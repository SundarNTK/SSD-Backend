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
  // Where this category (and its sub-categories / assigned items & services)
  // may appear. Missing values are treated as visible (see POS catalogue).
  posVisibility: { type: Boolean, default: true },
  customerPortalVisibility: { type: Boolean, default: true },
  // Independent of posVisibility — gates the Admin Booking Panel's own
  // catalogue separately from the POS counter (see
  // common/utils/pos-catalogue-visibility.js).
  adminBookingVisibility: { type: Boolean, default: true },
  // Marks this category as a quick-access favourite — surfaced by the POS
  // Portal's static "Favorites" tab alongside favourite Items/Services.
  favorite: { type: Boolean, default: false },
});

categorySchema.plugin(auditablePlugin);

categorySchema.index({ code: 1 }, activeUniqueIndexOptions({ collation: { locale: "en", strength: 2 } }));
categorySchema.index({ status: 1, displayOrder: 1 });
categorySchema.index({ status: 1, favorite: 1 });

module.exports = mongoose.model("Category", categorySchema);
