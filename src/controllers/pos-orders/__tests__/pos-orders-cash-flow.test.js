/**
 * Unit tests for controllers/pos-orders — the pos_orders/pos_bookings/
 * pos_transactions-backed counterpart to controllers/pos's Cash flow tests
 * (src/controllers/pos/__tests__/pos-cash-flow.test.js), which this module
 * intentionally mirrors line-for-line in behaviour. Same no-real-database
 * approach: Mongoose statics are stubbed directly, and the two DB-adjacent
 * modules destructured into local bindings at require-time (inventory-
 * reservation, sequence) are jest.mock()'d.
 *
 * Also covers confirmPosPayment() — the shared-dispatcher entrypoint
 * PayNow/NETS confirmations will call in later phases — even though
 * nothing wires it up yet beyond controllers/payments/dispatch.js's
 * registry, since it's the one function every future async-mode webhook
 * routes through.
 */

jest.mock("../../pos/inventory-reservation");
jest.mock("../../../common/utils/sequence");
jest.mock("../../payments/paynow/generate-qr/render");

const Item = require("../../../models/items");
const Service = require("../../../models/services");
const { Customer } = require("../../../models/customers");
const PaymentMode = require("../../../models/payment-modes");
const Category = require("../../../models/categories");
const SubCategory = require("../../../models/sub-categories");
const { PosOrder } = require("../../../models/pos-orders");
const { PosBooking } = require("../../../models/pos-bookings");
const { PosTransaction } = require("../../../models/pos-transactions");
const { placeReservationsForOrder, consumeReservations, cancelReservations } = require("../../pos/inventory-reservation");
const { nextSequence } = require("../../../common/utils/sequence");
const { assertPaynowConfigured, renderQrImage } = require("../../payments/paynow/generate-qr/render");
const {
  createOrder,
  confirmOrder,
  getOrderStatus,
  recordBookingPayment,
  confirmPosPayment,
  createPendingPayment,
  writePosBookingOnly,
  initiateNetsPayment,
  manualConfirmTerminalPayment,
  listBookings,
} = require("../index");

const RECEIPT_NO = "RCP-20260826-0001";

const CUSTOMER_ID = "aaaaaaaaaaaaaaaaaaaaaaaa";
const PAYMENT_MODE_ID = "bbbbbbbbbbbbbbbbbbbbbbbb";
const SERVICE_ID = "cccccccccccccccccccccccc";
const ITEM_ID = "dddddddddddddddddddddddd";
const ORDER_ID = "eeeeeeeeeeeeeeeeeeeeeeee";
const BOOKING_ID = "ffffffffffffffffffffffff";
const USER_ID = "111111111111111111111111";
const REFERENCE_ID = "POS0000000001";

function mockQuery(result) {
  return {
    select: jest.fn(() => mockQuery(result)),
    populate: jest.fn(() => mockQuery(result)),
    sort: jest.fn(() => mockQuery(result)),
    skip: jest.fn(() => mockQuery(result)),
    limit: jest.fn(() => mockQuery(result)),
    then: (resolve, reject) => Promise.resolve(result).then(resolve, reject),
    catch: (reject) => Promise.resolve(result).catch(reject),
  };
}

