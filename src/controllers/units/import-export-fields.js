/** Column definitions for Unit's Excel import/export — mirrors request-objects.js's createSchema. No dropdown/ref columns of its own. */
const fields = [
  { key: "unitCode", header: "Unit Code*", type: "string", required: true, unique: true, maxLength: 20, helpText: "Unique code (max 20 characters). Stored in uppercase." },
  { key: "unitName", header: "Unit Name*", type: "string", required: true, unique: true, maxLength: 100, helpText: "Unit name (max 100 characters), e.g. PCS, KG, LTR." },
  { key: "description", header: "Description", type: "string", required: false, helpText: "Optional description." },
];

function sampleRows() {
  return [
    { unitCode: "PCS", unitName: "Pieces", description: "" },
    { unitCode: "KG", unitName: "Kilogram", description: "" },
  ];
}

module.exports = { fields, sampleRows };
