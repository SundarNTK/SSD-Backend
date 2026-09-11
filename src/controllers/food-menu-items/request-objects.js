const Joi = require("joi");
const { PRICING_BASIS_VALUES } = require("../../models/food-menu-items");

const createSchema = Joi.object({
  name: Joi.string().trim().min(1).max(150).required(),
  itemCategory: Joi.string().trim().min(1).max(100).required(),
  description: Joi.string().allow("").default(""),
  pricingBasis: Joi.string().valid(...PRICING_BASIS_VALUES).required(),
  cost: Joi.number().min(0).required(),
  image: Joi.string().allow("", null).default(null),
  status: Joi.number().valid(0, 1).default(1),
});

const updateSchema = Joi.object({
  name: Joi.string().trim().min(1).max(150),
  itemCategory: Joi.string().trim().min(1).max(100),
  description: Joi.string().allow(""),
  pricingBasis: Joi.string().valid(...PRICING_BASIS_VALUES),
  cost: Joi.number().min(0),
  image: Joi.string().allow("", null),
  status: Joi.number().valid(0, 1),
});

module.exports = { createSchema, updateSchema };
