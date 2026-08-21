const mongoose = require("mongoose");
const { auditablePlugin, activeUniqueIndexOptions } = require("../../common/plugins/auditable");

/**
 * A fixed set of payment channels (Cash, PayNow, DBS, NETS, ...) rather than
 * an admin-authored list — records come from seed/seedPaymentModes.js, and
 * the Payment Mode Master only lets an admin view and edit them (no
 * create/delete route — see controllers/payment-modes).
 */
const paymentModeSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  description: { type: String, default: "" },
  publicAvailability: { type: Boolean, default: true },
});

paymentModeSchema.plugin(auditablePlugin);

paymentModeSchema.index({ name: 1 }, activeUniqueIndexOptions({ collation: { locale: "en", strength: 2 } }));
paymentModeSchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.model("PaymentMode", paymentModeSchema);
