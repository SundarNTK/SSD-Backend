const jwt = require("jsonwebtoken");
const env = require("../../config/env");

/**
 * The token carries the resolved *default* entity + that entity's roles,
 * plus a `permissions` snapshot merged from those roles (FSD §2.2 — see
 * common/middleware/require-permission.js for why this is a snapshot, not
 * a live lookup). `permissions` is precomputed by the caller (roleService
 * .resolveMergedPermissions) rather than fetched in here, so this module
 * stays a pure signer/verifier with no dependency on the Role model.
 */
function signSessionToken(user, permissions = {}) {
  const defaultAssignment = user.getDefaultEntityAssignment();
  return jwt.sign(
    {
      sub: String(user._id),
      userType: user.userType,
      entityId: defaultAssignment ? String(defaultAssignment.entity) : null,
      roles: (defaultAssignment?.roles || []).map(String),
      permissions,
    },
    env.JWT_SECRET,
    { expiresIn: env.JWT_EXPIRES_IN }
  );
}

function verifySessionToken(token) {
  return jwt.verify(token, env.JWT_SECRET);
}

module.exports = { signSessionToken, verifySessionToken };
