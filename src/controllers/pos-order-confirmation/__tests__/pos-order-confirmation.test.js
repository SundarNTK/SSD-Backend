/**
 * Unit tests for the manual POS order confirmation admin screen. As of the
 * pending-payment rewrite (see controllers/pos-orders' createPendingPayment/
 * confirmPosPayment), the amount is fixed the moment a QR is generated —
 * this screen only ever lists/displays that fixed amount and confirms it,
 * never accepts one. dispatchPaymentConfirmation is mocked so these tests
 * verify THIS module's own job (listing pending PosTransactions, shaping
 * detail, normalizing the confirm call) — not confirmPosPayment's own
 * logic, covered in controllers/pos-orders' test suite.
 */

jest.mock("../../payments/dispatch");

const { PosOrder } = require("../../../models/pos-orders");
const { PosBooking } = require("../../../models/pos-bookings");
const { PosTransaction } = require("../../../models/pos-transactions");
const { dispatchPaymentConfirmation } = require("../../payments/dispatch");
const { listPending, getPendingDetail, confirmManually } = require("../index");

const REFERENCE_ID = "POS23456789AB";
const ORDER_ID = "eeeeeeeeeeeeeeeeeeeeeeee";
const BOOKING_ID = "ffffffffffffffffffffffff";
const TXN_ID = "999999999999999999999999";

function mockQuery(result) {
  return {
    select: jest.fn(() => mockQuery(result)),
    populate: jest.fn(() => mockQuery(result)),
    sort: jest.fn(() => mockQuery(result)),
    then: (resolve, reject) => Promise.resolve(result).then(resolve, reject),
    catch: (reject) => Promise.resolve(result).catch(reject),
  };
}

function mockRes() {
  return { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
}

describe("listPending", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("lists a still-pending order's PENDING transaction as 'new_payment', excludes Cash", async () => {
    PosTransaction.find = jest.fn(() =>
      mockQuery([
        {
          _id: TXN_ID,
          bookingId: null,
          orderId: { referenceId: REFERENCE_ID, orderNumber: "POS1" },
          customer: { _id: "c1", name: "Devotee A", customerCode: "SSD-C0001" },
          paymentModeName: "PayNow",
          amount: 100,
          transactionDate: new Date("2026-09-01"),
          expiresAt: new Date(Date.now() + 15 * 60 * 1000),
        },
        {
          _id: "888888888888888888888888",
          bookingId: null,
          orderId: { referenceId: "POSCASHORDER01", orderNumber: "POS2" },
          customer: { _id: "c2", name: "Devotee B" },
          paymentModeName: "Cash",
          amount: 50,
          transactionDate: new Date("2026-09-02"),
          expiresAt: new Date(Date.now() + 15 * 60 * 1000),
        },
      ])
    );

    const req = { query: {} };
    const res = mockRes();
    await listPending(req, res);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          total: 1,
          items: [expect.objectContaining({ kind: "new_payment", referenceId: REFERENCE_ID, amount: 100, paymentModeName: "PayNow" })],
        }),
      })
    );
  });

  it("lists a top-up's pending transaction (bookingId already set) as 'balance_due'", async () => {
    PosTransaction.find = jest.fn(() =>
      mockQuery([
        {
          _id: TXN_ID,
          bookingId: BOOKING_ID,
          orderId: { referenceId: REFERENCE_ID, orderNumber: "POS1" },
          customer: { _id: "c1", name: "Devotee A" },
          paymentModeName: "PayNow",
          amount: 75,
          transactionDate: new Date(),
          expiresAt: new Date(Date.now() + 15 * 60 * 1000),
        },
      ])
    );

    const req = { query: {} };
    const res = mockRes();
    await listPending(req, res);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ items: [expect.objectContaining({ kind: "balance_due", amount: 75 })] }) })
    );
  });

  it("the query itself only ever asks for non-expired PENDING transactions — nothing already confirmed or expired can appear", async () => {
    PosTransaction.find = jest.fn(() => mockQuery([]));

    const req = { query: {} };
    const res = mockRes();
    await listPending(req, res);

    expect(PosTransaction.find).toHaveBeenCalledWith(
      expect.objectContaining({ paymentStatus: "pending", expiresAt: expect.objectContaining({ $gt: expect.any(Date) }) })
    );
  });
});

