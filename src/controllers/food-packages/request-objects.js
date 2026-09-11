const Joi = require("joi");

const objectId = Joi.string().trim().hex().length(24);

const menuItemRow = Joi.object({
  menuItem: objectId.required(),
  includedInPackage: Joi.boolean().default(true),
});

const createSchema = Joi.object({
  name: Joi.string().trim().min(1).max(150).required(),
  description: Joi.string().allow("").default(""),
  packagePricePerPax: Joi.number().min(0).required(),
  minimumBookingCount: Joi.number().integer().min(1).required(),
  menuItems: Joi.array().items(menuItemRow).min(1).required().messages({
    "array.min": "At least one Menu Item is required.",
  }),
  gstApplicable: Joi.boolean().default(false),
  image: Joi.string().allow("", null).default(null),
  status: Joi.number().valid(0, 1).default(1),
});

const updateSchema = Joi.object({
  name: Joi.string().trim().min(1).max(150),
  description: Joi.string().allow(""),
  packagePricePerPax: Joi.number().min(0),
  minimumBookingCount: Joi.number().integer().min(1),
  menuItems: Joi.array().items(menuItemRow).min(1).messages({
    "array.min": "At least one Menu Item is required.",
  }),
  gstApplicable: Joi.boolean(),
  image: Joi.string().allow("", null),
  status: Joi.number().valid(0, 1),
});

module.exports = { createSchema, updateSchema };
