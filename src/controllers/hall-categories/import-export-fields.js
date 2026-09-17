/** Column definitions for Hall Category's Excel import/export — mirrors request-objects.js's createSchema. */
const fields = [
  { key: "name", header: "Name*", type: "string", required: true, unique: true, maxLength: 100, helpText: "Hall Category name (max 100 characters)." },
  { key: "code", header: "Code*", type: "string", required: true, unique: true, maxLength: 30, helpText: "Unique code (max 30 characters). Stored in uppercase." },
];

function sampleRows() {
  return [
    { name: "Wedding Hall", code: "WED" },
    { name: "Function Hall", code: "FUNC" },
  ];
}

module.exports = { fields, sampleRows };
