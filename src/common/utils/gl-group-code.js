/**
 * GL Group `code` helpers — used when creating groups and when backfilling
 * records that predate the field. Codes are uppercase slugs of the group
 * name, with a numeric suffix if that slug is already taken.
 */
const MISSING_CODE_FILTER = {
  $or: [{ code: null }, { code: "" }, { code: { $exists: false } }],
};

function slugCodeFromName(name) {
  const slug = String(name || "GROUP")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 20)
    .replace(/-$/g, "");
  return slug || "GROUP";
}

async function nextAvailableCode(base, isTaken) {
  let code = base;
  let n = 1;
  while (await isTaken(code)) {
    n += 1;
    code = `${base}-${n}`.slice(0, 30);
  }
  return code;
}

async function backfillMissingGlGroupCodes(GlGroup) {
  const missing = await GlGroup.find(MISSING_CODE_FILTER).select("_id name level code isDeleted");
  const assigned = [];

  for (const doc of missing) {
    const base = slugCodeFromName(doc.name);
    const code = await nextAvailableCode(base, (candidate) =>
      GlGroup.exists({ code: candidate, _id: { $ne: doc._id } })
    );
    await GlGroup.updateOne({ _id: doc._id }, { $set: { code } });
    assigned.push({ _id: doc._id, code });
  }

  return assigned;
}

module.exports = {
  MISSING_CODE_FILTER,
  slugCodeFromName,
  nextAvailableCode,
  backfillMissingGlGroupCodes,
};
