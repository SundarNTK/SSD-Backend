const Joi = require("joi");

const objectId = Joi.string().trim().hex().length(24);

const createSchema = Joi.object({
  name: Joi.string().trim().min(1).max(100).required(),
  code: Joi.string().trim().min(1).max(30).required(),
  category: objectId.required(),
  capacity: Joi.number().integer().min(1).required(),
  hallImages: Joi.array().items(Joi.string()).default([]),
  floorPlan: Joi.string().allow("", null).default(null),
  individualBookingRate: Joi.number().min(0).allow(null).default(null),
  minimumBookingDuration: Joi.number().min(0).allow(null).default(null),
  depositAmount: Joi.number().min(0).default(0),
  status: Joi.number().valid(0, 1).default(1),
});

const updateSchema = Joi.object({
  name: Joi.string().trim().min(1).max(100),
  code: Joi.string().trim().min(1).max(30),
  category: objectId,
  capacity: Joi.number().integer().min(1),
  hallImages: Joi.array().items(Joi.string()),
  floorPlan: Joi.string().allow("", null),
  individualBookingRate: Joi.number().min(0).allow(null),
  minimumBookingDuration: Joi.number().min(0).allow(null),
  depositAmount: Joi.number().min(0),
  status: Joi.number().valid(0, 1),
});

module.exports = { createSchema, updateSchema };
