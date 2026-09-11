const mongoose = require("mongoose");
const { auditablePlugin, activeUniqueIndexOptions } = require("../../common/plugins/auditable");

/**
 * Why a Hall or Hall Package is booked (Wedding, Function, Meeting,
 * Religious Event, Other Temple-related Event) — used for Hall Package
 * configuration and Booking classification, not for pricing.
 */
const hallPurposeSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  description: { type: String, default: "" },
  image: { type: String, default: null }, // full Cloudinary secure_url
});

hallPurposeSchema.plugin(auditablePlugin);

hallPurposeSchema.index({ name: 1 }, activeUniqueIndexOptions({ collation: { locale: "en", strength: 2 } }));
hallPurposeSchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.model("HallPurpose", hallPurposeSchema);
