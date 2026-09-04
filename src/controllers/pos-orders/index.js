/**
 * POS counter order/payment flow — the `pos_` counterpart to
 * controllers/pos/index.js's order/booking/payment write routes, backed by
 * its own pos_orders/pos_bookings/pos_transactions collections instead of
 * the shared Order/Booking/Transaction the Admin Booking screen still uses.
 *
 * Catalogue browsing, customer lookup, and the cart-pricing summary are
 * NOT duplicated here — those already read from shared masters
 * (Item/Service/Customer) with no persistence of their own, so
 * controllers/pos/index.js keeps serving them for both the POS and Admin
 * booking trees unchanged. Only the endpoints that actually write an
 * order/booking/payment move to this module:
 *
 *   POST /orders                    — create order + reserve inventory
 *   POST /orders/:id/confirm        — confirm order -> PosBooking + PosTransaction
 *   GET  /orders/:id/status         — poll target
 *   GET  /bookings                  — POS Transactions ledger (pos_bookings)
 *   GET  /bookings/:id              — full booking + payment history
 *   POST /bookings/:id/payments     — collect another installment
 *
 * Cash confirms synchronously, in the same request, exactly like
 * controllers/pos/index.js's createOrder does today — a cashier collecting
 * cash in person IS the confirmation. PayNow/NETS instead leave the order
 * "pending" and reach confirmPosPayment() later, once the real gateway/
 * terminal confirmation lands, via the shared dispatcher in
 * controllers/payments/dispatch.js. Either path ends up calling the same
 * writePosBookingFromOrder() — there is exactly one place a PosBooking ever
 * gets written, regardless of which payment mode triggered it.
 */

const mongoose = require("mongoose");
const requirePermission = require("../../common/middleware/require-permission");
const validateBody = require("../../common/middleware/validate");
const { isZeroRateGstType } = require("../../utilities/constants/gst-types");
const { responseHandler, exceptionHandler } = require("../../utilities/handlers");
const { nextSequence } = require("../../common/utils/sequence");
const { withUniqueReferenceId, ORIGIN_PREFIXES } = require("../../common/utils/payment-reference");
const { registerPaymentHandler } = require("../payments/dispatch");
// Pure QR-image rendering, no dependency back on this module — see that
// file's own comment for why this has to be the direction the require goes
// (payments/paynow/generate-qr/index.js already requires THIS module for
// createPendingPayment; requiring it back here would be a cycle).
const { assertPaynowConfigured, renderQrImage } = require("../payments/paynow/generate-qr/render");

const Item = require("../../models/items");
const Service = require("../../models/services");
const { Customer } = require("../../models/customers");
const PaymentMode = require("../../models/payment-modes");
const { PosOrder } = require("../../models/pos-orders");
const { PosBooking, POS_BOOKING_STATUSES } = require("../../models/pos-bookings");
const { PosTransaction } = require("../../models/pos-transactions");

const {
  placeReservationsForOrder,
  consumeReservations,
  cancelReservations,
} = require("../pos/inventory-reservation");
const { effectiveQuantity } = require("../../common/utils/effective-quantity");
const { loadPosVisibleHierarchy, offeringInPosHierarchy } = require("../../common/utils/pos-catalogue-visibility");

const { createOrderSchema, confirmOrderSchema, recordPaymentSchema } = require("./request-objects");

// ─── helpers ──────────────────────────────────────────────────────────────

/**
 * POS-YYYYMMDD-NNNN — reuses the SAME "pos_order" counter
 * controllers/pos/index.js's own generateOrderNumber() draws from, so order
 * numbers stay globally distinct-looking across the old admin-booking
 * Orders and these new PosOrders even though they now live in separate
 * collections with their own independent uniqueness constraints.
 */
async function generateOrderNumber() {
  const n = await nextSequence("pos_order");
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  return `POS${today}${String(n).padStart(4, "0")}`;
}

async function generateBookingNumber() {
  const n = await nextSequence("booking");
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  return `BKG${today}${String(n).padStart(4, "0")}`;
}

async function generateReceiptNumber() {
  const n = await nextSequence("receipt");
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  return `RCP-${today}-${String(n).padStart(4, "0")}`;
}

/**
 * A booking's amountPaid is never stored on the booking itself — always the
 * sum of its "paid" PosTransaction rows. See models/pos-transactions' own
 * comment for why.
 */
function sumPaidAmount(transactions) {
  return +transactions
    .filter((t) => t.paymentStatus === "paid")
    .reduce((sum, t) => sum + t.amount, 0)
    .toFixed(2);
}

function derivePaymentStatus(amountPaid, grandTotal) {
  if (amountPaid >= grandTotal - 0.005) return "paid";
  if (amountPaid > 0) return "partial";
  return "pending";
}

/**
 * How much is still owed on this order/booking, regardless of whether it's
 * still a pending PosOrder (first payment) or an already-confirmed
 * PosBooking with some balance left (a top-up) — the one place that
 * question is answered, used by both createPendingPayment() below and
 * controllers/payments/paynow/generate-qr.
 */
async function resolveOutstandingBalance(order) {
  if (order.orderStatus !== "confirmed") {
    return { booking: null, balance: order.grandTotal };
  }
  const booking = await PosBooking.findById(order.bookingId);
  if (!booking) throw "Booking record not found for this order.";
  const transactions = await PosTransaction.find(
    PosTransaction.notDeletedFilter({ bookingId: booking._id })
  ).select("amount paymentStatus");
  const paid = sumPaidAmount(transactions);
  return { booking, balance: +(booking.grandTotal - paid).toFixed(2) };
}

