const mongoose = require("mongoose");
const { auditablePlugin } = require("../../common/plugins/auditable");

/**
 * The POS counter's own payment-history ledger — the `pos_` counterpart to
 * models/transactions, one row per payment attempt against a PosBooking.
 * `bookingId` is deliberately not unique-constrained, same reason as the
 * shared Transaction model: a full-payment confirm writes one row, and the
 * partial-payment flow appends further rows as the balance is collected. A
 * booking's amountPaid is never stored redundantly — always the sum of its
 * "paid" rows, computed at read time.
 *
 * Unlike the shared Transaction model (which only ever needed
 * paid|pending|refunded because Cash was the only mode, settled
 * synchronously), this ledger has a genuine async pending -> paid/failed
 * lifecycle for PayNow/NETS: a row is written PENDING before redirecting to
 * the gateway/terminal, and flipped by the shared confirmation dispatcher
 * (controllers/payments/dispatch.js) once the real confirmation lands —
 * never re-created. `gatewayReference` is what makes that flip idempotent:
 * whatever the bank/terminal hands back (DBS txnRefId, a NETS terminal
 * reference) so a duplicate callback for an already-settled row is
 * recognizable and safely ignored rather than double-counted.
 */

const POS_TRANSACTION_STATUSES = ["pending", "paid", "failed", "cancelled", "expired", "refunded"];

const posTransactionSchema = new mongoose.Schema({
  receiptNo: { type: String, required: true },

  bookingId: { type: mongoose.Schema.Types.ObjectId, ref: "PosBooking", required: true },
  orderId: { type: mongoose.Schema.Types.ObjectId, ref: "PosOrder", required: true },
  customer: { type: mongoose.Schema.Types.ObjectId, ref: "Customer", required: true },

  paymentMode: { type: mongoose.Schema.Types.ObjectId, ref: "PaymentMode", required: true },
  paymentModeName: { type: String, required: true },
  amount: { type: Number, required: true, min: 0 },
  // Named paymentStatus, not status — see models/transactions' own comment
  // on why (auditablePlugin already owns `status`).
  paymentStatus: { type: String, enum: POS_TRANSACTION_STATUSES, default: "paid" },

  // Whatever the gateway/terminal hands back once settled — DBS's
  // txnRefId for PayNow, the terminal's own reference for NETS. Not set
  // for Cash (nothing to correlate against). The one field a duplicate
  // callback is matched against before deciding "already processed."
  gatewayReference: { type: mongoose.Schema.Types.Mixed, default: null },

  transactionDate: { type: Date, required: true },
  processedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },

  // Denormalized snapshots — see common/utils/entity-snapshot.
  customerInfo: { type: mongoose.Schema.Types.Mixed, default: null },
  processedByInfo: { type: mongoose.Schema.Types.Mixed, default: null },
});

posTransactionSchema.pre("save", async function populatePosTransactionSnapshots() {
  const { buildUserSnapshot, buildCustomerSnapshot } = require("../../common/utils/entity-snapshot");
  if (this.isModified("customer") && this.customer) {
    this.customerInfo = await buildCustomerSnapshot(this.customer);
  }
  if (this.isModified("processedBy") && this.processedBy) {
    this.processedByInfo = await buildUserSnapshot(this.processedBy);
  }
});

posTransactionSchema.plugin(auditablePlugin);

posTransactionSchema.index({ receiptNo: 1 }, { unique: true });
posTransactionSchema.index({ bookingId: 1 });
posTransactionSchema.index({ orderId: 1 });
posTransactionSchema.index({ customer: 1, createdAt: -1 });
posTransactionSchema.index({ paymentStatus: 1, createdAt: -1 });
// Sparse — most rows (Cash) never set this, only PayNow/NETS rows do; a
// dense index here would carry every Cash row for no benefit.
posTransactionSchema.index({ gatewayReference: 1 }, { sparse: true });

module.exports = {
  PosTransaction: mongoose.model("PosTransaction", posTransactionSchema, "pos_transactions"),
  POS_TRANSACTION_STATUSES,
};
