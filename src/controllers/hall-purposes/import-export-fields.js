/** Column definitions for Hall Purpose's Excel import/export — mirrors request-objects.js's createSchema. */
const fields = [
  { key: "name", header: "Name*", type: "string", required: true, unique: true, maxLength: 100, helpText: "Hall Purpose name (max 100 characters)." },
  { key: "description", header: "Description", type: "string", required: false, helpText: "Optional description." },
];

function sampleRows() {
  return [
    { name: "Wedding", description: "" },
    { name: "Religious Event", description: "Temple-related functions" },
  ];
}

module.exports = { fields, sampleRows };
