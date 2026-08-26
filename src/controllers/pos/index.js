/**
 * POS / Admin Booking controller
 * Mounted at /pos — see routes/index.js.
 *
 * Endpoints:
 *
 *   GET  /pos/booking/customers/search?query=   — quick customer lookup
 *   GET  /pos/booking/items?search=&category=   — POS item picker
 *   GET  /pos/booking/services?search=&category= — POS service picker
 *   GET  /pos/booking/payment-modes             — active payment modes
 *   POST /pos/booking/summary                   — price + availability calc (no writes)
 *   POST /pos/booking/orders                    — create order + reserve inventory
 *   POST /pos/booking/orders/:id/confirm        — confirm order → booking + stock-out
 *
 * Inventory reservation lifecycle: see inventory-reservation.js.
 */

const express = require("express");
const authGuard = require("../../common/middleware/auth-guard");
const adminOnly = require("../../common/middleware/admin-only");
const requirePermission = require("../../common/middleware/require-permission");
const validateBody = require("../../common/middleware/validate");
const { responseHandler, exceptionHandler } = require("../../utilities/handlers");
const { nextSequence } = require("../../common/utils/sequence");
const escapeRegex = require("../../common/utils/escape-regex");

const Item = require("../../models/items");
const Service = require("../../models/services");
const { Customer } = require("../../models/customers");
const PaymentMode = require("../../models/payment-modes");
const { Order } = require("../../models/orders");
const { Booking } = require("../../models/bookings");

const {
  placeReservationsForOrder,
  consumeReservations,
  cancelReservations,
  getAvailability,
} = require("./inventory-reservation");

const {
  summarySchema,
  createOrderSchema,
  confirmOrderSchema,
  customerSearchSchema,
} = require("./request-objects");

const mongoose = require("mongoose");

// ─── helpers ──────────────────────────────────────────────────────────────────

function searchRegex(term) {
  return new RegExp(escapeRegex(term.trim()), "i");
}

/**
 * Generate the next sequential order number: POS-YYYYMMDD-NNNN
 * Uses the shared atomic sequence counter.
 */
async function generateOrderNumber() {
  const n = await nextSequence("pos_order");
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  return `POS${today}${String(n).padStart(4, "0")}`;
}

/**
 * Generate the next booking number: BKG-YYYYMMDD-NNNN
 */
async function generateBookingNumber() {
  const n = await nextSequence("booking");
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  return `BKG${today}${String(n).padStart(4, "0")}`;
}

/**
 * Fetch the GST percentage for a General Ledger (populated on Item/Service).
 * Returns 0 if the GL has no GST — the GST master's own `percentage` field
 * is the single source of truth for the rate (0 for "Exempted"/"Zero-rated"
 * rows), so there's no separate `type` string to special-case here.
 */
async function resolveGstRate(generalLedgerId) {
  if (!generalLedgerId) return 0;
  try {
    const GeneralLedger = mongoose.model("GeneralLedger");
    const gl = await GeneralLedger.findById(generalLedgerId).populate("gstType");
    return gl?.gstType?.percentage ?? 0;
  } catch {
    return 0;
  }
}

// ─── customer lookup ──────────────────────────────────────────────────────────

/**
 * GET /pos/booking/customers/search?query=
 * Search customers by mobile, email, or name for the Personal Details step.
 * Returns up to 10 matches.
 */
async function searchCustomers(req, res) {
  try {
    const { error, value } = customerSearchSchema.validate(req.query);
    if (error) throw error.details[0].message;

    const { query } = value;
    const regex = searchRegex(query);

    const customers = await Customer.find(
      Customer.notDeletedFilter({
        status: 1,
        $or: [{ name: regex }, { email: regex }, { mobileNumber: regex }],
      })
    )
      .select("customerCode name email mobileNumber familyMembers")
      .sort({ name: 1 })
      .limit(10);

    return responseHandler({ res, response: { items: customers } });
  } catch (error) {
    return exceptionHandler({ res, error, statusCode: typeof error === "string" ? 400 : undefined });
  }
}