async function resolveGstRate(generalLedgerId) {
  if (!generalLedgerId) return 0;
  try {
    const GeneralLedger = mongoose.model("GeneralLedger");
    const gl = await GeneralLedger.findById(generalLedgerId).populate("gstType");
    const gst = gl?.gstType;
    if (!gst) return 0;
    if (isZeroRateGstType(gst.type)) return 0;
    return gst.percentage ?? 0;
  } catch {
    return 0;
  }
}

// ─── create order ─────────────────────────────────────────────────────────

/**
 * POST /pos/booking/orders
 * Same shape as controllers/pos/index.js's createOrder — see that file's
 * own comment for the full step-by-step rationale (server-side pricing,
 * atomic reservation placement with rollback, server-decided confirmation).
 * The one behavioural difference: this always stamps portal "pos" (this
 * module is POS-only, there's no admin/customer branch to disambiguate),
 * and mints a `referenceId` every order carries from creation, whether or
 * not it ends up needed (Cash never sees it again; PayNow/NETS pass it to
 * the gateway/terminal).
 */
async function createOrder(req, res) {
  try {
    const { error, value } = createOrderSchema.validate(req.body);
    if (error) throw error.details[0].message;

    const { customerId, lines, paymentModeId, paidAmount } = value;
    const hierarchy = await loadPosVisibleHierarchy();

    const customer = await Customer.findOne(
      Customer.notDeletedFilter({ _id: customerId, status: 1 })
    ).select("customerCode name email mobileNumber");
    if (!customer) throw "Customer not found or inactive.";

    const paymentMode = await PaymentMode.findOne(
      PaymentMode.notDeletedFilter({ _id: paymentModeId, status: 1 })
    ).select("name");
    if (!paymentMode) throw "Payment mode not found or inactive.";

    // ── 1. Resolve all line details (prices, names, codes) ──────────────
    const resolvedLines = [];
    let subtotal = 0;
    let totalGst = 0;

    for (const line of lines) {
      const { refType, refId, deities, devotees } = line;
      let name, code, unitPrice, gstRate;

      if (refType === "Item") {
        const item = await Item.findOne(
          Item.notDeletedFilter({ _id: refId, status: 1, posAvailability: true })
        ).populate("generalLedger", "gstType");
        if (!item || !offeringInPosHierarchy(item, hierarchy.categoryIds, hierarchy.subCategoryIds)) {
          throw `An item in the cart is no longer available.`;
        }
        name = item.name;
        code = item.code;
        unitPrice = item.salePrice;
        gstRate = await resolveGstRate(item.generalLedger?._id);
      } else {
        const svc = await Service.findOne(
          Service.notDeletedFilter({ _id: refId, status: 1, isPosAvailable: true })
        ).populate("generalLedger", "gstType");
        if (!svc || !offeringInPosHierarchy(svc, hierarchy.categoryIds, hierarchy.subCategoryIds)) {
          throw `A service in the cart is no longer available.`;
        }
        name = svc.name;
        code = svc.code;
        unitPrice = svc.salePrice ?? 0;
        gstRate = await resolveGstRate(svc.generalLedger?._id);
      }

      const qty = effectiveQuantity(line);
      const lineTotal = unitPrice * qty;
      const lineGst = +(lineTotal * (gstRate / 100)).toFixed(2);
      subtotal += lineTotal;
      totalGst += lineGst;

      resolvedLines.push({ refType, refId, quantity: qty, name, code, unitPrice, lineTotal, deities, devotees });
    }

    const grandTotal = +(subtotal + totalGst).toFixed(2);
    if (paidAmount != null && paidAmount > grandTotal + 0.005) {
      throw `Payment amount cannot exceed the total payable amount of ${grandTotal.toFixed(2)}.`;
    }

    const expiresAt = new Date(Date.now() + 30 * 60 * 1000);
    const orderNumber = await generateOrderNumber();

    // ── 2. Write the PosOrder first (gives us an _id for reservations) ──
    // referenceId is crypto-random (see common/utils/payment-reference.js),
    // not sequential — withUniqueReferenceId regenerates and retries this
    // whole write on the practically-never-hit chance two orders mint the
    // same one, same defensive pattern this codebase already uses for uid.
    const order = await withUniqueReferenceId(ORIGIN_PREFIXES.POS, (referenceId) =>
      PosOrder.create({
        referenceId,
        orderNumber,
        customer: customerId,
        lines: resolvedLines.map((l) => ({
          refType: l.refType,
          refId: l.refId,
          name: l.name,
          code: l.code,
          quantity: l.quantity,
          unitPrice: l.unitPrice,
          lineTotal: l.lineTotal,
          deities: l.deities,
          devotees: l.devotees,
        })),
        subtotal: +subtotal.toFixed(2),
        gstAmount: +totalGst.toFixed(2),
        grandTotal,
        paymentMode: paymentModeId,
        paymentModeName: paymentMode.name,
        orderStatus: "pending",
        expiresAt,
        bookedBy: req.auth?.userId ?? null,
        entity: req.auth?.entityId ?? null,
        createdBy: req.auth?.userId ?? null,
      })
    );

    // ── 3. Place inventory reservations ─────────────────────────────────
    try {
      await placeReservationsForOrder(resolvedLines, order._id);
    } catch (reservationError) {
      await PosOrder.findByIdAndUpdate(order._id, { orderStatus: "cancelled" });
      throw reservationError;
    }

    // ── 4. Cash confirms itself, right here, server-side ────────────────
    if (paymentMode.name.trim().toLowerCase() === "cash") {
      const confirmed = await writePosBookingFromOrder({ ...order.toObject?.() ?? order, customer }, paidAmount);
      return responseHandler({
        res,
        response: { ...confirmed, status: "confirmed" },
        successMessage:
          confirmed.paymentStatus === "paid" ? "Booking confirmed successfully." : "Booking confirmed with a partial payment.",
        statusCode: 201,
      });
    }

    // PayNow builds its QR right here and embeds it as `paymentDetails` —
    // the POS counter gets { amount, qr } in this SAME response and never
    // has to make a second call to /payments/paynow/generate-qr just to see
    // one. A QR failure (config incomplete, render error) does NOT fail
    // order creation — the order and its inventory hold are already
    // committed by this point, and the customer still needs a referenceId
    // back to retry against; it comes back as `paymentDetailsError`
    // instead, and the frontend can fall back to calling
    // POST /payments/paynow/generate-qr directly with this referenceId
    // (still a live route — also what top-ups against an already-confirmed
    // booking use, since there's no order-create response to embed into
    // there).
    let paymentDetails = null;
    let paymentDetailsError = null;
    if (paymentMode.name.trim().toLowerCase() === "paynow") {
      try {
        paymentDetails = await buildPaynowQrForOrder({
          referenceId: order.referenceId,
          amount: paidAmount,
          processedBy: req.auth?.userId ?? null,
        });
      } catch (qrError) {
        paymentDetailsError = typeof qrError === "string" ? qrError : "Could not generate the PayNow QR. Please try again.";
      }
    }

    // Any other mode (NETS) stays "pending" with no paymentDetails yet —
    // its own initiate route (Phase 3) is what happens next, using this
    // order's `referenceId`.
    return responseHandler({
      res,
      response: {
        _id: order._id,
        referenceId: order.referenceId,
        orderNumber: order.orderNumber,
        customer: {
          _id: customer._id,
          customerCode: customer.customerCode,
          name: customer.name,
          email: customer.email,
          mobileNumber: customer.mobileNumber,
        },
        lines: order.lines,
        subtotal: order.subtotal,
        gstAmount: order.gstAmount,
        grandTotal: order.grandTotal,
        paymentModeName: order.paymentModeName,
        orderStatus: order.orderStatus,
        expiresAt: order.expiresAt,
        status: "pending",
        paymentDetails,
        paymentDetailsError,
      },
      successMessage: "Order created. Inventory held for 30 minutes.",
      statusCode: 201,
    });
  } catch (error) {
    return exceptionHandler({ res, error, statusCode: typeof error === "string" ? 400 : undefined });
  }
}

