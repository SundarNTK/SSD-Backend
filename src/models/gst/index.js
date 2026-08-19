const mongoose = require("mongoose");
const { auditablePlugin, activeUniqueIndexOptions } = require("../../common/plugins/auditable");

/**
 * A GST rate/slab, effective for a date range. Referenced by General
 * Ledger — an item's GST is derived from its GL's gstType, not stored on
 * the item directly.
 */
const gstSchema = new mongoose.Schema({
  type: { type: String, required: true, trim: true },
  percentage: { type: Number, required: true, min: 0, max: 100 },
  code: { type: String, required: true, trim: true, uppercase: true },
  effectiveStartDate: { type: Date, required: true },
  effectiveEndDate: { type: Date, default: null },
});

gstSchema.plugin(auditablePlugin);

gstSchema.index({ code: 1 }, activeUniqueIndexOptions({ collation: { locale: "en", strength: 2 } }));
gstSchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.model("Gst", gstSchema);