function mockRes() {
  return { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
}

// createOrder resolves the POS-visible category/sub-category hierarchy
// (common/utils/pos-catalogue-visibility) — an empty hierarchy is fine here
// since no test's mock item/service sets categoryDetails, and
// offeringInPosHierarchy treats "no categoryDetails" as always visible. Set
// once at module scope, not inside a beforeEach, so jest.clearAllMocks()
// elsewhere in this file (which clears call history, not implementations)
// never wipes it back out.
Category.find = jest.fn(() => mockQuery([]));
SubCategory.find = jest.fn(() => mockQuery([]));

const validCustomer = {
  _id: CUSTOMER_ID,
  customerCode: "SSD-C0001",
  name: "Test Devotee",
  email: "devotee@example.invalid",
  mobileNumber: "91234567",
};

const validPaymentMode = { _id: PAYMENT_MODE_ID, name: "Cash" };

const validService = {
  _id: SERVICE_ID,
  name: "Special Darshan",
  code: "SV-016",
  salePrice: 175,
};

function baseOrderBody(overrides = {}) {
  return {
    customerId: CUSTOMER_ID,
    paymentModeId: PAYMENT_MODE_ID,
    lines: [
      { refType: "Service", refId: SERVICE_ID, quantity: 1, deities: [], devotees: [{ name: "Devotee One", nakshatra: "Ashwini" }] },
    ],
    ...overrides,
  };
}

describe("createOrder (Cash flow, pos_orders)", () => {
  beforeEach(() => {
    jest.clearAllMocks();

    Customer.findOne = jest.fn(() => mockQuery(validCustomer));
    PaymentMode.findOne = jest.fn(() => mockQuery(validPaymentMode));
    Service.findOne = jest.fn(() => mockQuery(validService));
    Item.findOne = jest.fn(() => mockQuery(null));
    PosOrder.create = jest.fn(async (doc) => ({ _id: ORDER_ID, ...doc }));
    PosOrder.findByIdAndUpdate = jest.fn(async () => {});
    PosBooking.create = jest.fn(async (doc) => ({ _id: BOOKING_ID, ...doc }));
    PosTransaction.create = jest.fn(async (doc) => ({ _id: "999999999999999999999999", ...doc }));

    nextSequence.mockResolvedValue(1);
    placeReservationsForOrder.mockResolvedValue([]);
    consumeReservations.mockResolvedValue(undefined);
  });

  it("creates a Cash order in pos_orders and confirms it in the same request: writes the pos_booking + pos_transaction, consumes reservations, returns a confirmed booking with its referenceId", async () => {
    const req = { body: baseOrderBody(), auth: { userId: USER_ID, entityId: null } };
    const res = mockRes();

    await createOrder(req, res);

    expect(PosOrder.create).toHaveBeenCalledWith(
      expect.objectContaining({
        referenceId: expect.stringMatching(/^POS[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{10}$/),
        orderStatus: "pending",
        subtotal: 175,
        grandTotal: 175,
        paymentModeName: "Cash",
      })
    );
    expect(placeReservationsForOrder).toHaveBeenCalledWith(expect.any(Array), ORDER_ID);
    expect(PosBooking.create).toHaveBeenCalledWith(
      expect.objectContaining({ orderId: ORDER_ID, paymentStatus: "paid", bookingStatus: "confirmed", grandTotal: 175 })
    );
    expect(PosTransaction.create).toHaveBeenCalledWith(
      expect.objectContaining({ bookingId: BOOKING_ID, orderId: ORDER_ID, amount: 175, paymentStatus: "paid" })
    );
    expect(PosOrder.findByIdAndUpdate).toHaveBeenCalledWith(ORDER_ID, { orderStatus: "confirmed", bookingId: BOOKING_ID });
    expect(consumeReservations).toHaveBeenCalledWith(ORDER_ID, expect.any(Array), USER_ID, expect.any(String));
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        data: expect.objectContaining({ status: "confirmed", bookingStatus: "confirmed", grandTotal: 175, receiptNo: expect.any(String) }),
      })
    );
  });

  it("leaves a non-Cash, non-PayNow order (NETS) pending instead of confirming it, and never writes a pos_booking or a QR", async () => {
    PaymentMode.findOne = jest.fn(() => mockQuery({ _id: PAYMENT_MODE_ID, name: "NETS" }));
    const req = { body: baseOrderBody(), auth: { userId: USER_ID, entityId: null } };
    const res = mockRes();

    await createOrder(req, res);

    expect(PosBooking.create).not.toHaveBeenCalled();
    expect(consumeReservations).not.toHaveBeenCalled();
    expect(renderQrImage).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          referenceId: expect.stringMatching(/^POS[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{10}$/),
          orderStatus: "pending",
          status: "pending",
          paymentDetails: null,
        }),
      })
    );
  });

  describe("PayNow order creation — embeds the QR directly in this response (no separate /payments/paynow/generate-qr round trip needed)", () => {
    function pendingPaynowOrder(overrides = {}) {
      return {
        _id: ORDER_ID,
        orderStatus: "pending",
        grandTotal: 175,
        customer: CUSTOMER_ID,
        paymentMode: PAYMENT_MODE_ID,
        paymentModeName: "PayNow",
        bookingId: null,
        ...overrides,
      };
    }

    beforeEach(() => {
      PaymentMode.findOne = jest.fn(() => mockQuery({ _id: PAYMENT_MODE_ID, name: "PayNow" }));
      PosOrder.findOne = jest.fn(() => mockQuery(pendingPaynowOrder()));
      PosTransaction.updateMany = jest.fn(async () => {});
      assertPaynowConfigured.mockImplementation(() => {});
      renderQrImage.mockResolvedValue({ qrImage: "data:image/png;base64,FAKE", engine: "dummy" });
    });

    it("returns paymentDetails: { amount, qr, engine } straight in the order-create response", async () => {
      const req = { body: baseOrderBody(), auth: { userId: USER_ID, entityId: null } };
      const res = mockRes();

      await createOrder(req, res);

      expect(renderQrImage).toHaveBeenCalledWith(expect.stringMatching(/^POS/), 175);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: "pending",
            // paymentDetails.referenceId is the pending transaction's OWN
            // fresh reference — never the same as the order's own
            // top-level `referenceId` in this same response (see
            // buildPaynowQrForOrder's own comment on why they must differ).
            paymentDetails: { referenceId: expect.stringMatching(/^POS/), amount: 175, qr: "data:image/png;base64,FAKE", engine: "dummy" },
            paymentDetailsError: null,
          }),
        })
      );
      const [jsonArg] = res.json.mock.calls[0];
      expect(jsonArg.data.paymentDetails.referenceId).not.toBe(jsonArg.data.referenceId);
    });

    it("worst case — a QR build failure (config incomplete, render error, ...) does not fail order creation: the order still comes back with a referenceId, paymentDetails: null, and paymentDetailsError set", async () => {
      assertPaynowConfigured.mockImplementation(() => {
        throw "PayNow is not configured — missing: PAYNOW_MERCHANT_NAME.";
      });
      const req = { body: baseOrderBody(), auth: { userId: USER_ID, entityId: null } };
      const res = mockRes();

      await createOrder(req, res);

      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: "pending",
            referenceId: expect.stringMatching(/^POS[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{10}$/),
            paymentDetails: null,
            paymentDetailsError: expect.stringContaining("not configured"),
          }),
        })
      );
    });
  });

  it("rejects when the customer is not found or inactive", async () => {
    Customer.findOne = jest.fn(() => mockQuery(null));
    const req = { body: baseOrderBody(), auth: {} };
    const res = mockRes();

    await createOrder(req, res);

    expect(PosOrder.create).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("rolls back the pos_order when inventory reservation fails", async () => {
    placeReservationsForOrder.mockRejectedValue("Insufficient stock for \"Special Darshan\": only 0 unit(s) available for booking.");
    const req = { body: baseOrderBody(), auth: {} };
    const res = mockRes();

    await createOrder(req, res);

    expect(PosOrder.findByIdAndUpdate).toHaveBeenCalledWith(ORDER_ID, { orderStatus: "cancelled" });
    expect(res.status).toHaveBeenCalledWith(400);
  });
});

