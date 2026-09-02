const mongoose = require("mongoose");
const { auditablePlugin, activeUniqueIndexOptions } = require("../../common/plugins/auditable");

/**
 * One bookable slot within the event's date range — its own name, date,
 * time window, seat capacity, and status, so a multi-day event (or one with
 * several sessions per day) can be sold slot by slot.
 */
const slotDetailSchema = new mongoose.Schema(
  {
    slotName: { type: String, required: true, trim: true },
    date: { type: Date, required: true },
    startTime: { type: String, required: true },
    endTime: { type: String, required: true },
    totalSeats: { type: Number, default: 0 },
    status: { type: Number, enum: [0, 1], default: 1 },
  },
  { _id: false }
);

const eventSchema = new mongoose.Schema({
  code: { type: String, required: true, trim: true, uppercase: true },
  name: { type: String, required: true, trim: true },
  tamilName: { type: String, default: "" },
  description: { type: String, default: "" },
  image: { type: String, default: null }, // full Cloudinary secure_url

  category: { type: mongoose.Schema.Types.ObjectId, ref: "Category", required: true },
  subCategory: { type: mongoose.Schema.Types.ObjectId, ref: "SubCategory", default: null },
  deityMapping: { type: [{ type: mongoose.Schema.Types.ObjectId, ref: "Deity" }], default: [] },

  startDate: { type: Date, required: true },
  endDate: { type: Date, required: true },

  isSlotRequired: { type: Boolean, default: false },
  slotDetails: { type: [slotDetailSchema], default: [] },

  salePrice: { type: Number, required: true, min: 0 },
  gstClassification: { type: String, required: true }, // APPLICABLE | EXEMPTED | OUT_OF_SCOPE — see utilities/constants/gst-classifications
  displayOrder: { type: Number, default: 1 },

  posVisibility: { type: Boolean, default: true },
  publicVisibility: { type: Boolean, default: true },
});

eventSchema.plugin(auditablePlugin);

eventSchema.index({ code: 1 }, activeUniqueIndexOptions({ collation: { locale: "en", strength: 2 } }));
eventSchema.index({ status: 1, createdAt: -1 });
eventSchema.index({ startDate: 1, endDate: 1 });

// Every ref field indexed — Mongoose doesn't index a `ref` automatically.
eventSchema.index({ category: 1 });
eventSchema.index({ subCategory: 1 });
eventSchema.index({ deityMapping: 1 });

module.exports = mongoose.model("Event", eventSchema);
