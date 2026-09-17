const FoodMenuItem = require("../../models/food-menu-items");

/**
 * Column definitions for Food Package's Excel import/export. `Menu Items`
 * is a required (min 1), comma-separated multi-select dropdown backed by
 * the active Food Menu Item master — every imported menu item is marked
 * included in the package (`includedInPackage: true`), matching the
 * regular Add form's default; toggle any of them off afterwards from the
 * Edit form if needed.
 */
const fields = [
  { key: "name", header: "Name*", type: "string", required: true, unique: true, maxLength: 150, helpText: "Food Package name (max 150 characters)." },
  { key: "description", header: "Description", type: "string", required: false, helpText: "Optional description." },
  { key: "packagePricePerPax", header: "Package Price Per Pax*", type: "number", required: true, min: 0, helpText: "Price per pax, 0 or greater." },
  { key: "minimumBookingCount", header: "Minimum Booking Count*", type: "number", required: true, integer: true, min: 1, helpText: "Minimum pax per booking, 1 or greater." },
  {
    key: "menuItems",
    header: "Menu Items*",
    type: "ref",
    multi: true,
    required: true,
    refModel: FoodMenuItem,
    refLabelField: "name",
    helpText: "At least one active Food Menu Item name, separated by commas.",
  },
  { key: "gstApplicable", header: "GST Applicable", type: "boolean", default: false, helpText: "Yes/No. Defaults to No." },
];

function mapToDoc(resolved) {
  return {
    name: resolved.name,
    description: resolved.description,
    packagePricePerPax: resolved.packagePricePerPax,
    minimumBookingCount: resolved.minimumBookingCount,
    menuItems: (resolved.menuItems || []).map((menuItem) => ({ menuItem, includedInPackage: true })),
    gstApplicable: resolved.gstApplicable,
  };
}

function exportRow(doc) {
  return {
    name: doc.name,
    description: doc.description,
    packagePricePerPax: doc.packagePricePerPax,
    minimumBookingCount: doc.minimumBookingCount,
    menuItems: (doc.menuItems || []).map((m) => m.menuItem?.name).filter(Boolean).join(", "),
    gstApplicable: doc.gstApplicable ? "Yes" : "No",
  };
}

const exportPopulate = [{ path: "menuItems.menuItem", select: "name" }];

function sampleRows(refLookups) {
  const menuItemNames = (refLookups.menuItems?.docs || []).slice(0, 2).map((d) => d.name);
  return [
    {
      name: "Standard Lunch Package",
      description: "",
      packagePricePerPax: 250,
      minimumBookingCount: 50,
      menuItems: menuItemNames.length ? menuItemNames.join(", ") : "Your Menu Item Name",
      gstApplicable: "No",
    },
  ];
}

module.exports = { fields, mapToDoc, exportRow, exportPopulate, sampleRows };
