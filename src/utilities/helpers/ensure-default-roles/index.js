const Role = require("../../../models/roles");
const { DEFAULT_ROLES } = require("../../constants/default-roles");
const findActiveRoleByName = require("../find-active-role-by-name");

/** Idempotent — safe to run on every seed/create-account script. */
async function ensureDefaultRoles() {
  const roles = {};
  for (const def of DEFAULT_ROLES) {
    let role = await findActiveRoleByName(def.name);
    if (!role) {
      role = await Role.create(def);
      console.log(`>>> Seed: role "${def.name}" created`);
    }
    roles[def.name] = role;
  }
  return roles;
}

module.exports = ensureDefaultRoles;
