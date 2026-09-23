/** Column definitions for Nakshathiram's Excel import/export — mirrors request-objects.js's createSchema. No dropdown/ref columns of its own. */
const fields = [
  { key: "code", header: "Code*", type: "string", required: true, unique: true, maxLength: 20, helpText: "Unique code (max 20 characters). Stored in uppercase." },
  { key: "displayOrder", header: "Display Order", type: "number", required: false, integer: true, min: 0, default: 1, helpText: "Lower numbers appear first. Leave blank for 1." },
  { key: "name", header: "Nakshathiram*", type: "string", required: true, maxLength: 100, helpText: "Nakshathiram name (max 100 characters), e.g. Ashwini." },
  { key: "tamilName", header: "Tamil*", type: "string", required: true, maxLength: 100, helpText: "Tamil name (max 100 characters)." },
  { key: "rasi", header: "Rasi*", type: "string", required: true, maxLength: 100, helpText: "Rasi name (max 100 characters), e.g. Mesha." },
  { key: "tamilRasi", header: "Tamil Rasi*", type: "string", required: true, maxLength: 100, helpText: "Tamil Rasi name (max 100 characters)." },
  { key: "mainFlag", header: "Main Flag", type: "boolean", default: false, helpText: "Yes/No. Defaults to No." },
];

function sampleRows() {
  return [
    { code: "ASH01", displayOrder: 1, name: "Ashwini", tamilName: "அஸ்வினி", rasi: "Mesha", tamilRasi: "மேஷம்", mainFlag: "No" },
    { code: "BHA01", displayOrder: 2, name: "Bharani", tamilName: "பரணி", rasi: "Mesha", tamilRasi: "மேஷம்", mainFlag: "No" },
  ];
}

module.exports = { fields, sampleRows };
