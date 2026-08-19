const { exceptionHandler } = require("../../utilities/handlers");
const { USER_TYPES } = require("../../utilities/constants/user-types");

/**
 * Gates a route on a specific module + level (view/edit/fullAccess).
 *
 * Reads `req.auth.permissions`, which auth-guard.js has already resolved
 * from the database for this request — deliberately NOT the `permissions`
 * claim carried in the JWT. That claim exists only so the Admin Panel can
 * render its navigation without an extra round-trip; treating it as the
 * authority here would leave every revoked permission exploitable until the
 * token expired.
 *
 * SUPER_ADMIN bypasses this entirely, same as everywhere else in the app.
 * Mount it after authGuard and adminOnly.
 */
function requirePermission(module, level = "view") {
  const guard = (req, res, next) => {
    if (req.auth?.userType === USER_TYPES.SUPER_ADMIN) return next();

    if (req.auth?.permissions?.[module]?.[level]) return next();

    return exceptionHandler({
      res,
      error: `You don't have ${level} access to ${module}.`,
      statusCode: 403,
    });
  };

  // An arrow function assigned to a const is named "guard", which tells you
  // nothing when you walk the router stack to audit what protects what.
  // Naming it after the grant it enforces makes the route table
  // self-documenting: every route states the permission it requires.
  Object.defineProperty(guard, "name", { value: `requirePermission:${module}:${level}` });
  return guard;
}

module.exports = requirePermission;