describe("getPendingDetail", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns 'new_payment' detail (order's own lines/total) when the pending transaction has no bookingId yet", async () => {
    const orderDoc = {
      referenceId: REFERENCE_ID,
      orderNumber: "POS1",
      customer: { name: "Devotee A" },
      lines: [{ name: "Special Darshan" }],
      grandTotal: 175,
    };
    PosOrder.findOne = jest.fn(() => mockQuery(orderDoc));
    PosTransaction.findOne = jest.fn(() => mockQuery({ bookingId: null, amount: 100, paymentModeName: "PayNow", expiresAt: new Date() }));

    const req = { params: { referenceId: REFERENCE_ID } };
    const res = mockRes();
    await getPendingDetail(req, res);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ kind: "new_payment", referenceId: REFERENCE_ID, amount: 100, grandTotal: 175, bookingNumber: null }),
      })
    );
  });

  it("returns 'balance_due' detail (booking's own lines/total) when the pending transaction already has a bookingId", async () => {
    const orderDoc = { referenceId: REFERENCE_ID, orderNumber: "POS1", customer: {}, lines: [], grandTotal: 175 };
    PosOrder.findOne = jest.fn(() => mockQuery(orderDoc));
    PosTransaction.findOne = jest.fn(() => mockQuery({ bookingId: BOOKING_ID, amount: 75, paymentModeName: "PayNow", expiresAt: new Date() }));
    PosBooking.findById = jest.fn(() => mockQuery({ bookingNumber: "BKG1", lines: [{ name: "Archanai" }], grandTotal: 175 }));

    const req = { params: { referenceId: REFERENCE_ID } };
    const res = mockRes();
    await getPendingDetail(req, res);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ kind: "balance_due", amount: 75, bookingNumber: "BKG1", lines: [{ name: "Archanai" }] }),
      })
    );
  });

  it("rejects when no order matches the reference", async () => {
    PosOrder.findOne = jest.fn(() => mockQuery(null));
    const req = { params: { referenceId: REFERENCE_ID } };
    const res = mockRes();
    await getPendingDetail(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("rejects when there is no active pending transaction for this order (already confirmed, or expired)", async () => {
    PosOrder.findOne = jest.fn(() => mockQuery({ referenceId: REFERENCE_ID, orderNumber: "POS1" }));
    PosTransaction.findOne = jest.fn(() => mockQuery(null));

    const req = { params: { referenceId: REFERENCE_ID } };
    const res = mockRes();
    await getPendingDetail(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });
});

describe("confirmManually", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("validates input and dispatches with NO amount and NO payment-mode field — both were already fixed at QR-generation time", async () => {
    dispatchPaymentConfirmation.mockResolvedValue({ alreadyProcessed: false, bookingNumber: "BKG1", paymentStatus: "paid" });

    const req = {
      params: { referenceId: REFERENCE_ID },
      body: { gatewayReference: "MANUAL-REF-001" },
      auth: { userId: "u1" },
    };
    const res = mockRes();

    await confirmManually(req, res);

    expect(dispatchPaymentConfirmation).toHaveBeenCalledWith(REFERENCE_ID, {
      gatewayReference: "MANUAL-REF-001",
      processedBy: "u1",
    });
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ bookingNumber: "BKG1" }) }));
  });

  it("rejects a request with no gatewayReference", async () => {
    const req = { params: { referenceId: REFERENCE_ID }, body: {}, auth: { userId: "u1" } };
    const res = mockRes();

    await confirmManually(req, res);

    expect(dispatchPaymentConfirmation).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("rejects a request that tries to sneak in an amount override — the schema has no such field, and Joi rejects unknown keys by default", async () => {
    const req = {
      params: { referenceId: REFERENCE_ID },
      body: { gatewayReference: "MANUAL-REF-001", amount: 999999 },
      auth: { userId: "u1" },
    };
    const res = mockRes();

    await confirmManually(req, res);

    expect(dispatchPaymentConfirmation).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("reports an already-processed duplicate as a 200, not an error", async () => {
    dispatchPaymentConfirmation.mockResolvedValue({ alreadyProcessed: true, transactionId: "abc" });

    const req = { params: { referenceId: REFERENCE_ID }, body: { gatewayReference: "MANUAL-REF-001" }, auth: { userId: "u1" } };
    const res = mockRes();

    await confirmManually(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ alreadyProcessed: true }) }));
  });

  it("surfaces a 'no pending payment' error from the dispatcher as a 400", async () => {
    dispatchPaymentConfirmation.mockRejectedValue(`No pending payment found for reference "${REFERENCE_ID}".`);

    const req = { params: { referenceId: REFERENCE_ID }, body: { gatewayReference: "MANUAL-REF-001" }, auth: { userId: "u1" } };
    const res = mockRes();

    await confirmManually(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });
});
