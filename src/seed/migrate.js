/**
 * Brings existing records up to the current schema. Idempotent — safe to
 * re-run, and safe to run against a database that is already current.
 *
 *   pnpm run migrate
 *
 * Covers:
 *   1. userType values renamed to Admin_Users / Customers
 *   2. `uid` backfilled on every master that carries one
 *   3. `uCode` backfilled on users, and the counter advanced past them
 *   4. activation invitations that were issued with an expiry made permanent
 *   5. indexes resynced
 *   6. `portal` backfilled on Order/Booking rows that predate the field
 *   7. Service.salePrice backfilled from each row's old per-category price
 */
require("dotenv").config();
const mongoose = require("mongoose");
const connectDatabase = require("../config/database");
const { generateUid } = require("../common/utils/uid");
const { USER_TYPES } = require("../utilities/constants/user-types");
const { nextSequence } = require("../common/utils/sequence");

const { User } = require("../models/users");
const { Customer } = require("../models/customers");
const Role = require("../models/roles");
const EmailTemplate = require("../models/email-templates");
const EmailTemplateMapping = require("../models/email-template-mappings");
const { Order } = require("../models/orders");
const { Booking } = require("../models/bookings");

// Entity is excluded on purpose: it carries its own UUID `uid` predating the
// shared 10-character format, and rewriting it would break any reference.
const UID_MODELS = [
  ["User", User],
  ["Customer", Customer],
  ["Role", Role],
  ["EmailTemplate", EmailTemplate],
  ["EmailTemplateMapping", EmailTemplateMapping],
];

const LEGACY_USER_TYPES = [
  ["ADMIN", USER_TYPES.ADMIN_USER],
  ["CUSTOMER", USER_TYPES.CUSTOMER],
];

async function renameUserTypes() {
  for (const [from, to] of LEGACY_USER_TYPES) {
    const result = await mongoose.connection.db
      .collection("users")
      .updateMany({ userType: from }, { $set: { userType: to } });
    if (result.modifiedCount) console.log(`  ${from} -> ${to}: ${result.modifiedCount} account(s)`);
  }
  const counts = await mongoose.connection.db
    .collection("users")
    .aggregate([{ $group: { _id: "$userType", n: { $sum: 1 } } }])
    .toArray();
  counts.forEach((c) => console.log(`  now: ${c._id} = ${c.n}`));
}

async function backfillUids() {
  for (const [label, Model] of UID_MODELS) {
    // Written one at a time rather than in bulk: each needs its own random
    // uid, and the unique index has to be able to reject a duplicate.
    const docs = await Model.find({ $or: [{ uid: null }, { uid: { $exists: false } }] }).select("_id");
    let done = 0;
    for (const doc of docs) {
      for (let attempt = 0; attempt < 5; attempt++) {
        try {
          await Model.updateOne({ _id: doc._id }, { $set: { uid: generateUid() } });
          done++;
          break;
        } catch (err) {
          if (err?.code !== 11000) throw err; // anything but a collision is real
        }
      }
    }
    console.log(`  ${label}: ${done} uid(s) assigned${docs.length ? "" : " (already current)"}`);
  }
}

async function backfillUCodes() {
  const users = await User.find({ $or: [{ uCode: null }, { uCode: { $exists: false } }] })
    .sort({ createdAt: 1 })
    .select("_id email");

  for (const user of users) {
    const n = await nextSequence("userCode");
    await User.updateOne({ _id: user._id }, { $set: { uCode: `SSD-U${n}` } });
    console.log(`  ${user.email} -> SSD-U${n}`);
  }
  if (!users.length) console.log("  (all users already have a uCode)");
}

async function makeInvitationsPermanent() {
  // Only for accounts that never set a password — a spent invitation has a
  // null hash already and must stay that way.
  const result = await User.updateMany(
    { passwordSetAt: null, activationTokenHash: { $ne: null }, activationTokenExpiresAt: { $ne: null } },
    { $set: { activationTokenExpiresAt: null } }
  );
  console.log(`  ${result.modifiedCount} pending invitation(s) no longer expire`);
}

async function backfillBookingPortal() {
  // Every Order/Booking predating this field was created through the same
  // staff-gated /pos/booking/orders endpoint — no other flow has ever
  // existed — so backfilling "admin" is unambiguously correct, not a guess.
  // A raw {portal: "admin"} filter query wouldn't match these rows even
  // though Mongoose shows "admin" on read (the schema's declared default,
  // applied only at hydration, not stored) — this backfill closes that gap.
  const orderResult = await Order.updateMany({ portal: { $exists: false } }, { $set: { portal: "admin" } });
  console.log(`  Order: ${orderResult.modifiedCount} row(s) backfilled to portal="admin"`);

  const bookingResult = await Booking.updateMany({ portal: { $exists: false } }, { $set: { portal: "admin" } });
  console.log(`  Booking: ${bookingResult.modifiedCount} row(s) backfilled to portal="admin"`);
}

/**
 * Service.salePrice used to live per categoryDetails row (a service could
 * be priced differently under each category/sub-category it was mapped
 * to); it's now one service-level figure, matching how Item.salePrice
 * already worked. The old per-row field is no longer part of the schema,
 * so a row created before this change would otherwise read as salePrice: 0
 * once the new code deploys — this backfills it from that row's first
 * (and in practice, in this system's history, only ever used) price.
 * Reads/writes the raw collection: Mongoose's current schema no longer
 * declares categoryDetails[].salePrice, so a model-level find() wouldn't
 * expose it even though it's still physically stored on old documents.
 */
async function backfillServiceSalePrice() {
  const services = await mongoose.connection.db
    .collection("services")
    .find({ salePrice: { $exists: false } })
    .toArray();

  for (const svc of services) {
    const price = svc.categoryDetails?.[0]?.salePrice ?? 0;
    await mongoose.connection.db.collection("services").updateOne({ _id: svc._id }, { $set: { salePrice: price } });
    console.log(`  ${svc.name ?? svc._id}: salePrice -> ${price}`);
  }
  if (!services.length) console.log("  (all services already have a top-level salePrice)");
}

async function run() {
  await connectDatabase();

  console.log("\n>>> 1. Renaming userType values");
  await renameUserTypes();

  console.log("\n>>> 2. Backfilling uid");
  await backfillUids();

  console.log("\n>>> 3. Backfilling uCode");
  await backfillUCodes();

  console.log("\n>>> 4. Making pending invitations permanent");
  await makeInvitationsPermanent();

  console.log("\n>>> 5. Syncing indexes");
  for (const [label, Model] of UID_MODELS) {
    // An earlier revision created a plain non-unique `uid_1`. Mongoose won't
    // alter an existing index, and syncIndexes fails outright when the name
    // matches but the spec doesn't — so drop it and let it be rebuilt.
    const collection = Model.collection;
    const existing = await collection.indexes().catch(() => []);
    const staleUid = existing.find((i) => i.name === "uid_1" && !i.unique);
    if (staleUid) {
      await collection.dropIndex("uid_1");
      console.log(`  ${label}: dropped non-unique uid_1`);
    }
    await Model.syncIndexes();
    console.log(`  ${label}: indexes synced`);
  }

  console.log("\n>>> 6. Backfilling portal on Order/Booking");
  await backfillBookingPortal();

  console.log("\n>>> 7. Backfilling Service.salePrice");
  await backfillServiceSalePrice();

  console.log("\n>>> Migration complete.\n");
  process.exit(0);
}

run().catch((err) => {
  console.error(">>> migrate failed:", err);
  process.exit(1);
});