// ─── confirm order -> booking ───────────────────────────────────────────

/**
 * The one place a PosBooking is ever written. `paidAmount` is how much is
 * being collected right now — omit it to pay the grandTotal in full.
 * `paymentOverride` optionally carries a different paymentMode/Name and a
 * gatewayReference than the order's own (PayNow/NETS confirmations settle
 * against whatever mode the order was actually created for, so this is
 * unused there today, but kept for the same reason recordBookingPayment
 * accepts a different mode for a top-up — an installment doesn't have to
 * match the original).
 */
async function writePosBookingFromOrder(order, paidAmount, paymentOverride = {}) {
  const [bookingNumber, receiptNo] = await Promise.all([generateBookingNumber(), generateReceiptNumber()]);
  const now = new Date();
  const customerId = order.customer._id ?? order.customer;

  const amountNow = paidAmount == null ? order.grandTotal : Math.max(0, Math.min(paidAmount, order.grandTotal));
  const bookingPaymentStatus = derivePaymentStatus(amountNow, order.grandTotal);

  let booking;
  let transaction;
  try {
    booking = await PosBooking.create({
      bookingNumber,
      orderId: order._id,
      customer: customerId,
      lines: order.lines,
      subtotal: order.subtotal,
      gstAmount: order.gstAmount,
      grandTotal: order.grandTotal,
      paymentMode: paymentOverride.paymentMode ?? order.paymentMode,
      paymentModeName: paymentOverride.paymentModeName ?? order.paymentModeName,
      paymentStatus: bookingPaymentStatus,
      bookingStatus: "confirmed",
      bookedBy: order.bookedBy,
      entity: order.entity,
      bookedAt: now,
      createdBy: order.bookedBy ?? null,
    });

    if (amountNow > 0) {
      transaction = await PosTransaction.create({
        receiptNo,
        bookingId: booking._id,
        orderId: order._id,
        customer: customerId,
        paymentMode: paymentOverride.paymentMode ?? order.paymentMode,
        paymentModeName: paymentOverride.paymentModeName ?? order.paymentModeName,
        amount: amountNow,
        paymentStatus: "paid",
        gatewayReference: paymentOverride.gatewayReference ?? null,
        transactionDate: now,
        processedBy: paymentOverride.processedBy ?? order.bookedBy,
        createdBy: paymentOverride.processedBy ?? order.bookedBy ?? null,
      });
    }

    await PosOrder.findByIdAndUpdate(order._id, { orderStatus: "confirmed", bookingId: booking._id });
  } catch (writeError) {
    if (transaction) await PosTransaction.deleteOne({ _id: transaction._id }).catch(() => {});
    if (booking) await PosBooking.deleteOne({ _id: booking._id }).catch(() => {});
    throw writeError;
  }

  await consumeReservations(order._id, order.lines, order.bookedBy, bookingNumber);

  const customerSnap = order.customer?.customerCode
    ? order.customer
    : await Customer.findById(order.customer).select("customerCode name email mobileNumber");

  return {
    _id: booking._id,
    bookingNumber: booking.bookingNumber,
    orderNumber: order.orderNumber,
    referenceId: order.referenceId,
    receiptNo: transaction?.receiptNo ?? null,
    customer: {
      _id: customerSnap._id,
      customerCode: customerSnap.customerCode,
      name: customerSnap.name,
      email: customerSnap.email,
      mobileNumber: customerSnap.mobileNumber,
    },
    lines: booking.lines,
    subtotal: booking.subtotal,
    gstAmount: booking.gstAmount,
    grandTotal: booking.grandTotal,
    paymentModeName: booking.paymentModeName,
    paymentStatus: booking.paymentStatus,
    bookingStatus: booking.bookingStatus,
    bookedAt: booking.bookedAt,
    amountPaid: amountNow,
    balanceAmount: +(booking.grandTotal - amountNow).toFixed(2),
  };
}

