/**
 * POST /payments/paynow/icn-response
 *
 * DBS's PayNow Instant Credit Notification (ICN) webhook — the actual
 * "this PayNow payment succeeded" signal, arriving asynchronously and
 * completely separately from QR generation (../generate-qr). Modeled on
 * HEB's own Payment-Service handler
 * (D:\PROJECTS\HEB\Payment-Service\source\controllers\paynow\icn-response),
 * with one deliberate difference: HEB's current code reads a local sample
 * file instead of the live request body (a leftover from testing) — this
 * reads the real incoming request, since that's the whole point of a
 * webhook.
 *
 * Mounted unauthenticated (see controllers/payments/index.js) — DBS calls
 * this directly, it never carries this app's own auth token. The PGP
 * decrypt+verify step (decrypt-response.js) is what stands in for auth
 * here: only someone holding DBS's signing key could have produced a
 * message our public key verifies.
 *
 * `customerReference` in the decrypted payload is exactly the `referenceId`
 * generate-qr embedded in the QR as `Event_Order_Ref_No` — that's the
 * field the shared confirmation dispatcher (controllers/payments/dispatch)
 * uses to route this settlement back to the right origin module (POS
 * today). Idempotency (a duplicate ICN for an already-settled reference)
 * is handled inside that dispatch target, not here — see
 * controllers/pos-orders' confirmPosPayment().
 */

const { responseHandler, exceptionHandler } = require("../../../../utilities/handlers");
const { dispatchPaymentConfirmation } = require("../../dispatch");
const decryptIcnResponse = require("./decrypt-response");

/**
 * DBS's exact request shape for this webhook isn't confirmed yet (no API
 * doc on file — see docs/paynow-integration.md's ask-list) — HEB's own
 * source suggests a JSON body with the armored PGP text under a `data`
 * field (`req.body.data`), but a PGP message is also commonly posted as
 * raw text/plain. This accepts either shape rather than assuming one:
 *   - `{ "data": "-----BEGIN PGP MESSAGE-----..." }` (parsed JSON body)
 *   - the raw armored text as the entire body (string)
 *   - a JSON-shaped STRING body (e.g. if this route's body parser is
 *     configured as text/plain but DBS still sends JSON) containing `data`
 */
function extractArmoredMessage(req) {
  const body = req.body;
  if (typeof body === "string") {
    const trimmed = body.trim();
    if (trimmed.startsWith("{")) {
      try {
        const parsed = JSON.parse(trimmed);
        if (typeof parsed?.data === "string") return parsed.data;
      } catch {
        // not JSON after all — fall through and treat it as the armored text itself
      }
    }
    return trimmed || null;
  }
  if (body && typeof body === "object" && typeof body.data === "string") {
    return body.data;
  }
  return null;
}

async function icnResponse(req, res) {
  try {
    const armoredMessage = extractArmoredMessage(req);
    if (!armoredMessage) throw "No PayNow ICN payload found in the request.";

    const decryptedJson = await decryptIcnResponse(armoredMessage);
    const decrypted = JSON.parse(decryptedJson);

    const txnInfo = decrypted?.txnInfo;
    if (!txnInfo) throw "ICN payload carried no txnInfo — nothing to confirm.";

    const { customerReference, txnRefId, amtDtls } = txnInfo;
    if (!customerReference) throw "ICN payload carried no customerReference — cannot identify the order.";

    // txnRefId only appears once DBS considers the transfer actually
    // completed — the same signal HEB's own handler treats as "paid" vs
    // "still pending" (a notification can legitimately arrive before
    // that). Nothing is confirmed here for the still-pending case.
    if (!txnRefId) {
      return responseHandler({
        res,
        response: { customerReference, status: "pending" },
        successMessage: "ICN received — transaction not yet completed.",
      });
    }

    const amount = amtDtls?.txnAmt != null ? Number(amtDtls.txnAmt) : undefined;

    const result = await dispatchPaymentConfirmation(customerReference, {
      amount,
      gatewayReference: txnRefId,
      processedBy: null,
    });

    return responseHandler({
      res,
      response: { customerReference, ...result },
      successMessage: result.alreadyProcessed
        ? "ICN received — already processed."
        : "Payment confirmed from PayNow ICN.",
    });
  } catch (error) {
    return exceptionHandler({ res, error, statusCode: typeof error === "string" ? 400 : undefined });
  }
}

module.exports = icnResponse;
module.exports.extractArmoredMessage = extractArmoredMessage;
