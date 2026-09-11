const Joi = require("joi");

const createSchema = Joi.object({
  name: Joi.string().trim().min(1).max(100).required(),
  description: Joi.string().allow("").default(""),
  image: Joi.string().allow("", null).default(null),
  status: Joi.number().valid(0, 1).default(1),
});

const updateSchema = Joi.object({
  name: Joi.string().trim().min(1).max(100),
  description: Joi.string().allow(""),
  image: Joi.string().allow("", null),
  status: Joi.number().valid(0, 1),
});

module.exports = { createSchema, updateSchema };
