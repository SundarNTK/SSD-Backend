/**
 * Unit tests for the two PayNow QR rendering engines (render.js) and the
 * assertPaynowConfigured guard both engines share. Split out of what used
 * to be generate-qr's own test file when the rendering logic itself moved
 * to render.js — see that file's own module comment for why (so
 * controllers/pos-orders can build a QR in-process without a require cycle
 * through generate-qr/index.js).
 */

jest.mock("../find-java");
jest.mock("child_process");
jest.mock("qrcode", () => ({ toDataURL: jest.fn() }), { virtual: true });

const { execFile } = require("child_process");
const qrcode = require("qrcode");
const { findJavaExecutable } = require("../find-java");
const env = require("../../../../../config/env");
const { assertPaynowConfigured, renderQrImage } = require("../render");

const REFERENCE_ID = "POS23456789AB"; // 3-char prefix + 10-char body = 13

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

  it("refuses the java engine in production while credentials are still borrowed (PAYNOW_CREDENTIALS_ARE_SSD_OWN=false)", () => {
    Object.assign(env, FULL_CONFIG, { PAYNOW_QR_ENGINE: "java", NODE_ENV: "production", PAYNOW_CREDENTIALS_ARE_SSD_OWN: false });
    expect(() => assertPaynowConfigured()).toThrow(/not yet SSD's own/);
  });

  it("allows the java engine in production once PAYNOW_CREDENTIALS_ARE_SSD_OWN is flipped true", () => {
    Object.assign(env, FULL_CONFIG, { PAYNOW_QR_ENGINE: "java", NODE_ENV: "production", PAYNOW_CREDENTIALS_ARE_SSD_OWN: true });
    expect(() => assertPaynowConfigured()).not.toThrow();
  });

  it("allows the dummy engine (the default) in production even with borrowed credentials — it never touches DBS's certified pipeline, only a locally-rendered synthetic payload for demoing the flow before SSD's own DBS onboarding is done", () => {
    Object.assign(env, FULL_CONFIG, { PAYNOW_QR_ENGINE: "dummy", NODE_ENV: "production", PAYNOW_CREDENTIALS_ARE_SSD_OWN: false });
    expect(() => assertPaynowConfigured()).not.toThrow();
  });
});

describe("renderQrImage", () => {
  const originalEnv = { ...env };

  beforeEach(() => {
    jest.clearAllMocks();
    Object.assign(env, FULL_CONFIG);
    qrcode.toDataURL.mockResolvedValue("data:image/png;base64,QkFTRTY0SU1BR0U=");
  });

  afterEach(() => Object.assign(env, originalEnv));

  it("dummy engine (default): builds the EMVCo payload and renders it with qrcode, embedding the referenceId", async () => {
    const { qrImage, engine } = await renderQrImage(REFERENCE_ID, 175);

    expect(qrcode.toDataURL).toHaveBeenCalledWith(expect.stringContaining(REFERENCE_ID), expect.any(Object));
    expect(execFile).not.toHaveBeenCalled();
    expect(engine).toBe("dummy");
    expect(qrImage).toContain("data:image/png;base64,");
  });

  it("java engine: shells out to the jar with the fixed amount and referenceId", async () => {
    Object.assign(env, { PAYNOW_QR_ENGINE: "java" });
    findJavaExecutable.mockResolvedValue("java");
    execFile.mockImplementation((_bin, _args, _opts, cb) => cb(null, "QkFTRTY0SU1BR0U=", ""));

    const { qrImage, engine } = await renderQrImage(REFERENCE_ID, 175);

    expect(execFile).toHaveBeenCalledWith(
      "java",
      expect.arrayContaining(["-jar", expect.stringContaining("PayQRSDK.jar"), "175.00", REFERENCE_ID]),
      expect.any(Object),
      expect.any(Function)
    );
    expect(qrcode.toDataURL).not.toHaveBeenCalled();
    expect(engine).toBe("java");
    expect(qrImage).toContain("data:image/png;base64,");
  });

  it("java engine: surfaces a clear error when the Java subprocess fails", async () => {
    Object.assign(env, { PAYNOW_QR_ENGINE: "java" });
    findJavaExecutable.mockResolvedValue("java");
    execFile.mockImplementation((_bin, _args, _opts, cb) => cb(new Error("boom"), "", "stderr detail"));

    await expect(renderQrImage(REFERENCE_ID, 175)).rejects.toThrow(/PayNow QR generation failed/);
  });
});
