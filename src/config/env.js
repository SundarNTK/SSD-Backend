require("dotenv").config();

/**
 * Every module reads config from here, never from process.env directly —
 * one place to see what the whole app depends on, and one place to add a
 * default when a new env var shows up.
 */
module.exports = {
  NODE_ENV: process.env.NODE_ENV || "development",
  // SSD-Backend is the merged Auth/Users/Roles/Customers/Masters/POS/Inventory/
  // Payments/Reports API (formerly User-Service + Catalog-Service + Payment-Service
  // + Notification-Service, four separate processes). One port for the whole thing.
  PORT: process.env.PORT || 5003,
  API_PREFIX: process.env.API_PREFIX || "/api/v1",
  // Comma-separated so both a Vercel production domain and its per-branch
  // preview domains can be allowed at once, e.g.
  // "https://ssd-admin.vercel.app,https://ssd-frontend-git-develop-xxx.vercel.app".
  // See app.js's cors() call, which splits this into an array.
  CORS_ORIGIN: process.env.CORS_ORIGIN || "http://localhost:3000",

  MONGO_URI: process.env.MONGO_URI || "mongodb://127.0.0.1:27017/ssd-temple",

  JWT_SECRET: process.env.JWT_SECRET || "dev-only-insecure-secret-change-me",
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || "8h",

  BCRYPT_COST: Number(process.env.BCRYPT_COST || 12),

  ACTIVATION_TOKEN_TTL_HOURS: Number(process.env.ACTIVATION_TOKEN_TTL_HOURS || 48),
  RESET_TOKEN_TTL_MINUTES: Number(process.env.RESET_TOKEN_TTL_MINUTES || 30),
  MOBILE_OTP_TTL_MINUTES: Number(process.env.MOBILE_OTP_TTL_MINUTES || 5),

  ADMIN_APP_URL: process.env.ADMIN_APP_URL || "http://localhost:5001",

  // The email header logo. A `localhost` ADMIN_APP_URL can never be reached
  // by a real mail client (Gmail/Outlook fetch images through their own
  // servers, not the developer's machine), so this is pinned to a permanent
  // Cloudinary URL instead — works identically in local dev, on Render, and
  // after the AWS move. Override only if the logo asset itself changes.
  EMAIL_LOGO_URL:
    process.env.EMAIL_LOGO_URL ||
    "https://res.cloudinary.com/dfh7upn1f/image/upload/v1787328992/ssd-temple/branding/ssd-full-logo.png",

  /**
   * DRY_RUN=true (the default) logs every outgoing email/SMS to the console
   * and to /logs instead of actually calling the provider — exactly what's
   * needed while these are still HEB's placeholder keys, before the real
   * SSD temple credentials are dropped in.
   */
  DRY_RUN_NOTIFICATIONS: (process.env.DRY_RUN_NOTIFICATIONS ?? "true") === "true",

  // Same dual-provider approach as Syncetra-Backend (source/service/email):
  // Brevo's HTTP API first — Gmail SMTP is blocked outbound on Render's free
  // tier — falling back to Gmail SMTP via nodemailer for local dev or a paid
  // Render plan. See common/mailer/transport.js. Swap this block for AWS SES
  // once the project moves onto AWS (same DRY_RUN_NOTIFICATIONS gate stays).
  BREVO_API_KEY: process.env.BREVO_API_KEY || "",
  GMAIL_USER: process.env.GMAIL_USER || "",
  GMAIL_APP_PASSWORD: process.env.GMAIL_APP_PASSWORD || "",
  SENDER_EMAIL_ID: process.env.SENDER_EMAIL_ID || "no-reply@example-temple.org",

  // Profile image uploads — see common/utils/cloudinary.js and
  // common/middleware/upload.js. Chosen over local disk (wiped on every
  // Render redeploy) and over S3 (deferred until the AWS move) because it
  // works identically on Render today and after that migration.
  CLOUDINARY_CLOUD_NAME: process.env.CLOUDINARY_CLOUD_NAME || "",
  CLOUDINARY_API_KEY: process.env.CLOUDINARY_API_KEY || "",
  CLOUDINARY_API_SECRET: process.env.CLOUDINARY_API_SECRET || "",

  // SMS — placeholders only; nothing in the Day-1 auth flow sends an SMS yet
  // (mobile-change OTP arrives later per the build sequence), but the env
  // shape is reserved now so the notification-worker can reuse it unchanged.
  SMS_SENDER_ID: process.env.SMS_SENDER_ID || "SSDTEMPLE",

  // Seed script — the default entity every user/master belongs to today.
  DEFAULT_ENTITY_CODE: process.env.DEFAULT_ENTITY_CODE || "SST",
  SEED_SUPER_ADMIN_NAME: process.env.SEED_SUPER_ADMIN_NAME || "Temple System Admin",
  SEED_SUPER_ADMIN_EMAIL: (process.env.SEED_SUPER_ADMIN_EMAIL || "superadmin@example-temple.org").toLowerCase(),

  /**
   * PayNow (DBS PayNow Corporate) — QR generation + ICN webhook. No real
   * fallback values here on purpose, unlike EMAIL_LOGO_URL/DEFAULT_ENTITY_CODE
   * above — see docs/paynow-integration.md for the full picture, but in
   * short: these values (PAYNOW_MERCHANT_NAME, PAYNOW_PROXY_VALUE
   * especially) determine which bank account a scanned QR's money actually
   * goes to, so nothing here should default to a real value baked into
   * source — only an explicit .env entry, set on the deploying machine,
   * should ever put a live value here. Every field is required at
   * QR-generation time; controllers/payments/paynow/generate-qr throws a
   * clear "PayNow is not configured" error rather than silently generating
   * a broken QR if any of these is empty.
   */
  PAYNOW_CREDENTIALS_ARE_SSD_OWN: (process.env.PAYNOW_CREDENTIALS_ARE_SSD_OWN ?? "false") === "true",
  /**
   * "dummy"  → builds a real EMVCo-structured PayNow payload in pure JS
   *            (build-payload.js) and renders it with the `qrcode` npm
   *            package — no Java, no bank-signed SDK. Real field values
   *            (merchant name, proxy, amount, referenceId), just not run
   *            through DBS's own certified generation pipeline.
   * "java"   → the original path: shells out to PayQRSDK.jar
   *            (find-java.js + the jar under public/Paynowsdk/dist) —
   *            requires a JRE on this machine and the real DBS-issued jar.
   * Defaults to "dummy" so the QR can be seen/tested without Java or the
   * bank SDK being set up at all. Switch to "java" once both of those are
   * actually available and you want the certified generation path.
   */
  PAYNOW_QR_ENGINE: process.env.PAYNOW_QR_ENGINE || "dummy",
  PAYNOW_MERCHANT_CATEGORY_CODE: process.env.PAYNOW_MERCHANT_CATEGORY_CODE || "",
  PAYNOW_TXN_CURRENCY: process.env.PAYNOW_TXN_CURRENCY || "",
  PAYNOW_COUNTRY_CODE: process.env.PAYNOW_COUNTRY_CODE || "",
  PAYNOW_MERCHANT_NAME: process.env.PAYNOW_MERCHANT_NAME || "",
  PAYNOW_MERCHANT_CITY: process.env.PAYNOW_MERCHANT_CITY || "",
  PAYNOW_GLOBAL_UNIQUE_ID: process.env.PAYNOW_GLOBAL_UNIQUE_ID || "",
  PAYNOW_PROXY_TYPE: process.env.PAYNOW_PROXY_TYPE || "",
  PAYNOW_PROXY_VALUE: process.env.PAYNOW_PROXY_VALUE || "",
  PAYNOW_EDITABLE_AMOUNT: process.env.PAYNOW_EDITABLE_AMOUNT || "",
  PAYNOW_POINT_OF_INITIATION: process.env.PAYNOW_POINT_OF_INITIATION || "",
  PAYNOW_QR_COLOR_CODE: process.env.PAYNOW_QR_COLOR_CODE || "",
  // Not read at request time — DBS calls this URL directly, configured on
  // their side. Kept here purely so there's one place in the app that
  // states what that URL currently is, for whoever next talks to DBS.
  PAYNOW_ICN_RESPONSE_URL: process.env.PAYNOW_ICN_RESPONSE_URL || "",
  // Paths to the DBS key material — see public/Paynowsdk's own note (and
  // .gitignore) for why these files are local-only, not committed.
  PAYNOW_PRIVATE_KEY_PATH: process.env.PAYNOW_PRIVATE_KEY_PATH || "public/Paynowsdk/dbs-paynow-private-SECRET.asc",
  PAYNOW_PUBLIC_KEY_PATH: process.env.PAYNOW_PUBLIC_KEY_PATH || "public/Paynowsdk/dbs-paynow-public-uat.asc",
};