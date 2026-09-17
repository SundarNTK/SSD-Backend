const GlGroup = require("../../models/gl-groups");
const { GST_TYPES } = require("../../utilities/constants/gst-types");

/**
 * Column definitions for General Ledger's Excel import/export. Group Level
 * 1/2/3 all point at the same GlGroup collection, distinguished only by its
 * `level` field — `refExtraFilter` narrows each dropdown to the right level
 * (see common/factories/import-export-controller.js).
 *
 * GlGroup's own uniqueness is scoped per-parent ({level, level1, level2,
 * name} — see models/gl-groups), not global, so two different Level 1
 * branches could in principle each have a same-named Level 2/3 child. This
 * importer resolves Level 2/3 by name alone (like every other master's
 * dropdown), so such a name collision would resolve to whichever matching
 * record sorts first — a known, narrow edge case, not expected in a real
 * chart of accounts. The chain-membership check below (does the chosen
 * Level 2 actually belong to the chosen Level 1, etc.) still runs
 * regardless, exactly like the live create()/update() controller.
 */
const fields = [
  { key: "name", header: "Name*", type: "string", required: true, minLength: 1, maxLength: 150, helpText: "GL account name (max 150 characters)." },
  { key: "code", header: "Code*", type: "string", required: true, unique: true, maxLength: 30, helpText: "Unique code (max 30 characters). Stored in uppercase." },
  { key: "gstType", header: "GST Type*", type: "enum", required: true, values: GST_TYPES, helpText: `One of: ${GST_TYPES.join(", ")}.` },
  {
    key: "groupLevel1",
    header: "Group Level 1*",
    type: "ref",
    required: true,
    refModel: GlGroup,
    refLabelField: "name",
    refExtraFilter: { level: 1 },
    helpText: "Must exactly match one of the active Level 1 GL Groups.",
  },
  {
    key: "groupLevel2",
    header: "Group Level 2",
    type: "ref",
    required: false,
    refModel: GlGroup,
    refLabelField: "name",
    refExtraFilter: { level: 2 },
    helpText: "Optional — must belong to the chosen Group Level 1, and must exactly match one of the active Level 2 GL Groups.",
  },
  {
    key: "groupLevel3",
    header: "Group Level 3",
    type: "ref",
    required: false,
    refModel: GlGroup,
    refLabelField: "name",
    refExtraFilter: { level: 3 },
    helpText: "Optional, only when Group Level 2 is set — must belong to the chosen Group Level 2.",
  },
  { key: "description", header: "Description", type: "string", required: false, helpText: "Optional description." },
];

/** Mirrors controllers/general-ledgers/index.js's own assertGroupChainValid — same chain rule, checked the same way. */
async function validateRow(resolved, errors) {
  if (resolved.groupLevel3 && !resolved.groupLevel2) {
    errors.push("Group Level 3 requires Group Level 2 to be set too.");
    return;
  }
  if (resolved.groupLevel2) {
    const parent2 = await GlGroup.findOne(
      GlGroup.notDeletedFilter({ _id: resolved.groupLevel2, level: 2, level1: resolved.groupLevel1 })
    );
    if (!parent2) errors.push("Group Level 2 doesn't belong to the chosen Group Level 1.");
  }
  if (resolved.groupLevel3) {
    const parent3 = await GlGroup.findOne(
      GlGroup.notDeletedFilter({ _id: resolved.groupLevel3, level: 3, level1: resolved.groupLevel1, level2: resolved.groupLevel2 })
    );
    if (!parent3) errors.push("Group Level 3 doesn't belong to the chosen Group Level 1/2.");
  }
}

function exportRow(doc) {
  return {
    name: doc.name,
    code: doc.code,
    gstType: doc.gstType,
    groupLevel1: doc.groupLevel1?.name ?? "",
    groupLevel2: doc.groupLevel2?.name ?? "",
    groupLevel3: doc.groupLevel3?.name ?? "",
    description: doc.description,
  };
}

const exportPopulate = ["groupLevel1", "groupLevel2", "groupLevel3"];

function sampleRows(refLookups) {
  const level1Name = refLookups.groupLevel1?.docs?.[0]?.name ?? "Your Level 1 Group Name";
  return [
    { name: "Archana Income", code: "ARCH-INC", gstType: GST_TYPES[0], groupLevel1: level1Name, groupLevel2: "", groupLevel3: "", description: "" },
  ];
}

module.exports = { fields, validateRow, exportRow, exportPopulate, sampleRows };