describe("createOrder (partial payment, pos_orders)", () => {
  beforeEach(() => {
    jest.clearAllMocks();

    Customer.findOne = jest.fn(() => mockQuery(validCustomer));
    PaymentMode.findOne = jest.fn(() => mockQuery(validPaymentMode));
    Service.findOne = jest.fn(() => mockQuery(validService));
    Item.findOne = jest.fn(() => mockQuery(null));
    PosOrder.create = jest.fn(async (doc) => ({ _id: ORDER_ID, ...doc }));
    PosOrder.findByIdAndUpdate = jest.fn(async () => {});
    PosBooking.create = jest.fn(async (doc) => ({ _id: BOOKING_ID, ...doc }));
    PosTransaction.create = jest.fn(async (doc) => ({ _id: "999999999999999999999999", ...doc }));

    nextSequence.mockResolvedValue(1);
    placeReservationsForOrder.mockResolvedValue([]);
    consumeReservations.mockResolvedValue(undefined);
  });

  it("confirms with paymentStatus 'partial' when paidAmount is less than the priced grandTotal", async () => {
    const req = { body: baseOrderBody({ paidAmount: 100 }), auth: { userId: USER_ID, entityId: null } };
    const res = mockRes();

    await createOrder(req, res);

    expect(PosBooking.create).toHaveBeenCalledWith(expect.objectContaining({ paymentStatus: "partial" }));
    expect(PosTransaction.create).toHaveBeenCalledWith(expect.objectContaining({ amount: 100, paymentStatus: "paid" }));
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ paymentStatus: "partial", amountPaid: 100, balanceAmount: 75 }) })
    );
  });

  it("rejects a paidAmount greater than the priced grandTotal, before ever writing the order", async () => {
    const req = { body: baseOrderBody({ paidAmount: 200 }), auth: { userId: USER_ID, entityId: null } };
    const res = mockRes();

    await createOrder(req, res);

    expect(PosOrder.create).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });
});

describe("confirmOrder (Cash flow, pos_orders)", () => {
  function pendingOrder(overrides = {}) {
    return {
      _id: ORDER_ID,
      orderNumber: "POS202608260009",
      referenceId: REFERENCE_ID,
      orderStatus: "pending",
      expiresAt: new Date(Date.now() + 30 * 60 * 1000),
      customer: { ...validCustomer },
      lines: [{ refType: "Service", refId: SERVICE_ID, name: "Special Darshan", code: "SV-016", quantity: 1, unitPrice: 175, lineTotal: 175, deities: [], devotees: [] }],
      subtotal: 175,
      gstAmount: 0,
      grandTotal: 175,
      paymentMode: PAYMENT_MODE_ID,
      paymentModeName: "Cash",
      bookedBy: USER_ID,
      entity: null,
      bookingId: null,
      ...overrides,
    };
  }

  beforeEach(() => {
    jest.clearAllMocks();

    PosOrder.findOne = jest.fn(() => mockQuery(pendingOrder()));
    PosOrder.findByIdAndUpdate = jest.fn(async () => {});
    PosBooking.create = jest.fn(async (doc) => ({ _id: BOOKING_ID, ...doc }));
    PosBooking.findById = jest.fn(() => mockQuery(null));
    PosBooking.deleteOne = jest.fn(async () => {});
    PosTransaction.create = jest.fn(async (doc) => ({ _id: "999999999999999999999999", ...doc }));
    PosTransaction.findOne = jest.fn(() => mockQuery(null));
    PosTransaction.find = jest.fn(() => mockQuery([]));
    PosTransaction.deleteOne = jest.fn(async () => {});
    Customer.findById = jest.fn(() => mockQuery(validCustomer));

    nextSequence.mockResolvedValue(4);
    consumeReservations.mockResolvedValue(undefined);
    cancelReservations.mockResolvedValue(undefined);
  });

  it("confirms a pending Cash order: creates the pos_booking + pos_transaction, marks the order confirmed, and consumes stock", async () => {
    const req = { params: { id: ORDER_ID }, body: {} };
    const res = mockRes();

    await confirmOrder(req, res);

    expect(PosBooking.create).toHaveBeenCalledWith(
      expect.objectContaining({ orderId: ORDER_ID, paymentStatus: "paid", bookingStatus: "confirmed", grandTotal: 175 })
    );
    expect(PosOrder.findByIdAndUpdate).toHaveBeenCalledWith(ORDER_ID, { orderStatus: "confirmed", bookingId: BOOKING_ID });
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it("is idempotent: re-confirming an already-confirmed order returns the existing booking (with amountPaid/balanceAmount correctly computed, not undefined) + its receipt without creating a new one", async () => {
    const existingBookingData = { _id: BOOKING_ID, bookingNumber: "BKG202608260004", bookingStatus: "confirmed", grandTotal: 175 };
    const existingBooking = { ...existingBookingData, toObject: () => existingBookingData };
    PosOrder.findOne = jest.fn(() => mockQuery(pendingOrder({ orderStatus: "confirmed", bookingId: BOOKING_ID })));
    PosBooking.findById = jest.fn(() => mockQuery(existingBooking));
    PosTransaction.find = jest.fn(() => mockQuery([{ receiptNo: RECEIPT_NO, amount: 100, paymentStatus: "paid" }]));

    const req = { params: { id: ORDER_ID }, body: {} };
    const res = mockRes();

    await confirmOrder(req, res);

    expect(PosBooking.create).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        data: expect.objectContaining({ ...existingBookingData, receiptNo: RECEIPT_NO, amountPaid: 100, balanceAmount: 75 }),
      })
    );
  });

  it("cancels and rejects an order whose 30-minute hold has expired", async () => {
    PosOrder.findOne = jest.fn(() => mockQuery(pendingOrder({ expiresAt: new Date(Date.now() - 1000) })));
    const req = { params: { id: ORDER_ID }, body: {} };
    const res = mockRes();

    await confirmOrder(req, res);

    expect(cancelReservations).toHaveBeenCalledWith(ORDER_ID);
    expect(PosOrder.findByIdAndUpdate).toHaveBeenCalledWith(ORDER_ID, { orderStatus: "cancelled" });
    expect(res.status).toHaveBeenCalledWith(400);
  });
});