/**
 * Shapes an already-confirmed booking for a response — used by both
 * confirmOrder's idempotent re-confirm branch and getOrderStatus's
 * confirmed branch. Both used to spread `booking.toObject()` and stop
 * there, which meant neither ever carried `amountPaid`/`balanceAmount` —
 * fine for a `paid` booking (the frontend never needed those fields for
 * that case), but a real bug for a `partial` one: the polling flow for a
 * partially-paid PayNow first payment calls this exact endpoint and reads
 * `booking.balanceAmount` to build its success message, and it was always
 * `undefined` there — throwing inside PaynowQrModal's poll tick, which
 * silently swallowed it and retried forever instead of ever showing
 * success. Also picks `receiptNo` off the OLDEST transaction (the one
 * printed at confirm time), not an arbitrary unsorted `findOne` — the same
 * convention listBookings already uses.
 */
async function buildConfirmedOrderResponse(order, booking) {
  const transactions = await PosTransaction.find(PosTransaction.notDeletedFilter({ bookingId: booking._id }))
    .select("receiptNo amount paymentStatus transactionDate")
    .sort({ transactionDate: 1 });
  const amountPaid = sumPaidAmount(transactions);
  return {
    ...booking.toObject(),
    receiptNo: transactions[0]?.receiptNo ?? null,
    orderNumber: order.orderNumber,
    referenceId: order.referenceId,
    status: "confirmed",
    amountPaid,
    balanceAmount: +(booking.grandTotal - amountPaid).toFixed(2),
  };
}

/**
 * POST /pos/booking/orders/:id/confirm
 * Idempotent re-confirm, same shape as controllers/pos/index.js's
 * confirmOrder.
 */
async function confirmOrder(req, res) {
  try {
    const orderId = req.params.id;
    if (!mongoose.isValidObjectId(orderId)) throw "Invalid order ID.";

    const { error, value } = confirmOrderSchema.validate(req.body ?? {});
    if (error) throw error.details[0].message;
    const { paidAmount } = value;

    const order = await PosOrder.findOne(
      PosOrder.notDeletedFilter({ _id: orderId })
    ).populate("customer", "customerCode name email mobileNumber");

    if (!order) throw "Order not found.";
    if (order.orderStatus === "confirmed") {
      const existing = await PosBooking.findById(order.bookingId)
        .populate("customer", "customerCode name email mobileNumber")
        .populate("lines.deities", "name")
        .populate("bookedBy", "name email");
      if (!existing) throw "Booking record not found for this confirmed order.";
      return responseHandler({
        res,
        response: await buildConfirmedOrderResponse(order, existing),
        successMessage: "Booking already confirmed.",
      });
    }
    if (order.orderStatus === "cancelled") throw "This order has been cancelled and cannot be confirmed.";

    if (new Date() > order.expiresAt) {
      await cancelReservations(order._id);
      await PosOrder.findByIdAndUpdate(order._id, { orderStatus: "cancelled" });
      throw "Order expired — the 30-minute hold has lapsed. Please create a new order.";
    }

    if (paidAmount != null && paidAmount > order.grandTotal + 0.005) {
      throw `Payment amount cannot exceed the total payable amount of ${order.grandTotal.toFixed(2)}.`;
    }

    const confirmed = await writePosBookingFromOrder(order, paidAmount);
    return responseHandler({
      res,
      response: { ...confirmed, status: "confirmed" },
      successMessage:
        confirmed.paymentStatus === "paid" ? "Booking confirmed successfully." : "Booking confirmed with a partial payment.",
      statusCode: 201,
    });
  } catch (error) {
    return exceptionHandler({ res, error, statusCode: typeof error === "string" ? 400 : undefined });
  }
}

/**
 * GET /pos/booking/orders/:id/status
 */
async function getOrderStatus(req, res) {
  try {
    const orderId = req.params.id;
    if (!mongoose.isValidObjectId(orderId)) throw "Invalid order ID.";

    const order = await PosOrder.findOne(PosOrder.notDeletedFilter({ _id: orderId })).select(
      "orderStatus orderNumber referenceId expiresAt bookingId"
    );
    if (!order) throw "Order not found.";

    if (order.orderStatus === "confirmed") {
      const booking = await PosBooking.findById(order.bookingId)
        .populate("customer", "customerCode name email mobileNumber")
        .populate("lines.deities", "name")
        .populate("bookedBy", "name email");
      if (!booking) throw "Booking record not found for this confirmed order.";
      return responseHandler({ res, response: await buildConfirmedOrderResponse(order, booking) });
    }

    if (order.orderStatus === "cancelled") {
      return responseHandler({ res, response: { status: "cancelled" } });
    }

    const expired = new Date() > order.expiresAt;
    return responseHandler({ res, response: { status: expired ? "expired" : "pending", expiresAt: order.expiresAt } });
  } catch (error) {
    return exceptionHandler({ res, error, statusCode: typeof error === "string" ? 400 : undefined });
  }
}

