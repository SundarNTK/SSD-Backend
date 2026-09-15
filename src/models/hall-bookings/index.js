const mongoose = require("mongoose");
const { auditablePlugin } = require("../../common/plugins/auditable");

/**
 * The permanent, confirmed record of a Hall/Food booking — a financial
 * snapshot, the same philosophy as models/bookings: prices, names and
 * package configuration are denormalised here at confirm time and never
 * retroactively recalculated from the Hall/Package masters later.
 *
 * `halls` is the field every availability/overlap check runs against
 * (see common/utils/hall-availability.js) — populated from `[hall]` for
 * an individual booking or from the Hall Package's own `halls` array for
 * a package booking, so one overlap query handles both cases uniformly.
 */

const BOOKING_TYPES = ["individual", "package"];
const BOOKING_STATUSES = ["confirmed", "completed", "cancelled"];
const PAYMENT_STATUSES = ["unpaid", "partial", "paid"];

const foodMenuSnapshotSchema = new mongoose.Schema(
  {
    menuItem: { type: mongoose.Schema.Types.ObjectId, ref: "FoodMenuItem", required: true },
    name: { type: String, required: true },
    pricingBasis: { type: String, required: true },
    cost: { type: Number, required: true, min: 0 },
    // Standard package item removed for this booking only — the Food
    // Package master itself is never modified by a booking's customization.
    removed: { type: Boolean, default: false },
  },
  { _id: false }
);

const additionalFoodItemSchema = new mongoose.Schema(
  {
    menuItem: { type: mongoose.Schema.Types.ObjectId, ref: "FoodMenuItem", required: true },
    name: { type: String, required: true },
    pricingBasis: { type: String, required: true },
    cost: { type: Number, required: true, min: 0 },
    quantity: { type: Number, required: true, min: 1 },
    amount: { type: Number, required: true, min: 0 },
  },
  { _id: false }
);

const additionalServiceSnapshotSchema = new mongoose.Schema(
  { service: { type: mongoose.Schema.Types.ObjectId, ref: "AdditionalService", required: true }, name: { type: String, required: true } },
  { _id: false }
);

const rescheduleEntrySchema = new mongoose.Schema(
  {
    previousEventDate: { type: Date, required: true },
    previousStartTime: { type: String, required: true },
    previousEndTime: { type: String, required: true },
    reason: { type: String, default: "" },
    rescheduledBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    rescheduledAt: { type: Date, required: true },
  },
  { _id: false }
);

const cancellationSchema = new mongoose.Schema(
  {
    reason: { type: String, required: true },
    cancelledBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    cancelledAt: { type: Date, required: true },
    cancellationCharge: { type: Number, default: 0, min: 0 },
    refundableAmount: { type: Number, default: 0, min: 0 },
  },
  { _id: false }
);

const refundSchema = new mongoose.Schema(
  {
    status: { type: String, enum: ["pending", "processed"], default: "pending" },
    amount: { type: Number, required: true, min: 0 },
    mode: { type: String, default: "" },
    reference: { type: String, default: "" },
    remarks: { type: String, default: "" },
    processedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    processedAt: { type: Date, default: null },
  },
  { _id: false }
);

