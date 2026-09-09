/**
 * Assigns a unique `code` to every GL Group that is missing one (old
 * records created before the field existed). Idempotent.
 *
 *   node src/seed/backfillGlGroupCodes.js
 */
require("dotenv").config();
const connectDatabase = require("../config/database");
const GlGroup = require("../models/gl-groups");
const { MISSING_CODE_FILTER, backfillMissingGlGroupCodes } = require("../common/utils/gl-group-code");

async function run() {
  await connectDatabase();

  const missingCount = await GlGroup.countDocuments(MISSING_CODE_FILTER);
  console.log(`>>> GL Groups missing code: ${missingCount}`);

  const assigned = await backfillMissingGlGroupCodes(GlGroup);
  for (const row of assigned) {
    const doc = await GlGroup.findById(row._id).select("name level isDeleted");
    console.log(`  L${doc?.level} ${doc?.name} -> ${row.code}${doc?.isDeleted ? " (deleted)" : ""}`);
  }

  await GlGroup.syncIndexes();

  const stillMissing = await GlGroup.countDocuments(MISSING_CODE_FILTER);
  const withCode = await GlGroup.countDocuments({ code: { $type: "string", $ne: "" } });

  console.log(`>>> Assigned ${assigned.length} code(s). Now with code: ${withCode}. Still missing: ${stillMissing}.`);
  process.exit(stillMissing ? 1 : 0);
}

run().catch((err) => {
  console.error(">>> backfillGlGroupCodes failed:", err);
  process.exit(1);
});
