const Joi = require("joi");

const createSchema = Joi.object({
  name: Joi.string().trim().min(2).max(100).required(),
  description: Joi.string().allow("").default(""),
  status: Joi.number().valid(0, 1).default(1),
});

const updateSchema = Joi.object({
  name: Joi.string().trim().min(2).max(100),
  description: Joi.string().allow(""),
  status: Joi.number().valid(0, 1),
});

module.exports = { createSchema, updateSchema };
