/**
 * Single source of truth for permission module keys — the live permission
 * resolver (common/middleware/auth-guard.js), the Role Permission screen
 * (via GET /modules), and every route guard read from this list, so the
 * module tree is never hand-typed twice and drifting.
 *
 * RULE: a module key only belongs here if real routes are actually gated on
 * it. A key with no API behind it is worse than useless — it renders a
 * toggle in the Permission screen that silently grants nothing, which reads
 * to an admin as "access denied is broken". ("entities" used to sit here
 * for exactly that reason; there are no /entities routes, so it's gone
 * until the Entity Master is built.)
 *
 * Current key → route mapping:
 *   users            → GET/POST/PUT  /users
 *   customers        → GET/PUT       /customers   (admin-side devotee master;
 *                      distinct from /me/customer-profile, which is a devotee
 *                      reading their own record and needs no module grant)
 *   roles            → GET/POST/PUT/DELETE /roles, PUT /roles/:id/permissions, GET /modules
 *   email-templates  → CRUD /notifications/email-templates
 *                      CRUD /notifications/email-template-mappings
 *
 * Level semantics, applied consistently by every route:
 *   view       → read-only (GET)
 *   edit       → modify something that already exists (PUT)
 *   fullAccess → bring into or remove from existence (POST, DELETE), and
 *                any operation that changes who can do what
 */
/**
 * `group` mirrors the Admin Panel's main-menu heading, so the Permission
 * screen can lay itself out the same way the sidebar does — main menu, then
 * the modules beneath it. It ships from here rather than being hardcoded in
 * the frontend so a new master declares its home once and appears under the
 * right heading automatically.
 */
const AVAILABLE_MODULES = [
  { key: "users", label: "Admin Users", group: "Administration" },
  { key: "customers", label: "Customers", group: "Administration" },
  { key: "roles", label: "Roles & Permissions", group: "Administration" },
  { key: "email-templates", label: "Email Templates", group: "Administration" },
  { key: "printing-groups", label: "Printing Group Master", group: "Masters" },
  { key: "gst", label: "GST Master", group: "Masters" },
];

const MODULE_KEYS = AVAILABLE_MODULES.map((m) => m.key);
const PERMISSION_LEVELS = ["view", "edit", "fullAccess"];

module.exports = { AVAILABLE_MODULES, MODULE_KEYS, PERMISSION_LEVELS };
