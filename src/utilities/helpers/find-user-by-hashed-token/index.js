const { User } = require("../../../models/users");
const { hashToken } = require("../../../common/utils/token");

/**
 * Shared "look this user up by a hashed token field, check it hasn't
 * expired" step — activate, reset-password, and the read-only token-info
 * endpoints (which power the Set-Password page's personal-info check
 * client-side) all need the exact same lookup+expiry logic.
 */
async function findUserByHashedToken(hashField, expiresField, rawToken) {
  const user = await User.findOne(User.notDeletedFilter({ [hashField]: hashToken(rawToken) })).select(
    `+${hashField}`
  );
  if (!user) return { user: null, reason: "invalid" };

  // A null expiry means "does not expire", not "expired". Activation
  // invitations are issued that way deliberately: an admin creates an
  // account, the person opens the email a fortnight later, and it still
  // works. What ends the link's life is being used — `activate` clears the
  // hash, so it stays strictly single-use. Password *reset* tokens always
  // carry a real expiry, and are unaffected by this.
  const expiresAt = user[expiresField];
  if (expiresAt && expiresAt.getTime() < Date.now()) {
    return { user: null, reason: "expired" };
  }
  return { user, reason: null };
}

module.exports = findUserByHashedToken;
