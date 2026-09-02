const Joi = require("joi");
const { GST_CLASSIFICATIONS } = require("../../utilities/constants/gst-classifications");

const objectId = Joi.string().hex().length(24);

const slotDetailEntry = Joi.object({
  slotName: Joi.string().trim().min(1).max(100).required(),
  date: Joi.date().required(),
  startTime: Joi.string().trim().min(1).max(10).required(),
  endTime: Joi.string().trim().min(1).max(10).required(),
  totalSeats: Joi.number().integer().min(0).default(0),
  status: Joi.number().valid(0, 1).default(1),
});

const createSchema = Joi.object({
  code: Joi.string().trim().min(1).max(30).required(),
  name: Joi.string().trim().min(1).max(150).required(),
  tamilName: Joi.string().allow("").default(""),
  description: Joi.string().allow("").default(""),
  image: Joi.string().allow("").default(null),

  category: objectId.required(),
  subCategory: objectId.allow(null).default(null),
  deityMapping: Joi.array().items(objectId).default([]),

  startDate: Joi.date().required(),
  endDate: Joi.date().required(),

  isSlotRequired: Joi.boolean().default(false),
  slotDetails: Joi.array().items(slotDetailEntry).default([]),

  salePrice: Joi.number().min(0).required(),
  gstClassification: Joi.string()
    .valid(...GST_CLASSIFICATIONS)
    .required(),
  displayOrder: Joi.number().integer().min(0).default(1),

  posVisibility: Joi.boolean().default(true),
  publicVisibility: Joi.boolean().default(true),

  status: Joi.number().valid(0, 1).default(1),
});

const updateSchema = Joi.object({
  code: Joi.string().trim().min(1).max(30),
  name: Joi.string().trim().min(1).max(150),
  tamilName: Joi.string().allow(""),
  description: Joi.string().allow(""),
  image: Joi.string().allow(""),

  category: objectId,
  subCategory: objectId.allow(null),
  deityMapping: Joi.array().items(objectId),

  startDate: Joi.date(),
  endDate: Joi.date(),

  isSlotRequired: Joi.boolean(),
  slotDetails: Joi.array().items(slotDetailEntry),

  salePrice: Joi.number().min(0),
  gstClassification: Joi.string().valid(...GST_CLASSIFICATIONS),
  displayOrder: Joi.number().integer().min(0),

  posVisibility: Joi.boolean(),
  publicVisibility: Joi.boolean(),

  status: Joi.number().valid(0, 1),
});

module.exports = { createSchema, updateSchema };
