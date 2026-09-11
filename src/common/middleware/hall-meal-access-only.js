const { exceptionHandler } = require("../../utilities/handlers");

/**
 * Gates the Hall & Meal masters to exactly one account (or however many an
 * Admin later flips this on for), by the `hallMealAccess` boolean on
 * models/users — NOT by `userType`. Deliberately does not special-case
 * SUPER_ADMIN: the ask here is "this one account", not "every Super
 * Admin", so a second Super Admin created later (`create:super-admin`)
 * is refused here exactly like a regular Admin_Users account, unless the
 * flag is turned on for it too.
 *
 * Same shape as `posAccess` (see models/users) — a capability that lives
 * on the account itself, orthogonal to Role permissions and to userType.
 * There is still no `requirePermission()` call anywhere in this area and
 * no entry in AVAILABLE_MODULES, so there's nothing a Role screen could
 * grant here even by accident.
 *
 * Mount it once per router, right after authGuard.
 */
function hallMealAccessOnly(req, res, next) {
  if (req.auth?.user?.hallMealAccess === true) return next();

  return exceptionHandler({
    res,
    error: "This area is restricted to the assigned Hall & Meal administrator.",
    statusCode: 403,
  });
}

module.exports = hallMealAccessOnly;
