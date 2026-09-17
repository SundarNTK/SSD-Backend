const PrintingGroup = require("../../models/printing-groups");

/**
 * Column definitions for Deity's Excel import/export — see
 * common/factories/import-export-controller.js for how these are consumed.
 * Mirrors request-objects.js's createSchema field-for-field (limits, required-
 * ness) so a row that passes the import scan will also pass the same
 * create() validation the manual "Add Deity" form goes through. Deliberately
 * excludes `image` (no sane way to embed one in a spreadsheet cell) and
 * `status` (every imported deity starts Active — see extraDefaults in
 * controllers/deities/index.js); both stay editable afterwards from the
 * regular Deity Master screen.
 */
const fields = [
  {
    key: "code",
    header: "Code*",
    type: "string",
    required: true,
    unique: true,
    maxLength: 20,
    helpText: "Short unique code, e.g. GAN01 (max 20 characters). Stored in uppercase regardless of how it's typed.",
  },
  {
    key: "name",
    header: "Name*",
    type: "string",
    required: true,
    unique: true,
    minLength: 2,
    maxLength: 100,
    helpText: "Full deity name (2–100 characters). Must be unique across all deities.",
  },
  {
    key: "tamilName",
    header: "Tamil Name",
    type: "string",
    required: false,
    helpText: "Optional Tamil name.",
  },
  {
    key: "printingGroup",
    header: "Printing Group*",
    type: "ref",
    required: true,
    refModel: PrintingGroup,
    refLabelField: "name",
    helpText: "Must exactly match one of the active Printing Groups — pick it from the in-cell dropdown, don't type it freehand.",
  },
  {
    key: "displayOrder",
    header: "Display Order",
    type: "number",
    required: false,
    integer: true,
    min: 0,
    default: 0,
    helpText: "Lower numbers appear first wherever deities are selected (pickers, POS). Leave blank for 0.",
  },
  {
    key: "printOrder",
    header: "Print Order",
    type: "number",
    required: false,
    integer: true,
    min: 0,
    default: 0,
    helpText: "Lower numbers print first on a ticket. Independent of Display Order. Leave blank for 0.",
  },
];

/** Two real, currently-active Printing Groups as the template's sample fill — falls back to a placeholder name if none exist yet (the scan will then report the "no active Printing Groups" blocking issue). */
function sampleRows(refLookups) {
  const printingGroupDocs = refLookups.printingGroup?.docs || [];
  const groupName = (i) => printingGroupDocs[i]?.name ?? printingGroupDocs[0]?.name ?? "Your Printing Group Name";

  return [
    { code: "GAN01", name: "Lord Ganesha", tamilName: "விநாயகர்", printingGroup: groupName(0), displayOrder: 1, printOrder: 1 },
    { code: "MUR01", name: "Lord Murugan", tamilName: "முருகன்", printingGroup: groupName(1), displayOrder: 2, printOrder: 2 },
  ];
}

module.exports = { fields, sampleRows };
