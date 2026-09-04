const mongoose = require("mongoose");
const { auditablePlugin, activeUniqueIndexOptions } = require("../../common/plugins/auditable");

/**
 * The Unit of Measure master (PCS, KG, LTR, ...) — Item's own Unit of
 * Measure field lists only status: 1 records from here (see
 * controllers/items' listing use on the frontend), the same
 * active-only-dropdown convention every other master reference follows.
 */
const unitSchema = new mongoose.Schema({
  unitCode: { type: String, required: true, trim: true, uppercase: true },
  unitName: { type: String, required: true, trim: true },
  description: { type: String, default: "" },
});

unitSchema.plugin(auditablePlugin);

unitSchema.index({ unitCode: 1 }, activeUniqueIndexOptions({ collation: { locale: "en", strength: 2 } }));
unitSchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.model("Unit", unitSchema);
