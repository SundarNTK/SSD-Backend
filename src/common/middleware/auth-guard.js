const { verifySessionToken } = require("../utils/jwt");
const { exceptionHandler } = require("../../utilities/handlers");
const { User } = require("../../models/users");
const mergeRolePermissions = require("../../utilities/helpers/merge-role-permissions");

/**
 * Verifies the JWT, then re-reads the account and its permissions from the
 * database on every request. Both halves matter:
 *
 * 1. ACCOUNT STATE MUST BE LIVE. A JWT is valid for 8 hours. If deactivating
 *    a user (or their `accessUpto` lapsing) only took effect at login, then
 *    "deactivate" would mean "…in up to 8 hours", which is not what anyone
 *    clicking that toggle believes it means. Revoking access has to revoke
 *    access now.
 *
 * 2. PERMISSIONS MUST BE LIVE TOO — the token's `permissions` claim is a UI
 *    hint only, never the authority. The token still carries it so the
 *    Admin Panel can render its nav without a second round-trip, but this
 *    middleware overwrites `req.auth.permissions` with what the database
 *    actually says before any route guard reads it. Trusting the claim
 *    would mean a permission removed from a role stays exploitable for the
 *    rest of that session. (FSD §2.2 only sets a floor — "changes apply
 *    after re-login" — and applying them immediately clears that floor.)
 *
 * The cost is one indexed find-by-id with a populate per request. For an
 * admin panel used by temple staff that is a rounding error next to being
 * unable to revoke access.
 */
async function authGuard(req, res, next) {
  let payload;
  try {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : null;
    if (!token) throw new Error("missing token");
    payload = verifySessionToken(token);
  } catch {
    return exceptionHandler({
      res,
      error: "Session expired or invalid — please sign in again.",
      statusCode: 401,
    });
  }

  try {
    const user = await User.findOne(User.notDeletedFilter({ _id: payload.sub })).populate({
      path: "entities.roles",
      match: { isDeleted: false, status: 1 },
      select: "name permissions",
    });

    // Covers deleted, deactivated, and access-period-expired accounts in one
    // check — same rule login uses, applied continuously instead of once.
    if (!user || !user.isAccountUsable()) {
      return exceptionHandler({
        res,
        error: "This account is no longer active. Please contact an administrator.",
        statusCode: 401,
      });
    }

    const assignment = user.getDefaultEntityAssignment();
    const roles = (assignment?.roles || []).filter(Boolean);

    req.auth = {
      userId: String(user._id),
      userType: user.userType,
      entityId: assignment ? String(assignment.entity) : null,
      roles: roles.map((r) => String(r._id)),
      permissions: mergeRolePermissions(roles),
      user,
    };

    return next();
  } catch (error) {
    return exceptionHandler({ res, error });
  }
}

module.exports = authGuard;
