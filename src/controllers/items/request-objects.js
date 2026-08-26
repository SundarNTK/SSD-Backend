const Joi = require("joi");
const { UNITS_OF_MEASURE } = require("../../utilities/constants/units-of-measure");

const objectId = Joi.string().hex().length(24);

const categoryDetailEntry = Joi.object({
  category: objectId.required(),
  subCategory: objectId.required(),
  displayOrder: Joi.number().integer().min(0).default(0),
});

// deityMapping is only meaningful (and only required) once
// isDeityMappingRequired is turned on — otherwise it's cleared to [].
// Create always sends a full object, so a missing key safely defaults to [].
// Update must NOT apply that default: validateBody() fills in .default()
// for any key absent from the request body, and crud.update() spreads the
// whole validated body into findOneAndUpdate — so a partial PUT that
// doesn't mention deityMapping would silently blank out an existing
// mapping. Leaving it undefined on update means "not part of this PUT",
// so the existing value in the DB is left untouched.
const deityMappingField = Joi.array()
  .items(objectId)
  .when("isDeityMappingRequired", {
    is: true,
    then: Joi.array().min(1).required(),
    otherwise: Joi.array().default([]),
  });

const deityMappingFieldForUpdate = Joi.array()
  .items(objectId)
  .when("isDeityMappingRequired", {
    is: true,
    then: Joi.array().min(1).required(),
    otherwise: Joi.array(),
  });

const createSchema = Joi.object({
  code: Joi.string().trim().min(1).max(30).required(),
  name: Joi.string().trim().min(1).max(150).required(),
  tamilName: Joi.string().allow("").default(""),
  generalLedger: objectId.required(),
  salePrice: Joi.number().min(0).required(),
  description: Joi.string().allow("").default(""),

  isDeityMappingRequired: Joi.boolean().default(false),
  deityMapping: deityMappingField,
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
  maxFamilyMembers: Joi.number().integer().min(1).default(2),
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
  deityMapping: deityMappingFieldForUpdate,
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
  maxFamilyMembers: Joi.number().integer().min(1),
  posAvailability: Joi.boolean(),
  customerPortalAvailability: Joi.boolean(),

  status: Joi.number().valid(0, 1),
});

module.exports = { createSchema, updateSchema };