describe("getOrderStatus (pos_orders)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("reports pending for an order still inside its 30-minute hold", async () => {
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000);
    PosOrder.findOne = jest.fn(() => mockQuery({ _id: ORDER_ID, orderStatus: "pending", expiresAt, bookingId: null }));
    const req = { params: { id: ORDER_ID } };
    const res = mockRes();

    await getOrderStatus(req, res);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: true, data: expect.objectContaining({ status: "pending", expiresAt }) })
    );
  });

  it("returns the booking details once the order is confirmed, with amountPaid/balanceAmount correctly computed — this is the exact response PaynowQrModal's poll reads to build its success message, so an undefined balanceAmount here silently breaks that flow", async () => {
    const bookingData = { _id: BOOKING_ID, bookingNumber: "BKG202608260004", bookingStatus: "confirmed", paymentStatus: "partial", grandTotal: 175 };
    const booking = { ...bookingData, toObject: () => bookingData };
    PosOrder.findOne = jest.fn(() =>
      mockQuery({ _id: ORDER_ID, orderNumber: "POS202608260009", referenceId: REFERENCE_ID, orderStatus: "confirmed", bookingId: BOOKING_ID })
    );
    PosBooking.findById = jest.fn(() => mockQuery(booking));
    PosTransaction.find = jest.fn(() => mockQuery([{ receiptNo: RECEIPT_NO, amount: 100, paymentStatus: "paid" }]));
    const req = { params: { id: ORDER_ID } };
    const res = mockRes();

    await getOrderStatus(req, res);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          ...bookingData,
          receiptNo: RECEIPT_NO,
          referenceId: REFERENCE_ID,
          status: "confirmed",
          amountPaid: 100,
          balanceAmount: 75,
        }),
      })
    );
  });
});

describe("recordBookingPayment (collect the rest, pos_bookings)", () => {
  function confirmedBooking(overrides = {}) {
    return {
      _id: BOOKING_ID,
      orderId: ORDER_ID,
      customer: CUSTOMER_ID,
      grandTotal: 175,
      paymentMode: PAYMENT_MODE_ID,
      paymentModeName: "Cash",
      paymentStatus: "partial",
      bookingStatus: "confirmed",
      save: jest.fn(async function save() {
        return this;
      }),
      ...overrides,
    };
  }

  beforeEach(() => {
    jest.clearAllMocks();

    PosBooking.findOne = jest.fn(() => mockQuery(confirmedBooking()));
    PosTransaction.find = jest.fn(() => mockQuery([{ amount: 100, paymentStatus: "paid" }]));
    PosTransaction.create = jest.fn(async (doc) => ({ _id: "888888888888888888888888", ...doc }));
    PaymentMode.findOne = jest.fn(() => mockQuery(validPaymentMode));

    nextSequence.mockResolvedValue(2);
  });

  it("records an installment that clears the balance and flips paymentStatus to 'paid'", async () => {
    const req = { params: { id: BOOKING_ID }, body: { amount: 75 }, auth: { userId: USER_ID } };
    const res = mockRes();

    await recordBookingPayment(req, res);

    expect(PosTransaction.create).toHaveBeenCalledWith(
      expect.objectContaining({ bookingId: BOOKING_ID, amount: 75, paymentStatus: "paid", paymentModeName: "Cash" })
    );
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ paymentStatus: "paid", amountPaid: 175, balanceAmount: 0 }) })
    );
  });

  it("rejects an amount greater than the outstanding balance", async () => {
    const req = { params: { id: BOOKING_ID }, body: { amount: 999 }, auth: { userId: USER_ID } };
    const res = mockRes();

    await recordBookingPayment(req, res);

    expect(PosTransaction.create).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });
});

