/** Column definitions for Printing Group's Excel import/export — mirrors request-objects.js's createSchema. No dropdown/ref columns of its own. */
const fields = [
  { key: "code", header: "Code*", type: "string", required: true, unique: true, maxLength: 20, helpText: "Unique code (max 20 characters). Stored in uppercase." },
  { key: "name", header: "Name*", type: "string", required: true, unique: true, minLength: 2, maxLength: 100, helpText: "Printing Group name (2–100 characters)." },
  { key: "description", header: "Description", type: "string", required: false, helpText: "Optional description." },
];

function sampleRows() {
  return [
    { code: "ARCHANA", name: "Archana Group", description: "" },
    { code: "ABHISHEKAM", name: "Abhishekam Group", description: "" },
  ];
}

module.exports = { fields, sampleRows };
