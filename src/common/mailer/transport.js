const nodemailer = require("nodemailer");
const fs = require("fs");
const path = require("path");
const env = require("../../config/env");

const BREVO_API = "https://api.brevo.com/v3";

let transporter = null;

const isPlaceholder = (value) =>
  !value || /your\.email|your_16|example\.com|changeme|xxx/i.test(String(value));

const isBrevoConfigured = () => !isPlaceholder(env.BREVO_API_KEY);
const isGmailConfigured = () => !isPlaceholder(env.GMAIL_USER) && !isPlaceholder(env.GMAIL_APP_PASSWORD);
const isEmailConfigured = () => isBrevoConfigured() || isGmailConfigured();

function getBrevoApiKey() {
  const key = String(env.BREVO_API_KEY || "").trim();
  if (key.startsWith("xsmtpsib-")) {
    throw new Error(
      "BREVO_API_KEY is an SMTP key (xsmtpsib-). Use an API key (xkeysib-) from Brevo → Settings → SMTP & API → API keys."
    );
  }
  return key;
}

function getTransporter() {
  if (!isGmailConfigured()) return null;
  if (transporter) return transporter;

  transporter = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 587,
    secure: false,
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 15000,
    auth: {
      user: env.GMAIL_USER.trim(),
      pass: String(env.GMAIL_APP_PASSWORD || "").replace(/\s/g, ""),
    },
  });

  return transporter;
}

/** Prefer Brevo on Render — Gmail SMTP is blocked on the free tier. */
function getEmailProvider() {
  if (isBrevoConfigured()) return "brevo";
  if (isGmailConfigured()) return "gmail";
  return null;
}

async function sendViaBrevo({ to, cc, bcc, subject, html, from }) {
  const fromEmail = from || env.SENDER_EMAIL_ID;

  const res = await fetch(`${BREVO_API}/smtp/email`, {
    method: "POST",
    headers: {
      "api-key": getBrevoApiKey(),
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      sender: { email: fromEmail },
      to: [{ email: to }],
      ...(cc?.length ? { cc: cc.map((email) => ({ email })) } : {}),
      ...(bcc?.length ? { bcc: bcc.map((email) => ({ email })) } : {}),
      subject,
      htmlContent: html,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    let detail = body;
    try {
      detail = JSON.parse(body).message || body;
    } catch {
      /* keep raw body */
    }
    throw new Error(`Brevo send failed: ${detail}`);
  }
}

async function sendViaGmail({ to, cc, bcc, subject, html, from }) {
  const transport = getTransporter();
  await transport.sendMail({
    from: from || env.SENDER_EMAIL_ID,
    to,
    cc: cc?.length ? cc : undefined,
    bcc: bcc?.length ? bcc : undefined,
    subject,
    html,
  });
}

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
 * DRY_RUN_NOTIFICATIONS=true (the default), nothing actually goes out —
 * logged to console and logs/dry-run-emails.log instead, so the
 * activation/forgot-password flow can be tested safely with no email
 * provider configured at all.
 */
async function sendRawEmail({ to, subject, html, cc = [], bcc = [], from }) {
  if (env.DRY_RUN_NOTIFICATIONS) {
    console.log(`\n>>> [DRY RUN] Email NOT sent — would have gone to: ${to}`);
    console.log(`>>> [DRY RUN] Subject: ${subject}`);
    writeDryRunLog({ timestamp: new Date().toISOString(), to, cc, bcc, subject, html });
    return { dryRun: true };
  }

  const provider = getEmailProvider();
  if (!provider) {
    throw new Error(
      "Email not configured. Set BREVO_API_KEY (works on Render's free tier) or GMAIL_USER + GMAIL_APP_PASSWORD (local dev / paid Render)."
    );
  }

  if (provider === "brevo") {
    await sendViaBrevo({ to, cc, bcc, subject, html, from });
    return { sent: true, provider: "brevo" };
  }

  try {
    await sendViaGmail({ to, cc, bcc, subject, html, from });
    return { sent: true, provider: "gmail" };
  } catch (err) {
    const msg = err.message || String(err);
    if (msg.includes("535") || msg.includes("BadCredentials")) {
      throw new Error("Gmail rejected the login. Use a Google App Password (16 characters), not your normal Gmail password.");
    }
    throw new Error(`Failed to send email: ${msg}`);
  }
}

/** Used by a future health/diagnostics route to confirm the configured provider actually works. */
async function verifyEmailConnection() {
  if (isBrevoConfigured()) {
    try {
      const res = await fetch(`${BREVO_API}/account`, {
        headers: { "api-key": getBrevoApiKey(), Accept: "application/json" },
      });
      if (!res.ok) return { ok: false, provider: "brevo", message: `Brevo API key invalid (${res.status})` };
      return { ok: true, provider: "brevo", message: "Brevo API connection OK" };
    } catch (err) {
      return { ok: false, provider: "brevo", message: err.message };
    }
  }

  const transport = getTransporter();
  if (!transport) return { ok: false, provider: "gmail", message: "Gmail credentials not set in .env" };
  try {
    await transport.verify();
    return { ok: true, provider: "gmail", message: "Gmail SMTP connection OK" };
  } catch (err) {
    return { ok: false, provider: "gmail", message: err.message };
  }
}

module.exports = { sendRawEmail, isEmailConfigured, isBrevoConfigured, isGmailConfigured, verifyEmailConnection };
