/**
 * POST /payments/nets/callback
 *
 * The automatic NETS confirmation entry point — the SSD equivalent of
 * HEB's Payment-Response-Service receiving a NETS terminal/EXE result and
 * routing it to the right booking module. HEB does that across three
 * separate services (Payment-Response-Service -> Payment-Service ->
 * Catalog-Service, branching on a reference-id prefix); SSD-Backend is one
 * repo, so the same branch-by-prefix step already exists as
 * controllers/payments/dispatch.js's registerPaymentHandler/
 * dispatchPaymentConfirmation registry (today only "POS" is registered —
 * see controllers/pos-orders' confirmPosPayment) and this route is just a
 * new caller of it, exactly like PayNow's icn-response is.
 *
 * Mounted UNAUTHENTICATED at the router level (see controllers/payments/
 * index.js) — the local Nets-Service EXE calls this directly and never
 * carries this app's own admin JWT (it's a machine, not a logged-in
 * operator). A shared secret header stands in for auth here, the same role
 * DBS's PGP signature plays for the PayNow ICN route: only someone holding
 * NETS_CALLBACK_SECRET (the EXE, by its own config) can make this call.
 *
 * Also returns the resolved ticket data (`ticketData`, computeBookingTicketGroups'
 * full `{ticketGroups, receipt, temple, customer, splitMode}` shape — note
 * `ticketData.ticketGroups` is the actual array of physical tickets, this
 * response field is the whole envelope) for the now-confirmed booking in
 * the SAME response — see controllers/pos-orders' computeBookingTicketGroups
 * for why that function is called in-process here rather than the EXE
 * making a second, separately-authenticated call it has no admin JWT for.
 * A failure resolving ticket data does NOT fail the payment confirmation
 * itself (the money has already moved) — it comes back as `ticketData:
 * null` plus a `ticketDataError`, so the EXE can still log/report/retry
 * printing separately without ever appearing to have failed the payment.
 */
const crypto = require("crypto");
const env = require("../../../../config/env");
const { responseHandler, exceptionHandler } = require("../../../../utilities/handlers");
const { dispatchPaymentConfirmation } = require("../../dispatch");
const { PosTransaction } = require("../../../../models/pos-transactions");
const { computeBookingTicketGroups } = require("../../../pos-orders");
const { netsCallbackSchema } = require("./request-objects");

/**
 * Constant-time compare so a mistyped/attacker-guessed secret can't be
 * brute-forced via response-time differences — same reasoning as any
 * webhook-signature check. Falls back to `false` (never a match) on any
 * length mismatch rather than throwing, since timingSafeEqual requires
 * equal-length buffers.
 */
function secretsMatch(a, b) {
  const bufA = Buffer.from(String(a || ""));
  const bufB = Buffer.from(String(b || ""));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

async function netsCallback(req, res) {
  try {
    if (!env.NETS_CALLBACK_SECRET) {
      // Refuse rather than run open — see config/env.js's own comment on
      // why this has no fallback default.
      throw "NETS callback is not configured on this server (NETS_CALLBACK_SECRET is unset).";
    }
    const provided = req.get("X-Nets-Callback-Secret");
    if (!secretsMatch(provided, env.NETS_CALLBACK_SECRET)) {
      return exceptionHandler({ res, error: "Invalid or missing NETS callback secret.", statusCode: 401 });
    }

    const { error, value } = netsCallbackSchema.validate(req.body ?? {});
    if (error) throw error.details[0].message;
    const { referenceId, gatewayReference, amount, terminalId, approvalCode, terminalResponse } = value;

    // The genuine terminal-machine confirmation record — see
    // PosTransaction.terminalConfirmationDetails' own comment. Only built
    // when the EXE actually sent something to capture, so an older EXE
    // build that only sends the bare {gatewayReference, amount} pair still
    // confirms the payment normally, just with this left null (same as it
    // is today).
    const terminalConfirmationDetails =
      terminalId || approvalCode || terminalResponse
        ? {
            terminalId: terminalId || null,
            approvalCode: approvalCode || null,
            response: terminalResponse || null,
            confirmedAt: new Date(),
          }
        : undefined;

    const result = await dispatchPaymentConfirmation(referenceId, {
      amount,
      gatewayReference,
      processedBy: null,
      terminalConfirmationDetails,
    });

    // confirmPosPayment() returns booking `_id` on a fresh confirmation, but
    // only `transactionId` when it recognizes an already-processed
    // duplicate (see that function's own idempotency comment) — resolve the
    // bookingId from the transaction in that case so a retried callback
    // (network retry, EXE restart) still gets ticket groups back, not just
    // a bare "already processed".
    let bookingId = result.alreadyProcessed ? null : result._id;
    if (result.alreadyProcessed && result.transactionId) {
      const txn = await PosTransaction.findById(result.transactionId).select("bookingId");
      bookingId = txn?.bookingId ?? null;
    }

    let ticketData = null;
    let ticketDataError = null;
    if (bookingId) {
      try {
        ticketData = await computeBookingTicketGroups(bookingId);
      } catch (ticketError) {
        ticketDataError = typeof ticketError === "string" ? ticketError : "Could not resolve ticket groups for this booking.";
      }
    }

    return responseHandler({
      res,
      response: { referenceId, terminalId, approvalCode, ...result, ticketData, ticketDataError },
      successMessage: result.alreadyProcessed ? "NETS callback received — already processed." : "NETS payment confirmed.",
    });
  } catch (error) {
    return exceptionHandler({ res, error, statusCode: typeof error === "string" ? 400 : undefined });
  }
}

module.exports = netsCallback;