// ─── item / service catalogue for POS picker ─────────────────────────────────

/**
 * GET /pos/booking/items?search=&category=&page=&pageSize=
 * Returns active items with posAvailability = true.
 */
async function listPosItems(req, res) {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(100, Number(req.query.pageSize) || 50);

    const filter = Item.notDeletedFilter({ status: 1, posAvailability: true });
    if (req.query.search) {
      const regex = searchRegex(req.query.search);
      filter.$or = [{ name: regex }, { code: regex }];
    }
    if (req.query.category) {
      filter["categoryDetails.category"] = req.query.category;
    }

    const [items, total] = await Promise.all([
      Item.find(filter)
        .populate("categoryDetails.category", "name color")
        .populate("categoryDetails.subCategory", "name")
        .populate("generalLedger", "gstType")
        .select("name code salePrice isInventoryApplicable currentStock threshold isDeityMappingRequired isFamilyMembersRequired minQuantity maxQuantity categoryDetails")
        .sort({ name: 1 })
        .skip((page - 1) * pageSize)
        .limit(pageSize),
      Item.countDocuments(filter),
    ]);

    // Attach live available quantity to each item
    const itemsWithAvailability = await Promise.all(
      items.map(async (item) => {
        const avail = await getAvailability("Item", item._id);
        return {
          _id: item._id,
          code: item.code,
          name: item.name,
          salePrice: item.salePrice,
          isDeityMappingRequired: item.isDeityMappingRequired,
          isFamilyMembersRequired: item.isFamilyMembersRequired,
          minQuantity: item.minQuantity,
          maxQuantity: item.maxQuantity,
          categoryDetails: item.categoryDetails,
          inventory: avail,
        };
      })
    );

    return responseHandler({ res, response: { items: itemsWithAvailability, total, page, pageSize } });
  } catch (error) {
    return exceptionHandler({ res, error });
  }
}

/**
 * GET /pos/booking/services?search=&category=&page=&pageSize=
 * Returns active services with isPosAvailable = true.
 */
async function listPosServices(req, res) {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(100, Number(req.query.pageSize) || 50);

    const filter = Service.notDeletedFilter({ status: 1, isPosAvailable: true });
    if (req.query.search) {
      const regex = searchRegex(req.query.search);
      filter.$or = [{ name: regex }, { code: regex }];
    }
    if (req.query.category) {
      filter["categoryDetails.category"] = req.query.category;
    }

    const [services, total] = await Promise.all([
      Service.find(filter)
        .populate("categoryDetails.category", "name color")
        .populate("categoryDetails.subCategory", "name")
        .populate("deityMapping", "name")
        .select("name code categoryDetails isInventoryRequired currentStock thresholdCount isDeityMappingRequired deityMapping isFamilyMembersRequired minFamilyMembers maxFamilyMembers sessionRequired")
        .sort({ name: 1 })
        .skip((page - 1) * pageSize)
        .limit(pageSize),
      Service.countDocuments(filter),
    ]);

    const servicesWithAvailability = await Promise.all(
      services.map(async (svc) => {
        const avail = await getAvailability("Service", svc._id);
        // salePrice lives in categoryDetails — expose first one as default if needed
        const firstCatPrice = svc.categoryDetails[0]?.salePrice ?? 0;
        return {
          _id: svc._id,
          code: svc.code,
          name: svc.name,
          defaultSalePrice: firstCatPrice,
          categoryDetails: svc.categoryDetails,
          isDeityMappingRequired: svc.isDeityMappingRequired,
          deityMapping: svc.deityMapping,
          isFamilyMembersRequired: svc.isFamilyMembersRequired,
          minFamilyMembers: svc.minFamilyMembers,
          maxFamilyMembers: svc.maxFamilyMembers,
          sessionRequired: svc.sessionRequired,
          inventory: avail,
        };
      })
    );

    return responseHandler({ res, response: { items: servicesWithAvailability, total, page, pageSize } });
  } catch (error) {
    return exceptionHandler({ res, error });
  }
}

