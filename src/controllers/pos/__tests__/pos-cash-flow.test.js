/**
 * Unit tests for the Cash payment flow: createOrder (POST /pos/booking/orders)
 * now decides confirmation itself from the resolved payment mode — Cash
 * writes the Booking/Transaction and consumes reservations in the same
 * request, never waiting on a second client-triggered call. confirmOrder
 * (POST /pos/booking/orders/:id/confirm) and getOrderStatus
 * (GET /pos/booking/orders/:id/status) are still exercised directly here
 * too: confirmOrder as the idempotent re-confirm / future gateway-webhook
 * target, getOrderStatus as the read-only endpoint the frontend polls
 * after createOrder instead of asserting success itself.
 *
 * No real database — Mongoose models are stubbed directly (their static
 * methods are plain properties on a shared singleton object, so reassigning
 * them here is visible to controllers/pos/index.js too). The two DB-adjacent
 * modules that are destructured into local function bindings at require-time
 * (inventory-reservation, sequence) are jest.mock()'d instead, since a
 * post-hoc reassignment on those wouldn't reach a binding already captured
 * by destructuring.
 */

jest.mock("../inventory-reservation");
jest.mock("../../../common/utils/sequence");

const Item = require("../../../models/items");
const Service = require("../../../models/services");
const { Customer } = require("../../../models/customers");
const PaymentMode = require("../../../models/payment-modes");
const { Order } = require("../../../models/orders");
const { Booking } = require("../../../models/bookings");
const { Transaction } = require("../../../models/transactions");
const { placeReservationsForOrder, consumeReservations, cancelReservations } = require("../inventory-reservation");
const { nextSequence } = require("../../../common/utils/sequence");
const { createOrder, confirmOrder, getOrderStatus, effectiveQuantity, recordBookingPayment } = require("../index");

const RECEIPT_NO = "RCP-20260826-0001";

const CUSTOMER_ID = "aaaaaaaaaaaaaaaaaaaaaaaa";
const PAYMENT_MODE_ID = "bbbbbbbbbbbbbbbbbbbbbbbb";
const SERVICE_ID = "cccccccccccccccccccccccc";
const ITEM_ID = "dddddddddddddddddddddddd";
const ORDER_ID = "eeeeeeeeeeeeeeeeeeeeeeee";
const BOOKING_ID = "ffffffffffffffffffffffff";
const USER_ID = "111111111111111111111111";

/** Mimics a Mongoose query builder: any chained call (.select/.populate)
 *  returns another instance of itself, and it's awaitable on its own too —
 *  covers both `Model.findOne(...)` (awaited directly) and
 *  `Model.findOne(...).select(...)` (chained then awaited). */
function mockQuery(result) {
  return {
    select: jest.fn(() => mockQuery(result)),
    populate: jest.fn(() => mockQuery(result)),
    then: (resolve, reject) => Promise.resolve(result).then(resolve, reject),
    catch: (reject) => Promise.resolve(result).catch(reject),
  };
}

