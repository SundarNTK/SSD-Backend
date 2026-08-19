const findActiveRolesByIds = require("../find-active-roles-by-ids");
const mergeRolePermissions = require("../merge-role-permissions");

async function resolveMergedPermissions(roleIds = []) {
  if (!roleIds.length) return {};
  return mergeRolePermissions(await findActiveRolesByIds(roleIds));
}

module.exports = resolveMergedPermissions;
