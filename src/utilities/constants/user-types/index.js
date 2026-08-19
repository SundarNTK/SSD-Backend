/**
 * Account types. Stored on `User.userType`, and the basis for the
 * structural checks that run before any module permission is consulted.
 *
 * These are the values written to the database, not display labels — the
 * Admin Panel maps them to "Admin User" / "Customer" for the screen. There
 * is no user-type picker in the UI at all: the creating surface decides.
 *
 *   ADMIN_USER — created from the Admin Panel's User master.
 *   CUSTOMER   — created by public registration, or at the POS counter later.
 *   SUPER_ADMIN — deliberately NOT creatable from any screen. It bypasses
 *                 every module permission, so it only comes from the
 *                 bootstrap scripts (`seed:super-admin`, `create:super-admin`)
 *                 where someone already has shell access to the server.
 */
const USER_TYPES = {
  SUPER_ADMIN: "SUPER_ADMIN",
  ADMIN_USER: "Admin_Users",
  CUSTOMER: "Customers",
};

const USER_TYPE_VALUES = Object.values(USER_TYPES);

/** Types that may reach the Admin Panel at all (see middleware/admin-only.js). */
const ADMIN_PANEL_TYPES = [USER_TYPES.SUPER_ADMIN, USER_TYPES.ADMIN_USER];

function isAdminPanelType(userType) {
  return ADMIN_PANEL_TYPES.includes(userType);
}

module.exports = { USER_TYPES, USER_TYPE_VALUES, ADMIN_PANEL_TYPES, isAdminPanelType };
