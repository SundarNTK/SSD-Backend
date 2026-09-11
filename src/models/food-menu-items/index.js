const mongoose = require("mongoose");
const { auditablePlugin, activeUniqueIndexOptions } = require("../../common/plugins/auditable");

/** Supported values for pricingBasis — the calculation is Cost × the matching quantity (Pax / Units / Packs / Tubs). */
const PRICING_BASIS_VALUES = ["per-pax", "per-unit", "per-pack", "per-tub"];

/**
 * An individual dish (Briyani, Dalcha, Coffee, ...), used both to build a
 * Food Package's standard menu and as an additional item picked directly
 * during Hall Booking. Cost here is independent of whatever a Food
 * Package charges — see models/food-packages.
 */
const foodMenuItemSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  itemCategory: { type: String, required: true, trim: true },
  description: { type: String, default: "" },
  pricingBasis: { type: String, enum: PRICING_BASIS_VALUES, required: true },
  cost: { type: Number, required: true, min: 0 },
  image: { type: String, default: null }, // full Cloudinary secure_url
});

foodMenuItemSchema.plugin(auditablePlugin);

foodMenuItemSchema.index({ name: 1 }, activeUniqueIndexOptions({ collation: { locale: "en", strength: 2 } }));
foodMenuItemSchema.index({ status: 1, createdAt: -1 });
foodMenuItemSchema.index({ itemCategory: 1 });

module.exports = mongoose.model("FoodMenuItem", foodMenuItemSchema);
module.exports.PRICING_BASIS_VALUES = PRICING_BASIS_VALUES;
