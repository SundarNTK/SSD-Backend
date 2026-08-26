const mongoose = require("mongoose");
const { auditablePlugin } = require("../../common/plugins/auditable");

/**
 * An order is the in-progress shopping-cart record created when the admin
 * clicks "Create Order" on the Admin Booking screen. It captures all chosen
 * items/services, their quantities, devotee details, and the chosen payment
 * mode, but does NOT yet write to the bookings table or decrement permanent
 * inventory.
 *
 * Lifecycle:
 *   pending  → created via POST /pos/orders
 *   confirmed → moved to Booking record via POST /pos/orders/:id/confirm
 *   cancelled → released when the 30-minute hold expires (TTL) or by manual
 *               abandon
 *
 * Inventory is held via InventoryReservation documents (a separate
 * collection) so that the hold can be released atomically by expiry without
 * touching this record.
 */

const orderLineSchema = new mongoose.Schema(
  {
    refType: { type: String, enum: ["Item", "Service"], required: true },
    refId: { type: mongoose.Schema.Types.ObjectId, required: true, refPath: "refType" },
    name: { type: String, required: true },
    code: { type: String, required: true },
    quantity: { type: Number, required: true, min: 1 },
    unitPrice: { type: Number, required: true, min: 0 },
    // For services: each line can map to one or more deities
    deities: {
      type: [{ type: mongoose.Schema.Types.ObjectId, ref: "Deity" }],
      default: [],
    },
    // Devotee entries for this line (name + nakshatra)
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

const ORDER_STATUSES = ["pending", "confirmed", "cancelled"];

const orderSchema = new mongoose.Schema({
  orderNumber: { type: String, required: true },
  customer: { type: mongoose.Schema.Types.ObjectId, ref: "Customer", required: true },

  lines: { type: [orderLineSchema], default: [] },

  subtotal: { type: Number, required: true, min: 0, default: 0 },
  gstAmount: { type: Number, required: true, min: 0, default: 0 },
  grandTotal: { type: Number, required: true, min: 0, default: 0 },

  paymentMode: { type: mongoose.Schema.Types.ObjectId, ref: "PaymentMode", required: true },
  paymentModeName: { type: String, required: true },

  orderStatus: { type: String, enum: ORDER_STATUSES, default: "pending" },

  // Set when this order is confirmed and a Booking record is created
  bookingId: { type: mongoose.Schema.Types.ObjectId, ref: "Booking", default: null },

  // When the pending hold expires — used by the cleanup job as a fence post.
  // Orders placed by admin never expire (set far in the future), but the
  // field must exist for the TTL-reservation logic to read.
  expiresAt: { type: Date, required: true },

  // Booked by which admin
  bookedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  // Entity context at the time of booking
  entity: { type: mongoose.Schema.Types.ObjectId, default: null },
});

orderSchema.plugin(auditablePlugin);

orderSchema.index({ orderNumber: 1 }, { unique: true });
orderSchema.index({ customer: 1, createdAt: -1 });
orderSchema.index({ orderStatus: 1, createdAt: -1 });
// Allows the cleanup job to find and process expired pending orders efficiently
orderSchema.index({ orderStatus: 1, expiresAt: 1 });

module.exports = { Order: mongoose.model("Order", orderSchema), ORDER_STATUSES };
