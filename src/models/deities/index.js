const mongoose = require("mongoose");
const { auditablePlugin, activeUniqueIndexOptions } = require("../../common/plugins/auditable");

const deitySchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  tamilName: { type: String, default: "" },
  printingGroup: { type: mongoose.Schema.Types.ObjectId, ref: "PrintingGroup", required: true },
});

deitySchema.plugin(auditablePlugin);

deitySchema.index({ name: 1 }, activeUniqueIndexOptions({ collation: { locale: "en", strength: 2 } }));
deitySchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.model("Deity", deitySchema);
