const Joi = require("joi");

const objectId = Joi.string().hex().length(24);

// subCategory is optional — a row can map a service to a Category alone,
// with no specific SubCategory (see models/services categoryDetailSchema).
const categoryDetailEntry = Joi.object({
  category: objectId.required(),
  subCategory: objectId.allow(null),
  salePrice: Joi.number().min(0).default(0),
  displayOrder: Joi.number().integer().min(0).default(1),
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
  description: Joi.string().allow("").default(""),

  isDeityMappingRequired: Joi.boolean().default(false),
  deityMapping: deityMappingField,

  categoryDetails: Joi.array().items(categoryDetailEntry).default([]),

  generalLedger: objectId.required(),

  isFamilyMembersRequired: Joi.boolean().default(false),
  maxFamilyMembers: Joi.number().integer().min(1).default(2),

  sessionRequired: Joi.boolean().default(false),

  isInventoryRequired: Joi.boolean().default(false),
  thresholdCount: Joi.number().integer().min(0).default(0),

  bookingCutoffDate: Joi.date().allow(null).default(null),
  isPosAvailable: Joi.boolean().default(true),
  publicAvailability: Joi.boolean().default(true),

  status: Joi.number().valid(0, 1).default(1),
});

const updateSchema = Joi.object({
  code: Joi.string().trim().min(1).max(30),
  name: Joi.string().trim().min(1).max(150),
  tamilName: Joi.string().allow(""),
  description: Joi.string().allow(""),

  isDeityMappingRequired: Joi.boolean(),
  deityMapping: deityMappingFieldForUpdate,

  categoryDetails: Joi.array().items(categoryDetailEntry),

  generalLedger: objectId,

  isFamilyMembersRequired: Joi.boolean(),
  maxFamilyMembers: Joi.number().integer().min(1),

  sessionRequired: Joi.boolean(),

  isInventoryRequired: Joi.boolean(),
  thresholdCount: Joi.number().integer().min(0),

  bookingCutoffDate: Joi.date().allow(null),
  isPosAvailable: Joi.boolean(),
  publicAvailability: Joi.boolean(),

  status: Joi.number().valid(0, 1),
});

module.exports = { createSchema, updateSchema };
