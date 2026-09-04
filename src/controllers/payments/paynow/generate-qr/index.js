/**
 * POST /payments/paynow/generate-qr
 *
 * Standalone QR generation — used for a top-up against an already-confirmed
 * PosBooking (there's no "order create" response to embed a QR into at that
 * point, see BookingSuccessView's submitPayAgain on the frontend). The
 * FIRST payment on a brand new PayNow order no longer needs this route at
 * all: controllers/pos-orders' own createOrder builds the QR in-process
 * (via buildPaynowQrForOrder, same underlying logic) and returns it as
 * `paymentDetails` directly in the order-create response, so the POS
 * counter never has to make a second round trip just to see a QR.
 *
 * The actual QR-building work (assertPaynowConfigured, fixing the pending
 * transaction's amount, rendering the image, rolling back on render
 * failure) lives in controllers/pos-orders' buildPaynowQrForOrder — this
 * file is just the HTTP wrapper around it. See render.js for the two
 * rendering engines (dummy/java) and docs/paynow-integration.md for the
 * full flow.
 */

const Joi = require("joi");
const { responseHandler, exceptionHandler } = require("../../../../utilities/handlers");
const { assertPaynowConfigured } = require("./render");
const { buildPaynowQrForOrder } = require("../../../pos-orders");

const schema = Joi.object({
  referenceId: Joi.string().trim().length(13).required(),
  // How much of the outstanding balance to charge via this QR. Omit to
  // charge the full outstanding balance — same "omit means pay in full"
  // convention paidAmount already uses elsewhere in this codebase.
  amount: Joi.number().greater(0).precision(2).optional(),
});

async function generatePaynowQr(req, res) {
  try {
    const { error, value } = schema.validate(req.body);
    if (error) throw error.details[0].message;
    const { referenceId, amount: requestedAmount } = value;

    const { amount, qr, engine } = await buildPaynowQrForOrder({
      referenceId,
      amount: requestedAmount,
      processedBy: req.auth?.userId ?? null,
    });

    return responseHandler({
      res,
      response: { referenceId, amount, qrImage: qr, engine },
      successMessage: "PayNow QR generated.",
    });
  } catch (error) {
    return exceptionHandler({ res, error, statusCode: typeof error === "string" ? 400 : undefined });
  }
}

module.exports = generatePaynowQr;
module.exports.assertPaynowConfigured = assertPaynowConfigured;
