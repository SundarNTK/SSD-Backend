const mongoose = require("mongoose");
const { auditablePlugin, activeUniqueIndexOptions } = require("../../common/plugins/auditable");

/**
 * One (category, subCategory) pairing per row, with its own display order —
 * an item can sit under several category/sub-category combinations at
 * once (e.g. shown under both "Pooja Items" and "Festival Specials").
 *
 * subCategory is optional: a row can map an item to a Category alone, with
 * no specific SubCategory. The POS Portal has nowhere to file that into as
 * a folder, so it surfaces it directly in that category's listing instead
 * (see controllers/pos getCatalogue).
 */
const categoryDetailSchema = new mongoose.Schema(
  {
    category: { type: mongoose.Schema.Types.ObjectId, ref: "Category", required: true },
    subCategory: { type: mongoose.Schema.Types.ObjectId, ref: "SubCategory" },
    displayOrder: { type: Number, default: 0 },
  },
  { _id: false }
);

const itemSchema = new mongoose.Schema({
  code: { type: String, required: true, trim: true, uppercase: true },
  name: { type: String, required: true, trim: true },
  tamilName: { type: String, default: "" },
  generalLedger: { type: mongoose.Schema.Types.ObjectId, ref: "GeneralLedger", required: true },
  salePrice: { type: Number, required: true, min: 0 },
  description: { type: String, default: "" },

  isDeityMappingRequired: { type: Boolean, default: false },
  deityMapping: { type: [{ type: mongoose.Schema.Types.ObjectId, ref: "Deity" }], default: [] },
  printingGroup: { type: mongoose.Schema.Types.ObjectId, ref: "PrintingGroup", required: true },

  categoryDetails: { type: [categoryDetailSchema], default: [] },

  isInventoryApplicable: { type: Boolean, default: false },
  unitOfMeasure: { type: String, default: null },
  threshold: { type: Number, default: 0 },
  minQuantity: { type: Number, default: 1 },
  maxQuantity: { type: Number, default: 0 }, // 0 = unlimited, matching the reference screenshot's "0 - unlimited" note
  quantityReduction: { type: Number, default: 1 },
  // Live on-hand quantity — moved only by POST /inventory/adjustments
  // (models/inventory-adjustments), never edited directly through the Item
  // master form.
  currentStock: { type: Number, default: 0, min: 0 },

  futureBookingCutOffDate: { type: Date, default: null },
  isFamilyMembersRequired: { type: Boolean, default: false },
  maxFamilyMembers: { type: Number, default: 2 },
  posAvailability: { type: Boolean, default: true },
  customerPortalAvailability: { type: Boolean, default: true },
});

itemSchema.plugin(auditablePlugin);

itemSchema.index({ code: 1 }, activeUniqueIndexOptions({ collation: { locale: "en", strength: 2 } }));
itemSchema.index({ status: 1, createdAt: -1 });

// Every ref field indexed, including inside the categoryDetails array —
// Mongoose supports indexing a dotted path into an array of subdocuments,
// and this is exactly what a future "items in this category" catalog
// screen (and the POS/customer-portal browsing screens) will filter by.
itemSchema.index({ generalLedger: 1 });
itemSchema.index({ printingGroup: 1 });
itemSchema.index({ deityMapping: 1 });
itemSchema.index({ "categoryDetails.category": 1 });
itemSchema.index({ "categoryDetails.subCategory": 1 });

module.exports = mongoose.model("Item", itemSchema);
