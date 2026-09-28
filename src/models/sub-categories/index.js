const mongoose = require("mongoose");
const { auditablePlugin, activeUniqueIndexOptions } = require("../../common/plugins/auditable");

const subCategorySchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  tamilName: { type: String, default: "" },
  code: { type: String, required: true, trim: true, uppercase: true },
  // The parent Category this sub-category belongs to — required so every
  // sub-category has a clear owner, and so the frontend can filter sub-
  // category dropdowns by the currently selected category.
  category: { type: mongoose.Schema.Types.ObjectId, ref: "Category", required: true },
  displayOrder: { type: Number, default: 0 },
  color: { type: String, required: true },
  description: { type: String, default: "" },
  image: { type: String, default: null }, // full Cloudinary secure_url
  posVisibility: { type: Boolean, default: true },
  customerPortalVisibility: { type: Boolean, default: true },
  // Independent of posVisibility — gates the Admin Booking Panel's own
  // catalogue separately from the POS counter (see
  // common/utils/pos-catalogue-visibility.js).
  adminBookingVisibility: { type: Boolean, default: true },
  // Marks this sub-category as a quick-access favourite — surfaced by the
  // POS Portal's static "Favorites" tab alongside favourite Items/Services.
  favorite: { type: Boolean, default: false },
});

subCategorySchema.plugin(auditablePlugin);

subCategorySchema.index({ code: 1 }, activeUniqueIndexOptions({ collation: { locale: "en", strength: 2 } }));
subCategorySchema.index({ status: 1, displayOrder: 1 });
subCategorySchema.index({ category: 1, status: 1 });
subCategorySchema.index({ status: 1, favorite: 1 });

module.exports = mongoose.model("SubCategory", subCategorySchema);