/**
 * GET /pos/booking/payment-modes
 * Returns all active payment modes. The frontend shows only Cash for now
 * but this endpoint returns all so the screen can expand later.
 */
async function listPaymentModes(req, res) {
  try {
    const modes = await PaymentMode.find(
      PaymentMode.notDeletedFilter({ status: 1 })
    )
      .select("name description")
      .sort({ name: 1 });

    return responseHandler({ res, response: { items: modes } });
  } catch (error) {
    return exceptionHandler({ res, error });
  }
}

// ─── booking summary (no writes) ─────────────────────────────────────────────

/**
 * POST /pos/booking/summary
 *
 * Accepts the cart lines, validates them, resolves current prices and
 * availability, and returns a full cost breakdown. Does NOT write anything
 * to the database.
 *
 * Used by the frontend "Cart Summary" panel in real time as items are added.
 */
async function bookingSummary(req, res) {
  try {
    const { error, value } = summarySchema.validate(req.body);
    if (error) throw error.details[0].message;

    const { customerId, lines } = value;

    // Validate customer exists
    const customer = await Customer.findOne(
      Customer.notDeletedFilter({ _id: customerId, status: 1 })
    ).select("customerCode name email mobileNumber");
    if (!customer) throw "Customer not found or inactive.";

    const resolvedLines = [];
    let subtotal = 0;
    let totalGst = 0;

    for (const line of lines) {
      const { refType, refId, quantity, deities, devotees } = line;

      let name, code, unitPrice, gstRate;

      if (refType === "Item") {
        const item = await Item.findOne(
          Item.notDeletedFilter({ _id: refId, status: 1, posAvailability: true })
        ).populate("generalLedger", "gstType");
        if (!item) throw `Item not found or not available at POS.`;

        name = item.name;
        code = item.code;
        unitPrice = item.salePrice;
        gstRate = await resolveGstRate(item.generalLedger?._id);
      } else {
        // Service — price from categoryDetails
        const svc = await Service.findOne(
          Service.notDeletedFilter({ _id: refId, status: 1, isPosAvailable: true })
        ).populate("categoryDetails.category");
        if (!svc) throw `Service not found or not available at POS.`;

        name = svc.name;
        code = svc.code;
        // Use the first category price as default (admin can override in future)
        unitPrice = svc.categoryDetails[0]?.salePrice ?? 0;
        gstRate = 0; // Services typically exempt; can extend later
      }

      // Check availability (read-only — no reservation written here)
      const avail = await getAvailability(refType, refId);
      const available = avail.isInventoryApplicable ? avail.availableQty : Infinity;

      const lineTotal = unitPrice * quantity;
      const lineGst = +(lineTotal * (gstRate / 100)).toFixed(2);

      subtotal += lineTotal;
      totalGst += lineGst;

      resolvedLines.push({
        refType,
        refId,
        name,
        code,
        quantity,
        unitPrice,
        gstRate,
        lineGst,
        lineTotal,
        deities,
        devotees,
        inventory: avail.isInventoryApplicable
          ? {
              isApplicable: true,
              currentStock: avail.currentStock,
              reservedQty: avail.reservedQty,
              availableQty: avail.availableQty,
              threshold: avail.threshold,
            }
          : { isApplicable: false },
        availableForBooking: available,
        quantityExceedsStock: avail.isInventoryApplicable && quantity > avail.availableQty,
      });
    }

    const grandTotal = +(subtotal + totalGst).toFixed(2);

    return responseHandler({
      res,
      response: {
        customer: {
          _id: customer._id,
          customerCode: customer.customerCode,
          name: customer.name,
          email: customer.email,
          mobileNumber: customer.mobileNumber,
        },
        lines: resolvedLines,
        subtotal: +subtotal.toFixed(2),
        gstAmount: +totalGst.toFixed(2),
        grandTotal,
        hasStockIssues: resolvedLines.some((l) => l.quantityExceedsStock),
      },
    });
  } catch (error) {
    return exceptionHandler({ res, error, statusCode: typeof error === "string" ? 400 : undefined });
  }
}

