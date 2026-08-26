const mongoose = require("mongoose");
const { auditablePlugin } = require("../../common/plugins/auditable");

/**
 * Append-only log of every manual stock movement — one row per
 * POST /inventory/adjustments call, never edited or soft-deleted after
 * that. Uses the shared auditablePlugin for consistency with every other
 * model in the platform (createdBy/timestamps are genuinely useful here —
 * "who moved this stock, when" — even though status/isDeleted/softDelete
 * are never exercised on a row that's meant to be a permanent record).
 */
const inventoryAdjustmentSchema = new mongoose.Schema({
  refType: { type: String, enum: ["Item", "Service"], required: true },
  // Dynamic ref — resolves to Item or Service per-document via refPath,
  // matching this row's own refType.
  refId: { type: mongoose.Schema.Types.ObjectId, required: true, refPath: "refType" },
  inventoryType: { type: String, enum: ["Stock In", "Stock Out"], required: true },
  quantity: { type: Number, required: true, min: 1 },
  // The ref's currentStock immediately after this movement was applied —
  // stored rather than recomputed so history stays accurate even if the
  // ref's stock is later corrected by an out-of-band adjustment.
  balance: { type: Number, required: true, min: 0 },
  remarks: { type: String, default: "" },
});

inventoryAdjustmentSchema.plugin(auditablePlugin);

inventoryAdjustmentSchema.index({ refType: 1, refId: 1, createdAt: -1 });

module.exports = mongoose.model("InventoryAdjustment", inventoryAdjustmentSchema);
