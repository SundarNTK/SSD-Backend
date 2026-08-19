const findUserByHashedToken = require("../find-user-by-hashed-token");

function findUserByResetToken(rawToken) {
  return findUserByHashedToken("passwordResetTokenHash", "passwordResetTokenExpiresAt", rawToken);
}

module.exports = findUserByResetToken;