// ─── create order ─────────────────────────────────────────────────────────────

/**
 * POST /pos/booking/orders
 *
 * 1. Validate all lines (price, availability).
 * 2. Atomically place inventory reservations for inventory-applicable lines.
 *    If ANY line fails the availability check, ALL previously-placed
 *    reservations for this order are immediately rolled back.
 * 3. Write the Order document (status: "pending").
 * 4. Return the order with a 30-minute hold expiry timestamp.
 *
 * For Cash payment the frontend immediately calls /confirm after receiving
 * the order — the 30-minute window is never visible to the user in that
 * case, but the hold still exists for consistency.
 */
async function createOrder(req, res) {
  try {
    const { error, value } = createOrderSchema.validate(req.body);
    if (error) throw error.details[0].message;

    const { customerId, lines, paymentModeId } = value;

    const customer = await Customer.findOne(
      Customer.notDeletedFilter({ _id: customerId, status: 1 })
    ).select("customerCode name email mobileNumber");
    if (!customer) throw "Customer not found or inactive.";

    const paymentMode = await PaymentMode.findOne(
      PaymentMode.notDeletedFilter({ _id: paymentModeId, status: 1 })
    ).select("name");
    if (!paymentMode) throw "Payment mode not found or inactive.";

    // ── 1. Resolve all line details (prices, names, codes) ──────────────────
    const resolvedLines = [];
    let subtotal = 0;
    let totalGst = 0;

    for (const line of lines) {
      const { refType, refId, quantity, deities, devotees } = line;
      let name, code, unitPrice;

      if (refType === "Item") {
        const item = await Item.findOne(
          Item.notDeletedFilter({ _id: refId, status: 1, posAvailability: true })
        );
        if (!item) throw `An item in the cart is no longer available.`;
        name = item.name;
        code = item.code;
        unitPrice = item.salePrice;
      } else {
        const svc = await Service.findOne(
          Service.notDeletedFilter({ _id: refId, status: 1, isPosAvailable: true })
        );
        if (!svc) throw `A service in the cart is no longer available.`;
        name = svc.name;
        code = svc.code;
        unitPrice = svc.categoryDetails[0]?.salePrice ?? 0;
      }

      const lineTotal = unitPrice * quantity;
      subtotal += lineTotal;

      resolvedLines.push({ refType, refId, quantity, name, code, unitPrice, lineTotal, deities, devotees });
    }

    const grandTotal = +(subtotal + totalGst).toFixed(2);
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000);
    const orderNumber = await generateOrderNumber();

    // ── 2. Write the Order first (gives us an _id for reservations) ─────────
    const order = await Order.create({
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
    });

    // ── 3. Place inventory reservations ─────────────────────────────────────
    // If this throws, we cancel the order too and re-throw to the client.
    try {
      await placeReservationsForOrder(resolvedLines, order._id);
    } catch (reservationError) {
      // Roll back the order so the order number isn't a ghost
      await Order.findByIdAndUpdate(order._id, { orderStatus: "cancelled" });
      throw reservationError;
    }

    return responseHandler({
      res,
      response: {
        _id: order._id,
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
      },
      successMessage: "Order created. Inventory held for 30 minutes.",
      statusCode: 201,
    });
  } catch (error) {
    return exceptionHandler({ res, error, statusCode: typeof error === "string" ? 400 : undefined });
  }
}

// ─── confirm order → booking ──────────────────────────────────────────────────

/**
 * POST /pos/booking/orders/:id/confirm
 *
 * 1. Verify the order is still pending and not expired.
 * 2. Write the Booking document (permanent confirmed record).
 * 3. Mark the Order as confirmed, set bookingId.
 * 4. consumeReservations() — permanently decrement currentStock on each
 *    inventory-applicable ref and write InventoryAdjustment "Stock Out" rows.
 *
 * For Cash, the frontend calls this immediately after createOrder succeeds.
 * For other payment modes (future), the payment gateway callback calls it.
 */