function mockRes() {
  return { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
}

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

describe("effectiveQuantity", () => {
  it("uses the number of selected deities when deities are present", () => {
    expect(effectiveQuantity({ deities: ["a", "b", "c"], quantity: 1 })).toBe(3);
  });

  it("falls back to the typed quantity when no deities are selected", () => {
    expect(effectiveQuantity({ deities: [], quantity: 4 })).toBe(4);
  });
});

describe("createOrder (Cash flow)", () => {
  beforeEach(() => {
    jest.clearAllMocks();

    Customer.findOne = jest.fn(() => mockQuery(validCustomer));
    PaymentMode.findOne = jest.fn(() => mockQuery(validPaymentMode));
    Service.findOne = jest.fn(() => mockQuery(validService));
    Item.findOne = jest.fn(() => mockQuery(null));
    Order.create = jest.fn(async (doc) => ({ _id: ORDER_ID, ...doc }));
    Order.findByIdAndUpdate = jest.fn(async () => {});
    // Cash now confirms in the very same request — these back the
    // writeBookingFromOrder() call createOrder makes once it sees "Cash".
    Booking.create = jest.fn(async (doc) => ({ _id: BOOKING_ID, ...doc }));
    Transaction.create = jest.fn(async (doc) => ({ _id: "999999999999999999999999", ...doc }));

    nextSequence.mockResolvedValue(1);
    placeReservationsForOrder.mockResolvedValue([]);
    consumeReservations.mockResolvedValue(undefined);
  });

  it("creates a Cash order and confirms it in the same request: writes the booking, consumes reservations, returns a confirmed booking", async () => {
    const req = { body: baseOrderBody(), auth: { userId: USER_ID, entityId: null } };
    const res = mockRes();

    await createOrder(req, res);

    expect(Order.create).toHaveBeenCalledWith(
      expect.objectContaining({
        orderStatus: "pending",
        subtotal: 175,
        grandTotal: 175,
        paymentModeName: "Cash",
        lines: [expect.objectContaining({ refType: "Service", refId: SERVICE_ID, quantity: 1, unitPrice: 175, lineTotal: 175 })],
      })
    );
    expect(placeReservationsForOrder).toHaveBeenCalledWith(expect.any(Array), ORDER_ID);
    expect(Booking.create).toHaveBeenCalledWith(
      expect.objectContaining({ orderId: ORDER_ID, paymentStatus: "paid", bookingStatus: "confirmed", grandTotal: 175 })
    );
    expect(Transaction.create).toHaveBeenCalledWith(
      expect.objectContaining({ bookingId: BOOKING_ID, orderId: ORDER_ID, amount: 175, paymentStatus: "paid" })
    );
    expect(Order.findByIdAndUpdate).toHaveBeenCalledWith(ORDER_ID, { orderStatus: "confirmed", bookingId: BOOKING_ID });
    expect(consumeReservations).toHaveBeenCalledWith(ORDER_ID, expect.any(Array), USER_ID, expect.any(String));
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        data: expect.objectContaining({ status: "confirmed", bookingStatus: "confirmed", grandTotal: 175, receiptNo: expect.any(String) }),
      })
    );
  });

  it("leaves a non-Cash order pending instead of confirming it, and never writes a booking", async () => {
    PaymentMode.findOne = jest.fn(() => mockQuery({ _id: PAYMENT_MODE_ID, name: "PayNow" }));
    const req = { body: baseOrderBody(), auth: { userId: USER_ID, entityId: null } };
    const res = mockRes();

    await createOrder(req, res);

    expect(Booking.create).not.toHaveBeenCalled();
    expect(consumeReservations).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        data: expect.objectContaining({ orderNumber: expect.any(String), orderStatus: "pending", status: "pending", grandTotal: 175 }),
      })
    );
  });

  it("prices a deity-mapped line by deity count, not the typed quantity", async () => {
    const req = {
      body: baseOrderBody({
        lines: [{ refType: "Service", refId: SERVICE_ID, quantity: 1, deities: ["111111111111111111111111", "222222222222222222222222"], devotees: [] }],
      }),
      auth: { userId: USER_ID },
    };
    const res = mockRes();

    await createOrder(req, res);

    expect(Order.create).toHaveBeenCalledWith(
      expect.objectContaining({
        subtotal: 350, // 175 * 2 deities, not 175 * 1 quantity
        lines: [expect.objectContaining({ quantity: 2, lineTotal: 350 })],
      })
    );
  });

  it("rejects when the customer is not found or inactive", async () => {
    Customer.findOne = jest.fn(() => mockQuery(null));
    const req = { body: baseOrderBody(), auth: {} };
    const res = mockRes();

    await createOrder(req, res);

    expect(Order.create).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: false, message: "Customer not found or inactive." }));
  });

  it("rejects when the payment mode is not found or inactive", async () => {
    PaymentMode.findOne = jest.fn(() => mockQuery(null));
    const req = { body: baseOrderBody(), auth: {} };
    const res = mockRes();

    await createOrder(req, res);

    expect(Order.create).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: "Payment mode not found or inactive." }));
  });

  it("rejects when a line's item/service is no longer available", async () => {
    Service.findOne = jest.fn(() => mockQuery(null));
    const req = { body: baseOrderBody(), auth: {} };
    const res = mockRes();

    await createOrder(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: "A service in the cart is no longer available." }));
  });

  it("rolls back the order when inventory reservation fails", async () => {
    placeReservationsForOrder.mockRejectedValue("Insufficient stock for \"Special Darshan\": only 0 unit(s) available for booking.");
    const req = { body: baseOrderBody(), auth: {} };
    const res = mockRes();

    await createOrder(req, res);

    expect(Order.findByIdAndUpdate).toHaveBeenCalledWith(ORDER_ID, { orderStatus: "cancelled" });
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining("Insufficient stock") }));
  });
});

