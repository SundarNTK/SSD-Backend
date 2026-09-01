const mongoose = require("mongoose");
const { auditablePlugin } = require("../../common/plugins/auditable");
const { PORTAL_TYPES } = require("../orders");

/**
 * A Transaction is the payment-specific record for a confirmed Booking —
 * receipt number, payment mode, amount, and status — kept separate from the
 * Booking header on purpose so payment history isn't locked into a 1:1
 * shape. `bookingId` is deliberately not unique-constrained: a full-payment
 * confirm still writes exactly one row, but the partial-payment flow
 * (POST /pos/booking/bookings/:id/payments) appends further rows against the
 * same booking as the balance is collected. A booking's amountPaid is never
 * stored redundantly — it's always the sum of this booking's "paid" rows,
 * computed at read time (see getPaidAmount() in controllers/pos), so there is
 * exactly one source of truth for how much has actually been collected.
 */

const TRANSACTION_STATUSES = ["paid", "pending", "refunded"];

const transactionSchema = new mongoose.Schema({
  receiptNo: { type: String, required: true },

  bookingId: { type: mongoose.Schema.Types.ObjectId, ref: "Booking", required: true },
  orderId: { type: mongoose.Schema.Types.ObjectId, ref: "Order", required: true },
  customer: { type: mongoose.Schema.Types.ObjectId, ref: "Customer", required: true },

  paymentMode: { type: mongoose.Schema.Types.ObjectId, ref: "PaymentMode", required: true },
  paymentModeName: { type: String, required: true },
  amount: { type: Number, required: true, min: 0 },
  // Named paymentStatus, not status — auditablePlugin (applied below)
  // already declares its own `status: Number` (the generic active/inactive
  // flag every model gets); a same-named field here would be silently
  // clobbered by the plugin's schema.add(), since the plugin runs after
  // this object literal. Booking/Order avoid the same collision the same
  // way, via bookingStatus/orderStatus.
  paymentStatus: { type: String, enum: TRANSACTION_STATUSES, default: "paid" },

  // Mirrors the Booking/Order's own portal field — denormalized here so
  // the Transactions ledger can filter/report by surface without a join.
  portal: { type: String, enum: PORTAL_TYPES, default: "admin" },

  transactionDate: { type: Date, required: true },
  processedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },

  // Denormalized snapshots — see common/utils/entity-snapshot. Frozen at
  // write time; not retroactively updated by a later name/role change.
  customerInfo: { type: mongoose.Schema.Types.Mixed, default: null },
  processedByInfo: { type: mongoose.Schema.Types.Mixed, default: null },
});

transactionSchema.pre("save", async function populateTransactionSnapshots() {
  const { buildUserSnapshot, buildCustomerSnapshot } = require("../../common/utils/entity-snapshot");
  if (this.isModified("customer") && this.customer) {
    this.customerInfo = await buildCustomerSnapshot(this.customer);
  }
  if (this.isModified("processedBy") && this.processedBy) {
    this.processedByInfo = await buildUserSnapshot(this.processedBy);
  }
});

transactionSchema.plugin(auditablePlugin);

transactionSchema.index({ receiptNo: 1 }, { unique: true });
transactionSchema.index({ bookingId: 1 });
transactionSchema.index({ orderId: 1 });
transactionSchema.index({ customer: 1, createdAt: -1 });
transactionSchema.index({ paymentStatus: 1, createdAt: -1 });
transactionSchema.index({ portal: 1, createdAt: -1 });

module.exports = { Transaction: mongoose.model("Transaction", transactionSchema), TRANSACTION_STATUSES };
