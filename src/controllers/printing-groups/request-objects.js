const Joi = require("joi");

const createSchema = Joi.object({
  code: Joi.string().trim().min(1).max(20).required(),
  name: Joi.string().trim().min(2).max(100).required(),
  description: Joi.string().allow("").default(""),
  status: Joi.number().valid(0, 1).default(1),
});

const updateSchema = Joi.object({
  code: Joi.string().trim().min(1).max(20),
  name: Joi.string().trim().min(2).max(100),
  description: Joi.string().allow(""),
  status: Joi.number().valid(0, 1),
});

module.exports = { createSchema, updateSchema };
