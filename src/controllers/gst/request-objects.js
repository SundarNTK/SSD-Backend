const Joi = require("joi");
const {
  GST_TYPES,
  canonicalGstType,
  isZeroRateGstType,
  validateGstPercentage,
} = require("../../utilities/constants/gst-types");

const ACCEPTED_TYPES = [...GST_TYPES, "Standard GST"];

const dateRange = (schema) =>
  schema.custom((value, helpers) => {
    if (value.effectiveEndDate && new Date(value.effectiveEndDate) < new Date(value.effectiveStartDate)) {
      return helpers.message("Effective end date can't be before the start date.");
    }
    return value;
  });

const gstRules = (schema) =>
  schema.custom((value, helpers) => {
    if (value.type) value.type = canonicalGstType(value.type);
    if (value.type && isZeroRateGstType(value.type)) value.percentage = 0;
    if (value.type && value.percentage !== undefined) {
      const error = validateGstPercentage(value.type, value.percentage);
      if (error) return helpers.message(error);
    }
    return value;
  });

const createSchema = gstRules(
  dateRange(
    Joi.object({
      type: Joi.string()
        .valid(...ACCEPTED_TYPES)
        .required(),
      percentage: Joi.number().min(0).max(100).required(),
      code: Joi.string().trim().min(1).max(20).required(),
      effectiveStartDate: Joi.date().required(),
      effectiveEndDate: Joi.date().allow(null).default(null),
      status: Joi.number().valid(0, 1).default(1),
      replaceActive: Joi.boolean().default(false),
    })
  )
);

const updateSchema = gstRules(
  dateRange(
    Joi.object({
      type: Joi.string().valid(...ACCEPTED_TYPES),
      percentage: Joi.number().min(0).max(100),
      code: Joi.string().trim().min(1).max(20),
      effectiveStartDate: Joi.date(),
      effectiveEndDate: Joi.date().allow(null),
      status: Joi.number().valid(0, 1),
      replaceActive: Joi.boolean(),
    })
  )
);

module.exports = { createSchema, updateSchema };
