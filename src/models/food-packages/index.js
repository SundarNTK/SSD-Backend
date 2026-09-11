const mongoose = require("mongoose");
const { auditablePlugin, activeUniqueIndexOptions } = require("../../common/plugins/auditable");

/**
 * One row per Menu Item included in the Package's standard menu.
 * itemCategory/pricingBasis/cost are NOT duplicated here — the Booking
 * screen (Phase 2) reads them live off the referenced Food Menu Item, the
 * same way the FSD's "read only / auto-populate" Menu Item child table
 * works; this table only records *which* items make up the Package.
 */
const packageMenuItemSchema = new mongoose.Schema(
  {
    menuItem: { type: mongoose.Schema.Types.ObjectId, ref: "FoodMenuItem", required: true },
    includedInPackage: { type: Boolean, default: true },
  },
  { _id: false }
);

/**
 * A fixed meal set — a standard menu, a price per pax, and a minimum pax
 * requirement. Per-booking swaps/additions (Phase 2) never modify this
 * master.
 */
const foodPackageSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  description: { type: String, default: "" },
  packagePricePerPax: { type: Number, required: true, min: 0 },
  minimumBookingCount: { type: Number, required: true, min: 1 },
  // At least one active Menu Item required — enforced in
  // request-objects.js (min(1)).
  menuItems: { type: [packageMenuItemSchema], default: [] },
  gstApplicable: { type: Boolean, default: false },
  image: { type: String, default: null }, // full Cloudinary secure_url
});

foodPackageSchema.plugin(auditablePlugin);

foodPackageSchema.index({ name: 1 }, activeUniqueIndexOptions({ collation: { locale: "en", strength: 2 } }));
foodPackageSchema.index({ status: 1, createdAt: -1 });
foodPackageSchema.index({ "menuItems.menuItem": 1 });

module.exports = mongoose.model("FoodPackage", foodPackageSchema);
