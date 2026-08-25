const mongoose = require("mongoose");
const { auditablePlugin, activeUniqueIndexOptions } = require("../../common/plugins/auditable");

/**
 * One (category, subCategory) pairing per row, each with its own sale price
 * and display order — a service can be sold under several category/
 * sub-category combinations at once, at different prices (e.g. a pooja
 * listed under both "Daily Pooja" and "Festival Special" at different rates).
 */
const categoryDetailSchema = new mongoose.Schema(
  {
    category: { type: mongoose.Schema.Types.ObjectId, ref: "Category", required: true },
    subCategory: { type: mongoose.Schema.Types.ObjectId, ref: "SubCategory", required: true },
    salePrice: { type: Number, required: true, min: 0, default: 0 },
    displayOrder: { type: Number, default: 1 },
  },
  { _id: false }
);

const serviceSchema = new mongoose.Schema({
  code: { type: String, required: true, trim: true, uppercase: true },
  name: { type: String, required: true, trim: true },
  tamilName: { type: String, default: "" },
  description: { type: String, default: "" },

  isDeityMappingRequired: { type: Boolean, default: false },
  deityMapping: { type: [{ type: mongoose.Schema.Types.ObjectId, ref: "Deity" }], default: [] },

  categoryDetails: { type: [categoryDetailSchema], default: [] },

  generalLedger: { type: mongoose.Schema.Types.ObjectId, ref: "GeneralLedger", required: true },

  isFamilyMembersRequired: { type: Boolean, default: false },
  minFamilyMembers: { type: Number, default: 1 },
  maxFamilyMembers: { type: Number, default: 1 },

  sessionRequired: { type: Boolean, default: false },

  isInventoryRequired: { type: Boolean, default: false },
  thresholdCount: { type: Number, default: 0 },
  // Live on-hand quantity — moved only by POST /inventory/adjustments
  // (models/inventory-adjustments), never edited directly through the
  // Service master form.
  currentStock: { type: Number, default: 0, min: 0 },

  bookingCutoffDate: { type: Date, default: null },
  isPosAvailable: { type: Boolean, default: true },
  publicAvailability: { type: Boolean, default: true },
});

serviceSchema.plugin(auditablePlugin);

serviceSchema.index({ code: 1 }, activeUniqueIndexOptions({ collation: { locale: "en", strength: 2 } }));
serviceSchema.index({ status: 1, createdAt: -1 });

// Every ref field indexed, including inside the categoryDetails array and the
// deityMapping array — Mongoose supports indexing a dotted/array path into
// subdocuments, and future "services under this category" / "services for
// this deity" screens will filter by exactly these.
serviceSchema.index({ generalLedger: 1 });
serviceSchema.index({ deityMapping: 1 });
serviceSchema.index({ "categoryDetails.category": 1 });
serviceSchema.index({ "categoryDetails.subCategory": 1 });

module.exports = mongoose.model("Service", serviceSchema);
