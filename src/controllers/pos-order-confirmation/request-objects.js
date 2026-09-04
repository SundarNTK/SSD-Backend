const Joi = require("joi");

/**
 * POST /pos-order-confirmation/:referenceId/confirm
 *
 * Deliberately carries NO amount and NO payment-mode field. Both were
 * already fixed the moment the QR was generated (createPendingPayment, see
 * controllers/pos-orders) — an admin confirming a payment cannot change
 * what's being confirmed, only attest that the pending amount was actually
 * received, the same way HEB's own admin confirm screens render that
 * amount read-only rather than as an editable field. `gatewayReference` is
 * the one thing genuinely being recorded here — a note/reference for this
 * confirmation, and the field a repeat submission is caught on
 * (confirmPosPayment's idempotency check).
 */
const manualConfirmSchema = Joi.object({
  gatewayReference: Joi.string().trim().min(1).max(100).required(),
});

module.exports = { manualConfirmSchema };
