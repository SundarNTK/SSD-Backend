const mongoose = require("mongoose");
const { auditablePlugin, activeUniqueIndexOptions } = require("../../common/plugins/auditable");

/**
 * Groups items for print-run purposes at the POS counter (e.g. all
 * "Archana" tickets print together, separate from "Prasadam" tickets).
 * Referenced by Deity and Item.
 */
const printingGroupSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  description: { type: String, default: "" },
});

printingGroupSchema.plugin(auditablePlugin);

printingGroupSchema.index({ name: 1 }, activeUniqueIndexOptions({ collation: { locale: "en", strength: 2 } }));
printingGroupSchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.model("PrintingGroup", printingGroupSchema);
