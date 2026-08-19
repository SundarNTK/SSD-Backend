const crypto = require("crypto");

/**
 * Shared token helpers — activation links, password-reset links, and the
 * mobile-change OTP all need "generate a random secret, store only its
 * hash, compare hashes on verify." One implementation, reused by all three.
 */

function generateRawToken() {
  return crypto.randomBytes(32).toString("hex");
}

function hashToken(rawToken) {
  return crypto.createHash("sha256").update(rawToken).digest("hex");
}

function generateNumericOtp(digits = 6) {
  const min = 10 ** (digits - 1);
  const max = 10 ** digits - 1;
  return String(crypto.randomInt(min, max + 1));
}

function addMinutes(date, minutes) {
  return new Date(date.getTime() + minutes * 60_000);
}

function addHours(date, hours) {
  return new Date(date.getTime() + hours * 60 * 60_000);
}

module.exports = { generateRawToken, hashToken, generateNumericOtp, addMinutes, addHours };