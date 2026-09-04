/**
 * Unit tests for the PayNow ICN webhook. openpgp is mocked as a virtual
 * module (`{ virtual: true }`) — it doesn't need to actually be installed
 * for these tests to run, since only decrypt-response.js's own thin
 * wrapper around it is exercised here, not real PGP decryption. That
 * wrapper is mocked directly instead, so these tests focus on what this
 * codebase actually controls: body-shape tolerance, routing the decrypted
 * payload to the shared dispatcher, and the pending-vs-settled branch.
 */

// Explicit factory — decrypt-response.js requires the real "openpgp"
// package, which isn't installed yet (pending `pnpm install`, see
// docs/paynow-integration.md). A plain jest.mock("../decrypt-response")
// would still load the real file to build its automock and fail on that
// require; this factory never touches it.
jest.mock("../decrypt-response", () => jest.fn());
jest.mock("../../../dispatch");

const decryptIcnResponse = require("../decrypt-response");
const { dispatchPaymentConfirmation } = require("../../../dispatch");
const icnResponse = require("../index");
const { extractArmoredMessage } = require("../index");

function mockRes() {
  return { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
}

const REFERENCE_ID = "POS23456789AB";
const ARMORED = "-----BEGIN PGP MESSAGE-----\nfake\n-----END PGP MESSAGE-----";

function settledPayload(overrides = {}) {
  return JSON.stringify({
    header: { msgId: "MSG1", timeStamp: "2026-09-03T101905.019" },
    txnInfo: {
      customerReference: REFERENCE_ID,
      txnRefId: "DBS-TXN-REF-001",
      txnType: "PAYNOW",
      txnDate: "03-09-2026",
      amtDtls: { txnCcy: "SGD", txnAmt: 175 },
      ...overrides,
    },
  });
}

describe("extractArmoredMessage", () => {
  it("reads the armored text from a parsed JSON body's data field", () => {
    expect(extractArmoredMessage({ body: { data: ARMORED } })).toBe(ARMORED);
  });

  it("reads a JSON-shaped string body's data field", () => {
    expect(extractArmoredMessage({ body: JSON.stringify({ data: ARMORED }) })).toBe(ARMORED);
  });

  it("treats a plain non-JSON string body as the armored text itself", () => {
    expect(extractArmoredMessage({ body: ARMORED })).toBe(ARMORED);
  });

  it("returns null when nothing usable is found", () => {
    expect(extractArmoredMessage({ body: {} })).toBeNull();
    expect(extractArmoredMessage({ body: "" })).toBeNull();
  });
});

describe("icnResponse handler", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("rejects a request with no usable PGP payload, without attempting to decrypt", async () => {
    const req = { body: {} };
    const res = mockRes();

    await icnResponse(req, res);

    expect(decryptIcnResponse).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("dispatches a settled transaction to the shared confirmation dispatcher, keyed by customerReference", async () => {
    decryptIcnResponse.mockResolvedValue(settledPayload());
    dispatchPaymentConfirmation.mockResolvedValue({
      alreadyProcessed: false,
      bookingNumber: "BKG202609030001",
      paymentStatus: "paid",
    });

    const req = { body: { data: ARMORED } };
    const res = mockRes();

    await icnResponse(req, res);

    expect(decryptIcnResponse).toHaveBeenCalledWith(ARMORED);
    expect(dispatchPaymentConfirmation).toHaveBeenCalledWith(REFERENCE_ID, {
      amount: 175,
      gatewayReference: "DBS-TXN-REF-001",
      processedBy: null,
    });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ customerReference: REFERENCE_ID, paymentStatus: "paid" }) })
    );
  });

  it("does not dispatch anything for a still-pending notification (no txnRefId yet)", async () => {
    decryptIcnResponse.mockResolvedValue(settledPayload({ txnRefId: undefined }));

    const req = { body: { data: ARMORED } };
    const res = mockRes();

    await icnResponse(req, res);

    expect(dispatchPaymentConfirmation).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "pending" }) }));
  });

  it("rejects a payload with no txnInfo at all", async () => {
    decryptIcnResponse.mockResolvedValue(JSON.stringify({ header: {} }));
    const req = { body: { data: ARMORED } };
    const res = mockRes();

    await icnResponse(req, res);

    expect(dispatchPaymentConfirmation).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("surfaces a decrypt failure as an error response instead of crashing", async () => {
    decryptIcnResponse.mockRejectedValue(new Error("bad signature"));
    const req = { body: { data: ARMORED } };
    const res = mockRes();

    await icnResponse(req, res);

    expect(dispatchPaymentConfirmation).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(500);
  });

  it("reports 'already processed' without treating a duplicate ICN as an error", async () => {
    decryptIcnResponse.mockResolvedValue(settledPayload());
    dispatchPaymentConfirmation.mockResolvedValue({ alreadyProcessed: true, transactionId: "abc" });

    const req = { body: { data: ARMORED } };
    const res = mockRes();

    await icnResponse(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ alreadyProcessed: true }) })
    );
  });
});
