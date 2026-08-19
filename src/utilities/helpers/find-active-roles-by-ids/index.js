const Role = require("../../../models/roles");
const activeRoleFilter = require("../active-role-filter");

async function findActiveRolesByIds(roleIds = []) {
  if (!roleIds.length) return [];
  return Role.find(activeRoleFilter({ _id: { $in: roleIds } }));
}

module.exports = findActiveRolesByIds;
