const Joi = require("joi");

const objectId = Joi.string().hex().length(24);

// groupLevel2 only makes sense once groupLevel1 is chosen, groupLevel3 only
// once groupLevel2 is chosen — same chain GL Group's own Level 2/3 forms
// enforce, mirrored here since a GL account drills into the same tree.
const createSchema = Joi.object({
  name: Joi.string().trim().min(1).max(150).required(),
  code: Joi.string().trim().min(1).max(30).required(),
  gstType: objectId.required(),
  groupLevel1: objectId.required(),
  groupLevel2: objectId.allow(null).default(null),
  groupLevel3: objectId.allow(null).when("groupLevel2", { is: Joi.exist().not(null), then: Joi.optional(), otherwise: Joi.forbidden() }).default(null),
  description: Joi.string().allow("").default(""),
  status: Joi.number().valid(0, 1).default(1),
});

const updateSchema = Joi.object({
  name: Joi.string().trim().min(1).max(150),
  code: Joi.string().trim().min(1).max(30),
  gstType: objectId,
  groupLevel1: objectId,
  groupLevel2: objectId.allow(null),
  groupLevel3: objectId.allow(null),
  description: Joi.string().allow(""),
  status: Joi.number().valid(0, 1),
});

module.exports = { createSchema, updateSchema };
