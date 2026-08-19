const Role = require("../../../models/roles");
const activeRoleFilter = require("../active-role-filter");

function findAllActiveRoles() {
  return Role.find(activeRoleFilter()).sort({ name: 1 });
}

module.exports = findAllActiveRoles;
