/**
 * Merges permission entries across role DOCUMENTS into one
 * `{ module: { view, edit, fullAccess } }` map, normalizing the
 * fullAccess→edit→view implication along the way. Pure — the caller decides
 * where the role documents came from, so the live per-request resolver
 * (common/middleware/auth-guard.js, which already has them populated) and
 * the id-based lookup (utilities/helpers/resolve-merged-permissions) share
 * one merge implementation instead of two that can drift.
 */
function mergeRolePermissions(roleDocs = []) {
  const merged = {};

  for (const role of roleDocs) {
    if (!role) continue;
    for (const perm of role.permissions || []) {
      const existing = merged[perm.module] || { view: false, edit: false, fullAccess: false };
      merged[perm.module] = {
        view: existing.view || perm.view || perm.edit || perm.fullAccess,
        edit: existing.edit || perm.edit || perm.fullAccess,
        fullAccess: existing.fullAccess || perm.fullAccess,
      };
    }
  }

  return merged;
}

module.exports = mergeRolePermissions;
