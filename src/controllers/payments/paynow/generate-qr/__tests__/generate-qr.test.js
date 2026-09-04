/**
 * Unit tests for POST /payments/paynow/generate-qr — now a thin HTTP
 * wrapper. All the actual work (config guard, fixing the pending
 * transaction's amount, rendering the QR, rolling back on render failure)
 * lives in controllers/pos-orders' buildPaynowQrForOrder, which this route
 * shares with createOrder's own in-response QR embedding — see that
 * module's own test suite for coverage of the amount/dedup/validation/
 * rollback logic, and render.test.js for the two rendering engines. This
 * suite only covers what's actually this route's own job: schema
 * validation, calling buildPaynowQrForOrder with the right arguments, and
 * mapping its result onto the HTTP response.
 */

jest.mock("../../../../pos-orders");

const { buildPaynowQrForOrder } = require("../../../../pos-orders");
const generatePaynowQr = require("../index");

const REFERENCE_ID = "POS23456789AB"; // 3-char prefix + 10-char body = 13

function mockRes() {
  return { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
}

describe("generatePaynowQr (HTTP wrapper around buildPaynowQrForOrder)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    buildPaynowQrForOrder.mockResolvedValue({ amount: 175, qr: "data:image/png;base64,QkFTRTY0SU1BR0U=", engine: "dummy" });
  });

  it("rejects a malformed referenceId without calling buildPaynowQrForOrder", async () => {
    const req = { body: { referenceId: "too-short" } };
    const res = mockRes();

    await generatePaynowQr(req, res);

    expect(buildPaynowQrForOrder).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("passes the referenceId, requested amount, and caller through to buildPaynowQrForOrder", async () => {
    const req = { body: { referenceId: REFERENCE_ID, amount: 100 }, auth: { userId: "user-1" } };
    const res = mockRes();

    await generatePaynowQr(req, res);

    expect(buildPaynowQrForOrder).toHaveBeenCalledWith({ referenceId: REFERENCE_ID, amount: 100, processedBy: "user-1" });
  });

  it("omits amount (pay the full outstanding balance) when the request doesn't specify one", async () => {
    const req = { body: { referenceId: REFERENCE_ID } };
    const res = mockRes();

    await generatePaynowQr(req, res);

    expect(buildPaynowQrForOrder).toHaveBeenCalledWith({ referenceId: REFERENCE_ID, amount: undefined, processedBy: null });
  });

  it("maps buildPaynowQrForOrder's result onto the response as referenceId/amount/qrImage/engine", async () => {
    const req = { body: { referenceId: REFERENCE_ID } };
    const res = mockRes();

    await generatePaynowQr(req, res);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        data: {
          referenceId: REFERENCE_ID,
          amount: 175,
          qrImage: "data:image/png;base64,QkFTRTY0SU1BR0U=",
          engine: "dummy",
        },
      })
    );
  });

  it("surfaces a buildPaynowQrForOrder error (e.g. already fully paid, config incomplete) as a 400", async () => {
    buildPaynowQrForOrder.mockRejectedValue("This order is already fully paid.");
    const req = { body: { referenceId: REFERENCE_ID } };
    const res = mockRes();

    await generatePaynowQr(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: "This order is already fully paid." }));
  });
});
