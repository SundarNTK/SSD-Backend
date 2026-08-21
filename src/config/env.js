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
};