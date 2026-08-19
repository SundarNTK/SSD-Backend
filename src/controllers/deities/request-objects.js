const Joi = require("joi");

const objectId = Joi.string().hex().length(24);

const createSchema = Joi.object({
  name: Joi.string().trim().min(2).max(100).required(),
  tamilName: Joi.string().allow("").default(""),
  printingGroup: objectId.required(),
  status: Joi.number().valid(0, 1).default(1),
});

const updateSchema = Joi.object({
  name: Joi.string().trim().min(2).max(100),
  tamilName: Joi.string().allow(""),
  printingGroup: objectId,
  status: Joi.number().valid(0, 1),
});

module.exports = { createSchema, updateSchema };
