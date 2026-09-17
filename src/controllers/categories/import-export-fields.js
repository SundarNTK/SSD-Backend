/** Column definitions for Category's Excel import/export — mirrors request-objects.js's createSchema. No dropdown/ref columns of its own. */
const fields = [
  { key: "name", header: "Name*", type: "string", required: true, minLength: 1, maxLength: 100, helpText: "Category name (1–100 characters)." },
  { key: "tamilName", header: "Tamil Name", type: "string", required: false, helpText: "Optional Tamil name." },
  { key: "code", header: "Code*", type: "string", required: true, unique: true, maxLength: 30, helpText: "Unique code (max 30 characters). Stored in uppercase." },
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

function sampleRows() {
  return [
    { name: "Pooja Items", tamilName: "பூஜை பொருட்கள்", code: "POOJA", displayOrder: 1, color: "#942237", description: "Everyday archana/pooja supplies", posVisibility: "Yes", customerPortalVisibility: "Yes" },
    { name: "Festival Specials", tamilName: "", code: "FEST", displayOrder: 2, color: "#7c1527", description: "", posVisibility: "Yes", customerPortalVisibility: "No" },
  ];
}

module.exports = { fields, validateRow, sampleRows };
