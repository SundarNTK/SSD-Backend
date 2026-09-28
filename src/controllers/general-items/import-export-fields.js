const GeneralLedger = require("../../models/general-ledgers");
const Category = require("../../models/categories");
const SubCategory = require("../../models/sub-categories");
const PrintingGroup = require("../../models/printing-groups");
const Unit = require("../../models/units");

/**
 * Column definitions for General Item's Excel import/export — same shape as
 * Item's import (see controllers/items/import-export-fields.js), minus Sale
 * Price (no master price — the amount is typed in at the point of sale) and
 * minus Deity Mapping (General Items never carry one, so Printing Group is
 * always required, never conditional). Only the first Category/Sub Category
 * pairing is imported per row — add more from the Edit form afterwards.
 */
const fields = [
  { key: "code", header: "Code*", type: "string", required: true, unique: true, maxLength: 30, helpText: "Unique code (max 30 characters). Stored in uppercase." },
  { key: "name", header: "Name*", type: "string", required: true, unique: true, minLength: 1, maxLength: 150, helpText: "General Item name (1–150 characters). Must be unique." },
  { key: "tamilName", header: "Tamil Name", type: "string", required: false, helpText: "Optional Tamil name." },
  { key: "description", header: "Description", type: "string", required: false, helpText: "Optional description." },
  { key: "generalLedger", header: "General Ledger*", type: "ref", required: true, refModel: GeneralLedger, refLabelField: "name", helpText: "Must exactly match one of the active General Ledger records." },
  { key: "category", header: "Category*", type: "ref", required: true, refModel: Category, refLabelField: "name", helpText: "Must exactly match one of the active Categories. Becomes this General Item's first Category/Sub Category pairing — add more from the Edit form if needed." },
  { key: "subCategory", header: "Sub Category", type: "ref", required: false, refModel: SubCategory, refLabelField: "name", helpText: "Optional — must exactly match one of the active Sub Categories." },
  { key: "printingGroup", header: "Printing Group*", type: "ref", required: true, refModel: PrintingGroup, refLabelField: "name", helpText: "Must exactly match one of the active Printing Groups." },
  { key: "isInventoryApplicable", header: "Inventory Applicable", type: "boolean", default: false, helpText: "Yes/No — whether stock is tracked for this General Item." },
  { key: "unitOfMeasure", header: "Unit of Measure", type: "ref", refModel: Unit, refLabelField: "unitName", storeAs: "label", helpText: "Must exactly match one of the active Unit master's Unit Name values (e.g. PCS, KG)." },
  { key: "threshold", header: "Threshold", type: "number", integer: true, min: 0, default: 0, helpText: "Low-stock threshold. Leave blank for 0." },
  { key: "minQuantity", header: "Min Quantity", type: "number", integer: true, min: 1, default: 1, helpText: "Minimum bookable quantity. Leave blank for 1." },
  { key: "maxQuantity", header: "Max Quantity", type: "number", integer: true, min: 0, default: 0, helpText: "Maximum bookable quantity, 0 = unlimited. Leave blank for 0." },
  { key: "quantityReduction", header: "Quantity Reduction", type: "number", integer: true, min: 1, default: 1, helpText: "Stock reduced per booking unit. Leave blank for 1." },
  { key: "posAvailability", header: "POS Availability", type: "boolean", default: true, helpText: "Yes/No — available at the POS counter. Defaults to Yes." },
  { key: "adminBookingVisibility", header: "Admin Booking Visibility", type: "boolean", default: true, helpText: "Yes/No — available on the Admin Booking Panel. Defaults to Yes." },
  { key: "favorite", header: "Favorite", type: "boolean", default: false, helpText: "Yes/No — shown under the POS Portal's Favorites tab. Defaults to No." },
];

/** Flattens the imported Category/Sub Category pair into GeneralItem's actual nested schema shape. */
function mapToDoc(resolved) {
  return {
    code: resolved.code,
    name: resolved.name,
    tamilName: resolved.tamilName,
    description: resolved.description,
    generalLedger: resolved.generalLedger,
    printingGroup: resolved.printingGroup,
    categoryDetails: [{ category: resolved.category, subCategory: resolved.subCategory || null, displayOrder: 0 }],
    isInventoryApplicable: resolved.isInventoryApplicable,
    unitOfMeasure: resolved.isInventoryApplicable ? resolved.unitOfMeasure || null : null,
    threshold: resolved.threshold,
    minQuantity: resolved.minQuantity,
    maxQuantity: resolved.maxQuantity,
    quantityReduction: resolved.quantityReduction,
    posAvailability: resolved.posAvailability,
    adminBookingVisibility: resolved.adminBookingVisibility,
    favorite: resolved.favorite,
  };
}

/** Reverses mapToDoc for the export sheet. */
function exportRow(doc) {
  const firstPair = doc.categoryDetails?.[0];
  return {
    code: doc.code,
    name: doc.name,
    tamilName: doc.tamilName,
    description: doc.description,
    generalLedger: doc.generalLedger?.name ?? "",
    category: firstPair?.category?.name ?? "",
    subCategory: firstPair?.subCategory?.name ?? "",
    printingGroup: doc.printingGroup?.name ?? "",
    isInventoryApplicable: doc.isInventoryApplicable ? "Yes" : "No",
    unitOfMeasure: doc.unitOfMeasure ?? "",
    threshold: doc.threshold,
    minQuantity: doc.minQuantity,
    maxQuantity: doc.maxQuantity,
    quantityReduction: doc.quantityReduction,
    posAvailability: doc.posAvailability ? "Yes" : "No",
    adminBookingVisibility: doc.adminBookingVisibility ? "Yes" : "No",
    favorite: doc.favorite ? "Yes" : "No",
  };
}

const exportPopulate = [
  { path: "generalLedger", select: "name" },
  { path: "printingGroup", select: "name" },
  { path: "categoryDetails.category", select: "name" },
  { path: "categoryDetails.subCategory", select: "name" },
];

function sampleRows(refLookups) {
  const glName = refLookups.generalLedger?.docs?.[0]?.name ?? "Your General Ledger Name";
  const categoryName = refLookups.category?.docs?.[0]?.name ?? "Your Category Name";
  const printingGroupName = refLookups.printingGroup?.docs?.[0]?.name ?? "Your Printing Group Name";
  const unitName = refLookups.unitOfMeasure?.docs?.[0]?.label ?? refLookups.unitOfMeasure?.docs?.[0]?.unitName ?? "PCS";

  return [
    {
      code: "GEN01",
      name: "Silk Saree",
      tamilName: "",
      description: "",
      generalLedger: glName,
      category: categoryName,
      subCategory: "",
      printingGroup: printingGroupName,
      isInventoryApplicable: "Yes",
      unitOfMeasure: unitName,
      threshold: 2,
      minQuantity: 1,
      maxQuantity: 0,
      quantityReduction: 1,
      posAvailability: "Yes",
      adminBookingVisibility: "Yes",
      favorite: "No",
    },
    {
      code: "GEN02",
      name: "Old Deity Photo",
      tamilName: "",
      description: "",
      generalLedger: glName,
      category: categoryName,
      subCategory: "",
      printingGroup: printingGroupName,
      isInventoryApplicable: "No",
      unitOfMeasure: "",
      threshold: 0,
      minQuantity: 1,
      maxQuantity: 0,
      quantityReduction: 1,
      posAvailability: "Yes",
      adminBookingVisibility: "Yes",
      favorite: "No",
    },
  ];
}

module.exports = { fields, mapToDoc, exportRow, exportPopulate, sampleRows };
