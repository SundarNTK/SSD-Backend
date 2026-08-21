const { PERMISSION_LEVELS } = require("../../utilities/constants/modules");
const { USER_TYPES } = require("../../utilities/constants/user-types");

/**
 * Guards against vertical privilege escalation — the class of bug where
 * someone with permission to manage users or roles uses exactly that
 * permission to give themselves more than they started with.
 *
 * Every check here is a no-op for SUPER_ADMIN, which is the one account
 * type that legitimately sits above the permission system.
 */

function isSuperAdmin(req) {
  return req.auth?.userType === USER_TYPES.SUPER_ADMIN;
}

/** Does the actor personally hold `module`.`level` right now? */
function actorHolds(req, module, level) {
  return Boolean(req.auth?.permissions?.[module]?.[level]);
}

/**
 * Nobody may hand out access they don't themselves hold.
 *
 * Without this, one admin with `roles:fullAccess` — a permission that
 * sounds like "can manage the Roles master" — could grant a role
 * `users:fullAccess`, assign it to themselves, log back in, and now create
 * accounts. Repeat across modules and "can edit roles" quietly becomes
 * "can do everything".
 *
 * `permissionEntries` is the raw [{ module, view, edit, fullAccess }] shape
 * the Permission screen submits.
 */
function findUngrantable(req, permissionEntries = []) {
  if (isSuperAdmin(req)) return null;

  for (const entry of permissionEntries) {
    for (const level of PERMISSION_LEVELS) {
      if (entry[level] && !actorHolds(req, entry.module, level)) {
        return { module: entry.module, level };
      }
    }
  }
  return null;
}

function assertGrantablePermissions(req, permissionEntries = []) {
  const violation = findUngrantable(req, permissionEntries);
  if (violation) {
    throw `You can't grant ${violation.level} access to ${violation.module} — you don't hold it yourself.`;
  }
}

/**
 * Boolean form, for deciding what to *offer* rather than what to refuse.
 * The role picker uses this so someone is never shown a role that assigning
 * would immediately bounce with a 403.
 */
function canGrantRole(req, role) {
  return findUngrantable(req, role?.permissions || []) === null;
}

/**
 * Same rule, expressed against whole role documents — used when assigning
 * roles to a user, where the escalation is indirect (the actor isn't
 * editing permissions, just attaching a role that already carries them).
 */
function assertGrantableRoles(req, roleDocs = []) {
  if (isSuperAdmin(req)) return;

  for (const role of roleDocs) {
    assertGrantablePermissions(req, role.permissions || []);
  }
}

/**
 * Editing a role you personally hold is self-escalation with an extra step:
 * add a permission to your own role, sign in again, keep it. System Admins
 * are exempt (they already bypass permissions entirely, so there's nothing
 * to escalate to).
 */
function assertNotOwnRole(req, roleId) {
  if (isSuperAdmin(req)) return;

  const holdsIt = (req.auth?.roles || []).some((id) => String(id) === String(roleId));
  if (holdsIt) {
    throw "You can't change the permissions of a role assigned to your own account.";
  }
}

module.exports = {
  isSuperAdmin,
  actorHolds,
  findUngrantable,
  assertGrantablePermissions,
  assertGrantableRoles,
  canGrantRole,
  assertNotOwnRole,
};
