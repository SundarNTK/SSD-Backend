const Joi = require("joi");
const { UNITS_OF_MEASURE } = require("../../utilities/constants/units-of-measure");

const objectId = Joi.string().hex().length(24);

const categoryDetailEntry = Joi.object({
  category: objectId.required(),
  subCategory: objectId.required(),
  displayOrder: Joi.number().integer().min(0).default(0),
});

const createSchema = Joi.object({
  code: Joi.string().trim().min(1).max(30).required(),
  name: Joi.string().trim().min(1).max(150).required(),
  tamilName: Joi.string().allow("").default(""),
  generalLedger: objectId.required(),
  salePrice: Joi.number().min(0).required(),
  description: Joi.string().allow("").default(""),

  isDeityMappingRequired: Joi.boolean().default(false),
  printingGroup: objectId.required(),

  categoryDetails: Joi.array().items(categoryDetailEntry).default([]),

  isInventoryApplicable: Joi.boolean().default(false),
  unitOfMeasure: Joi.string()
    .valid(...UNITS_OF_MEASURE)
    .allow(null)
    .default(null),
  threshold: Joi.number().integer().min(0).default(0),
  minQuantity: Joi.number().integer().min(1).default(1),
  maxQuantity: Joi.number().integer().min(0).default(0),
  quantityReduction: Joi.number().integer().min(1).default(1),

  futureBookingCutOffDate: Joi.date().allow(null).default(null),
  isFamilyMembersRequired: Joi.boolean().default(false),
  posAvailability: Joi.boolean().default(true),
  customerPortalAvailability: Joi.boolean().default(true),

  status: Joi.number().valid(0, 1).default(1),
});

const updateSchema = Joi.object({
  code: Joi.string().trim().min(1).max(30),
  name: Joi.string().trim().min(1).max(150),
  tamilName: Joi.string().allow(""),
  generalLedger: objectId,
  salePrice: Joi.number().min(0),
  description: Joi.string().allow(""),

  isDeityMappingRequired: Joi.boolean(),
  printingGroup: objectId,

  categoryDetails: Joi.array().items(categoryDetailEntry),

  isInventoryApplicable: Joi.boolean(),
  unitOfMeasure: Joi.string()
    .valid(...UNITS_OF_MEASURE)
    .allow(null),
  threshold: Joi.number().integer().min(0),
  minQuantity: Joi.number().integer().min(1),
  maxQuantity: Joi.number().integer().min(0),
  quantityReduction: Joi.number().integer().min(1),

  futureBookingCutOffDate: Joi.date().allow(null),
  isFamilyMembersRequired: Joi.boolean(),
  posAvailability: Joi.boolean(),
  customerPortalAvailability: Joi.boolean(),

  status: Joi.number().valid(0, 1),
});

module.exports = { createSchema, updateSchema };
