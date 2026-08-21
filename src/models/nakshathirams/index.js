const mongoose = require("mongoose");
const { auditablePlugin, activeUniqueIndexOptions } = require("../../common/plugins/auditable");

const nakshathiramSchema = new mongoose.Schema({
  code: { type: String, required: true, trim: true, uppercase: true },
  displayOrder: { type: Number, required: true, default: 1 },
  name: { type: String, required: true, trim: true }, // e.g. "Ashwini"
  tamilName: { type: String, required: true, trim: true },
  rasi: { type: String, required: true, trim: true }, // e.g. "Mesha"
  tamilRasi: { type: String, required: true, trim: true },
  mainFlag: { type: Boolean, default: false },
});

nakshathiramSchema.plugin(auditablePlugin);

nakshathiramSchema.index({ code: 1 }, activeUniqueIndexOptions({ collation: { locale: "en", strength: 2 } }));
nakshathiramSchema.index({ status: 1, displayOrder: 1 });

module.exports = mongoose.model("Nakshathiram", nakshathiramSchema);
