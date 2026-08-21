const Joi = require("joi");

const createSchema = Joi.object({
  code: Joi.string().trim().min(1).max(20).required(),
  displayOrder: Joi.number().integer().min(0).required(),
  name: Joi.string().trim().min(1).max(100).required(),
  tamilName: Joi.string().trim().min(1).max(100).required(),
  rasi: Joi.string().trim().min(1).max(100).required(),
  tamilRasi: Joi.string().trim().min(1).max(100).required(),
  mainFlag: Joi.boolean().default(false),
  status: Joi.number().valid(0, 1).default(1),
});

const updateSchema = Joi.object({
  code: Joi.string().trim().min(1).max(20),
  displayOrder: Joi.number().integer().min(0),
  name: Joi.string().trim().min(1).max(100),
  tamilName: Joi.string().trim().min(1).max(100),
  rasi: Joi.string().trim().min(1).max(100),
  tamilRasi: Joi.string().trim().min(1).max(100),
  mainFlag: Joi.boolean(),
  status: Joi.number().valid(0, 1),
});

module.exports = { createSchema, updateSchema };
