const crypto = require("crypto");

/**
 * The external, gateway-facing correlation key for a payment order — the
 * thing PayNow's QR "Event_Order_Ref_No" and the NETS terminal's "orderId"
 * actually carry, and the thing the shared confirmation dispatcher
 * (controllers/payments) parses to route a settled payment back to the
 * right origin module (see HEB's Payment-Service, which does exactly this
 * with `customerReference.startsWith("HEB-OBS-MB")` vs `"HEB-HPS"`).
 *
 * Always exactly 13 characters: a 3-letter origin prefix + a 10-character
 * alphanumeric body.
 *
 * The body is crypto-random, NOT a sequential counter. An earlier version
 * of this used one global atomic counter (nextSequence("payment_order")) —
 * that never actually risked exhaustion (10 digits is 10 billion values),
 * but a sequential id is a different kind of problem: it's guessable.
 * Reference ids are handed to a bank and a payment terminal and settle
 * through a public webhook — an id an attacker can predict from a real one
 * ("the last order was ...0000000042, try ...0000000043") is an
 * enumeration surface against that webhook, on top of leaking exactly how
 * many orders the counter has ever processed. common/utils/uid.js already
 * exists in this codebase for the identical problem (a public record id
 * that must not be guessable, unlike Mongo's own sequential-ish ObjectId)
 * — this mirrors that same approach: crypto.randomInt-driven, restricted to
 * an alphabet with the classic ambiguous characters removed (0/O, 1/I/L —
 * easy to mistype or misread off a printed receipt/QR).
 *
 * A 31-character alphabet at 10 characters is 31^10 (~8.2 x 10^14)
 * possible bodies per prefix — several orders of magnitude more headroom
 * than the old 10-digit counter ever had, with none of it predictable from
 * a previously-seen id. Uniqueness is still guaranteed the same way every
 * other business-facing id in this codebase is (orderNumber, bookingNumber,
 * receiptNo): a unique index at the collection level, with the caller
 * retrying on the practically-never-hit collision — see
 * withUniqueReferenceId() below, and models/pos-orders' unique index on
 * `referenceId`.
 */
const DIGITS = "23456789"; // 0/1 omitted — read as O/l off a printout or QR
const UPPER = "ABCDEFGHJKMNPQRSTUVWXYZ"; // I, L, O omitted for the same reason
const ALPHABET = DIGITS + UPPER;

const REFERENCE_ID_LENGTH = 13;
const PREFIX_LENGTH = 3;
const BODY_LENGTH = REFERENCE_ID_LENGTH - PREFIX_LENGTH;

// Every origin module that mints its own reference ids registers its
// 3-letter prefix here — one place to see the full set and catch a
// duplicate/mistyped prefix at require time instead of at booking time.
const ORIGIN_PREFIXES = {
  POS: "POS",
};

/** Uniform pick — crypto.randomInt avoids the modulo bias `% length` introduces. */
function pick(alphabet) {
  return alphabet[crypto.randomInt(0, alphabet.length)];
}

function generatePaymentReferenceId(prefix) {
  if (typeof prefix !== "string" || prefix.length !== PREFIX_LENGTH) {
    throw new Error(`generatePaymentReferenceId: prefix must be exactly ${PREFIX_LENGTH} characters, got "${prefix}"`);
  }
  let body = "";
  for (let i = 0; i < BODY_LENGTH; i++) body += pick(ALPHABET);
  return `${prefix}${body}`;
}

/**
 * Which origin module a reference id belongs to — the one piece of logic
 * the shared confirmation dispatcher needs to route a settled payment.
 */
function referenceIdPrefix(referenceId) {
  return typeof referenceId === "string" ? referenceId.slice(0, PREFIX_LENGTH) : null;
}

/**
 * Wraps a write that includes a freshly-minted reference id, and retries it
 * with a fresh id if (and only if) that specific write failed on a
 * referenceId uniqueness collision — MongoDB error code 11000 naming
 * `referenceId` in its `keyPattern`. Any other failure (validation error,
 * a different duplicate key, a connection error, ...) is rethrown
 * immediately, unchanged, on the first attempt.
 *
 * `attempt(referenceId)` performs the actual write (e.g. `PosOrder.create({
 * referenceId, ...restOfTheOrder })`) and returns whatever the caller wants
 * back. Retrying the id is only useful when it's generated fresh on each
 * call — attempt() must actually use the `referenceId` it's given, not one
 * captured from an outer closure.
 *
 * Given the odds above, a real retry firing here is not expected to happen
 * in this system's lifetime — this exists as the same defensive belt this
 * codebase already wears for `uid` (common/plugins/auditable.js), not
 * because a collision is likely.
 */
async function withUniqueReferenceId(prefix, attempt, maxAttempts = 5) {
  let lastError;
  for (let i = 0; i < maxAttempts; i++) {
    const referenceId = generatePaymentReferenceId(prefix);
    try {
      return await attempt(referenceId);
    } catch (error) {
      const isReferenceIdCollision = error?.code === 11000 && Object.keys(error?.keyPattern || {}).includes("referenceId");
      if (!isReferenceIdCollision) throw error;
      lastError = error;
    }
  }
  throw lastError;
}

module.exports = {
  generatePaymentReferenceId,
  withUniqueReferenceId,
  referenceIdPrefix,
  ORIGIN_PREFIXES,
  REFERENCE_ID_LENGTH,
};
