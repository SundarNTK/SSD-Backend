const Joi = require("joi");

const objectId = Joi.string().trim().hex().length(24);

/** FSD: "Past date shall not be allowed for new Booking" — this screen exists to check availability before creating one, so the same rule applies here. Compared against the start of today, not the exact instant. */
function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

const checkSchema = Joi.object({
  bookingType: Joi.string().valid("individual", "package").required(),
  hallId: objectId.when("bookingType", { is: "individual", then: Joi.required(), otherwise: Joi.forbidden() }),
  hallPackageId: objectId.when("bookingType", { is: "package", then: Joi.required(), otherwise: Joi.forbidden() }),
  eventDate: Joi.date().min(startOfToday()).required().messages({ "date.min": "Event Date cannot be in the past." }),
  startTime: Joi.string()
    .pattern(/^([01]\d|2[0-3]):[0-5]\d$/)
    .required(),
  endTime: Joi.string()
    .pattern(/^([01]\d|2[0-3]):[0-5]\d$/)
    .required(),
  excludeBookingId: objectId.optional(),
}).custom((value, helpers) => {
  if (value.startTime >= value.endTime) {
    return helpers.message("End Time must be later than Start Time.");
  }
  return value;
});

module.exports = { checkSchema };
