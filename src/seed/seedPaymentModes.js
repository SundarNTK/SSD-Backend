const PaymentMode = require("../models/payment-modes");

const DEFAULT_PAYMENT_MODES = [
  { name: "Cash", description: "Cash payment at counter", publicAvailability: true },
  { name: "PayNow", description: "PayNow transfer", publicAvailability: true },
  { name: "DBS", description: "DBS bank transfer", publicAvailability: false },
  { name: "NETS", description: "NETS payment", publicAvailability: true },
];

/**
 * Idempotent — safe to run on every seed. Payment Mode Master has no create
 * route (view/edit only, see controllers/payment-modes), so this is the only
 * way these records come into existence.
 */
async function ensureDefaultPaymentModes() {
  for (const def of DEFAULT_PAYMENT_MODES) {
    const existing = await PaymentMode.findOne(PaymentMode.notDeletedFilter({ name: def.name }));
    if (!existing) {
      await PaymentMode.create(def);
      console.log(`>>> Seed: payment mode "${def.name}" created`);
    }
  }
}

module.exports = { ensureDefaultPaymentModes };

/**
 * Also runnable on its own — `pnpm run seed:payment-modes` — for an
 * environment that's already bootstrapped, where re-running the whole
 * seed:super-admin script isn't necessary just to backfill these records.
 * Guarded so requiring this file from seedSuperAdmin.js doesn't also run it.
 */
if (require.main === module) {
  require("dotenv").config();
  const connectDatabase = require("../config/database");

  (async () => {
    await connectDatabase();
    await ensureDefaultPaymentModes();
    console.log(">>> Seed: payment modes ready.");
    process.exit(0);
  })().catch((err) => {
    console.error(">>> seed:payment-modes failed:", err.message || err);
    process.exit(1);
  });
}
