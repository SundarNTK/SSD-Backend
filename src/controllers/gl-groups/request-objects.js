const Joi = require("joi");

const objectId = Joi.string().hex().length(24);

const createSchema = Joi.object({
  level: Joi.number().valid(1, 2, 3).required(),
  name: Joi.string().trim().min(1).max(150).required(),
  code: Joi.string().trim().min(1).max(30).required(),
  description: Joi.string().allow("").default(""),
  status: Joi.number().valid(0, 1).default(1),
  level1: objectId.when("level", { is: Joi.number().valid(2, 3), then: Joi.required(), otherwise: Joi.forbidden() }),
  level2: objectId.when("level", { is: 3, then: Joi.required(), otherwise: Joi.forbidden() }),
});

const updateSchema = Joi.object({
  name: Joi.string().trim().min(1).max(150),
  description: Joi.string().allow(""),
  status: Joi.number().valid(0, 1),
  // code/level/level1/level2 are deliberately not editable — code is a
  // stable identifier after creation; reparenting after General Ledger
  // accounts may already reference the group is a bigger operation than a
  // name/description/status edit.
});

module.exports = { createSchema, updateSchema };
