const express = require("express");
const authGuard = require("../../common/middleware/auth-guard");
const adminOnly = require("../../common/middleware/admin-only");
const requirePermission = require("../../common/middleware/require-permission");
const validateBody = require("../../common/middleware/validate");
const makeCrudController = require("../../common/factories/crud-controller");
const { responseHandler, exceptionHandler } = require("../../utilities/handlers");
const { AVAILABLE_MODULES } = require("../../utilities/constants/modules");
const { SYSTEM_ROLE_NAMES } = require("../../utilities/constants/default-roles");
const {
  isSuperAdmin,
  assertGrantablePermissions,
  assertNotOwnRole,
} = require("../../common/utils/escalation");

const Role = require("../../models/roles");
const { User } = require("../../models/users");
const { createSchema, updateSchema, updatePermissionsSchema } = require("./request-objects");

/** 403 for the escalation/authorization refusals, 404 only for a genuinely missing role. */
function statusFor(error, fallback) {
  return typeof error === "string" ? fallback : undefined;
}

async function loadRole(id) {
  const role = await Role.findOne(Role.notDeletedFilter({ _id: id }));
  if (!role) throw "Role not found.";
  return role;
}

/**
 * Two separate rules, and the order matters — the stricter one runs first.
 *
 * 1. Locked roles ("System Admin", "Customer") are refused for EVERYONE,
 *    System Admins included. Their behaviour comes from the account's
 *    userType, so there is nothing here that editing could change, and the
 *    bootstrap scripts look them up by name. See models/roles/index.js.
 * 2. Remaining seeded roles — "Admin" today — are configurable, but only by
 *    a System Admin.
 */
function assertRoleIsEditable(req, role) {
  if (role.isLocked) {
    throw `"${role.name}" is managed by the system and can't be edited or removed — access for this role is decided by account type, not by module permissions.`;
  }
  if (isSuperAdmin(req)) return;
  if (SYSTEM_ROLE_NAMES.includes(role.name)) {
    throw `"${role.name}" is a system role — only a System Admin can change it.`;
  }
}

/**
 * Replaces a role's whole permissions array, normalizing the
 * fullAccess→edit→view implication server-side (never trusting the client
 * to have applied it) after two escalation checks: the actor can't grant
 * anything they don't hold, and can't edit a role they hold themselves.
 *
 * Because permissions are resolved live per request (see auth-guard.js),
 * saving here takes effect on the affected users' very next request — no
 * re-login needed, and no window where a just-revoked permission still works.
 */
async function updatePermissions(req, res) {
  try {
    const role = await loadRole(req.params.id);
    assertRoleIsEditable(req, role);
    assertNotOwnRole(req, role._id);
    assertGrantablePermissions(req, req.body.permissions);

    role.permissions = req.body.permissions.map((p) => ({
      module: p.module,
      view: p.view || p.edit || p.fullAccess,
      edit: p.edit || p.fullAccess,
      fullAccess: p.fullAccess,
    }));
    role.updatedBy = req.auth?.userId || null;
    await role.save();

    return responseHandler({ res, response: role, successMessage: "Permissions updated successfully." });
  } catch (error) {
    return exceptionHandler({ res, error, statusCode: statusFor(error, 403) });
  }
}

async function update(req, res) {
  try {
    const role = await loadRole(req.params.id);
    assertRoleIsEditable(req, role);

    const { name, description, status } = req.body;
    if (name !== undefined) role.name = name;
    if (description !== undefined) role.description = description;
    if (status !== undefined) role.status = status;
    role.updatedBy = req.auth?.userId || null;
    await role.save();

    return responseHandler({ res, response: role, successMessage: "Updated successfully." });
  } catch (error) {
    if (error?.code === 11000) {
      return exceptionHandler({ res, error: "A role with this name already exists.", statusCode: 409 });
    }
    return exceptionHandler({ res, error, statusCode: statusFor(error, 403) });
  }
}

/**
 * A role still attached to any live account cannot be removed.
 *
 * "Live" here means not deleted — deliberately nothing more. An inactive
 * account, or one whose `accessUpto` has lapsed, still counts as holding the
 * role: both of those states are reversible, and reactivating someone whose
 * role had been quietly deleted underneath them would silently return them
 * with less access than before, which is the kind of bug nobody thinks to
 * look for. Only a deleted account releases its claim.
 */
async function assertRoleUnassigned(role) {
  const holders = await User.find(User.notDeletedFilter({ "entities.roles": role._id }))
    .select("name email status accessUpto")
    .limit(6);

  if (holders.length === 0) return;

  const shown = holders.slice(0, 5).map((u) => u.name || u.email);
  const suffix = holders.length > 5 ? ` and ${holders.length - 5} more` : "";
  throw (
    `"${role.name}" is still assigned to ${shown.join(", ")}${suffix}. ` +
    `Reassign or delete those accounts first — deactivating them is not enough.`
  );
}

async function remove(req, res) {
  try {
    const role = await loadRole(req.params.id);
    assertRoleIsEditable(req, role);
    assertNotOwnRole(req, role._id);
    await assertRoleUnassigned(role);

    await role.softDelete(req.auth?.userId);
    return responseHandler({ res, successMessage: "Role deleted successfully." });
  } catch (error) {
    return exceptionHandler({ res, error, statusCode: statusFor(error, 409) });
  }
}

// Mounted at /roles — see routes/index.js for why the prefix lives there
// and not in these paths.
const router = express.Router();
router.use(authGuard, adminOnly);

const crud = makeCrudController(Role, { searchFields: ["name", "description"] });

// Declared before "/:id" so "modules" is never swallowed as a role id.
// Powers the Permission screen's module tree — never hardcoded on the frontend.
router.get("/modules", requirePermission("roles", "view"), (req, res) =>
  responseHandler({ res, response: AVAILABLE_MODULES })
);

router.get("/", requirePermission("roles", "view"), crud.list);
router.post("/", requirePermission("roles", "fullAccess"), validateBody(createSchema), crud.create);

// update/remove are hand-written, not the factory's — they need the
// system-role and self-escalation guards the generic factory knows nothing about.
router.put("/:id", requirePermission("roles", "edit"), validateBody(updateSchema), update);
router.delete("/:id", requirePermission("roles", "fullAccess"), remove);

// fullAccess, not edit: this route changes who can do what, which is a
// higher bar than editing a role's name (see utilities/constants/modules).
router.put(
  "/:id/permissions",
  requirePermission("roles", "fullAccess"),
  validateBody(updatePermissionsSchema),
  updatePermissions
);

module.exports = router;
