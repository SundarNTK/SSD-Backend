const { User } = require("../../../models/users");
const { generateRawToken, hashToken } = require("../../../common/utils/token");
const isUserEmailTaken = require("../is-user-email-taken");
const isUserMobileTaken = require("../is-user-mobile-taken");
const generateUserCode = require("../generate-user-code");

/**
 * The shared "create an unactivated account + issue an activation token"
 * step — used by the public register endpoint (auth.controller.js) and the
 * admin-creates-a-staff-account flow (the User Master). One place, so both
 * paths stay consistent instead of drifting.
 *
 * Deliberately does NOT decide who's allowed to call this with which
 * userType — that's the caller's job. The public register endpoint only
 * ever passes userType: "CUSTOMER"; nothing here would stop a future admin
 * flow from creating an ADMIN account, since that path checks permissions
 * before it ever gets here.
 */
async function createPendingUser({
  name,
  email,
  mobileNumber,
  userType,
  entityId,
  roleIds = [],
  createdBy,
  profileImage = null,
  status = 1,
  accessUpto = null,
  posAccess = false,
}) {
  if (await isUserEmailTaken(email)) throw "An account with this email already exists.";
  if (mobileNumber && (await isUserMobileTaken(mobileNumber))) {
    throw "An account with this mobile number already exists.";
  }

  const rawToken = generateRawToken();

  const user = await User.create({
    uCode: await generateUserCode(),
    name,
    email: String(email).trim().toLowerCase(),
    mobileNumber: mobileNumber || null,
    profileImage,
    userType,
    entities: entityId ? [{ entity: entityId, roles: roleIds, default: true }] : [],
    status,
    accessUpto,
    posAccess,
    createdBy: createdBy || null,
    activationTokenHash: hashToken(rawToken),
    // Null on purpose — the invitation stays valid until it's used. See
    // find-user-by-hashed-token above, and models/users for the reasoning.
    activationTokenExpiresAt: null,
  });

  return { user, rawToken };
}

module.exports = createPendingUser;
