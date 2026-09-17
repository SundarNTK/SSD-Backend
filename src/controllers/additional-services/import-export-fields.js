/** Column definitions for Additional Service's Excel import/export — mirrors request-objects.js's createSchema. */
const fields = [
  { key: "name", header: "Name*", type: "string", required: true, unique: true, maxLength: 100, helpText: "Additional Service name (max 100 characters)." },
  { key: "code", header: "Code*", type: "string", required: true, unique: true, maxLength: 30, helpText: "Unique code (max 30 characters). Stored in uppercase." },
  { key: "description", header: "Description", type: "string", required: false, helpText: "Optional description." },
];

function sampleRows() {
  return [
    { name: "Decoration", code: "DECOR", description: "" },
    { name: "Stage Lighting", code: "LIGHT", description: "" },
  ];
}

module.exports = { fields, sampleRows };
