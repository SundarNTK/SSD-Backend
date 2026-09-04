/**
 * Pure QR-rendering half of PayNow QR generation — no knowledge of
 * pos_orders/pos_transactions at all, on purpose. Split out from this
 * module's own index.js (the HTTP route) so controllers/pos-orders can
 * build a QR image directly, in-process, while creating an order — without
 * pos-orders having to require index.js (which itself requires pos-orders
 * for createPendingPayment) and forming a require cycle. index.js still
 * owns the actual `POST /payments/paynow/generate-qr` route and re-exports
 * assertPaynowConfigured from here for that route's own use.
 *
 * Two interchangeable ways to actually build the image, chosen by
 * PAYNOW_QR_ENGINE (config/env.js):
 *
 *   "dummy" (default) — builds a real EMVCo-structured payload in pure JS
 *     (build-payload.js) and renders it with the `qrcode` package. No Java,
 *     no bank-signed SDK required. Real fields (merchant name, proxy,
 *     amount, referenceId), just not run through DBS's certified pipeline.
 *
 *   "java" — shells out to the DBS-issued PayQRSDK.jar, the same way HEB's
 *     own Payment-Service does
 *     (D:\PROJECTS\HEB\Payment-Service\source\controllers\paynow\generate-qr).
 *     Requires a JRE on this machine and the real jar under
 *     public/Paynowsdk/dist.
 */

const path = require("path");
const crypto = require("crypto");
const fs = require("fs");
const { execFile } = require("child_process");
const qrcode = require("qrcode");
const env = require("../../../../config/env");
const { findJavaExecutable } = require("./find-java");
const { buildPaynowQrPayload } = require("./build-payload");

const REQUIRED_CONFIG_FIELDS = [
  "PAYNOW_MERCHANT_CATEGORY_CODE",
  "PAYNOW_TXN_CURRENCY",
  "PAYNOW_COUNTRY_CODE",
  "PAYNOW_MERCHANT_NAME",
  "PAYNOW_MERCHANT_CITY",
  "PAYNOW_GLOBAL_UNIQUE_ID",
  "PAYNOW_PROXY_TYPE",
  "PAYNOW_PROXY_VALUE",
  "PAYNOW_EDITABLE_AMOUNT",
  "PAYNOW_POINT_OF_INITIATION",
];

function assertPaynowConfigured() {
  const missing = REQUIRED_CONFIG_FIELDS.filter((key) => !env[key]);
  if (missing.length > 0) {
    throw `PayNow is not configured — missing: ${missing.join(", ")}. See docs/paynow-integration.md.`;
  }
  // Only the "java" engine goes through DBS's actual certified pipeline and
  // produces a QR a real banking app will act on — that's the one that can
  // actually misroute a donor's payment to HEB's still-borrowed account, so
  // it's the only engine this guard blocks. "dummy" (the default) is a
  // synthetic EMVCo-shaped payload rendered locally purely to demo/test the
  // POS flow end-to-end before SSD's own DBS onboarding is done — safe to
  // run in any environment, including a Render deployment's
  // NODE_ENV=production, while PAYNOW_QR_ENGINE stays "dummy".
  if (env.PAYNOW_QR_ENGINE === "java" && env.NODE_ENV === "production" && !env.PAYNOW_CREDENTIALS_ARE_SSD_OWN) {
    throw "PayNow credentials are not yet SSD's own (PAYNOW_CREDENTIALS_ARE_SSD_OWN=false) — refusing to generate a QR in production. See docs/paynow-integration.md.";
  }
}

/** YYYYMMDDHHmmss, in local time — matches the format the QR SDK expects. */
function formatSdkDateTime(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return (
    String(date.getFullYear()) +
    pad(date.getMonth() + 1) +
    pad(date.getDate()) +
    pad(date.getHours()) +
    pad(date.getMinutes()) +
    pad(date.getSeconds())
  );
}