describe("createPendingPayment (QR generated — fixes the amount, matches Cash's own paidAmount-at-checkout rule)", () => {
  function pendingOrder(overrides = {}) {
    return {
      _id: ORDER_ID,
      orderStatus: "pending",
      grandTotal: 175,
      customer: CUSTOMER_ID,
      paymentMode: PAYMENT_MODE_ID,
      paymentModeName: "PayNow",
      bookingId: null,
      ...overrides,
    };
  }

  beforeEach(() => {
    jest.clearAllMocks();
    PosOrder.findOne = jest.fn(() => mockQuery(pendingOrder()));
    PosTransaction.updateMany = jest.fn(async () => {});
    PosTransaction.create = jest.fn(async (doc) => ({ _id: "999999999999999999999999", ...doc }));
    nextSequence.mockResolvedValue(5);
  });

  it("creates a PENDING transaction fixed at the full outstanding balance when no amount is requested", async () => {
    const { transaction } = await createPendingPayment({ referenceId: REFERENCE_ID, amount: undefined, processedBy: USER_ID });

    expect(PosTransaction.create).toHaveBeenCalledWith(
      expect.objectContaining({ orderId: ORDER_ID, amount: 175, paymentStatus: "pending", expiresAt: expect.any(Date) })
    );
    expect(transaction.amount).toBe(175);
  });

  it("fixes the PENDING transaction at a genuinely partial requested amount", async () => {
    const { transaction } = await createPendingPayment({ referenceId: REFERENCE_ID, amount: 100, processedBy: USER_ID });

    expect(PosTransaction.create).toHaveBeenCalledWith(expect.objectContaining({ amount: 100 }));
    expect(transaction.amount).toBe(100);
  });

  it("rejects a requested amount greater than the outstanding balance", async () => {
    await expect(createPendingPayment({ referenceId: REFERENCE_ID, amount: 999 })).rejects.toMatch(/cannot exceed/);
    expect(PosTransaction.create).not.toHaveBeenCalled();
  });

  it("worst case #1 — cancels any earlier still-pending transaction for the same order before creating the new one", async () => {
    await createPendingPayment({ referenceId: REFERENCE_ID, amount: 100 });

    expect(PosTransaction.updateMany).toHaveBeenCalledWith(
      { orderId: ORDER_ID, paymentStatus: "pending" },
      { $set: { paymentStatus: "cancelled" } }
    );
  });

  it("rejects when the order is already fully paid", async () => {
    PosOrder.findOne = jest.fn(() =>
      mockQuery(pendingOrder({ orderStatus: "confirmed", bookingId: BOOKING_ID }))
    );
    PosBooking.findById = jest.fn(() => mockQuery({ _id: BOOKING_ID, grandTotal: 175 }));
    PosTransaction.find = jest.fn(() => mockQuery([{ amount: 175, paymentStatus: "paid" }]));

    await expect(createPendingPayment({ referenceId: REFERENCE_ID })).rejects.toMatch(/already fully paid/);
  });

  it("rejects an order that was cancelled", async () => {
    PosOrder.findOne = jest.fn(() => mockQuery(pendingOrder({ orderStatus: "cancelled" })));

    await expect(createPendingPayment({ referenceId: REFERENCE_ID })).rejects.toMatch(/cancelled/);
  });

  it("defaults the transaction's payment mode to the order's own when no override is given", async () => {
    PosOrder.findOne = jest.fn(() =>
      mockQuery(pendingOrder({ paymentMode: PAYMENT_MODE_ID, paymentModeName: "Cash" }))
    );

    await createPendingPayment({ referenceId: REFERENCE_ID, amount: 100 });

    expect(PosTransaction.create).toHaveBeenCalledWith(
      expect.objectContaining({ paymentMode: PAYMENT_MODE_ID, paymentModeName: "Cash" })
    );
  });

  it("worst case #2 — tags the transaction with the CALLER'S payment mode, not the order's original one, so a PayNow top-up on a Cash-booked order isn't mislabeled Cash", async () => {
    const PAYNOW_MODE_ID = "cccccccccccccccccccccccd";
    PosOrder.findOne = jest.fn(() =>
      mockQuery(pendingOrder({ paymentMode: PAYMENT_MODE_ID, paymentModeName: "Cash" }))
    );

    await createPendingPayment({
      referenceId: REFERENCE_ID,
      amount: 100,
      paymentMode: PAYNOW_MODE_ID,
      paymentModeName: "PayNow",
    });

    expect(PosTransaction.create).toHaveBeenCalledWith(
      expect.objectContaining({ paymentMode: PAYNOW_MODE_ID, paymentModeName: "PayNow" })
    );
  });
});

describe("initiateNetsPayment (the 'Phase 3' NETS initiate step — fixes the amount and creates a PENDING transaction, same as PayNow's buildPaynowQrForOrder minus the QR)", () => {
  function pendingOrder(overrides = {}) {
    return {
      _id: ORDER_ID,
      orderStatus: "pending",
      grandTotal: 175,
      customer: CUSTOMER_ID,
      paymentMode: PAYMENT_MODE_ID,
      paymentModeName: "NETS",
      bookingId: null,
      ...overrides,
    };
  }

  beforeEach(() => {
    jest.clearAllMocks();
    PosOrder.findOne = jest.fn(() => mockQuery(pendingOrder()));
    PaymentMode.findOne = jest.fn(() => mockQuery({ _id: PAYMENT_MODE_ID, name: "NETS" }));
    PosTransaction.updateMany = jest.fn(async () => {});
    PosTransaction.create = jest.fn(async (doc) => ({ _id: "999999999999999999999999", ...doc }));
    nextSequence.mockResolvedValue(5);
  });

  it("looks up the NETS payment mode and creates a PENDING transaction fixed at the full outstanding balance", async () => {
    const result = await initiateNetsPayment({ referenceId: REFERENCE_ID, amount: undefined, processedBy: USER_ID });

    expect(PaymentMode.findOne.mock.calls[0][0]).toEqual(expect.objectContaining({ name: "NETS", status: 1 }));
    expect(PosTransaction.create).toHaveBeenCalledWith(
      expect.objectContaining({ paymentMode: PAYMENT_MODE_ID, paymentModeName: "NETS", amount: 175, paymentStatus: "pending" })
    );
    // The returned referenceId is the pending transaction's OWN fresh
    // reference (see createPendingPayment's own comment) — never the order
    // referenceId this was called with, or a top-up sent to the terminal
    // would carry a reference it's already seen settle once.
    expect(result).toEqual({ referenceId: expect.stringMatching(/^POS/), amount: 175, currency: "SGD" });
    expect(result.referenceId).not.toBe(REFERENCE_ID);
  });

  it("fixes the transaction at a genuinely partial requested amount, matching what's returned", async () => {
    const result = await initiateNetsPayment({ referenceId: REFERENCE_ID, amount: 100, processedBy: USER_ID });

    expect(PosTransaction.create).toHaveBeenCalledWith(expect.objectContaining({ amount: 100 }));
    expect(result.amount).toBe(100);
  });

  it("rejects when NETS isn't configured as an available payment mode", async () => {
    PaymentMode.findOne = jest.fn(() => mockQuery(null));

    await expect(initiateNetsPayment({ referenceId: REFERENCE_ID })).rejects.toMatch(/not configured/);
    expect(PosTransaction.create).not.toHaveBeenCalled();
  });

  it("rejects a requested amount greater than the outstanding balance, same guard createPendingPayment already enforces", async () => {
    await expect(initiateNetsPayment({ referenceId: REFERENCE_ID, amount: 999 })).rejects.toMatch(/cannot exceed/);
  });
});