const depositSettlementSchema = new mongoose.Schema(
  {
    depositPaid: { type: Number, default: 0, min: 0 },
    deduction: { type: Number, default: 0, min: 0 },
    refundableDeposit: { type: Number, default: 0, min: 0 },
    returnDate: { type: Date, default: null },
    status: { type: String, enum: ["pending", "returned"], default: "pending" },
    processedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { _id: false }
);

const hallBookingSchema = new mongoose.Schema({
  bookingNumber: { type: String, required: true },

  customer: { type: mongoose.Schema.Types.ObjectId, ref: "Customer", required: true },
  customerInfo: { type: mongoose.Schema.Types.Mixed, default: null },

  bookingType: { type: String, enum: BOOKING_TYPES, required: true },
  hall: { type: mongoose.Schema.Types.ObjectId, ref: "Hall", default: null },
  hallName: { type: String, default: null },
  hallPackage: { type: mongoose.Schema.Types.ObjectId, ref: "HallPackage", default: null },
  hallPackageName: { type: String, default: null },
  // Every Hall actually reserved by this booking — [hall] for an individual
  // booking, or the Hall Package's own halls[] copied at confirm time.
  halls: { type: [{ type: mongoose.Schema.Types.ObjectId, ref: "Hall" }], default: [] },

  hallPurpose: { type: mongoose.Schema.Types.ObjectId, ref: "HallPurpose", required: true },
  hallPurposeName: { type: String, required: true },

  eventDate: { type: Date, required: true },
  startTime: { type: String, required: true }, // "HH:mm"
  endTime: { type: String, required: true },

  foodRequired: { type: Boolean, default: false },
  foodPackage: { type: mongoose.Schema.Types.ObjectId, ref: "FoodPackage", default: null },
  foodPackageName: { type: String, default: null },
  paxCount: { type: Number, default: null, min: 0 },
  foodMenuSnapshot: { type: [foodMenuSnapshotSchema], default: [] },
  additionalFoodItems: { type: [additionalFoodItemSchema], default: [] },

  additionalServices: { type: [additionalServiceSnapshotSchema], default: [] },

  remarks: { type: String, default: "" },

  discountPercentage: { type: Number, default: 0, min: 0, max: 100 },
  membershipNumber: { type: String, default: "" },
  memberName: { type: String, default: "" },

  // --- frozen amounts — never recalculated from master data after confirm ---
  hallAmount: { type: Number, required: true, min: 0 },
  foodAmount: { type: Number, default: 0, min: 0 },
  foodAdjustmentAmount: { type: Number, default: 0 },
  additionalHourAmount: { type: Number, default: 0, min: 0 },
  subtotalAmount: { type: Number, required: true, min: 0 },
  discountAmount: { type: Number, default: 0, min: 0 },
  gstPercentage: { type: Number, default: 0, min: 0 },
  gstAmount: { type: Number, default: 0, min: 0 },
  finalAmount: { type: Number, required: true, min: 0 },
  depositAmount: { type: Number, default: 0, min: 0 },
  advanceAmount: { type: Number, default: 0, min: 0 },

  bookingStatus: { type: String, enum: BOOKING_STATUSES, default: "confirmed" },
  // Recomputed and stored after every payment write (see
  // controllers/hall-bookings/manage.js) — the same convention
  // models/bookings uses; amountPaid itself is never stored, always the
  // sum of this booking's HallBookingPayment rows at read time.
  paymentStatus: { type: String, enum: PAYMENT_STATUSES, default: "unpaid" },

  rescheduleHistory: { type: [rescheduleEntrySchema], default: [] },
  cancellation: { type: cancellationSchema, default: null },
  refund: { type: refundSchema, default: null },
  depositSettlement: { type: depositSettlementSchema, default: null },

  completedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  completedAt: { type: Date, default: null },

  bookedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  bookedByInfo: { type: mongoose.Schema.Types.Mixed, default: null },
  bookedAt: { type: Date, required: true },
});

hallBookingSchema.pre("save", async function populateHallBookingSnapshots() {
  const { buildUserSnapshot, buildCustomerSnapshot } = require("../../common/utils/entity-snapshot");
  if (this.isModified("customer") && this.customer) {
    this.customerInfo = await buildCustomerSnapshot(this.customer);
  }
  if (this.isModified("bookedBy") && this.bookedBy) {
    this.bookedByInfo = await buildUserSnapshot(this.bookedBy);
  }
});

hallBookingSchema.plugin(auditablePlugin);

hallBookingSchema.index({ bookingNumber: 1 }, { unique: true });
// The availability/overlap query's own shape — see common/utils/hall-availability.js.
hallBookingSchema.index({ halls: 1, eventDate: 1, bookingStatus: 1 });
hallBookingSchema.index({ bookingStatus: 1, createdAt: -1 });
hallBookingSchema.index({ paymentStatus: 1, createdAt: -1 });
hallBookingSchema.index({ customer: 1, createdAt: -1 });

module.exports = {
  HallBooking: mongoose.model("HallBooking", hallBookingSchema),
  BOOKING_TYPES,
  BOOKING_STATUSES,
  PAYMENT_STATUSES,
};
