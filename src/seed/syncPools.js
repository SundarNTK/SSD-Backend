/**
 * Brings the database in line with the two-pool rule: every account in the
 * user pool must also hold a profile in the customer pool.
 *
 * Also repairs the indexes those pools depend on. Mongoose will happily
 * create a missing index but never *modifies* an existing one, so an index
 * built under older options keeps its old definition forever unless
 * something drops it — which is what the first step does.
 *
 * Idempotent. Safe to re-run.
 *
 *   pnpm run sync:pools
 */
require("dotenv").config();
const mongoose = require("mongoose");
const connectDatabase = require("../config/database");
const { User } = require("../models/users");
const { Customer } = require("../models/customers");
const findCustomerByLinkedUserId = require("../utilities/helpers/find-customer-by-linked-user-id");
const ensureCustomerProfileForUser = require("../utilities/helpers/ensure-customer-profile-for-user");

/**
 * Indexes whose stored definition no longer matches the model. Dropping
 * them lets Mongoose's autoIndex rebuild each to the current spec on the
 * next boot; we rebuild explicitly below so the fix lands in this run.
 */
const STALE_INDEXES = [
  // Declared as unique + partialFilterExpression + sparse, which MongoDB
  // rejects outright — so this never existed and mobile numbers had no
  // uniqueness constraint at all.
  { collection: "users", name: "mobileNumber_1" },
  // Built before the soft-delete partial filter was introduced, so it still
  // reserves the mobile numbers of soft-deleted profiles.
  { collection: "customers", name: "mobileNumber_1" },
  // Same, for the code sequence.
  { collection: "customers", name: "customerCode_1" },
];

async function repairIndexes() {
  const db = mongoose.connection.db;

  for (const { collection, name } of STALE_INDEXES) {
    const existing = await db.collection(collection).indexes();
    const found = existing.find((i) => i.name === name);
    if (!found) {
      console.log(`  - ${collection}.${name}: absent, nothing to drop`);
      continue;
    }
    await db.collection(collection).dropIndex(name);
    console.log(`  - ${collection}.${name}: dropped`);
  }

  // Rebuild from the current model definitions.
  await User.syncIndexes();
  await Customer.syncIndexes();
  console.log("  - indexes rebuilt from current model definitions");
}

async function backfillCustomerPool() {
  const users = await User.find(User.notDeletedFilter());
  let created = 0;
  let already = 0;

  for (const user of users) {
    const assignment = user.getDefaultEntityAssignment();
    if (!assignment) {
      console.log(`  ! ${user.email}: no entity assignment, skipped`);
      continue;
    }

    const existing = await findCustomerByLinkedUserId(user._id);
    if (existing) {
      already++;
      continue;
    }

    try {
      const profile = await ensureCustomerProfileForUser(user, assignment.entity);
      console.log(`  + ${user.email} (${user.userType}) -> ${profile.customerCode}`);
      created++;
    } catch (err) {
      console.log(`  ! ${user.email}: ${err.message || err}`);
    }
  }

  return { created, already, total: users.length };
}

async function run() {
  await connectDatabase();

  console.log("\n>>> Repairing indexes");
  await repairIndexes();

  console.log("\n>>> Enrolling every login in the customer pool");
  const result = await backfillCustomerPool();

  const orphans = await Customer.countDocuments(
    Customer.notDeletedFilter({ linkedUserId: null })
  );

  console.log(
    `\n>>> Done. ${result.created} profile(s) created, ${result.already} already present, ` +
      `${result.total} account(s) checked.`
  );
  console.log(`>>> ${orphans} walk-in profile(s) with no login (expected once POS exists).\n`);
  process.exit(0);
}

run().catch((err) => {
  console.error(">>> sync:pools failed:", err);
  process.exit(1);
});