describe("createOrder (partial payment)", () => {
  beforeEach(() => {
    jest.clearAllMocks();

    Customer.findOne = jest.fn(() => mockQuery(validCustomer));
    PaymentMode.findOne = jest.fn(() => mockQuery(validPaymentMode));
    Service.findOne = jest.fn(() => mockQuery(validService));
    Item.findOne = jest.fn(() => mockQuery(null));
    Order.create = jest.fn(async (doc) => ({ _id: ORDER_ID, ...doc }));
    Order.findByIdAndUpdate = jest.fn(async () => {});
    Booking.create = jest.fn(async (doc) => ({ _id: BOOKING_ID, ...doc }));
    Transaction.create = jest.fn(async (doc) => ({ _id: "999999999999999999999999", ...doc }));

    nextSequence.mockResolvedValue(1);
    placeReservationsForOrder.mockResolvedValue([]);
    consumeReservations.mockResolvedValue(undefined);
  });

  it("confirms with paymentStatus 'partial' when paidAmount is less than the priced grandTotal", async () => {
    const req = { body: baseOrderBody({ paidAmount: 100 }), auth: { userId: USER_ID, entityId: null } };
    const res = mockRes();

    await createOrder(req, res);

    expect(Booking.create).toHaveBeenCalledWith(
      expect.objectContaining({ paymentStatus: "partial", bookingStatus: "confirmed", grandTotal: 175 })
    );
    expect(Transaction.create).toHaveBeenCalledWith(expect.objectContaining({ amount: 100, paymentStatus: "paid" }));
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ paymentStatus: "partial", amountPaid: 100, balanceAmount: 75 }),
      })
    );
  });

  it("confirms with paymentStatus 'pending' and writes no Transaction when paidAmount is 0 (pay later)", async () => {
    const req = { body: baseOrderBody({ paidAmount: 0 }), auth: { userId: USER_ID, entityId: null } };
    const res = mockRes();

    await createOrder(req, res);

    expect(Booking.create).toHaveBeenCalledWith(expect.objectContaining({ paymentStatus: "pending" }));
    expect(Transaction.create).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ paymentStatus: "pending", amountPaid: 0, balanceAmount: 175, receiptNo: null }) })
    );
  });

  it("rejects a paidAmount greater than the priced grandTotal, before ever writing the order", async () => {
    const req = { body: baseOrderBody({ paidAmount: 200 }), auth: { userId: USER_ID, entityId: null } };
    const res = mockRes();

    await createOrder(req, res);

    expect(Order.create).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining("cannot exceed") }));
  });
});

