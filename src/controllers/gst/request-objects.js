const Joi = require("joi");

const dateRange = (schema) =>
  schema.custom((value, helpers) => {
    if (value.effectiveEndDate && new Date(value.effectiveEndDate) < new Date(value.effectiveStartDate)) {
      return helpers.message("Effective end date can't be before the start date.");
    }
    return value;
  });

const createSchema = dateRange(
  Joi.object({
    type: Joi.string().trim().min(1).max(50).required(),
    percentage: Joi.number().min(0).max(100).required(),
    code: Joi.string().trim().min(1).max(20).required(),
    effectiveStartDate: Joi.date().required(),
    effectiveEndDate: Joi.date().allow(null).default(null),
    status: Joi.number().valid(0, 1).default(1),
  })
);

const updateSchema = dateRange(
  Joi.object({
    type: Joi.string().trim().min(1).max(50),
    percentage: Joi.number().min(0).max(100),
    code: Joi.string().trim().min(1).max(20),
    effectiveStartDate: Joi.date(),
    effectiveEndDate: Joi.date().allow(null),
    status: Joi.number().valid(0, 1),
  })
);

module.exports = { createSchema, updateSchema };
