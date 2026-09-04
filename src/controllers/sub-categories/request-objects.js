const Joi = require("joi");

const HEX_COLOR = /^#[0-9A-Fa-f]{6}$/;

const createSchema = Joi.object({
  name: Joi.string().trim().min(1).max(100).required(),
  tamilName: Joi.string().allow("").default(""),
  code: Joi.string().trim().min(1).max(30).required(),
  category: Joi.string().hex().length(24).required().messages({
    "string.empty": "Category is required.",
    "any.required": "Category is required.",
  }),
  displayOrder: Joi.number().integer().min(0).default(0),
  color: Joi.string().trim().pattern(HEX_COLOR).required().messages({
    "string.pattern.base": "Colour must be a hex value like #942237.",
  }),
  description: Joi.string().allow("").default(""),
  image: Joi.string().allow("").default(null),
  posVisibility: Joi.boolean().default(true),
  customerPortalVisibility: Joi.boolean().default(true),
  status: Joi.number().valid(0, 1).default(1),
});

const updateSchema = Joi.object({
  name: Joi.string().trim().min(1).max(100),
  tamilName: Joi.string().allow(""),
  code: Joi.string().trim().min(1).max(30),
  category: Joi.string().hex().length(24),
  displayOrder: Joi.number().integer().min(0),
  color: Joi.string().trim().pattern(HEX_COLOR).messages({
    "string.pattern.base": "Colour must be a hex value like #942237.",
  }),
  description: Joi.string().allow(""),
  image: Joi.string().allow(""),
  posVisibility: Joi.boolean(),
  customerPortalVisibility: Joi.boolean(),
  status: Joi.number().valid(0, 1),
});

module.exports = { createSchema, updateSchema };
