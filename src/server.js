const env = require("./config/env");
const connectDatabase = require("./config/database");
const app = require("./app");
const { startReservationCleanupJob } = require("./utilities/helpers/release-expired-reservations");

async function start() {
  await connectDatabase();

  // Start the inventory-reservation expiry cleanup job.
  // Runs every 5 minutes — releases held stock for orders that were
  // abandoned without being confirmed (the 30-minute cart hold).
  // Must start AFTER the DB connection is ready so the Mongoose models
  // are initialised before the first query fires.
  startReservationCleanupJob();

  // Explicit "0.0.0.0" — Render (and most PaaS hosts) route traffic to the
  // container's external interface, not just loopback, so the default host
  // Node picks when none is given isn't a safe assumption to rely on here.
  app.listen(env.PORT, "0.0.0.0", () => {
    console.log(`>>> SSD-Backend listening on http://localhost:${env.PORT}${env.API_PREFIX}`);
    if (env.DRY_RUN_NOTIFICATIONS) {
      console.log(">>> DRY_RUN_NOTIFICATIONS is ON — emails are logged, not sent. See src/common/mailer.");
    }
  });
}

start().catch((err) => {
  console.error(">>> SSD-Backend failed to start:", err);
  process.exit(1);
});