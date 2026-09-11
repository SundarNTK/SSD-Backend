const Joi = require("joi");

const createSchema = Joi.object({
  name: Joi.string().trim().min(1).max(100).required(),
  code: Joi.string().trim().min(1).max(30).required(),
  image: Joi.string().allow("", null).default(null),
  status: Joi.number().valid(0, 1).default(1),
});

const updateSchema = Joi.object({
  name: Joi.string().trim().min(1).max(100),
  code: Joi.string().trim().min(1).max(30),
  image: Joi.string().allow("", null),
  status: Joi.number().valid(0, 1),
});

module.exports = { createSchema, updateSchema };
