/**
 * The three roles from the FSD's User Roles/Access table (§2.1), one per
 * userType. SUPER_ADMIN doesn't actually need its role's `permissions` to
 * enforce anything — the userType itself bypasses per-module checks (§05
 * Identity & Access) — this exists so the Role Master has a real record to
 * show, and so createPendingUser() has something concrete to assign.
 */
const DEFAULT_ROLES = [
  {
    name: "System Admin",
    description: "Full access to every module — not gated by the permissions list below, the account's userType alone grants this.",
    permissions: [],
  },
  {
    name: "Admin",
    description: "Staff access — per-module permissions are managed from Role Permission Management.",
    permissions: [
      { module: "users", view: true, edit: true, fullAccess: false },
      { module: "roles", view: true, edit: false, fullAccess: false },
      { module: "email-templates", view: true, edit: true, fullAccess: false },
    ],
  },
  {
    name: "Customer",
    description: "No Admin Panel access — Customer Portal only.",
    permissions: [],
  },
];

/**
 * Roles the platform itself depends on. They can be renamed or have their
 * permissions tuned by a System Admin, but a non-System-Admin must never be
 * able to touch them — "System Admin" in particular is the role every
 * bootstrap script assigns, and deleting it would break account creation.
 */
const SYSTEM_ROLE_NAMES = DEFAULT_ROLES.map((r) => r.name);

module.exports = { DEFAULT_ROLES, SYSTEM_ROLE_NAMES };
