const Joi = require("joi");

const objectId = Joi.string().trim().hex().length(24);
const timeString = Joi.string().pattern(/^([01]\d|2[0-3]):[0-5]\d$/);

/** FSD: "Past date shall not be allowed for new Booking" — compared against the start of today, not the exact instant, so booking for later today still passes. */
function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}
const futureEventDate = Joi.date().min(startOfToday()).required().messages({
  "date.min": "Event Date cannot be in the past.",
});

const customerSearchSchema = Joi.object({
  query: Joi.string().trim().min(1).required(),
});

const createCustomerSchema = Joi.object({
  name: Joi.string().trim().min(2).max(100).required(),
  email: Joi.string().trim().lowercase().email({ tlds: false }).required(),
  mobileNumber: Joi.string().trim().allow("").default(null),
});

const additionalMenuItemRow = Joi.object({
  menuItemId: objectId.required(),
  quantity: Joi.number().min(1).required(),
});

const createBookingSchema = Joi.object({
  customerId: objectId.required(),

  bookingType: Joi.string().valid("individual", "package").required(),
  hallId: objectId.when("bookingType", { is: "individual", then: Joi.required(), otherwise: Joi.forbidden() }),
  hallPackageId: objectId.when("bookingType", { is: "package", then: Joi.required(), otherwise: Joi.forbidden() }),

  hallPurposeId: objectId.required(),
  eventDate: futureEventDate,
  startTime: timeString.required(),
  endTime: timeString.required(),

  foodRequired: Joi.boolean().default(false),
  foodPackageId: objectId.when("foodRequired", { is: true, then: Joi.required(), otherwise: Joi.forbidden() }),
  paxCount: Joi.number().integer().min(1).when("foodRequired", { is: true, then: Joi.required(), otherwise: Joi.forbidden() }),
  removedMenuItemIds: Joi.array().items(objectId).default([]),
  additionalMenuItems: Joi.array().items(additionalMenuItemRow).default([]),

  additionalServiceIds: Joi.array().items(objectId).default([]),

  remarks: Joi.string().allow("").default(""),

  discountPercentage: Joi.number().min(0).max(100).default(0),
  membershipNumber: Joi.string().trim().when("discountPercentage", { is: Joi.number().greater(0), then: Joi.required(), otherwise: Joi.allow("") }),
  memberName: Joi.string().trim().when("discountPercentage", { is: Joi.number().greater(0), then: Joi.required(), otherwise: Joi.allow("") }),

  paymentType: Joi.string().valid("deposit", "advance"),
  paymentAmount: Joi.number().min(0).default(0),
  paymentModeId: objectId.when("paymentAmount", { is: Joi.number().greater(0), then: Joi.required() }),
  paymentSubtype: Joi.string().allow("").default(""),
  referenceNo: Joi.string().allow("").default(""),
  paymentRemarks: Joi.string().allow("").default(""),
}).custom((value, helpers) => {
  if (value.startTime >= value.endTime) return helpers.message("End Time must be later than Start Time.");
  if (value.paymentAmount > 0 && !value.paymentType) return helpers.message('"paymentType" is required when a payment is collected.');
  return value;
});

// Remarks-mandatory-for-"Other" (FSD's rule) can't be checked here — the
// mode name only exists after PaymentMode is looked up by ID — so the
// handler enforces it itself once it has resolved paymentModeName.
// Same shape as createBookingSchema, minus the customer/payment fields —
// used to price a booking BEFORE it exists (the live pricing panel on the
// Create Hall Booking screen), as distinct from editPreviewSchema below,
// which prices a change against an ALREADY-confirmed booking.
const previewBookingSchema = createBookingSchema.fork(["customerId"], (schema) => schema.optional());

const recordPaymentSchema = Joi.object({
  amount: Joi.number().greater(0).required(),
  paymentModeId: objectId.required(),
  paymentSubtype: Joi.string().allow("").default(""),
  referenceNo: Joi.string().allow("").default(""),
  remarks: Joi.string().allow("").default(""),
});

// Deliberately excludes eventDate/startTime/endTime and hallId/hallPackageId
// — changing the Hall/Package or the event date/time goes exclusively
// through Reschedule below, which carries its own history tracking and
// "old slot stays blocked until the new one is confirmed" semantics. Having
// two endpoints that could both move the time slot, with different history
// behaviour, would be a correctness trap.
const editPreviewSchema = Joi.object({
  hallPurposeId: objectId,
  foodRequired: Joi.boolean(),
  foodPackageId: objectId.allow(null),
  paxCount: Joi.number().integer().min(1).allow(null),
  removedMenuItemIds: Joi.array().items(objectId),
  additionalMenuItems: Joi.array().items(additionalMenuItemRow),
  additionalServiceIds: Joi.array().items(objectId),
  discountPercentage: Joi.number().min(0).max(100),
  membershipNumber: Joi.string().trim().allow(""),
  memberName: Joi.string().trim().allow(""),
  remarks: Joi.string().allow(""),
});

const rescheduleSchema = Joi.object({
  eventDate: futureEventDate,
  startTime: timeString.required(),
  endTime: timeString.required(),
  reason: Joi.string().allow("").default(""),
}).custom((value, helpers) => {
  if (value.startTime >= value.endTime) return helpers.message("End Time must be later than Start Time.");
  return value;
});

const cancelSchema = Joi.object({
  reason: Joi.string().trim().min(1).required(),
  cancellationCharge: Joi.number().min(0).default(0),
  remarks: Joi.string().allow("").default(""),
});

const refundSchema = Joi.object({
  amount: Joi.number().greater(0).required(),
  mode: Joi.string().trim().required(),
  reference: Joi.string().allow("").default(""),
  remarks: Joi.string().allow("").default(""),
  status: Joi.string().valid("pending", "processed").default("processed"),
});

const depositSettlementSchema = Joi.object({
  deduction: Joi.number().min(0).default(0),
  returnDate: Joi.date().required(),
});

module.exports = {
  customerSearchSchema,
  createCustomerSchema,
  createBookingSchema,
  previewBookingSchema,
  recordPaymentSchema,
  editPreviewSchema,
  rescheduleSchema,
  cancelSchema,
  refundSchema,
  depositSettlementSchema,
};
