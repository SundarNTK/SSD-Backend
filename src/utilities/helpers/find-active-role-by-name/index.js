const Role = require("../../../models/roles");

function findActiveRoleByName(name) {
  return Role.findOne(Role.notDeletedFilter({ name }));
}

module.exports = findActiveRoleByName;
