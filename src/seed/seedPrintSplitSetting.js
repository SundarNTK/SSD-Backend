const PrintSplitSetting = require("../models/print-split-settings");

/**
 * Idempotent — safe to run on every seed. Genuinely a singleton (unlike
 * seedPaymentModes.js's loop over a fixed list), so this is just
 * "find-or-create one document", same shape as
 * utilities/helpers/ensure-default-entity.
 */
async function ensureDefaultPrintSplitSetting() {
  const existing = await PrintSplitSetting.findOne({});
  if (!existing) {
    await PrintSplitSetting.create({ mode: "PRINT_GROUP_WISE" });
    console.log('>>> Seed: print split setting created (mode: "PRINT_GROUP_WISE")');
  }
}

module.exports = { ensureDefaultPrintSplitSetting };

/**
 * Also runnable on its own — `pnpm run seed:print-split-setting` — same
 * reasoning as seedPaymentModes.js's standalone runner.
 */
if (require.main === module) {
  require("dotenv").config();
  const connectDatabase = require("../config/database");

  (async () => {
    await connectDatabase();
    await ensureDefaultPrintSplitSetting();
    console.log(">>> Seed: print split setting ready.");
    process.exit(0);
  })().catch((err) => {
    console.error(">>> seed:print-split-setting failed:", err.message || err);
    process.exit(1);
  });
}
