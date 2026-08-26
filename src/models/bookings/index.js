const mongoose = require("mongoose");
const { auditablePlugin } = require("../../common/plugins/auditable");

/**
 * A Booking is the permanent, confirmed record of a transaction. It is
 * created exclusively by POST /pos/orders/:id/confirm and represents the
 * single source of truth for "this purchase happened".
 *
 * It mirrors the Order's line items but is intentionally a snapshot —
 * changes to the Item/Service master after booking must NOT retroactively
 * alter a receipt. Prices, names and codes are denormalised here.
 *
 * Inventory stock is permanently decremented (via an InventoryAdjustment
 * "Stock Out") at the moment this record is inserted.
 */

const bookingLineSchema = new mongoose.Schema(
  {
    refType: { type: String, enum: ["Item", "Service"], required: true },
    refId: { type: mongoose.Schema.Types.ObjectId, required: true },
    name: { type: String, required: true },
    code: { type: String, required: true },
    quantity: { type: Number, required: true, min: 1 },
    unitPrice: { type: Number, required: true, min: 0 },
    deities: {
      type: [{ type: mongoose.Schema.Types.ObjectId, ref: "Deity" }],
      default: [],
    },
    devotees: {
      type: [
        {
          name: { type: String, required: true },
          nakshatra: { type: String, default: "" },
        },
      ],
      default: [],
    },
    lineTotal: { type: Number, required: true, min: 0 },
  },
  { _id: false }
);

const BOOKING_STATUSES = ["confirmed", "cancelled"];

// Re-import from orders so both collections share the same constant and
// stay in sync when a new portal surface is added.
const { PORTAL_TYPES } = require("../orders");

const bookingSchema = new mongoose.Schema({
  bookingNumber: { type: String, required: true },
  orderId: { type: mongoose.Schema.Types.ObjectId, ref: "Order", required: true },
  customer: { type: mongoose.Schema.Types.ObjectId, ref: "Customer", required: true },

  lines: { type: [bookingLineSchema], default: [] },

  subtotal: { type: Number, required: true, min: 0, default: 0 },
  gstAmount: { type: Number, required: true, min: 0, default: 0 },
  grandTotal: { type: Number, required: true, min: 0, default: 0 },

  paymentMode: { type: mongoose.Schema.Types.ObjectId, ref: "PaymentMode", required: true },
  paymentModeName: { type: String, required: true },
  paymentStatus: { type: String, enum: ["paid", "pending"], default: "paid" },

  bookingStatus: { type: String, enum: BOOKING_STATUSES, default: "confirmed" },

  // Copied from the originating Order at confirm time — which surface
  // (Admin Panel, POS counter, or future Customer Portal) created this booking.
  portal: { type: String, enum: PORTAL_TYPES, default: "admin" },

  bookedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  entity: { type: mongoose.Schema.Types.ObjectId, default: null },
  bookedAt: { type: Date, required: true },
});

bookingSchema.plugin(auditablePlugin);

bookingSchema.index({ bookingNumber: 1 }, { unique: true });
bookingSchema.index({ customer: 1, createdAt: -1 });
bookingSchema.index({ bookingStatus: 1, createdAt: -1 });
bookingSchema.index({ portal: 1, createdAt: -1 });
bookingSchema.index({ orderId: 1 });

module.exports = { Booking: mongoose.model("Booking", bookingSchema), BOOKING_STATUSES };
