const Category = require("../../models/categories");

/** Column definitions for Sub Category's Excel import/export — mirrors request-objects.js's createSchema. `category` is a dropdown backed by the active Category master. */
const fields = [
  { key: "name", header: "Name*", type: "string", required: true, minLength: 1, maxLength: 100, helpText: "Sub category name (1–100 characters)." },
  { key: "tamilName", header: "Tamil Name", type: "string", required: false, helpText: "Optional Tamil name." },
  { key: "code", header: "Code*", type: "string", required: true, unique: true, maxLength: 30, helpText: "Unique code (max 30 characters). Stored in uppercase." },
  { key: "category", header: "Category*", type: "ref", required: true, refModel: Category, refLabelField: "name", helpText: "Must exactly match one of the active Categories." },
  { key: "displayOrder", header: "Display Order", type: "number", required: false, integer: true, min: 0, default: 0, helpText: "Lower numbers appear first. Leave blank for 0." },
  { key: "color", header: "Color*", type: "string", required: true, helpText: "Hex color like #942237." },
  { key: "description", header: "Description", type: "string", required: false, helpText: "Optional description." },
  { key: "posVisibility", header: "POS Visibility", type: "boolean", default: true, helpText: "Yes/No — visible at the POS counter. Defaults to Yes." },
  { key: "customerPortalVisibility", header: "Customer Portal Visibility", type: "boolean", default: true, helpText: "Yes/No — visible on the customer portal. Defaults to Yes." },
];

const HEX_COLOR = /^#[0-9A-Fa-f]{6}$/;

function validateRow(resolved, errors) {
  if (resolved.color && !HEX_COLOR.test(resolved.color)) {
    errors.push("Color must be a hex value like #942237.");
  }
}

function sampleRows(refLookups) {
  const categoryName = (i) => refLookups.category?.docs?.[i]?.name ?? refLookups.category?.docs?.[0]?.name ?? "Your Category Name";
  return [
    { name: "Flowers", tamilName: "பூக்கள்", code: "FLOWER", category: categoryName(0), displayOrder: 1, color: "#942237", description: "", posVisibility: "Yes", customerPortalVisibility: "Yes" },
  ];
}

module.exports = { fields, validateRow, sampleRows };
