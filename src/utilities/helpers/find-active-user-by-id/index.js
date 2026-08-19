const { User } = require("../../../models/users");

function findActiveUserById(id) {
  return User.findOne(User.notDeletedFilter({ _id: id }));
}

module.exports = findActiveUserById;
