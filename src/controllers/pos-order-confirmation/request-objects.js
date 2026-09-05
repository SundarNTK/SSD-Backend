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
 * the one thing that's genuinely functional here — the field a repeat
 * submission is caught on (confirmPosPayment's idempotency check) — every
 * other field below is pure audit trail, stored as
 * PosTransaction.manualConfirmationDetails and never read back by any
 * matching/idempotency logic.
 *
 * The extra fields mirror what HEB's own admin confirm screens capture
 * (D:\PROJECTS\HEB\Admin-Frontend's pos-order-confirmation CreateModal) —
 * txnType/receivingParty/senderParty exist there because that screen
 * reconstructs a synthetic PayNow ICN payload; SSD's dispatcher is already
 * simpler (a single gatewayReference), so these are optional, additive
 * audit fields rather than a payload shape a downstream API depends on.
 * senderParty is only meaningful for a PayNow confirmation; left optional
 * so a NETS confirmation can omit it.
 */
const partySchema = Joi.object({
  name: Joi.string().trim().allow("").max(200),
  accountNo: Joi.string().trim().allow("").max(50),
  senderBankId: Joi.string().trim().allow("").max(50),
});

const manualConfirmSchema = Joi.object({
  gatewayReference: Joi.string().trim().min(1).max(100).required(),
  txnType: Joi.string().trim().allow("").max(100),
  txnDate: Joi.date().optional(),
  valueDt: Joi.date().optional(),
  receivingParty: partySchema.optional(),
  senderParty: partySchema.optional(),
});

module.exports = { manualConfirmSchema };