describe("confirmOrder (Cash flow)", () => {
  function pendingOrder(overrides = {}) {
    return {
      _id: ORDER_ID,
      orderNumber: "POS202608260009",
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

    Order.findOne = jest.fn(() => mockQuery(pendingOrder()));
    Order.findByIdAndUpdate = jest.fn(async () => {});
    Booking.create = jest.fn(async (doc) => ({ _id: BOOKING_ID, ...doc }));
    Booking.findById = jest.fn(() => mockQuery(null));
    Booking.deleteOne = jest.fn(async () => {});
    Transaction.create = jest.fn(async (doc) => ({ _id: "999999999999999999999999", ...doc }));
    Transaction.findOne = jest.fn(() => mockQuery(null));
    Transaction.deleteOne = jest.fn(async () => {});
    Customer.findById = jest.fn(() => mockQuery(validCustomer));

    nextSequence.mockResolvedValue(4);
    consumeReservations.mockResolvedValue(undefined);
    cancelReservations.mockResolvedValue(undefined);
  });

  it("confirms a pending Cash order: creates the booking + transaction (plain sequential writes, no DB transaction), marks the order confirmed, and consumes stock", async () => {
    const req = { params: { id: ORDER_ID }, body: {} };
    const res = mockRes();

    await confirmOrder(req, res);

    expect(Booking.create).toHaveBeenCalledWith(
      expect.objectContaining({ orderId: ORDER_ID, paymentStatus: "paid", bookingStatus: "confirmed", grandTotal: 175 })
    );
    expect(Transaction.create).toHaveBeenCalledWith(
      expect.objectContaining({ bookingId: BOOKING_ID, orderId: ORDER_ID, amount: 175, paymentStatus: "paid" })
    );
    expect(Order.findByIdAndUpdate).toHaveBeenCalledWith(ORDER_ID, { orderStatus: "confirmed", bookingId: BOOKING_ID });
    expect(consumeReservations).toHaveBeenCalledWith(ORDER_ID, expect.any(Array), USER_ID, expect.any(String));
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        data: expect.objectContaining({ bookingStatus: "confirmed", paymentStatus: "paid", grandTotal: 175, receiptNo: expect.any(String) }),
      })
    );
  });

  it("cleans up the Booking if the Transaction write fails partway through, and leaves the order retryable", async () => {
    Transaction.create = jest.fn(async () => {
      throw new Error("simulated write failure");
    });
    const req = { params: { id: ORDER_ID }, body: {} };
    const res = mockRes();

    await confirmOrder(req, res);

    expect(Booking.create).toHaveBeenCalled();
    expect(Booking.deleteOne).toHaveBeenCalledWith({ _id: BOOKING_ID });
    // Order was never touched — it's still "pending" in the DB, so a retry
    // of confirmOrder can run the whole sequence again cleanly.
    expect(Order.findByIdAndUpdate).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(500);
  });

  it("is idempotent: re-confirming an already-confirmed order returns the existing booking + its receipt without creating a new one", async () => {
    const existingBookingData = { _id: BOOKING_ID, bookingNumber: "BKG202608260004", bookingStatus: "confirmed" };
    const existingBooking = { ...existingBookingData, toObject: () => existingBookingData };
    Order.findOne = jest.fn(() => mockQuery(pendingOrder({ orderStatus: "confirmed", bookingId: BOOKING_ID })));
    Booking.findById = jest.fn(() => mockQuery(existingBooking));
    Transaction.findOne = jest.fn(() => mockQuery({ receiptNo: RECEIPT_NO }));

    const req = { params: { id: ORDER_ID }, body: {} };
    const res = mockRes();

    await confirmOrder(req, res);

    expect(Booking.create).not.toHaveBeenCalled();
    expect(Transaction.create).not.toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: true, data: expect.objectContaining({ ...existingBookingData, receiptNo: RECEIPT_NO }) })
    );
  });

  it("rejects confirming a cancelled order", async () => {
    Order.findOne = jest.fn(() => mockQuery(pendingOrder({ orderStatus: "cancelled" })));
    const req = { params: { id: ORDER_ID }, body: {} };
    const res = mockRes();

    await confirmOrder(req, res);

    expect(Booking.create).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining("cancelled") }));
  });

  it("cancels and rejects an order whose 30-minute hold has expired", async () => {
    Order.findOne = jest.fn(() => mockQuery(pendingOrder({ expiresAt: new Date(Date.now() - 1000) })));
    const req = { params: { id: ORDER_ID }, body: {} };
    const res = mockRes();

    await confirmOrder(req, res);

    expect(cancelReservations).toHaveBeenCalledWith(ORDER_ID);
    expect(Order.findByIdAndUpdate).toHaveBeenCalledWith(ORDER_ID, { orderStatus: "cancelled" });
    expect(Booking.create).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining("expired") }));
  });

  it("rejects a malformed order id without touching the database", async () => {
    const req = { params: { id: "not-a-valid-id" }, body: {} };
    const res = mockRes();

    await confirmOrder(req, res);

    expect(Order.findOne).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: "Invalid order ID." }));
  });
});

describe("getOrderStatus", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("reports pending for an order still inside its 30-minute hold", async () => {
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000);
    Order.findOne = jest.fn(() => mockQuery({ _id: ORDER_ID, orderStatus: "pending", expiresAt, bookingId: null }));
    const req = { params: { id: ORDER_ID } };
    const res = mockRes();

    await getOrderStatus(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: true, data: expect.objectContaining({ status: "pending", expiresAt }) })
    );
  });

  it("reports expired, without mutating anything, once the hold has lapsed", async () => {
    Order.findOne = jest.fn(() => mockQuery({ _id: ORDER_ID, orderStatus: "pending", expiresAt: new Date(Date.now() - 1000), bookingId: null }));
    const req = { params: { id: ORDER_ID } };
    const res = mockRes();

    await getOrderStatus(req, res);

    expect(Order.findByIdAndUpdate).not.toHaveBeenCalled();
    expect(cancelReservations).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "expired" }) }));
  });

  it("reports cancelled for a cancelled order", async () => {
    Order.findOne = jest.fn(() => mockQuery({ _id: ORDER_ID, orderStatus: "cancelled", bookingId: null }));
    const req = { params: { id: ORDER_ID } };
    const res = mockRes();

    await getOrderStatus(req, res);

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ data: { status: "cancelled" } }));
  });

  it("returns the booking details once the order is confirmed", async () => {
    const bookingData = { _id: BOOKING_ID, bookingNumber: "BKG202608260004", bookingStatus: "confirmed", grandTotal: 175 };
    const booking = { ...bookingData, toObject: () => bookingData };
    Order.findOne = jest.fn(() => mockQuery({ _id: ORDER_ID, orderNumber: "POS202608260009", orderStatus: "confirmed", bookingId: BOOKING_ID }));
    Booking.findById = jest.fn(() => mockQuery(booking));
    Transaction.findOne = jest.fn(() => mockQuery({ receiptNo: RECEIPT_NO }));
    const req = { params: { id: ORDER_ID } };
    const res = mockRes();

    await getOrderStatus(req, res);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ ...bookingData, receiptNo: RECEIPT_NO, orderNumber: "POS202608260009", status: "confirmed" }),
      })
    );
  });

  it("rejects a malformed order id without touching the database", async () => {
    const req = { params: { id: "not-a-valid-id" } };
    const res = mockRes();

    await getOrderStatus(req, res);

    expect(Order.findOne).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("rejects when the order doesn't exist", async () => {
    Order.findOne = jest.fn(() => mockQuery(null));
    const req = { params: { id: ORDER_ID } };
    const res = mockRes();

    await getOrderStatus(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: "Order not found." }));
  });
});

