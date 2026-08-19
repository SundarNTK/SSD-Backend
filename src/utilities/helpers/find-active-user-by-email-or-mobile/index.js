const { User } = require("../../../models/users");

function isLikelyEmail(identifier) {
  return /@/.test(identifier);
}

function findActiveUserByEmailOrMobile(identifier) {
  const value = String(identifier).trim();
  const filter = isLikelyEmail(value)
    ? { email: value.toLowerCase() }
    : { mobileNumber: value };
  return User.findOne(User.notDeletedFilter(filter));
}

module.exports = findActiveUserByEmailOrMobile;
