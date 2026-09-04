/**
 * POST /payments/paynow/generate-qr
 *
 * Generates a PayNow QR for one POS order (or the outstanding balance of
 * one already-confirmed booking, for a top-up). Two interchangeable ways to
 * actually build the image, chosen by PAYNOW_QR_ENGINE (config/env.js):
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
 *
 * IMPORTANT: unlike an earlier version of this endpoint, generating a QR is
 * NOT a pure read any more — it fixes the amount this payment will confirm
 * for, exactly the way Cash's own `paidAmount` gets fixed at checkout time.
 * createPendingPayment() (controllers/pos-orders) writes a PENDING
 * PosTransaction for that fixed amount before this returns; nothing later
 * (a real DBS ICN, or an admin's manual confirm in controllers/pos-order-
 * confirmation) gets to change it — they can only confirm this exact
 * amount. See docs/paynow-integration.md for the full flow.
 */

const path = require("path");
const crypto = require("crypto");
const fs = require("fs");
const { execFile } = require("child_process");
const Joi = require("joi");
const qrcode = require("qrcode");
const env = require("../../../../config/env");
const { responseHandler, exceptionHandler } = require("../../../../utilities/handlers");
const { createPendingPayment } = require("../../../pos-orders");
const { PosTransaction } = require("../../../../models/pos-transactions");
const PaymentMode = require("../../../../models/payment-modes");
const { findJavaExecutable } = require("./find-java");
const { buildPaynowQrPayload } = require("./build-payload");

const schema = Joi.object({
  referenceId: Joi.string().trim().length(13).required(),
  // How much of the outstanding balance to charge via this QR. Omit to
  // charge the full outstanding balance — same "omit means pay in full"
  // convention paidAmount already uses elsewhere in this codebase.
  amount: Joi.number().greater(0).precision(2).optional(),
});

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
  // See config/env.js's own comment on PAYNOW_CREDENTIALS_ARE_SSD_OWN — this
  // is the one place that flag is actually enforced: refuse to generate a
  // real-looking QR in production while the credentials on file are still
  // HEB's borrowed ones, so a forgotten swap can't silently route a real
  // donor's payment to HEB's own bank account.
  if (env.NODE_ENV === "production" && !env.PAYNOW_CREDENTIALS_ARE_SSD_OWN) {
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

async function generatePaynowQr(req, res) {
  try {
    assertPaynowConfigured();

    const { error, value } = schema.validate(req.body);
    if (error) throw error.details[0].message;
    const { referenceId, amount: requestedAmount } = value;

    // This endpoint only ever generates a PayNow QR, so the pending
    // transaction it creates must always be tagged PayNow — regardless of
    // what mode the order was originally booked/paid with (e.g. a PayNow
    // top-up on a Cash-booked order). Leaving this to createPendingPayment's
    // own default (the order's original mode) mislabels the transaction,
    // which then also makes pos-order-confirmation's Cash-exclusion filter
    // hide it. See the fix in controllers/pos-orders/index.js.
    const paynowMode = await PaymentMode.findOne(PaymentMode.notDeletedFilter({ name: "PayNow", status: 1 }));
    if (!paynowMode) throw "PayNow is not configured as an available payment mode.";

    // Fixes the amount (see the module comment) and writes the PENDING
    // PosTransaction this QR's payment will confirm — before the QR image
    // itself is even built, since that amount is what goes into it.
    const { transaction } = await createPendingPayment({
      referenceId,
      amount: requestedAmount,
      paymentMode: paynowMode._id,
      paymentModeName: paynowMode.name,
      processedBy: req.auth?.userId ?? null,
    });
    const amount = transaction.amount;

    let qrImage;
    try {
      qrImage =
        env.PAYNOW_QR_ENGINE === "java" ? await generateViaJava(referenceId, amount) : await generateViaDummy(referenceId, amount);
    } catch (renderError) {
      // The pending payment this row promised is unconfirmable with no QR
      // ever shown for it — cancel it rather than leaving a ghost entry an
      // admin would otherwise see on the pos-order-confirmation screen for
      // a payment nobody could actually have made.
      await PosTransaction.findByIdAndUpdate(transaction._id, { paymentStatus: "cancelled" }).catch(() => {});
      throw renderError;
    }

    return responseHandler({
      res,
      response: { referenceId, amount, qrImage, engine: env.PAYNOW_QR_ENGINE },
      successMessage: "PayNow QR generated.",
    });
  } catch (error) {
    return exceptionHandler({ res, error, statusCode: typeof error === "string" ? 400 : undefined });
  }
}

module.exports = generatePaynowQr;
module.exports.assertPaynowConfigured = assertPaynowConfigured;