function runQrJar(javaPath, args) {
  const jarFilePath = path.join(__dirname, "../../../../../public/Paynowsdk/dist/");
  const jarPath = path.join(jarFilePath, "PayQRSDK.jar");

  if (!fs.existsSync(jarPath)) {
    throw "PayQRSDK.jar not found in public/Paynowsdk/dist/ — see docs/paynow-integration.md.";
  }

  return new Promise((resolve, reject) => {
    execFile(
      javaPath,
      ["-jar", jarPath, ...args],
      {
        cwd: jarFilePath,
        env: { ...process.env, PATH: process.env.PATH || process.env.Path || "" },
        maxBuffer: 10 * 1024 * 1024,
      },
      (error, stdout, stderr) => {
        if (error) return reject(new Error(`PayNow QR generation failed: ${stderr || error.message}`));
        const base64Image = stdout.trim();
        if (!base64Image) return reject(new Error("No output received from the PayNow QR generator."));
        resolve(base64Image);
      }
    );
  });
}

/** PAYNOW_QR_ENGINE="java" — the DBS-issued SDK, see the module comment. */
async function generateViaJava(referenceId, amount) {
  const javaPath = await findJavaExecutable();

  const id = crypto.randomUUID();
  const paynowBrandImagePath = path.join(__dirname, "../../../../../public/Paynowsdk/PayNow.png");
  const filename = `qr-${id}.png`;
  // 1 year out — matches the reference implementation's own expiry window;
  // confirm this is the right window for SSD's own DBS agreement once
  // that's in place (see docs/paynow-integration.md).
  const expiryDate = formatSdkDateTime(new Date(Date.now() + 365 * 24 * 60 * 60 * 1000));

  const args = [
    env.PAYNOW_MERCHANT_CATEGORY_CODE,
    env.PAYNOW_TXN_CURRENCY,
    env.PAYNOW_COUNTRY_CODE,
    env.PAYNOW_MERCHANT_NAME,
    env.PAYNOW_MERCHANT_CITY,
    env.PAYNOW_GLOBAL_UNIQUE_ID,
    env.PAYNOW_PROXY_TYPE,
    env.PAYNOW_PROXY_VALUE,
    env.PAYNOW_EDITABLE_AMOUNT,
    expiryDate,
    env.PAYNOW_POINT_OF_INITIATION,
    amount.toFixed(2),
    referenceId,
    env.PAYNOW_QR_COLOR_CODE,
    paynowBrandImagePath,
    filename,
    "/t",
  ];

  const base64Image = await runQrJar(javaPath, args);
  return `data:image/png;base64,${base64Image}`;
}

/** PAYNOW_QR_ENGINE="dummy" (the default) — pure-JS EMVCo payload + qrcode rendering, see the module comment. */
async function generateViaDummy(referenceId, amount) {
  const payload = buildPaynowQrPayload({
    merchantCategoryCode: env.PAYNOW_MERCHANT_CATEGORY_CODE,
    currency: env.PAYNOW_TXN_CURRENCY,
    countryCode: env.PAYNOW_COUNTRY_CODE,
    merchantName: env.PAYNOW_MERCHANT_NAME,
    merchantCity: env.PAYNOW_MERCHANT_CITY,
    globalUniqueId: env.PAYNOW_GLOBAL_UNIQUE_ID,
    proxyType: env.PAYNOW_PROXY_TYPE,
    proxyValue: env.PAYNOW_PROXY_VALUE,
    editableAmount: env.PAYNOW_EDITABLE_AMOUNT,
    pointOfInitiation: env.PAYNOW_POINT_OF_INITIATION,
    amount,
    referenceId,
  });
  return qrcode.toDataURL(payload, { errorCorrectionLevel: "M", margin: 2 });
}

/** Picks the engine from PAYNOW_QR_ENGINE and renders the QR — the one entrypoint every caller (the HTTP route and pos-orders' own order-create embedding) should use. */
async function renderQrImage(referenceId, amount) {
  const engine = env.PAYNOW_QR_ENGINE === "java" ? "java" : "dummy";
  const qrImage = engine === "java" ? await generateViaJava(referenceId, amount) : await generateViaDummy(referenceId, amount);
  return { qrImage, engine };
}

module.exports = { assertPaynowConfigured, renderQrImage, generateViaJava, generateViaDummy };
