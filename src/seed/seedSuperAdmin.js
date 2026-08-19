/**
 * There's no UI path to create the very first entity, roles, email
 * templates, or account — someone/something has to exist before the
 * Login/Set-Password screens have anyone or anything to work with.
 * Run once per environment: `pnpm run seed:super-admin`
 *
 * Reads SEED_SUPER_ADMIN_NAME / _EMAIL / DEFAULT_ENTITY_CODE from .env if
 * present, otherwise falls back to the defaults in config/env.js.
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
const { generateRawToken, hashToken, addHours } = require("../common/utils/token");
const sendTemplatedEmail = require("../utilities/helpers/send-templated-email");

async function run() {
  await connectDatabase();

  const entity = await ensureDefaultEntity({
    code: env.DEFAULT_ENTITY_CODE,
    name: "Sri Siva Durga Temple",
    templeName: "Sri Siva Durga Temple",
    templeTamilName: "ஸ்ரீ சிவ துர்கா கோவில்",
  });
  console.log(`>>> Seed: entity "${entity.code}" (${entity.name}) ready — _id ${entity._id}`);

  await ensureDefaultEmailTemplates(entity._id);

  const roles = await ensureDefaultRoles();
  const superAdminRole = roles["Super Admin"];
  console.log(`>>> Seed: roles ready — Super Admin / Admin / Customer`);

  const email = env.SEED_SUPER_ADMIN_EMAIL;
  const existing = await User.findOne(User.notDeletedFilter({ email }));

  if (existing) {
    // Retroactive fix for an account created before roles existed — this is
    // exactly the "created before role assignment landed" case.
    const assignment = existing.getDefaultEntityAssignment();
    const alreadyHasRole = assignment?.roles?.some((r) => String(r) === String(superAdminRole._id));
    if (assignment && !alreadyHasRole) {
      assignment.roles = [superAdminRole._id];
      await existing.save();
      console.log(`>>> Seed: assigned "Super Admin" role to existing user "${email}"`);
    } else {
      console.log(`>>> Seed: user "${email}" already exists (userType: ${existing.userType}) and already has a role.`);
    }
    // Same retroactive treatment for the customer pool — accounts created
    // before staff were enrolled there need a profile too.
    const profile = await ensureCustomerProfileForUser(existing, entity._id);
    console.log(`>>> Seed: devotee profile ready — ${profile.customerCode}`);
    process.exit(0);
  }

  const { user, rawToken } = await createPendingUser({
    name: env.SEED_SUPER_ADMIN_NAME,
    email,
    userType: USER_TYPES.SUPER_ADMIN,
    entityId: entity._id,
    roleIds: [superAdminRole._id],
  });

  const profile = await ensureCustomerProfileForUser(user, entity._id);

  const activationUrl = `${env.ADMIN_APP_URL}/admin/activate/${rawToken}`;

  await sendTemplatedEmail("ACCOUNT_ACTIVATION", entity._id, user.email, {
    name: user.name,
    activationUrl,
    expiresInHours: env.ACTIVATION_TOKEN_TTL_HOURS,
  });

  console.log("\n>>> Super Admin created:");
  console.log(`    email: ${user.email}`);
  console.log(`    entity: ${entity.code}`);
  console.log(`    role: Super Admin`);
  console.log(`    devotee profile: ${profile.customerCode}`);
  console.log(`    activation link (DRY_RUN — use this directly): ${activationUrl}\n`);

  process.exit(0);
}

run().catch((err) => {
  console.error(">>> Seed failed:", err);
  process.exit(1);
});