// ─── ledger + partial payment ───────────────────────────────────────────

function deriveLineType(lines) {
  const types = new Set((lines || []).map((l) => l.refType));
  if (types.size === 0) return "—";
  if (types.size === 1) return [...types][0];
  return "Mixed";
}

/**
 * GET /pos/booking/bookings?search=&status=&paymentStatus=
 */
async function listBookings(req, res) {
  try {
    const escapeRegex = require("../../common/utils/escape-regex");
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(100, Number(req.query.pageSize) || 20);

    const filter = PosBooking.notDeletedFilter();
    if (req.query.status && POS_BOOKING_STATUSES.includes(req.query.status)) {
      filter.bookingStatus = req.query.status;
    }
    if (req.query.paymentStatus && ["paid", "partial", "pending"].includes(req.query.paymentStatus)) {
      filter.paymentStatus = req.query.paymentStatus;
    }
    if (req.query.search) {
      const regex = new RegExp(escapeRegex(req.query.search.trim()), "i");
      const [matchingCustomers, matchingTransactions] = await Promise.all([
        Customer.find(Customer.notDeletedFilter({ name: regex })).select("_id"),
        PosTransaction.find(PosTransaction.notDeletedFilter({ receiptNo: regex })).select("bookingId"),
      ]);
      filter.$or = [
        { bookingNumber: regex },
        { customer: { $in: matchingCustomers.map((c) => c._id) } },
        { _id: { $in: matchingTransactions.map((t) => t.bookingId) } },
      ];
    }

    const [bookings, total] = await Promise.all([
      PosBooking.find(filter)
        .populate("customer", "customerCode name email mobileNumber")
        .populate("orderId", "orderNumber referenceId")
        .select(
          "bookingNumber orderId customer lines subtotal gstAmount grandTotal paymentModeName paymentStatus bookingStatus bookedAt"
        )
        .sort({ bookedAt: -1 })
        .skip((page - 1) * pageSize)
        .limit(pageSize),
      PosBooking.countDocuments(filter),
    ]);

    const bookingIds = bookings.map((b) => b._id);
    const transactions = await PosTransaction.find(PosTransaction.notDeletedFilter({ bookingId: { $in: bookingIds } }))
      .select("bookingId receiptNo amount paymentStatus transactionDate")
      .sort({ transactionDate: 1 });
    const transactionsByBooking = new Map();
    for (const t of transactions) {
      const key = String(t.bookingId);
      if (!transactionsByBooking.has(key)) transactionsByBooking.set(key, []);
      transactionsByBooking.get(key).push(t);
    }

    const items = bookings.map((b) => {
      const bookingTxns = transactionsByBooking.get(String(b._id)) ?? [];
      const amountPaid = sumPaidAmount(bookingTxns);
      return {
        _id: b._id,
        bookingNumber: b.bookingNumber,
        receiptNo: bookingTxns[0]?.receiptNo ?? null,
        orderNumber: b.orderId?.orderNumber ?? null,
        referenceId: b.orderId?.referenceId ?? null,
        customer: b.customer
          ? { _id: b.customer._id, customerCode: b.customer.customerCode, name: b.customer.name }
          : null,
        lineType: deriveLineType(b.lines),
        paymentModeName: b.paymentModeName,
        subtotal: b.subtotal,
        gstAmount: b.gstAmount,
        grandTotal: b.grandTotal,
        paymentStatus: b.paymentStatus,
        amountPaid,
        balanceAmount: +(b.grandTotal - amountPaid).toFixed(2),
        bookingStatus: b.bookingStatus,
        bookedAt: b.bookedAt,
      };
    });

    return responseHandler({ res, response: { items, total, page, pageSize } });
  } catch (error) {
    return exceptionHandler({ res, error });
  }
}

/**
 * GET /pos/booking/bookings/:id
 */
async function getBookingDetail(req, res) {
  try {
    const id = req.params.id;
    if (!mongoose.isValidObjectId(id)) throw "Invalid booking ID.";

    const [booking, transactions] = await Promise.all([
      PosBooking.findOne(PosBooking.notDeletedFilter({ _id: id }))
        .populate("customer", "customerCode name email mobileNumber")
        .populate("orderId", "orderNumber referenceId orderStatus")
        .populate("paymentMode", "name")
        .populate("lines.deities", "name")
        .populate("bookedBy", "name email"),
      // paymentStatus: "paid" only — this is the receipt's payment history,
      // and a pending/cancelled/failed/expired attempt (e.g. a QR that was
      // scanned but never paid, or superseded by a later retry) isn't a
      // payment that was actually collected. Matches sumPaidAmount below,
      // which already only counts "paid" toward amountPaid.
      PosTransaction.find(PosTransaction.notDeletedFilter({ bookingId: id, paymentStatus: "paid" }))
        .select("receiptNo amount paymentStatus paymentModeName transactionDate processedBy")
        .populate("processedBy", "name email")
        .sort({ transactionDate: 1 }),
    ]);

    if (!booking) throw "Booking not found.";

    const amountPaid = sumPaidAmount(transactions);

    return responseHandler({
      res,
      response: {
        ...booking.toObject(),
        transactions,
        amountPaid,
        balanceAmount: +(booking.grandTotal - amountPaid).toFixed(2),
      },
    });
  } catch (error) {
    return exceptionHandler({ res, error, statusCode: typeof error === "string" ? 404 : undefined });
  }
}

