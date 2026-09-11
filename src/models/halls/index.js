const mongoose = require("mongoose");
const { auditablePlugin, activeUniqueIndexOptions } = require("../../common/plugins/auditable");

/**
 * The physical, bookable room. No fixed booking slots or Start/End Time
 * live here on purpose — those are captured per Hall Booking (Phase 2),
 * so the same Hall can be booked more than once a day whenever the
 * requested periods don't overlap.
 */
const hallSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  code: { type: String, required: true, trim: true, uppercase: true },
  category: { type: mongoose.Schema.Types.ObjectId, ref: "HallCategory", required: true },
  capacity: { type: Number, required: true, min: 1 },
  hallImages: { type: [String], default: [] }, // full Cloudinary secure_urls
  floorPlan: { type: String, default: null }, // full Cloudinary secure_url
  // Applicable only where the Hall may be booked on its own, outside a
  // Hall Package — see Hall Booking (Phase 2).
  individualBookingRate: { type: Number, default: null, min: 0 },
  minimumBookingDuration: { type: Number, default: null, min: 0 }, // hours
  depositAmount: { type: Number, default: 0, min: 0 },
});

hallSchema.plugin(auditablePlugin);

hallSchema.index({ code: 1 }, activeUniqueIndexOptions({ collation: { locale: "en", strength: 2 } }));
hallSchema.index({ status: 1, createdAt: -1 });
hallSchema.index({ category: 1 });

module.exports = mongoose.model("Hall", hallSchema);
