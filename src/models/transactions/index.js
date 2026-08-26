const mongoose = require("mongoose");
const { auditablePlugin } = require("../../common/plugins/auditable");

/**
 * A Transaction is the payment-specific record for a confirmed Booking —
 * receipt number, payment mode, amount, and status — kept separate from the
 * Booking header on purpose so payment history isn't locked into a 1:1
 * shape. Today the POS flow pays in full at confirm time, so it's always
 * exactly one Transaction per Booking, but `bookingId` is deliberately not
 * unique-constrained: a future partial-payment or refund flow can append
 * more rows against the same booking without a schema change, the same way
 * a booking's totalAmountPaid would eventually need to be summed across
 * its transactions rather than read off a single row.
 */

const TRANSACTION_STATUSES = ["paid", "pending", "refunded"];

const { PORTAL_TYPES } = require("../orders");

const transactionSchema = new mongoose.Schema({
  receiptNo: { type: String, required: true },

  bookingId: { type: mongoose.Schema.Types.ObjectId, ref: "Booking", required: true },
  orderId: { type: mongoose.Schema.Types.ObjectId, ref: "Order", required: true },
  customer: { type: mongoose.Schema.Types.ObjectId, ref: "Customer", required: true },

  paymentMode: { type: mongoose.Schema.Types.ObjectId, ref: "PaymentMode", required: true },
  paymentModeName: { type: String, required: true },
  amount: { type: Number, required: true, min: 0 },
  status: { type: String, enum: TRANSACTION_STATUSES, default: "paid" },

  // Mirrors the Booking/Order's own portal field — denormalized here so
  // the Transactions ledger can filter/report by surface without a join.
  portal: { type: String, enum: PORTAL_TYPES, default: "admin" },

  transactionDate: { type: Date, required: true },
  processedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
});

transactionSchema.plugin(auditablePlugin);

transactionSchema.index({ receiptNo: 1 }, { unique: true });
transactionSchema.index({ bookingId: 1 });
transactionSchema.index({ orderId: 1 });
transactionSchema.index({ customer: 1, createdAt: -1 });
transactionSchema.index({ status: 1, createdAt: -1 });
transactionSchema.index({ portal: 1, createdAt: -1 });

module.exports = { Transaction: mongoose.model("Transaction", transactionSchema), TRANSACTION_STATUSES };
