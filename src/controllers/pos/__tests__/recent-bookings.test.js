/**
 * GET /pos/booking/customers/:id/recent-bookings — regression coverage for
 * the fix that made this read BOTH models/bookings (legacy, still written
 * by Admin Booking) and models/pos-bookings (pos_bookings, written by the
 * POS Portal since its writes moved off the shared collections). Querying
 * only the legacy collection (the bug) meant a customer whose history was
 * entirely POS Portal bookings — most visibly a staff member's own linked
 * "self" customer — got back zero rows and so saw no devotee-suggestion
 * chips at all, while a customer with legacy history looked fine.
 */

const { Booking } = require("../../../models/bookings");
const { PosBooking } = require("../../../models/pos-bookings");
const { getRecentBookings } = require("../index");

const CUSTOMER_ID = "aaaaaaaaaaaaaaaaaaaaaaaa";

function mockQuery(result) {
  return {
    select: jest.fn(() => mockQuery(result)),
    populate: jest.fn(() => mockQuery(result)),
    sort: jest.fn(() => mockQuery(result)),
    limit: jest.fn(() => mockQuery(result)),
    then: (resolve, reject) => Promise.resolve(result).then(resolve, reject),
    catch: (reject) => Promise.resolve(result).catch(reject),
  };
}

function mockRes() {
  return { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
}

function bookingStub(overrides = {}) {
  return {
    _id: "legacy0000000000000000001",
    bookingNumber: "BKG20260101-0001",
    orderId: { orderNumber: "POS20260101-0001" },
    lines: [{ devotees: [{ name: "Legacy Devotee", nakshatra: "Ashwini" }] }],
    grandTotal: 100,
    bookedAt: new Date("2026-01-01"),
    ...overrides,
  };
}

function posBookingStub(overrides = {}) {
  return {
    _id: "posbkg0000000000000000001",
    bookingNumber: "BKG20260201-0002",
    orderId: { orderNumber: "POS20260201-0002" },
    lines: [{ devotees: [{ name: "POS Devotee", nakshatra: "Bharani" }] }],
    grandTotal: 200,
    bookedAt: new Date("2026-02-01"),
    ...overrides,
  };
}

describe("getRecentBookings", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("rejects an invalid customer id without querying either collection", async () => {
    const req = { params: { id: "not-an-id" }, query: {} };
    const res = mockRes();

    await getRecentBookings(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("a customer with ONLY pos_bookings history (e.g. a staff member's own 'self' customer) still gets their devotees back — not an empty list", async () => {
    Booking.find = jest.fn(() => mockQuery([]));
    PosBooking.find = jest.fn(() => mockQuery([posBookingStub()]));
    const req = { params: { id: CUSTOMER_ID }, query: {} };
    const res = mockRes();

    await getRecentBookings(req, res);

    expect(PosBooking.find).toHaveBeenCalledWith(
      expect.objectContaining({ customer: CUSTOMER_ID, bookingStatus: "confirmed" })
    );
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          items: [
            expect.objectContaining({
              bookingNumber: "BKG20260201-0002",
              lines: [{ devotees: [{ name: "POS Devotee", nakshatra: "Bharani" }] }],
            }),
          ],
        },
      })
    );
  });

  it("merges legacy Booking and PosBooking history together, newest first, capped at the requested limit", async () => {
    Booking.find = jest.fn(() => mockQuery([bookingStub()]));
    PosBooking.find = jest.fn(() => mockQuery([posBookingStub()]));
    const req = { params: { id: CUSTOMER_ID }, query: { limit: "3" } };
    const res = mockRes();

    await getRecentBookings(req, res);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          items: [
            expect.objectContaining({ bookingNumber: "BKG20260201-0002" }), // Feb — newest first
            expect.objectContaining({ bookingNumber: "BKG20260101-0001" }), // Jan
          ],
        },
      })
    );
  });

  it("caps the merged, sorted result at the requested limit even when both collections independently stay under it", async () => {
    Booking.find = jest.fn(() => mockQuery([bookingStub({ _id: "l1" }), bookingStub({ _id: "l2", bookedAt: new Date("2026-01-15") })]));
    PosBooking.find = jest.fn(() => mockQuery([posBookingStub({ _id: "p1" })]));
    const req = { params: { id: CUSTOMER_ID }, query: { limit: "2" } };
    const res = mockRes();

    await getRecentBookings(req, res);

    const { items } = res.json.mock.calls[0][0].data;
    expect(items).toHaveLength(2);
    expect(items[0].bookingNumber).toBe("BKG20260201-0002"); // Feb PosBooking, newest
    expect(items[1]._id).toBe("l2"); // Jan 15 legacy, next-newest — l1 (Jan 1) dropped
  });
});
