/**
 * Creates an ADDITIONAL System Admin account on demand — distinct from
 * `seedSuperAdmin.js`, which only ever bootstraps the one default account
 * from .env and refuses to run again once that exists. Use this for a
 * personal login, or a teammate's, without editing .env each time.
 *
 * Usage:
 *   pnpm run create:super-admin -- --name "Your Name" --email you@example.com
 */
require("dotenv").config();
const env = require("../config/env");
const connectDatabase = require("../config/database");
const { User } = require("../models/users");
const createPendingUser = require("../utilities/helpers/create-pending-user");
const ensureCustomerProfileForUser = require("../utilities/helpers/ensure-customer-profile-for-user");
const { USER_TYPES } = require("../utilities/constants/user-types");
const ensureDefaultEntity = require("../utilities/helpers/ensure-default-entity");
const ensureDefaultRoles = require("../utilities/helpers/ensure-default-roles");
const { ensureDefaultEmailTemplates } = require("./seedEmailTemplates");
const sendTemplatedEmail = require("../utilities/helpers/send-templated-email");

function parseArgs() {
  const args = {};
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--name") args.name = argv[++i];
    if (argv[i] === "--email") args.email = argv[++i];
    if (argv[i] === "--mobile") args.mobileNumber = argv[++i];
  }
  return args;
}

async function run() {
  const { name, email, mobileNumber } = parseArgs();

  if (!name || !email) {
    console.error("\nUsage: pnpm run create:super-admin -- --name \"Your Name\" --email you@example.com [--mobile +6591234567]\n");
    process.exit(1);
  }

  await connectDatabase();

  const entity = await ensureDefaultEntity({
    code: env.DEFAULT_ENTITY_CODE,
    name: "Sri Siva Durga Temple",
    templeName: "Sri Siva Durga Temple",
    templeTamilName: "ஸ்ரீ சிவ துர்கா கோவில்",
  });
  await ensureDefaultEmailTemplates(entity._id);
  const roles = await ensureDefaultRoles();

  const normalizedEmail = String(email).trim().toLowerCase();
  const existing = await User.findOne(User.notDeletedFilter({ email: normalizedEmail }));
  if (existing) {
    console.log(`\n>>> A user with email "${normalizedEmail}" already exists (userType: ${existing.userType}).`);
    console.log(">>> Nothing created. Use /auth/forgot-password if they need a new password link.\n");
    process.exit(0);
  }

  const { user, rawToken } = await createPendingUser({
    name,
    email: normalizedEmail,
    mobileNumber: mobileNumber || null,
    userType: USER_TYPES.SUPER_ADMIN,
    entityId: entity._id,
    roleIds: [roles["System Admin"]._id],
  });

  // Both pools — staff are devotees too. See customer.service.js.
  const profile = await ensureCustomerProfileForUser(user, entity._id);

  const activationUrl = `${env.ADMIN_APP_URL}/admin/activate/${rawToken}`;
  await sendTemplatedEmail("ACCOUNT_ACTIVATION", entity._id, user.email, {
    name: user.name,
    activationUrl,
    expiresInHours: env.ACTIVATION_TOKEN_TTL_HOURS,
  });

  console.log("\n>>> System Admin created:");
  console.log(`    name: ${user.name}`);
  console.log(`    email: ${user.email}`);
  console.log(`    entity: ${entity.code}`);
  console.log(`    devotee profile: ${profile.customerCode}`);
  console.log(`    activation link (DRY_RUN — use this directly): ${activationUrl}\n`);

  process.exit(0);
}

run().catch((err) => {
  console.error(">>> create:super-admin failed:", err.message || err);
  process.exit(1);
});