/**
 * Appends one more "paid" PosTransaction row against an already-confirmed
 * PosBooking and recomputes its paymentStatus — the write both
 * recordBookingPayment (HTTP route, cash/manual top-up) and
 * confirmPosPayment (dispatcher, PayNow/NETS top-up) funnel through, so
 * there is exactly one place a balance top-up is ever applied.
 */
async function applyBookingPayment(booking, amount, { paymentMode, paymentModeName, gatewayReference, processedBy } = {}) {
  const existingTxns = await PosTransaction.find(PosTransaction.notDeletedFilter({ bookingId: booking._id })).select(
    "amount paymentStatus"
  );
  const paidSoFar = sumPaidAmount(existingTxns);
  const balance = +(booking.grandTotal - paidSoFar).toFixed(2);
  if (balance <= 0.005) throw "This booking is already fully paid.";
  if (amount > balance + 0.005) throw `Payment amount cannot exceed the outstanding balance of ${balance.toFixed(2)}.`;

  const receiptNo = await generateReceiptNumber();
  const transaction = await PosTransaction.create({
    receiptNo,
    bookingId: booking._id,
    orderId: booking.orderId,
    customer: booking.customer,
    paymentMode: paymentMode ?? booking.paymentMode,
    paymentModeName: paymentModeName ?? booking.paymentModeName,
    amount,
    paymentStatus: "paid",
    gatewayReference: gatewayReference ?? null,
    transactionDate: new Date(),
    processedBy: processedBy ?? null,
    createdBy: processedBy ?? null,
  });

  const newAmountPaid = +(paidSoFar + amount).toFixed(2);
  booking.paymentStatus = derivePaymentStatus(newAmountPaid, booking.grandTotal);
  await booking.save();

  return { transaction, amountPaid: newAmountPaid, balanceAmount: +(booking.grandTotal - newAmountPaid).toFixed(2) };
}

/**
 * POST /pos/booking/bookings/:id/payments
 */
async function recordBookingPayment(req, res) {
  try {
    const bookingId = req.params.id;
    if (!mongoose.isValidObjectId(bookingId)) throw "Invalid booking ID.";

    const { error, value } = recordPaymentSchema.validate(req.body ?? {});
    if (error) throw error.details[0].message;
    const { amount, paymentModeId } = value;

    const booking = await PosBooking.findOne(PosBooking.notDeletedFilter({ _id: bookingId }));
    if (!booking) throw "Booking not found.";
    if (booking.bookingStatus !== "confirmed") throw "Only confirmed bookings can receive payments.";

    let paymentMode = booking.paymentMode;
    let paymentModeName = booking.paymentModeName;
    if (paymentModeId) {
      const mode = await PaymentMode.findOne(PaymentMode.notDeletedFilter({ _id: paymentModeId, status: 1 })).select("name");
      if (!mode) throw "Payment mode not found or inactive.";
      paymentMode = mode._id;
      paymentModeName = mode.name;
    }

    const { transaction, amountPaid, balanceAmount } = await applyBookingPayment(booking, amount, {
      paymentMode,
      paymentModeName,
      processedBy: req.auth?.userId ?? null,
    });

    return responseHandler({
      res,
      response: {
        receiptNo: transaction.receiptNo,
        amount: transaction.amount,
        paymentModeName,
        transactionDate: transaction.transactionDate,
        paymentStatus: booking.paymentStatus,
        amountPaid,
        balanceAmount,
      },
      successMessage:
        booking.paymentStatus === "paid" ? "Payment recorded — booking is now fully paid." : "Payment recorded successfully.",
      statusCode: 201,
    });
  } catch (error) {
    return exceptionHandler({ res, error, statusCode: typeof error === "string" ? 400 : undefined });
  }
}

// ─── pending payment lifecycle (PayNow/NETS — QR generated, not yet paid) ─

const PAYMENT_ATTEMPT_TTL_MS = 15 * 60 * 1000; // 15 minutes to scan & pay one QR

/**
 * Called by controllers/payments/paynow/generate-qr BEFORE it builds the QR
 * image — this is what fixes the amount a QR is generated for, the same
 * moment Cash's own amount gets fixed (createOrder's `paidAmount`). Nothing
 * confirms this payment — it only ever exists as a PENDING PosTransaction
 * until a real webhook or a manual admin confirm (controllers/pos-order-
 * confirmation) flips this SAME row to paid. Neither of those steps gets to
 * choose a different amount.
 *
 * Worst case #1 this guards against: a customer/cashier generates a second
 * QR (retry, changed their mind) while an earlier one for the same order is
 * still outstanding — the earlier PENDING row is cancelled first, so there
 * is never more than one active pending payment per order at a time and a
 * stray old QR can't later get confirmed against a since-superseded amount.
 *
 * `paymentMode`/`paymentModeName` default to the order's own, but a caller
 * SHOULD pass the mode it's actually generating a QR/terminal prompt for
 * explicitly — an installment doesn't have to match how the order was
 * originally paid (booked on Cash, balance topped up via PayNow is exactly
 * the case recordBookingPayment/applyBookingPayment already support for
 * Cash top-ups; PayNow's own generate-qr must do the same, or a PayNow
 * top-up on a Cash-booked order silently gets tagged "Cash" — which is not
 * just a display bug, it also makes the POS Order Confirmation screen's
 * own Cash-exclusion filter hide it, since Cash never needs manual
 * confirmation).
 *
 * @returns {Promise<{ order: PosOrder, transaction: PosTransaction }>}
 */