async function confirmOrder(req, res) {
  try {
    const orderId = req.params.id;
    if (!mongoose.isValidObjectId(orderId)) throw "Invalid order ID.";

    // No required body for cash — just validate whatever comes
    const { error } = confirmOrderSchema.validate(req.body ?? {});
    if (error) throw error.details[0].message;

    const order = await Order.findOne(
      Order.notDeletedFilter({ _id: orderId })
    ).populate("customer", "customerCode name email mobileNumber");

    if (!order) throw "Order not found.";
    if (order.orderStatus === "confirmed") {
      // Idempotent — return the existing booking
      const existing = await Booking.findById(order.bookingId)
        .populate("customer", "customerCode name email mobileNumber");
      return responseHandler({ res, response: existing, successMessage: "Booking already confirmed." });
    }
    if (order.orderStatus === "cancelled") throw "This order has been cancelled and cannot be confirmed.";

    // Check the 30-minute hold hasn't expired
    if (new Date() > order.expiresAt) {
      await cancelReservations(order._id);
      await Order.findByIdAndUpdate(order._id, { orderStatus: "cancelled" });
      throw "Order expired — the 30-minute hold has lapsed. Please create a new order.";
    }

    const bookingNumber = await generateBookingNumber();
    const now = new Date();

    // ── 1. Write Booking (permanent record) ──────────────────────────────────
    const booking = await Booking.create({
      bookingNumber,
      orderId: order._id,
      customer: order.customer._id ?? order.customer,
      lines: order.lines,
      subtotal: order.subtotal,
      gstAmount: order.gstAmount,
      grandTotal: order.grandTotal,
      paymentMode: order.paymentMode,
      paymentModeName: order.paymentModeName,
      paymentStatus: "paid",
      bookingStatus: "confirmed",
      bookedBy: order.bookedBy,
      entity: order.entity,
      bookedAt: now,
      createdBy: order.bookedBy ?? null,
    });

    // ── 2. Update Order ──────────────────────────────────────────────────────
    await Order.findByIdAndUpdate(order._id, {
      orderStatus: "confirmed",
      bookingId: booking._id,
    });

    // ── 3. Permanently decrement stock + consume reservations ────────────────
    await consumeReservations(
      order._id,
      order.lines,
      order.bookedBy,
      bookingNumber
    );

    const customerSnap = order.customer?.customerCode
      ? order.customer
      : await Customer.findById(order.customer).select("customerCode name email mobileNumber");

    return responseHandler({
      res,
      response: {
        _id: booking._id,
        bookingNumber: booking.bookingNumber,
        orderNumber: order.orderNumber,
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
      },
      successMessage: "Booking confirmed successfully.",
      statusCode: 201,
    });
  } catch (error) {
    return exceptionHandler({ res, error, statusCode: typeof error === "string" ? 400 : undefined });
  }
}

// ─── router assembly ──────────────────────────────────────────────────────────

const router = express.Router();

// All POS routes require an authenticated admin
router.use(authGuard, adminOnly);

router.get("/health", (req, res) =>
  res.json({ ok: true, service: "SSD-Backend", module: "pos" })
);

// Booking sub-routes — gated on "admin-booking" module permission
const booking = express.Router();

booking.get(
  "/customers/search",
  requirePermission("admin-booking", "view"),
  searchCustomers
);
booking.get(
  "/items",
  requirePermission("admin-booking", "view"),
  listPosItems
);
booking.get(
  "/services",
  requirePermission("admin-booking", "view"),
  listPosServices
);
booking.get(
  "/payment-modes",
  requirePermission("admin-booking", "view"),
  listPaymentModes
);
booking.post(
  "/summary",
  requirePermission("admin-booking", "view"),
  validateBody(summarySchema),
  bookingSummary
);
booking.post(
  "/orders",
  requirePermission("admin-booking", "fullAccess"),
  validateBody(createOrderSchema),
  createOrder
);
booking.post(
  "/orders/:id/confirm",
  requirePermission("admin-booking", "fullAccess"),
  confirmOrder
);

router.use("/booking", booking);

module.exports = router;
