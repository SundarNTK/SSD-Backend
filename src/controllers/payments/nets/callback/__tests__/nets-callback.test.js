/**
 * Unit tests for POST /payments/nets/callback — the Nets-Service EXE's
 * automatic confirmation entry point. dispatchPaymentConfirmation is
 * mocked (confirmPosPayment's own logic is covered in controllers/
 * pos-orders' test suite) — these tests verify THIS module's own job:
 * secret-checking, validating the body, and — the focus of this file —
 * building `terminalConfirmationDetails` from whatever the EXE sent and
 * forwarding it through, so a genuine terminal response ends up recorded
 * on the PosTransaction row (see models/pos-transactions' own comment on
 * that field).
 */

jest.mock("../../../dispatch");
jest.mock("../../../../pos-orders", () => ({
  computeBookingTicketGroups: jest.fn(async () => ({ ticketGroups: [], receipt: {}, temple: null, customer: null, splitMode: "PRINT_GROUP_WISE" })),
}));

const env = require("../../../../../config/env");
const { dispatchPaymentConfirmation } = require("../../../dispatch");
const netsCallback = require("../index");

const REFERENCE_ID = "POS0000000001";
const BOOKING_ID = "ffffffffffffffffffffffff";

function mockRes() {
  return { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
}

function mockReq(body) {
  return { body, get: (header) => (header === "X-Nets-Callback-Secret" ? env.NETS_CALLBACK_SECRET : undefined) };
}

describe("netsCallback", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    dispatchPaymentConfirmation.mockResolvedValue({ alreadyProcessed: false, _id: BOOKING_ID, amountPaid: 175 });
  });

  it("builds terminalConfirmationDetails from terminalId/approvalCode/terminalResponse and forwards it to the shared dispatcher", async () => {
    const req = mockReq({
      referenceId: REFERENCE_ID,
      gatewayReference: "APPROVAL123",
      amount: 175,
      terminalId: "TERM-01",
      approvalCode: "APPROVAL123",
      terminalResponse: { cardType: "VISA", maskedPan: "411111******1111", responsetext: "APPROVED", stan: "000123" },
    });
    const res = mockRes();

    await netsCallback(req, res);

    expect(dispatchPaymentConfirmation).toHaveBeenCalledWith(
      REFERENCE_ID,
      expect.objectContaining({
        amount: 175,
        gatewayReference: "APPROVAL123",
        processedBy: null,
        terminalConfirmationDetails: {
          terminalId: "TERM-01",
          approvalCode: "APPROVAL123",
          response: { cardType: "VISA", maskedPan: "411111******1111", responsetext: "APPROVED", stan: "000123" },
          confirmedAt: expect.any(Date),
        },
      })
    );
  });

  it("leaves terminalConfirmationDetails undefined when the EXE sends only the bare gatewayReference/amount (older build, or nothing to capture)", async () => {
    const req = mockReq({ referenceId: REFERENCE_ID, gatewayReference: "APPROVAL123", amount: 175 });
    const res = mockRes();

    await netsCallback(req, res);

    const [, details] = dispatchPaymentConfirmation.mock.calls[0];
    expect(details.terminalConfirmationDetails).toBeUndefined();
  });

  it("still builds terminalConfirmationDetails from terminalId/approvalCode alone when no terminalResponse blob is sent", async () => {
    const req = mockReq({
      referenceId: REFERENCE_ID,
      gatewayReference: "APPROVAL123",
      terminalId: "TERM-01",
      approvalCode: "APPROVAL123",
    });
    const res = mockRes();

    await netsCallback(req, res);

    const [, details] = dispatchPaymentConfirmation.mock.calls[0];
    expect(details.terminalConfirmationDetails).toEqual({
      terminalId: "TERM-01",
      approvalCode: "APPROVAL123",
      response: null,
      confirmedAt: expect.any(Date),
    });
  });

  it("rejects a request with a missing/wrong callback secret before ever touching the dispatcher", async () => {
    const req = { body: { referenceId: REFERENCE_ID, gatewayReference: "APPROVAL123" }, get: () => "wrong-secret" };
    const res = mockRes();

    await netsCallback(req, res);

    expect(dispatchPaymentConfirmation).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });
});
