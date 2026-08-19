const { exceptionHandler } = require("../../utilities/handlers");
const { isAdminPanelType } = require("../../utilities/constants/user-types");

/**
 * Blocks CUSTOMER accounts from every Admin Panel surface, by userType
 * rather than by permissions.
 *
 * Without this the only thing keeping a Customer out of the admin API is
 * the fact that their role happens to carry no permissions — which is a
 * data coincidence, not a boundary. Anyone who later grants the Customer
 * role a module toggle, or mounts a route with `authGuard` but no
 * `requirePermission`, silently opens the whole Admin Panel to every
 * registered temple devotee. (That is exactly how the notification routes
 * were reachable by customers before this existed.)
 *
 * Mount it once per admin router, right after authGuard. FSD §2.1:
 * Customer = "No Admin Panel access — Customer Portal only."
 */
function adminOnly(req, res, next) {
  if (isAdminPanelType(req.auth?.userType)) return next();

  return exceptionHandler({
    res,
    error: "This area is restricted to temple administrators.",
    statusCode: 403,
  });
}

module.exports = adminOnly;