async function createPendingPayment({ referenceId, amount: requestedAmount, paymentMode, paymentModeName, processedBy }) {
  const order = await PosOrder.findOne(PosOrder.notDeletedFilter({ referenceId }));
  if (!order) throw "No order found for this reference.";
  if (order.orderStatus === "cancelled") throw "This order has been cancelled and can no longer be paid.";

  const { balance } = await resolveOutstandingBalance(order);
  if (balance <= 0.005) throw "This order is already fully paid.";
  if (requestedAmount != null && requestedAmount > balance + 0.005) {
    throw `Payment amount cannot exceed the outstanding balance of ${balance.toFixed(2)}.`;
  }
  const amount = requestedAmount != null ? requestedAmount : balance;

  await PosTransaction.updateMany(
    { orderId: order._id, paymentStatus: "pending" },
    { $set: { paymentStatus: "cancelled" } }
  );

  const receiptNo = await generateReceiptNumber();
  const transaction = await PosTransaction.create({
    receiptNo,
    orderId: order._id,
    bookingId: order.bookingId ?? null,
    customer: order.customer,
    paymentMode: paymentMode ?? order.paymentMode,
    paymentModeName: paymentModeName ?? order.paymentModeName,
    amount,
    paymentStatus: "pending",
    expiresAt: new Date(Date.now() + PAYMENT_ATTEMPT_TTL_MS),
    transactionDate: new Date(),
    processedBy: processedBy ?? null,
    createdBy: processedBy ?? null,
  });

  return { order, transaction };
}

/**
 * Fixes a PayNow pending payment's amount AND renders its QR in one call —
 * used both by createOrder below (embeds the result straight into the
 * order-create response as `paymentDetails`, so a brand new PayNow order
 * never needs a second round trip just to see a QR) and by the standalone
 * POST /payments/paynow/generate-qr route (top-ups against an already-
 * confirmed booking, which has no "order create" response to embed into).
 *
 * Looks up the "PayNow" PaymentMode itself and always tags the pending
 * transaction with it — same reasoning as createPendingPayment's own doc
 * comment: this function only ever generates a PayNow QR, so its pending
 * transaction must always read as PayNow, regardless of what mode the
 * order was originally created/booked under.
 */
async function buildPaynowQrForOrder({ referenceId, amount, processedBy }) {
  assertPaynowConfigured();

  const paynowMode = await PaymentMode.findOne(PaymentMode.notDeletedFilter({ name: "PayNow", status: 1 }));
  if (!paynowMode) throw "PayNow is not configured as an available payment mode.";

  const { transaction } = await createPendingPayment({
    referenceId,
    amount,
    paymentMode: paynowMode._id,
    paymentModeName: paynowMode.name,
    processedBy,
  });

  let qrImage, engine;
  try {
    ({ qrImage, engine } = await renderQrImage(referenceId, transaction.amount));
  } catch (renderError) {
    // The pending payment this QR promised is unconfirmable with no QR ever
    // shown for it — cancel it rather than leaving a ghost entry an admin
    // would otherwise see on the pos-order-confirmation screen for a
    // payment nobody could actually have made.
    await PosTransaction.findByIdAndUpdate(transaction._id, { paymentStatus: "cancelled" }).catch(() => {});
    throw renderError;
  }

  return { amount: transaction.amount, qr: qrImage, engine };
}

/**
 * Writes the PosBooking for an order's first payment when that payment's
 * PosTransaction ALREADY exists (created pending by createPendingPayment,
 * now claimed paid by confirmPosPayment below) — unlike
 * writePosBookingFromOrder (Cash's own synchronous path), this never
 * creates a transaction itself, only the booking, then links the two.
 */
async function writePosBookingOnly(order, amountNow, transaction) {
  const bookingNumber = await generateBookingNumber();
  const now = new Date();
  const bookingPaymentStatus = derivePaymentStatus(amountNow, order.grandTotal);

  let booking;
  try {
    booking = await PosBooking.create({
      bookingNumber,
      orderId: order._id,
      customer: order.customer,
      lines: order.lines,
      subtotal: order.subtotal,
      gstAmount: order.gstAmount,
      grandTotal: order.grandTotal,
      paymentMode: transaction.paymentMode,
      paymentModeName: transaction.paymentModeName,
      paymentStatus: bookingPaymentStatus,
      bookingStatus: "confirmed",
      bookedBy: order.bookedBy,
      entity: order.entity,
      bookedAt: now,
      createdBy: order.bookedBy ?? null,
    });
    await PosTransaction.findByIdAndUpdate(transaction._id, { bookingId: booking._id });
    await PosOrder.findByIdAndUpdate(order._id, { orderStatus: "confirmed", bookingId: booking._id });
  } catch (writeError) {
    // The transaction itself is left "paid" — best-effort cleanup here only
    // removes the half-written booking, so a retry of THIS function (not a
    // new payment) can pick the same already-paid transaction back up
    // rather than losing track of money already confirmed as received.
    if (booking) await PosBooking.deleteOne({ _id: booking._id }).catch(() => {});
    throw writeError;
  }

  await consumeReservations(order._id, order.lines, order.bookedBy, bookingNumber);
  return booking;
}

// ─── shared confirmation dispatcher entrypoint ──────────────────────────

