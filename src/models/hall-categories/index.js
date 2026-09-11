const mongoose = require("mongoose");
const { auditablePlugin, activeUniqueIndexOptions } = require("../../common/plugins/auditable");

/**
 * Groups Halls by type (Wedding Hall, Dining Hall, Function Hall,
 * Multipurpose Hall) — Hall Master assigns one of these to every Hall.
 * Restricted to the Super Admin area; see controllers/hall-categories.
 */
const hallCategorySchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  code: { type: String, required: true, trim: true, uppercase: true },
  image: { type: String, default: null }, // full Cloudinary secure_url
});

hallCategorySchema.plugin(auditablePlugin);

hallCategorySchema.index({ name: 1 }, activeUniqueIndexOptions({ collation: { locale: "en", strength: 2 } }));
hallCategorySchema.index({ code: 1 }, activeUniqueIndexOptions({ collation: { locale: "en", strength: 2 } }));
hallCategorySchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.model("HallCategory", hallCategorySchema);
