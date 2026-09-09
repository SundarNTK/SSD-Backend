const Joi = require("joi");

const objectId = Joi.string().hex().length(24);

const createSchema = Joi.object({
  code: Joi.string().trim().min(1).max(20).required(),
  name: Joi.string().trim().min(2).max(100).required(),
  tamilName: Joi.string().allow("").default(""),
  printingGroup: objectId.required(),
  status: Joi.number().valid(0, 1).default(1),
  // Lower sorts first; ties fall back to alphabetical by name (see the
  // model's own comment). Not required — a deity left at the default 0
  // simply sorts among the other unordered ones.
  displayOrder: Joi.number().integer().min(0).default(0),
  // Same shape, independent value — the order this deity prints in on a
  // ticket, not the order it's offered for selection.
  printOrder: Joi.number().integer().min(0).default(0),
});

const updateSchema = Joi.object({
  code: Joi.string().trim().min(1).max(20),
  name: Joi.string().trim().min(2).max(100),
  tamilName: Joi.string().allow(""),
  printingGroup: objectId,
  status: Joi.number().valid(0, 1),
  displayOrder: Joi.number().integer().min(0),
  printOrder: Joi.number().integer().min(0),
});

module.exports = { createSchema, updateSchema };