/**
 * Registered against the "POS" prefix in controllers/payments/dispatch.js.
 * Called once a PayNow/NETS confirmation actually lands — a real DBS ICN,
 * or an admin's manual confirm (controllers/pos-order-confirmation) —
 * never at QR generation time. Confirms the SAME PENDING PosTransaction
 * createPendingPayment() already created; does not create a new one and
 * does not accept a different amount than what that row already has.
 *
 * Idempotent two ways (worst case #2 — duplicate/racing confirmations):
 *   - A duplicate callback carrying a `gatewayReference` already recorded
 *     on a "paid" row is recognized and returned as a no-op.
 *   - The actual pending -> paid transition is one atomic
 *     `findOneAndUpdate` guarded on `paymentStatus: "pending"` — if two
 *     confirmations for the same pending row race (e.g. a real webhook and
 *     a manual admin click at nearly the same moment), only the one that
 *     wins the atomic update proceeds to write the booking; the loser sees
 *     its update match nothing and reports alreadyProcessed instead of
 *     double-confirming.
 *
 * @param {string} referenceId
 * @param {{ amount?: number, gatewayReference?: string, processedBy?: ObjectId }} details
 *   `amount`, if given (e.g. a real gateway's own reported amount), is only
 *   ever a cross-check against the pending transaction's own fixed amount —
 *   never a value that changes what gets confirmed.
 */
async function confirmPosPayment(referenceId, details = {}) {
  const order = await PosOrder.findOne(PosOrder.notDeletedFilter({ referenceId }));
  if (!order) throw `No POS order found for reference "${referenceId}".`;

  if (details.gatewayReference) {
    const already = await PosTransaction.findOne(
      PosTransaction.notDeletedFilter({
        orderId: order._id,
        gatewayReference: details.gatewayReference,
        paymentStatus: "paid",
      })
    );
    if (already) return { alreadyProcessed: true, transactionId: already._id };
  }

  const pending = await PosTransaction.findOne(
    PosTransaction.notDeletedFilter({ orderId: order._id, paymentStatus: "pending" })
  );
  if (!pending) throw `No pending payment found for reference "${referenceId}" — it may already be confirmed, or the QR needs to be regenerated.`;

  if (pending.expiresAt && pending.expiresAt < new Date()) {
    await PosTransaction.findByIdAndUpdate(pending._id, { paymentStatus: "expired" });
    throw `The payment window for reference "${referenceId}" has expired — generate a new QR and try again.`;
  }

  if (details.amount != null && Math.abs(details.amount - pending.amount) > 0.005) {
    throw `Confirmation amount ${details.amount.toFixed(2)} does not match the expected amount of ${pending.amount.toFixed(2)} for this payment.`;
  }

  // Atomic claim — see the module comment above for why this specific write
  // (not a read-then-write) is what makes a race between two confirmations
  // for the same pending row safe.
  const claimed = await PosTransaction.findOneAndUpdate(
    { _id: pending._id, paymentStatus: "pending" },
    { $set: { paymentStatus: "paid", gatewayReference: details.gatewayReference ?? null, processedBy: details.processedBy ?? null } },
    { new: true }
  );
  if (!claimed) return { alreadyProcessed: true, transactionId: pending._id };

  // First payment for this order — nothing confirmed yet.
  if (order.orderStatus !== "confirmed") {
    const booking = await writePosBookingOnly(order, claimed.amount, claimed);
    return {
      alreadyProcessed: false,
      _id: booking._id,
      bookingNumber: booking.bookingNumber,
      referenceId: order.referenceId,
      receiptNo: claimed.receiptNo,
      paymentStatus: booking.paymentStatus,
      amountPaid: claimed.amount,
      balanceAmount: +(booking.grandTotal - claimed.amount).toFixed(2),
    };
  }

  // Booking already confirmed — this settlement is a balance top-up.
  const booking = await PosBooking.findById(order.bookingId);
  if (!booking) throw `Booking record not found for confirmed order "${referenceId}".`;
  const paidTransactions = await PosTransaction.find(
    PosTransaction.notDeletedFilter({ bookingId: booking._id })
  ).select("amount paymentStatus");
  const amountPaid = sumPaidAmount(paidTransactions);
  booking.paymentStatus = derivePaymentStatus(amountPaid, booking.grandTotal);
  await booking.save();

  return {
    alreadyProcessed: false,
    _id: booking._id,
    bookingNumber: booking.bookingNumber,
    referenceId: order.referenceId,
    receiptNo: claimed.receiptNo,
    paymentStatus: booking.paymentStatus,
    amountPaid,
    balanceAmount: +(booking.grandTotal - amountPaid).toFixed(2),
  };
}

registerPaymentHandler(ORIGIN_PREFIXES.POS, confirmPosPayment);

// ─── router assembly ──────────────────────────────────────────────────────

function registerPosOrderRoutes(r) {
  r.post("/orders", requirePermission("admin-booking", "fullAccess"), validateBody(createOrderSchema), createOrder);
  r.post("/orders/:id/confirm", requirePermission("admin-booking", "fullAccess"), confirmOrder);
  r.get("/orders/:id/status", requirePermission("admin-booking", "view"), getOrderStatus);

  r.get("/bookings", requirePermission("pos-transactions", "view"), listBookings);
  r.get("/bookings/:id", requirePermission("pos-transactions", "view"), getBookingDetail);

  r.post(
    "/bookings/:id/payments",
    requirePermission("pos-transactions", "fullAccess"),
    validateBody(recordPaymentSchema),
    recordBookingPayment
  );
}

module.exports = {
  registerPosOrderRoutes,
  confirmPosPayment,
  // used by controllers/payments/paynow/generate-qr
  createPendingPayment,
  buildPaynowQrForOrder,
  resolveOutstandingBalance,
  // exposed for unit testing, same pattern controllers/pos/index.js uses
  createOrder,
  confirmOrder,
  getOrderStatus,
  recordBookingPayment,
  writePosBookingFromOrder,
  writePosBookingOnly,
};
