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
  CORS_ORIGIN: process.env.CORS_ORIGIN || "http://localhost:5001",

  MONGO_URI: process.env.MONGO_URI || "mongodb://127.0.0.1:27017/ssd-temple",

  JWT_SECRET: process.env.JWT_SECRET || "dev-only-insecure-secret-change-me",
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || "8h",

  BCRYPT_COST: Number(process.env.BCRYPT_COST || 12),

  ACTIVATION_TOKEN_TTL_HOURS: Number(process.env.ACTIVATION_TOKEN_TTL_HOURS || 48),
  RESET_TOKEN_TTL_MINUTES: Number(process.env.RESET_TOKEN_TTL_MINUTES || 30),
  MOBILE_OTP_TTL_MINUTES: Number(process.env.MOBILE_OTP_TTL_MINUTES || 5),

  ADMIN_APP_URL: process.env.ADMIN_APP_URL || "http://localhost:5001",

  /**
   * DRY_RUN=true (the default) logs every outgoing email/SMS to the console
   * and to /logs instead of actually calling the provider — exactly what's
   * needed while these are still HEB's placeholder keys, before the real
   * SSD temple credentials are dropped in.
   */
  DRY_RUN_NOTIFICATIONS: (process.env.DRY_RUN_NOTIFICATIONS ?? "true") === "true",

  // Same key names as HEB's Notification-Service (D:\PROJECTS\HEB\Notification-Service),
  // so swapping HEB's placeholder values for the client's real SES identity later
  // is a drop-in .env change, not a code change.
  AWS_REGION: process.env.AWS_REGION || "ap-southeast-1",
  AWS_ACCESS_KEY: process.env.AWS_ACCESS_KEY || "",
  AWS_SECRET_KEY: process.env.AWS_SECRET_KEY || "",
  SENDER_EMAIL_ID: process.env.SENDER_EMAIL_ID || "no-reply@example-temple.org",

  // SMS — placeholders only; nothing in the Day-1 auth flow sends an SMS yet
  // (mobile-change OTP arrives later per the build sequence), but the env
  // shape is reserved now so the notification-worker can reuse it unchanged.
  SMS_SENDER_ID: process.env.SMS_SENDER_ID || "SSDTEMPLE",

  // Seed script — the default entity every user/master belongs to today.
  DEFAULT_ENTITY_CODE: process.env.DEFAULT_ENTITY_CODE || "SST",
  SEED_SUPER_ADMIN_NAME: process.env.SEED_SUPER_ADMIN_NAME || "Temple Super Admin",
  SEED_SUPER_ADMIN_EMAIL: (process.env.SEED_SUPER_ADMIN_EMAIL || "superadmin@example-temple.org").toLowerCase(),
};