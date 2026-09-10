const Joi = require("joi");

/**
 * POST /payments/nets/callback — the Nets-Service EXE's automatic
 * confirmation payload, sent once it has verified a genuine terminal
 * SUCCESS (see paymentOutcomes.js's genuinelyApproved guard on that side —
 * this route trusts whatever the EXE sends, the same way PayNow's ICN route
 * trusts whatever a decrypted DBS payload says, so that verification has to
 * have already happened before this is called).
 */
const netsCallbackSchema = Joi.object({
  referenceId: Joi.string().trim().min(1).max(50).required(),
  // The terminal's own approval/transaction reference — what
  // dispatchPaymentConfirmation()/idempotency matches duplicate callbacks
  // against, same role PayNow's txnRefId plays.
  gatewayReference: Joi.string().trim().min(1).max(100).required(),
  amount: Joi.number().min(0).optional(),
  terminalId: Joi.string().trim().max(50).allow("", null).optional(),
  approvalCode: Joi.string().trim().max(50).allow("", null).optional(),
  // The terminal SDK's full translated response (card type, masked PAN,
  // retrieval reference number, response text, STAN, ...) — shape varies by
  // terminal/SDK version, so this is intentionally unvalidated beyond "an
  // object, not too large" and stored verbatim as PosTransaction's
  // terminalConfirmationDetails for audit. Optional so older EXE builds
  // that don't send it yet keep working unchanged.
  terminalResponse: Joi.object().unknown(true).max(50).optional(),
});

module.exports = { netsCallbackSchema };
