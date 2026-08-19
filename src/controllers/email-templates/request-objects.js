const Joi = require("joi");

const createSchema = Joi.object({
  name: Joi.string().trim().min(2).max(150).required(),
  subject: Joi.string().trim().min(1).required(),
  htmlContent: Joi.string().min(1).required(),
  description: Joi.string().allow("").default(""),
});

const updateSchema = Joi.object({
  name: Joi.string().trim().min(2).max(150),
  subject: Joi.string().trim().min(1),
  htmlContent: Joi.string().min(1),
  description: Joi.string().allow(""),
  status: Joi.number().valid(0, 1),
});

module.exports = { createSchema, updateSchema };
