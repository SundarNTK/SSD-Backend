const mongoose = require("mongoose");
const { auditablePlugin, activeUniqueIndexOptions } = require("../../common/plugins/auditable");

/**
 * Bundles one or more Halls with a Purpose, a single package price, and
 * optional add-on services. Booking a Package (Phase 2) blocks every Hall
 * mapped here, together, for the requested date/time — a Package is only
 * available when every one of its Halls is.
 */
const hallPackageSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  hallPurpose: { type: mongoose.Schema.Types.ObjectId, ref: "HallPurpose", required: true },
  // At least one Hall required — enforced in request-objects.js (min(1))
  // rather than only at the schema level, so the API rejects it before a
  // write is attempted.
  halls: { type: [{ type: mongoose.Schema.Types.ObjectId, ref: "Hall" }], default: [] },
  standardSessionDuration: { type: Number, required: true, min: 0.1 }, // hours
  packagePrice: { type: Number, required: true, min: 0 },
  bookingAdvanceAmount: { type: Number, default: 0, min: 0 },
  depositAmount: { type: Number, default: 0, min: 0 },
  additionalHourRate: { type: Number, default: 0, min: 0 },
  gstApplicable: { type: Boolean, default: false },
  description: { type: String, default: "" },
  additionalServices: { type: [{ type: mongoose.Schema.Types.ObjectId, ref: "AdditionalService" }], default: [] },
  termsAndConditions: { type: String, default: "" },
  image: { type: String, default: null }, // full Cloudinary secure_url
});

hallPackageSchema.plugin(auditablePlugin);

hallPackageSchema.index({ name: 1 }, activeUniqueIndexOptions({ collation: { locale: "en", strength: 2 } }));
hallPackageSchema.index({ status: 1, createdAt: -1 });
hallPackageSchema.index({ hallPurpose: 1 });
hallPackageSchema.index({ halls: 1 });

module.exports = mongoose.model("HallPackage", hallPackageSchema);
