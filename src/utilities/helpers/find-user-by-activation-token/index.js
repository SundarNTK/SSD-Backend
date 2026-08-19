const findUserByHashedToken = require("../find-user-by-hashed-token");

function findUserByActivationToken(rawToken) {
  return findUserByHashedToken("activationTokenHash", "activationTokenExpiresAt", rawToken);
}

module.exports = findUserByActivationToken;
