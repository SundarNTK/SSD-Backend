const env = require("./config/env");
const connectDatabase = require("./config/database");
const app = require("./app");

async function start() {
  await connectDatabase();
  app.listen(env.PORT, () => {
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