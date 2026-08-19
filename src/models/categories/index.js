const mongoose = require("mongoose");
const { auditablePlugin, activeUniqueIndexOptions } = require("../../common/plugins/auditable");

const categorySchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  tamilName: { type: String, default: "" },
  code: { type: String, required: true, trim: true, uppercase: true },
  displayOrder: { type: Number, default: 0 },
  color: { type: String, required: true },
  description: { type: String, default: "" },
  image: { type: String, default: null }, // full Cloudinary secure_url
});

categorySchema.plugin(auditablePlugin);

categorySchema.index({ code: 1 }, activeUniqueIndexOptions({ collation: { locale: "en", strength: 2 } }));
categorySchema.index({ status: 1, displayOrder: 1 });

module.exports = mongoose.model("Category", categorySchema);
