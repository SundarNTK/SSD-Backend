const PaymentMode = require("../models/payment-modes");

// All-caps for every mode name, consistently — this used to be Title Case
// for Cash/PayNow but already-uppercase "NETS" (an acronym), which is what
// made the mix visible on a printed ticket's "Payment Method: <name>" line
// and anywhere else paymentModeName gets displayed verbatim. Every
// comparison against these names elsewhere in the codebase already does its
// own .toLowerCase() first (see createOrder's Cash/PayNow/NETS branches),
// so this casing choice only affects what gets *displayed/stored*, never
// which branch a payment takes.
const DEFAULT_PAYMENT_MODES = [
  { name: "CASH", description: "Cash payment at counter", publicAvailability: true },
  { name: "PAYNOW", description: "PayNow transfer", publicAvailability: true },
  { name: "DBS", description: "DBS bank transfer", publicAvailability: false },
  { name: "NETS", description: "NETS payment", publicAvailability: true },
];

// Maps each current name to the legacy, differently-cased name an
// already-seeded database might still have it under — renamed in place
// (not re-created) so existing bookings/transactions that reference this
// document's _id keep resolving correctly, and running this seed again
// never produces a duplicate "Cash" + "CASH" pair.
const LEGACY_NAME_ALIASES = {
  CASH: "Cash",
  PAYNOW: "PayNow",
};

/**
 * Idempotent — safe to run on every seed. Payment Mode Master has no create
 * route (view/edit only, see controllers/payment-modes), so this is the only
 * way these records come into existence.
 */
async function ensureDefaultPaymentModes() {
  for (const def of DEFAULT_PAYMENT_MODES) {
    const existing = await PaymentMode.findOne(PaymentMode.notDeletedFilter({ name: def.name }));
    if (existing) continue;

    const legacyName = LEGACY_NAME_ALIASES[def.name];
    const legacy = legacyName ? await PaymentMode.findOne(PaymentMode.notDeletedFilter({ name: legacyName })) : null;
    if (legacy) {
      legacy.name = def.name;
      await legacy.save();
      console.log(`>>> Seed: payment mode "${legacyName}" renamed to "${def.name}"`);
      continue;
    }

    await PaymentMode.create(def);
    console.log(`>>> Seed: payment mode "${def.name}" created`);
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
