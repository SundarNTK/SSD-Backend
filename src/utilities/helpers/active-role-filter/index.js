const Role = require("../../../models/roles");

/**
 * `status: 1` matters as much as `isDeleted: false` here — without it,
 * deactivating a role in the Role Master would keep granting every one of
 * its permissions, making the Active/Inactive toggle silently decorative.
 */
function activeRoleFilter(extra = {}) {
  return Role.notDeletedFilter({ status: 1, ...extra });
}

module.exports = activeRoleFilter;
