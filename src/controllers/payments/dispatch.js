const { referenceIdPrefix } = require("../../common/utils/payment-reference");

/**
 * The one shared confirmation surface every payment mode's webhook/route
 * eventually calls, instead of each mode re-implementing "find the
 * booking, verify it, update it, maybe confirm it" on its own. Mirrors
 * HEB's Payment-Service paymentResponse(), which branches on
 * `customerReference.startsWith(...)` to decide which downstream booking
 * path a settled payment belongs to — here that's done by a small
 * prefix -> handler registry instead of a chain of startsWith() checks, so
 * a new origin module (events, customer-portal bookings, ...) just
 * registers its own prefix rather than this file growing another branch.
 *
 * A handler is `(referenceId, details) => Promise<result>` and owns its
 * own idempotency (see controllers/pos-orders' confirmPosPayment for the
 * pattern: an atomic findOneAndUpdate guarded on paymentStatus: "pending",
 * so a duplicate callback for an already-settled transaction is a safe
 * no-op instead of double-counting).
 */
const handlers = new Map();

function registerPaymentHandler(prefix, handler) {
  if (typeof prefix !== "string" || prefix.length !== 3) {
    throw new Error(`registerPaymentHandler: prefix must be exactly 3 characters, got "${prefix}"`);
  }
  if (typeof handler !== "function") {
    throw new Error(`registerPaymentHandler: handler for "${prefix}" must be a function`);
  }
  handlers.set(prefix, handler);
}

/**
 * @param {string} referenceId  the 13-char id minted by generatePaymentReferenceId()
 * @param {object} details      whatever the confirming mode has: amount, paymentMode,
 *                               gatewayReference, processedBy, etc. — shape is up to
 *                               each origin handler to interpret.
 */
async function dispatchPaymentConfirmation(referenceId, details) {
  const prefix = referenceIdPrefix(referenceId);
  const handler = prefix && handlers.get(prefix);
  if (!handler) {
    throw `No confirmation handler registered for reference id "${referenceId}".`;
  }
  return handler(referenceId, details);
}

module.exports = { registerPaymentHandler, dispatchPaymentConfirmation };
