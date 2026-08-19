const { User } = require("../../../models/users");

function findActiveUserByEmail(email) {
  return User.findOne(User.notDeletedFilter({ email: String(email).trim().toLowerCase() })).select(
    "+passwordHash"
  );
}

module.exports = findActiveUserByEmail;
