const { User } = require("../../../models/users");

async function isUserMobileTaken(mobileNumber, excludeUserId) {
  if (!mobileNumber) return false;
  const filter = User.notDeletedFilter({ mobileNumber });
  if (excludeUserId) filter._id = { $ne: excludeUserId };
  return Boolean(await User.exists(filter));
}

module.exports = isUserMobileTaken;