describe("confirmPosPayment (shared confirmation dispatcher entrypoint — confirms a PENDING transaction createPendingPayment already created)", () => {
  function pendingOrder(overrides = {}) {
    return {
      _id: ORDER_ID,
      orderNumber: "POS202608260009",
      referenceId: REFERENCE_ID,
      orderStatus: "pending",
      lines: [{ refType: "Service", refId: SERVICE_ID, name: "Special Darshan", code: "SV-016", quantity: 1, unitPrice: 175, lineTotal: 175, deities: [], devotees: [] }],
      subtotal: 175,
      gstAmount: 0,
      grandTotal: 175,
      paymentMode: PAYMENT_MODE_ID,
      paymentModeName: "PayNow",
      bookedBy: USER_ID,
      entity: null,
      bookingId: null,
      ...overrides,
    };
  }

  function pendingTxn(overrides = {}) {
    return {
      _id: "999999999999999999999999",
      orderId: ORDER_ID,
      bookingId: null,
      amount: 175,
      paymentStatus: "pending",
      paymentMode: PAYMENT_MODE_ID,
      paymentModeName: "PayNow",
      receiptNo: RECEIPT_NO,
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
      ...overrides,
    };
  }

  beforeEach(() => {
    jest.clearAllMocks();

    PosOrder.findOne = jest.fn(() => mockQuery(pendingOrder()));
    PosOrder.findByIdAndUpdate = jest.fn(async () => {});
    // confirmPosPayment now resolves the pending row with ONE lookup, by
    // its own unique referenceId (see the model's own comment) — no more
    // separate order lookup + gatewayReference dedup scan.
    PosTransaction.findOne = jest.fn(() => mockQuery(pendingTxn()));
    PosTransaction.findOneAndUpdate = jest.fn(async (filter, update) => ({ ...pendingTxn(), ...update.$set }));
    PosTransaction.findByIdAndUpdate = jest.fn(async () => {});
    PosBooking.create = jest.fn(async (doc) => ({ _id: BOOKING_ID, ...doc }));
    PosBooking.findById = jest.fn(() => mockQuery(null));
    PosBooking.deleteOne = jest.fn(async () => {});
    Customer.findById = jest.fn(() => mockQuery(validCustomer));

    nextSequence.mockResolvedValue(4);
    consumeReservations.mockResolvedValue(undefined);
    cancelReservations.mockResolvedValue(undefined);
  });

  it("claims the pending transaction atomically, then confirms the first payment for a still-pending order — writes the pos_booking, does NOT create a new transaction", async () => {
    const result = await confirmPosPayment(REFERENCE_ID, { gatewayReference: "DBS-TXN-REF-001", processedBy: USER_ID });

    expect(PosTransaction.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: "999999999999999999999999", paymentStatus: "pending" },
      { $set: { paymentStatus: "paid", gatewayReference: "DBS-TXN-REF-001", processedBy: USER_ID } },
      { new: true }
    );
    expect(PosBooking.create).toHaveBeenCalledWith(expect.objectContaining({ paymentStatus: "paid", bookingStatus: "confirmed", grandTotal: 175 }));
    expect(PosTransaction.findByIdAndUpdate).toHaveBeenCalledWith("999999999999999999999999", { bookingId: BOOKING_ID });
    expect(result.alreadyProcessed).toBe(false);
    expect(result.amountPaid).toBe(175);
  });

  it("stores manualConfirmationDetails on the transaction when the caller is a manual (not gateway/terminal) confirmation — this is the flag that distinguishes the two", async () => {
    const details = { transactionRefNo: "123456789012", confirmedBy: USER_ID, confirmedAt: expect.any(Date) };
    await confirmPosPayment(REFERENCE_ID, {
      gatewayReference: "123456789012",
      processedBy: USER_ID,
      manualConfirmationDetails: details,
    });

    expect(PosTransaction.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: "999999999999999999999999", paymentStatus: "pending" },
      {
        $set: {
          paymentStatus: "paid",
          gatewayReference: "123456789012",
          processedBy: USER_ID,
          manualConfirmationDetails: details,
        },
      },
      { new: true }
    );
  });

  it("leaves manualConfirmationDetails off the $set entirely for a real gateway/terminal confirmation — stays null on the schema's own default, not overwritten with an explicit null", async () => {
    await confirmPosPayment(REFERENCE_ID, { gatewayReference: "TERMINAL-APPROVAL-CODE", processedBy: USER_ID });

    const [, update] = PosTransaction.findOneAndUpdate.mock.calls[0];
    expect(update.$set).not.toHaveProperty("manualConfirmationDetails");
  });

  it("stores terminalConfirmationDetails on the transaction when the caller is a genuine NETS/Credit Card terminal callback (controllers/payments/nets/callback)", async () => {
    const terminalDetails = { terminalId: "TERM-01", approvalCode: "APPROVAL123", response: { cardType: "VISA" }, confirmedAt: expect.any(Date) };
    await confirmPosPayment(REFERENCE_ID, {
      gatewayReference: "APPROVAL123",
      terminalConfirmationDetails: terminalDetails,
    });

    expect(PosTransaction.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: "999999999999999999999999", paymentStatus: "pending" },
      {
        $set: {
          paymentStatus: "paid",
          gatewayReference: "APPROVAL123",
          processedBy: null,
          terminalConfirmationDetails: terminalDetails,
        },
      },
      { new: true }
    );
  });

  it("leaves terminalConfirmationDetails off the $set entirely for a manual admin/cashier confirmation — the two audit trails are mutually exclusive", async () => {
    await confirmPosPayment(REFERENCE_ID, {
      gatewayReference: "123456789012",
      manualConfirmationDetails: { transactionRefNo: "123456789012" },
    });

    const [, update] = PosTransaction.findOneAndUpdate.mock.calls[0];
    expect(update.$set).not.toHaveProperty("terminalConfirmationDetails");
    expect(update.$set).toHaveProperty("manualConfirmationDetails");
  });

  it("manualConfirmTerminalPayment (POST /pos/booking/manual-confirm) validates the body, routes through the shared dispatcher, and tags the transaction as manually confirmed", async () => {
    const req = {
      body: { referenceId: REFERENCE_ID, transactionRefNo: "  123456789012  " },
      auth: { userId: USER_ID },
    };
    const res = mockRes();

    await manualConfirmTerminalPayment(req, res);

    expect(PosTransaction.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: "999999999999999999999999", paymentStatus: "pending" },
      {
        $set: {
          paymentStatus: "paid",
          gatewayReference: "123456789012",
          processedBy: USER_ID,
          manualConfirmationDetails: {
            transactionRefNo: "123456789012",
            confirmedBy: USER_ID,
            confirmedAt: expect.any(Date),
          },
        },
      },
      { new: true }
    );
    expect(res.status).not.toHaveBeenCalledWith(400);
  });

  it("manualConfirmTerminalPayment rejects a missing transactionRefNo with a 400 before ever touching the dispatcher", async () => {
    const req = { body: { referenceId: REFERENCE_ID }, auth: { userId: USER_ID } };
    const res = mockRes();

    await manualConfirmTerminalPayment(req, res);

    expect(PosTransaction.findOneAndUpdate).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("rejects a confirmation amount that doesn't match the pending transaction's own fixed amount — the amount cannot be changed at confirm time", async () => {
    await expect(confirmPosPayment(REFERENCE_ID, { amount: 999, gatewayReference: "DBS-TXN-REF-001" })).rejects.toMatch(
      /does not match the expected amount/
    );
    expect(PosTransaction.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it("accepts a confirmation amount that DOES match the pending transaction's fixed amount (e.g. a real gateway echoing it back)", async () => {
    const result = await confirmPosPayment(REFERENCE_ID, { amount: 175, gatewayReference: "DBS-TXN-REF-001" });
    expect(result.alreadyProcessed).toBe(false);
  });

  it("is idempotent: a duplicate callback for a referenceId that's already paid is a no-op, without touching the row again", async () => {
    // referenceId is unique PER ATTEMPT now — the same lookup that finds
    // the pending row also finds it once it's already been paid, so a
    // duplicate callback resolves to the same document, just already settled.
    PosTransaction.findOne = jest.fn(() => mockQuery(pendingTxn({ paymentStatus: "paid" })));

    const result = await confirmPosPayment(REFERENCE_ID, { gatewayReference: "DBS-TXN-REF-001" });

    expect(PosTransaction.findOneAndUpdate).not.toHaveBeenCalled();
    expect(PosBooking.create).not.toHaveBeenCalled();
    expect(result.alreadyProcessed).toBe(true);
  });

  it("worst case #2 — a race where something else claims the pending row first (findOneAndUpdate matches nothing) is reported alreadyProcessed instead of double-confirming", async () => {
    PosTransaction.findOneAndUpdate = jest.fn(async () => null);

    const result = await confirmPosPayment(REFERENCE_ID, { gatewayReference: "DBS-TXN-REF-001" });

    expect(PosBooking.create).not.toHaveBeenCalled();
    expect(result.alreadyProcessed).toBe(true);
  });

  it("marks an expired pending transaction expired and refuses to confirm it", async () => {
    PosTransaction.findOne = jest.fn(() => mockQuery(pendingTxn({ expiresAt: new Date(Date.now() - 1000) })));

    await expect(confirmPosPayment(REFERENCE_ID, { gatewayReference: "DBS-TXN-REF-001" })).rejects.toMatch(/expired/);

    expect(PosTransaction.findByIdAndUpdate).toHaveBeenCalledWith("999999999999999999999999", { paymentStatus: "expired" });
    expect(PosTransaction.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it("rejects when no transaction matches this reference at all", async () => {
    PosTransaction.findOne = jest.fn(() => mockQuery(null));

    await expect(confirmPosPayment(REFERENCE_ID, { gatewayReference: "DBS-TXN-REF-001" })).rejects.toMatch(/No payment found/);
  });

  it("treats a payment against an already-confirmed order as a balance top-up, recomputing paymentStatus from all paid transactions instead of creating a second booking", async () => {
    PosOrder.findOne = jest.fn(() => mockQuery(pendingOrder({ orderStatus: "confirmed", bookingId: BOOKING_ID })));
    PosTransaction.findOne = jest.fn(() => mockQuery(pendingTxn({ bookingId: BOOKING_ID, amount: 75 })));
    PosTransaction.findOneAndUpdate = jest.fn(async () => pendingTxn({ bookingId: BOOKING_ID, amount: 75, paymentStatus: "paid" }));
    PosBooking.findById = jest.fn(() =>
      mockQuery({
        _id: BOOKING_ID,
        grandTotal: 175,
        paymentStatus: "partial",
        save: jest.fn(async function save() {
          return this;
        }),
      })
    );
    PosTransaction.find = jest.fn(() => mockQuery([{ amount: 100, paymentStatus: "paid" }, { amount: 75, paymentStatus: "paid" }]));

    const result = await confirmPosPayment(REFERENCE_ID, { gatewayReference: "DBS-TXN-REF-002" });

    expect(PosBooking.create).not.toHaveBeenCalled();
    expect(result.amountPaid).toBe(175);
    expect(result.balanceAmount).toBe(0);
  });

  it("rejects a reference id that doesn't match any pos_order", async () => {
    PosOrder.findOne = jest.fn(() => mockQuery(null));

    await expect(confirmPosPayment("POS9999999999", {})).rejects.toMatch(/No POS order found/);
  });
});

describe("writePosBookingOnly (books the fixed amount an already-paid PENDING transaction carries)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    PosBooking.create = jest.fn(async (doc) => ({ _id: BOOKING_ID, ...doc }));
    PosTransaction.findByIdAndUpdate = jest.fn(async () => {});
    PosOrder.findByIdAndUpdate = jest.fn(async () => {});
    nextSequence.mockResolvedValue(4);
    consumeReservations.mockResolvedValue(undefined);
  });

  it("creates the booking, backfills bookingId onto the transaction, and marks the order confirmed", async () => {
    const order = {
      _id: ORDER_ID,
      grandTotal: 175,
      lines: [],
      subtotal: 175,
      gstAmount: 0,
      customer: CUSTOMER_ID,
      bookedBy: USER_ID,
      entity: null,
    };
    const transaction = { _id: "999999999999999999999999", paymentMode: PAYMENT_MODE_ID, paymentModeName: "PayNow" };

    const booking = await writePosBookingOnly(order, 175, transaction);

    expect(PosBooking.create).toHaveBeenCalledWith(
      expect.objectContaining({ orderId: ORDER_ID, paymentStatus: "paid", bookingStatus: "confirmed", paymentModeName: "PayNow" })
    );
    expect(PosTransaction.findByIdAndUpdate).toHaveBeenCalledWith("999999999999999999999999", { bookingId: BOOKING_ID });
    expect(PosOrder.findByIdAndUpdate).toHaveBeenCalledWith(ORDER_ID, { orderStatus: "confirmed", bookingId: BOOKING_ID });
    expect(booking._id).toBe(BOOKING_ID);
  });
});

describe("listBookings (POS Transactions list) — payment-mode display for partial, multi-mode bookings", () => {
  it("returns every distinct PAID mode a booking's installments landed on, oldest first, deduped — not just the booking's own first-payment mode", async () => {
    const booking = {
      _id: BOOKING_ID,
      bookingNumber: "BK202609100001",
      orderId: { orderNumber: "POS202609100001", referenceId: REFERENCE_ID },
      customer: { _id: CUSTOMER_ID, customerCode: "CUS001", name: "Test Customer" },
      lines: [{ refType: "Service" }],
      subtotal: 200,
      gstAmount: 0,
      grandTotal: 200,
      paymentModeName: "CASH",
      paymentStatus: "paid",
      bookingStatus: "confirmed",
      bookedAt: new Date("2026-09-10"),
    };
    PosBooking.find = jest.fn(() => mockQuery([booking]));
    PosBooking.countDocuments = jest.fn(async () => 1);
    PosTransaction.find = jest.fn(() =>
      mockQuery([
        {
          bookingId: BOOKING_ID,
          receiptNo: "RCP-20260910-0001",
          amount: 100,
          paymentStatus: "paid",
          paymentModeName: "CASH",
          transactionDate: new Date("2026-09-10T10:00:00Z"),
        },
        // A cancelled pending attempt on a third mode must NOT show up —
        // only "paid" installments actually landed money.
        {
          bookingId: BOOKING_ID,
          receiptNo: "RCP-20260910-0002",
          amount: 100,
          paymentStatus: "cancelled",
          paymentModeName: "CREDIT CARD",
          transactionDate: new Date("2026-09-10T10:05:00Z"),
        },
        {
          bookingId: BOOKING_ID,
          receiptNo: "RCP-20260910-0003",
          amount: 100,
          paymentStatus: "paid",
          paymentModeName: "PAYNOW",
          transactionDate: new Date("2026-09-10T10:10:00Z"),
        },
      ])
    );

    const res = mockRes();
    await listBookings({ query: {} }, res);

    const item = res.json.mock.calls[0][0].data.items[0];
    expect(item.paymentModeNames).toEqual(["CASH", "PAYNOW"]);
    // The booking's own single-mode field is left untouched for whatever
    // else still reads it (e.g. the detail drawer).
    expect(item.paymentModeName).toBe("CASH");
    expect(item.amountPaid).toBe(200);
  });

  it("falls back to the booking's own paymentModeName when it has no paid transactions at all (shouldn't happen in practice, but never render an empty list)", async () => {
    const booking = {
      _id: BOOKING_ID,
      bookingNumber: "BK202609100002",
      orderId: { orderNumber: "POS202609100002", referenceId: REFERENCE_ID },
      customer: null,
      lines: [],
      subtotal: 0,
      gstAmount: 0,
      grandTotal: 0,
      paymentModeName: "CASH",
      paymentStatus: "pending",
      bookingStatus: "confirmed",
      bookedAt: new Date("2026-09-10"),
    };
    PosBooking.find = jest.fn(() => mockQuery([booking]));
    PosBooking.countDocuments = jest.fn(async () => 1);
    PosTransaction.find = jest.fn(() => mockQuery([]));

    const res = mockRes();
    await listBookings({ query: {} }, res);

    const item = res.json.mock.calls[0][0].data.items[0];
    expect(item.paymentModeNames).toEqual(["CASH"]);
  });
});
