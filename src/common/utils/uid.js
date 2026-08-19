const crypto = require("crypto");

/**
 * Public record identifier — 10 characters mixing digits, uppercase,
 * lowercase and symbols, carried by every master (see plugins/auditable.js).
 *
 * Separate from Mongo's `_id` on purpose. An ObjectId leaks its creation
 * timestamp and is sequential enough to guess neighbours from; `uid` is the
 * value that's safe to put in a URL, a QR code on a printed receipt, or a
 * support conversation. Also separate from display codes like `SSD-U1`,
 * which are deliberately human-readable and therefore deliberately guessable.
 */
const DIGITS = "23456789"; // 0/1 omitted — they read as O/l when someone types a uid off a printout
const UPPER = "ABCDEFGHJKMNPQRSTUVWXYZ"; // I, L, O omitted for the same reason
const LOWER = "abcdefghijkmnopqrstuvwxyz"; // l omitted
const SYMBOLS = "@#$%&*+=?";
const ALL = DIGITS + UPPER + LOWER + SYMBOLS;

const UID_LENGTH = 10;

/** Uniform pick — `crypto.randomInt` avoids the modulo bias `% length` introduces. */
function pick(alphabet) {
  return alphabet[crypto.randomInt(0, alphabet.length)];
}

/**
 * Guarantees at least one character from each class, then fills the rest at
 * random and shuffles — otherwise "random 10 from the full set" occasionally
 * produces a uid with no symbol, and the format stops being a format.
 */
function generateUid() {
  const chars = [pick(DIGITS), pick(UPPER), pick(LOWER), pick(SYMBOLS)];
  while (chars.length < UID_LENGTH) chars.push(pick(ALL));

  // Fisher–Yates, so the guaranteed characters aren't always in positions 0-3.
  for (let i = chars.length - 1; i > 0; i--) {
    const j = crypto.randomInt(0, i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }

  return chars.join("");
}

module.exports = { generateUid, UID_LENGTH };
