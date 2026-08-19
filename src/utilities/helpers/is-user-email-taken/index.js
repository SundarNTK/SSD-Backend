const { User } = require("../../../models/users");

async function isUserEmailTaken(email, excludeUserId) {
  const filter = User.notDeletedFilter({ email: String(email).trim().toLowerCase() });
  if (excludeUserId) filter._id = { $ne: excludeUserId };
  return Boolean(await User.exists(filter));
}

module.exports = isUserEmailTaken;