describe("recordBookingPayment (collect the rest of a partial payment)", () => {
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
      portal: "admin",
      save: jest.fn(async function save() {
        return this;
      }),
      ...overrides,
    };
  }

  beforeEach(() => {
    jest.clearAllMocks();

    Booking.findOne = jest.fn(() => mockQuery(confirmedBooking()));
    Transaction.find = jest.fn(() => mockQuery([{ amount: 100, paymentStatus: "paid" }]));
    Transaction.create = jest.fn(async (doc) => ({ _id: "888888888888888888888888", ...doc }));
    PaymentMode.findOne = jest.fn(() => mockQuery(validPaymentMode));

    nextSequence.mockResolvedValue(2);
  });

  it("records an installment that clears the balance and flips paymentStatus to 'paid'", async () => {
    const req = { params: { id: BOOKING_ID }, body: { amount: 75 }, auth: { userId: USER_ID } };
    const res = mockRes();

    await recordBookingPayment(req, res);

    expect(Transaction.create).toHaveBeenCalledWith(
      expect.objectContaining({ bookingId: BOOKING_ID, amount: 75, paymentStatus: "paid", paymentModeName: "Cash" })
    );
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ paymentStatus: "paid", amountPaid: 175, balanceAmount: 0 }) })
    );
  });

  it("records a partial installment that leaves the booking still 'partial'", async () => {
    const req = { params: { id: BOOKING_ID }, body: { amount: 25 }, auth: { userId: USER_ID } };
    const res = mockRes();

    await recordBookingPayment(req, res);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ paymentStatus: "partial", amountPaid: 125, balanceAmount: 50 }) })
    );
  });

  it("rejects an amount greater than the outstanding balance", async () => {
    const req = { params: { id: BOOKING_ID }, body: { amount: 999 }, auth: { userId: USER_ID } };
    const res = mockRes();

    await recordBookingPayment(req, res);

    expect(Transaction.create).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining("outstanding balance") }));
  });

  it("rejects paying a booking that's already fully paid", async () => {
    Booking.findOne = jest.fn(() => mockQuery(confirmedBooking({ paymentStatus: "paid" })));
    Transaction.find = jest.fn(() => mockQuery([{ amount: 175, paymentStatus: "paid" }]));
    const req = { params: { id: BOOKING_ID }, body: { amount: 10 }, auth: { userId: USER_ID } };
    const res = mockRes();

    await recordBookingPayment(req, res);

    expect(Transaction.create).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining("already fully paid") }));
  });

  it("rejects payments against a cancelled booking", async () => {
    Booking.findOne = jest.fn(() => mockQuery(confirmedBooking({ bookingStatus: "cancelled" })));
    const req = { params: { id: BOOKING_ID }, body: { amount: 10 }, auth: { userId: USER_ID } };
    const res = mockRes();

    await recordBookingPayment(req, res);

    expect(Transaction.create).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("collects an installment via a different payment mode than the booking's original one", async () => {
    PaymentMode.findOne = jest.fn(() => mockQuery({ _id: "cccccccccccccccccccccccd", name: "PayNow" }));
    const req = {
      params: { id: BOOKING_ID },
      body: { amount: 75, paymentModeId: "cccccccccccccccccccccccd" },
      auth: { userId: USER_ID },
    };
    const res = mockRes();

    await recordBookingPayment(req, res);

    expect(Transaction.create).toHaveBeenCalledWith(expect.objectContaining({ paymentModeName: "PayNow" }));
  });
});
