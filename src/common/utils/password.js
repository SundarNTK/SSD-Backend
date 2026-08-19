const bcrypt = require("bcryptjs");
const zxcvbn = require("zxcvbn");
const env = require("../../config/env");

const SEQUENTIAL_RUNS = ["0123456789", "abcdefghijklmnopqrstuvwxyz", "qwertyuiop", "asdfghjkl", "zxcvbnm"];

function hasSequentialRun(lower, len = 4) {
  return SEQUENTIAL_RUNS.some((run) => {
    for (let i = 0; i <= run.length - len; i++) {
      if (lower.includes(run.slice(i, i + len))) return true;
    }
    return false;
  });
}

function hasRepeatedRun(lower, len = 4) {
  for (let i = 0; i <= lower.length - len; i++) {
    if (new Set(lower.slice(i, i + len)).size === 1) return true;
  }
  return false;
}

/**
 * "Sundar Test" as a whole string only blocks a password containing the
 * literal substring "sundar test" — a password reusing just "Sundar" (the
 * actual real-world case) sailed straight through the naive whole-string
 * check. Split every personal value into its individual words (and an
 * email's local-part into its own sub-tokens on `.`/`_`/`-`/`+`) so each
 * one is checked on its own, not just the full string verbatim.
 */
function derivePersonalTokens(values) {
  const tokens = [];
  for (const raw of values) {
    if (!raw) continue;
    const value = String(raw);
    const base = value.includes("@") ? value.split("@")[0] : value;
    for (const token of base.split(/[\s._\-+]+/)) {
      if (token.length >= 3) tokens.push(token);
    }
  }
  return tokens;
}

/**
 * Server-side mirror of admin-frontend's `checkPasswordStrength` (§05 policy).
 * The API never trusts the client's own validation — this is the real gate.
 * Deliberately reuses the same `zxcvbn` package as the frontend so the two
 * never silently drift apart on what counts as "strong enough."
 */
function assertStrongPassword(password, personal = []) {
  const errors = [];
  const lower = String(password || "").toLowerCase();
  const personalTerms = derivePersonalTokens(personal);

  if (password.length < 12) errors.push("At least 12 characters");
  if (!/[A-Z]/.test(password)) errors.push("One uppercase letter");
  if (!/[a-z]/.test(password)) errors.push("One lowercase letter");
  if (!/[0-9]/.test(password)) errors.push("One number");
  if (!/[^A-Za-z0-9]/.test(password)) errors.push("One special character");

  if (personalTerms.some((v) => lower.includes(String(v).toLowerCase()))) {
    errors.push("Can't contain your name, email or mobile number");
  }

  if (hasSequentialRun(lower) || hasRepeatedRun(lower)) {
    errors.push("No sequential or repeated runs (e.g. 1234, aaaa)");
  }

  if (password.length >= 12) {
    const { score } = zxcvbn(password, personalTerms);
    if (score < 3) errors.push("This password is too easy to guess — try something longer and less predictable");
  }

  if (errors.length > 0) {
    throw errors.join(" · ");
  }
}

async function hashPassword(plainPassword) {
  return bcrypt.hash(plainPassword, env.BCRYPT_COST);
}

async function comparePassword(plainPassword, passwordHash) {
  if (!passwordHash) return false;
  return bcrypt.compare(plainPassword, passwordHash);
}

module.exports = { assertStrongPassword, hashPassword, comparePassword };