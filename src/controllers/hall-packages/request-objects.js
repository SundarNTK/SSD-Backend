const Joi = require("joi");

const objectId = Joi.string().trim().hex().length(24);

const createSchema = Joi.object({
  name: Joi.string().trim().min(1).max(150).required(),
  hallPurpose: objectId.required(),
  halls: Joi.array().items(objectId).min(1).required().messages({
    "array.min": "At least one Hall is required.",
  }),
  standardSessionDuration: Joi.number().greater(0).required(),
  packagePrice: Joi.number().min(0).required(),
  bookingAdvanceAmount: Joi.number().min(0).default(0),
  depositAmount: Joi.number().min(0).default(0),
  additionalHourRate: Joi.number().min(0).default(0),
  gstApplicable: Joi.boolean().default(false),
  description: Joi.string().allow("").default(""),
  additionalServices: Joi.array().items(objectId).default([]),
  termsAndConditions: Joi.string().allow("").default(""),
  image: Joi.string().allow("", null).default(null),
  status: Joi.number().valid(0, 1).default(1),
});

const updateSchema = Joi.object({
  name: Joi.string().trim().min(1).max(150),
  hallPurpose: objectId,
  halls: Joi.array().items(objectId).min(1).messages({
    "array.min": "At least one Hall is required.",
  }),
  standardSessionDuration: Joi.number().greater(0),
  packagePrice: Joi.number().min(0),
  bookingAdvanceAmount: Joi.number().min(0),
  depositAmount: Joi.number().min(0),
  additionalHourRate: Joi.number().min(0),
  gstApplicable: Joi.boolean(),
  description: Joi.string().allow(""),
  additionalServices: Joi.array().items(objectId),
  termsAndConditions: Joi.string().allow(""),
  image: Joi.string().allow("", null),
  status: Joi.number().valid(0, 1),
});

module.exports = { createSchema, updateSchema };
