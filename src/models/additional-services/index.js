const mongoose = require("mongoose");
const { auditablePlugin, activeUniqueIndexOptions } = require("../../common/plugins/auditable");

/**
 * Optional Hall-side add-ons (decoration, lighting, event arrangements)
 * that may be attached to a Hall Package or picked during Hall Booking.
 * Deliberately separate from the POS Service Master (Archanai, Pooja,
 * Homam) — this master carries no price; pricing is resolved at Hall
 * Package / Booking level.
 */
const additionalServiceSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  code: { type: String, required: true, trim: true, uppercase: true },
  description: { type: String, default: "" },
  image: { type: String, default: null }, // full Cloudinary secure_url
});

additionalServiceSchema.plugin(auditablePlugin);

additionalServiceSchema.index({ name: 1 }, activeUniqueIndexOptions({ collation: { locale: "en", strength: 2 } }));
additionalServiceSchema.index({ code: 1 }, activeUniqueIndexOptions({ collation: { locale: "en", strength: 2 } }));
additionalServiceSchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.model("AdditionalService", additionalServiceSchema);
