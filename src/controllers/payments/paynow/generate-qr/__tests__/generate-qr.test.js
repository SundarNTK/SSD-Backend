/**
 * Unit tests for the PayNow QR generation endpoint, covering both engines
 * (see PAYNOW_QR_ENGINE in config/env.js): the default "dummy" pure-JS
 * path, and the "java" PayQRSDK.jar path. Balance resolution and the
 * pending-PosTransaction write now live in controllers/pos-orders'
 * createPendingPayment() (see that module's own test suite for coverage of
 * the amount/dedup/validation logic) — this suite mocks that call and
 * focuses on what's actually this endpoint's own job: building the QR from
 * whatever fixed amount createPendingPayment() hands back, choosing the
 * right engine, the config-completeness guard, the production safety gate,
 * and rolling back an orphaned pending row if rendering itself fails.
 */

jest.mock("../find-java");
jest.mock("child_process");
jest.mock("qrcode", () => ({ toDataURL: jest.fn() }), { virtual: true });
jest.mock("../../../../pos-orders");

const { execFile } = require("child_process");
const qrcode = require("qrcode");
const { findJavaExecutable } = require("../find-java");
const env = require("../../../../../config/env");
const { createPendingPayment } = require("../../../../pos-orders");
const { PosTransaction } = require("../../../../../models/pos-transactions");
const PaymentMode = require("../../../../../models/payment-modes");
const generatePaynowQr = require("../index");
const { assertPaynowConfigured } = require("../index");

const REFERENCE_ID = "POS23456789AB"; // 3-char prefix + 10-char body = 13
const TRANSACTION_ID = "999999999999999999999999";
const PAYNOW_MODE_ID = "aaaaaaaaaaaaaaaaaaaaaaaa";
const PAYNOW_MODE = { _id: PAYNOW_MODE_ID, name: "PayNow" };

