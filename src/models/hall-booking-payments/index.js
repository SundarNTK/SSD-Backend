const mongoose = require("mongoose");
const { auditablePlugin } = require("../../common/plugins/auditable");

/**
 * The payment-specific record for a Hall Booking — kept as its own
 * collection, same reasoning as models/transactions: a booking's amountPaid
 * is never stored redundantly on the booking, it's always the sum of this
 * booking's "paid" rows here, computed at read time. `booking` is
 * deliberately not unique-constrained — a deposit, an advance, and any
 * number of balance installments each append their own row.
 */

const PAYMENT_TYPES = ["deposit", "advance", "balance"];
const PAYMENT_ROW_STATUSES = ["paid"];

const hallBookingPaymentSchema = new mongoose.Schema({
  receiptNo: { type: String, required: true },
  booking: { type: mongoose.Schema.Types.ObjectId, ref: "HallBooking", required: true },
  customer: { type: mongoose.Schema.Types.ObjectId, ref: "Customer", required: true },

  paymentType: { type: String, enum: PAYMENT_TYPES, required: true },
  amount: { type: Number, required: true, min: 0 },

  paymentMode: { type: mongoose.Schema.Types.ObjectId, ref: "PaymentMode", required: true },
  paymentModeName: { type: String, required: true },
  // NETS-only — QR / Debit Card / Credit Card. Empty for every other mode.
  paymentSubtype: { type: String, default: "" },
  referenceNo: { type: String, default: "" },
  remarks: { type: String, default: "" },

  // No refunded/void row here — a refund is tracked on the booking's own
  // `refund` subdocument (see models/hall-bookings), not by mutating a
  // payment row after the fact.
  paymentStatus: { type: String, enum: PAYMENT_ROW_STATUSES, default: "paid" },

  paymentDate: { type: Date, required: true },
  collectedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  collectedByInfo: { type: mongoose.Schema.Types.Mixed, default: null },
});

hallBookingPaymentSchema.pre("save", async function populatePaymentSnapshots() {
  const { buildUserSnapshot } = require("../../common/utils/entity-snapshot");
  if (this.isModified("collectedBy") && this.collectedBy) {
    this.collectedByInfo = await buildUserSnapshot(this.collectedBy);
  }
});

hallBookingPaymentSchema.plugin(auditablePlugin);

hallBookingPaymentSchema.index({ receiptNo: 1 }, { unique: true });
hallBookingPaymentSchema.index({ booking: 1, createdAt: 1 });
hallBookingPaymentSchema.index({ customer: 1, createdAt: -1 });

module.exports = {
  HallBookingPayment: mongoose.model("HallBookingPayment", hallBookingPaymentSchema),
  PAYMENT_TYPES,
};
