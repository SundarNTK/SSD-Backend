const Joi = require("joi");

const objectId = Joi.string().hex().length(24);

const createSchema = Joi.object({
  entity: objectId.required(),
  event: Joi.string().trim().uppercase().min(2).required(),
  template: objectId.required(),
  fromOverride: Joi.string().email({ tlds: false }).allow(null).default(null),
  cc: Joi.array().items(Joi.string().email({ tlds: false })).default([]),
  bcc: Joi.array().items(Joi.string().email({ tlds: false })).default([]),
});

const updateSchema = Joi.object({
  template: objectId,
  fromOverride: Joi.string().email({ tlds: false }).allow(null),
  cc: Joi.array().items(Joi.string().email({ tlds: false })),
  bcc: Joi.array().items(Joi.string().email({ tlds: false })),
  status: Joi.number().valid(0, 1),
});

module.exports = { createSchema, updateSchema };
