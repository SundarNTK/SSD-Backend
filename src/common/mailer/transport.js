const { SESClient, SendEmailCommand } = require("@aws-sdk/client-ses");
const fs = require("fs");
const path = require("path");
const env = require("../../config/env");

const sesClient = new SESClient({
  region: env.AWS_REGION,
  credentials: { accessKeyId: env.AWS_ACCESS_KEY, secretAccessKey: env.AWS_SECRET_KEY },
});

const DRY_RUN_LOG = path.join(__dirname, "../../../logs/dry-run-emails.log");

function writeDryRunLog(entry) {
  try {
    fs.mkdirSync(path.dirname(DRY_RUN_LOG), { recursive: true });
    fs.appendFileSync(DRY_RUN_LOG, `${JSON.stringify(entry)}\n`);
  } catch (err) {
    console.warn(">>> mailer: could not write dry-run log:", err.message);
  }
}

/**
 * Low-level "send this exact subject/html" — no template resolution here,
 * that's utilities/helpers/send-templated-email's job. While
 * DRY_RUN_NOTIFICATIONS=true (the default, and what's set with HEB's
 * borrowed dev keys right now), nothing actually goes out — logged to
 * console and logs/dry-run-emails.log instead.
 */
async function sendRawEmail({ to, subject, html, cc = [], bcc = [], from }) {
  if (env.DRY_RUN_NOTIFICATIONS) {
    console.log(`\n>>> [DRY RUN] Email NOT sent — would have gone to: ${to}`);
    console.log(`>>> [DRY RUN] Subject: ${subject}`);
    writeDryRunLog({ timestamp: new Date().toISOString(), to, cc, bcc, subject, html });
    return { dryRun: true };
  }

  const command = new SendEmailCommand({
    Source: from || env.SENDER_EMAIL_ID,
    Destination: { ToAddresses: [to], CcAddresses: cc, BccAddresses: bcc },
    Message: {
      Subject: { Data: subject },
      Body: { Html: { Data: html } },
    },
  });

  return sesClient.send(command);
}

module.exports = { sendRawEmail };