function mockRes() {
  return { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
}

function mockQuery(result) {
  return Promise.resolve(result);
}

const FULL_CONFIG = {
  NODE_ENV: "development",
  PAYNOW_CREDENTIALS_ARE_SSD_OWN: false,
  PAYNOW_MERCHANT_CATEGORY_CODE: "0000",
  PAYNOW_TXN_CURRENCY: "702",
  PAYNOW_COUNTRY_CODE: "SG",
  PAYNOW_MERCHANT_NAME: "HINDU ENDOWMENTS BOARD",
  PAYNOW_MERCHANT_CITY: "Singapore",
  PAYNOW_GLOBAL_UNIQUE_ID: "SG.PAYNOW",
  PAYNOW_PROXY_TYPE: "2",
  PAYNOW_PROXY_VALUE: "T08GB0016CH02",
  PAYNOW_EDITABLE_AMOUNT: "1",
  PAYNOW_POINT_OF_INITIATION: "12",
  PAYNOW_QR_COLOR_CODE: "#7C1A78",
  PAYNOW_QR_ENGINE: "dummy",
};

describe("assertPaynowConfigured", () => {
  const originalEnv = { ...env };
  afterEach(() => Object.assign(env, originalEnv));

  it("throws naming every missing field when config is incomplete", () => {
    Object.assign(env, FULL_CONFIG, { PAYNOW_MERCHANT_NAME: "", PAYNOW_PROXY_VALUE: "" });
    expect(() => assertPaynowConfigured()).toThrow(/PAYNOW_MERCHANT_NAME.*PAYNOW_PROXY_VALUE/);
  });

  it("does not throw when every required field is set and not in production", () => {
    Object.assign(env, FULL_CONFIG);
    expect(() => assertPaynowConfigured()).not.toThrow();
  });

  it("refuses in production while credentials are still borrowed (PAYNOW_CREDENTIALS_ARE_SSD_OWN=false)", () => {
    Object.assign(env, FULL_CONFIG, { NODE_ENV: "production", PAYNOW_CREDENTIALS_ARE_SSD_OWN: false });
    expect(() => assertPaynowConfigured()).toThrow(/not yet SSD's own/);
  });

  it("allows production once PAYNOW_CREDENTIALS_ARE_SSD_OWN is flipped true", () => {
    Object.assign(env, FULL_CONFIG, { NODE_ENV: "production", PAYNOW_CREDENTIALS_ARE_SSD_OWN: true });
    expect(() => assertPaynowConfigured()).not.toThrow();
  });
});

describe("generatePaynowQr (handler, engine-agnostic)", () => {
  const originalEnv = { ...env };

  beforeEach(() => {
    jest.clearAllMocks();
    Object.assign(env, FULL_CONFIG);
    createPendingPayment.mockResolvedValue({
      order: { referenceId: REFERENCE_ID },
      transaction: { _id: TRANSACTION_ID, amount: 175 },
    });
    qrcode.toDataURL.mockResolvedValue("data:image/png;base64,QkFTRTY0SU1BR0U=");
    PosTransaction.findByIdAndUpdate = jest.fn(async () => {});
    PaymentMode.findOne = jest.fn(() => mockQuery(PAYNOW_MODE));
  });

  afterEach(() => Object.assign(env, originalEnv));

  it("refuses to run at all when PayNow config is incomplete, before creating any pending payment", async () => {
    Object.assign(env, FULL_CONFIG, { PAYNOW_PROXY_VALUE: "" });
    const req = { body: { referenceId: REFERENCE_ID } };
    const res = mockRes();

    await generatePaynowQr(req, res);

    expect(createPendingPayment).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining("not configured") }));
  });

  it("rejects a malformed referenceId without calling createPendingPayment", async () => {
    const req = { body: { referenceId: "too-short" } };
    const res = mockRes();

    await generatePaynowQr(req, res);

    expect(createPendingPayment).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("passes the requested amount through to createPendingPayment and uses ITS fixed amount for the QR, not the request's", async () => {
    createPendingPayment.mockResolvedValue({
      order: { referenceId: REFERENCE_ID },
      transaction: { _id: TRANSACTION_ID, amount: 75 }, // clamped/resolved amount, may differ from the request
    });
    const req = { body: { referenceId: REFERENCE_ID, amount: 999 } };
    const res = mockRes();

    await generatePaynowQr(req, res);

    expect(createPendingPayment).toHaveBeenCalledWith({
      referenceId: REFERENCE_ID,
      amount: 999,
      paymentMode: PAYNOW_MODE_ID,
      paymentModeName: "PayNow",
      processedBy: null,
    });
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ amount: 75 }) }));
  });

  it("always tags the pending payment as PayNow, even when the order was originally booked under a different mode (e.g. a PayNow top-up on a Cash-booked order)", async () => {
    const req = { body: { referenceId: REFERENCE_ID } };
    const res = mockRes();

    await generatePaynowQr(req, res);

    expect(createPendingPayment).toHaveBeenCalledWith(
      expect.objectContaining({ paymentMode: PAYNOW_MODE_ID, paymentModeName: "PayNow" })
    );
  });

  it("refuses to generate a QR when PayNow isn't configured as an available payment mode, without calling createPendingPayment", async () => {
    PaymentMode.findOne = jest.fn(() => mockQuery(null));
    const req = { body: { referenceId: REFERENCE_ID } };
    const res = mockRes();

    await generatePaynowQr(req, res);

    expect(createPendingPayment).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining("PayNow is not configured") }));
  });

  it("surfaces a createPendingPayment error (e.g. already fully paid) without attempting to render a QR", async () => {
    createPendingPayment.mockRejectedValue("This order is already fully paid.");
    const req = { body: { referenceId: REFERENCE_ID } };
    const res = mockRes();

    await generatePaynowQr(req, res);

    expect(qrcode.toDataURL).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("cancels the just-created pending transaction if QR rendering itself fails, so no unconfirmable ghost payment is left for the admin confirm list", async () => {
    qrcode.toDataURL.mockRejectedValue(new Error("boom"));
    const req = { body: { referenceId: REFERENCE_ID } };
    const res = mockRes();

    await generatePaynowQr(req, res);

    expect(PosTransaction.findByIdAndUpdate).toHaveBeenCalledWith(TRANSACTION_ID, { paymentStatus: "cancelled" });
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

describe("generatePaynowQr (handler, dummy engine — default)", () => {
  const originalEnv = { ...env };

  beforeEach(() => {
    jest.clearAllMocks();
    Object.assign(env, FULL_CONFIG);
    createPendingPayment.mockResolvedValue({
      order: { referenceId: REFERENCE_ID },
      transaction: { _id: TRANSACTION_ID, amount: 175 },
    });
    qrcode.toDataURL.mockResolvedValue("data:image/png;base64,QkFTRTY0SU1BR0U=");
    PaymentMode.findOne = jest.fn(() => mockQuery(PAYNOW_MODE));
  });

  afterEach(() => Object.assign(env, originalEnv));

  it("builds the EMVCo payload and renders it with qrcode, embedding the referenceId", async () => {
    const req = { body: { referenceId: REFERENCE_ID } };
    const res = mockRes();

    await generatePaynowQr(req, res);

    expect(qrcode.toDataURL).toHaveBeenCalledWith(expect.stringContaining(REFERENCE_ID), expect.any(Object));
    expect(execFile).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        data: expect.objectContaining({
          referenceId: REFERENCE_ID,
          amount: 175,
          engine: "dummy",
          qrImage: expect.stringContaining("data:image/png;base64,"),
        }),
      })
    );
  });
});

describe("generatePaynowQr (handler, java engine)", () => {
  const originalEnv = { ...env };

  beforeEach(() => {
    jest.clearAllMocks();
    Object.assign(env, FULL_CONFIG, { PAYNOW_QR_ENGINE: "java" });
    createPendingPayment.mockResolvedValue({
      order: { referenceId: REFERENCE_ID },
      transaction: { _id: TRANSACTION_ID, amount: 175 },
    });
    findJavaExecutable.mockResolvedValue("java");
    execFile.mockImplementation((_bin, _args, _opts, cb) => cb(null, "QkFTRTY0SU1BR0U=", ""));
    PaymentMode.findOne = jest.fn(() => mockQuery(PAYNOW_MODE));
  });

  afterEach(() => Object.assign(env, originalEnv));

  it("shells out to the jar with the fixed amount and referenceId", async () => {
    const req = { body: { referenceId: REFERENCE_ID } };
    const res = mockRes();

    await generatePaynowQr(req, res);

    expect(execFile).toHaveBeenCalledWith(
      "java",
      expect.arrayContaining(["-jar", expect.stringContaining("PayQRSDK.jar"), "175.00", REFERENCE_ID]),
      expect.any(Object),
      expect.any(Function)
    );
    expect(qrcode.toDataURL).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ engine: "java", qrImage: expect.stringContaining("data:image/png;base64,") }) })
    );
  });

  it("surfaces a clear error when the Java subprocess fails", async () => {
    execFile.mockImplementation((_bin, _args, _opts, cb) => cb(new Error("boom"), "", "stderr detail"));
    const req = { body: { referenceId: REFERENCE_ID } };
    const res = mockRes();

    await generatePaynowQr(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
  });
});
