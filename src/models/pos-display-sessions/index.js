const mongoose = require("mongoose");

/**
 * Live payload for the customer-facing POS display (tablet / second window).
 * One row per cashier: the counter PUTs cart / QR / totals here; the tablet
 * GETs by short code with no login. Not a master — rows expire on their own
 * via the TTL index so abandoned counters don't linger.
 */
const posDisplaySessionSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, uppercase: true, trim: true },
    ownerUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    entityId: { type: mongoose.Schema.Types.ObjectId, default: null },
    payload: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  { timestamps: true },
);

posDisplaySessionSchema.index({ code: 1 }, { unique: true });
posDisplaySessionSchema.index({ ownerUserId: 1 }, { unique: true });
// Drop a row 2 days after the last cashier update.
posDisplaySessionSchema.index({ updatedAt: 1 }, { expireAfterSeconds: 60 * 60 * 48 });

module.exports = mongoose.model("PosDisplaySession", posDisplaySessionSchema);
