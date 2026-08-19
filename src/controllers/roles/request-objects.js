const Joi = require("joi");
const { MODULE_KEYS } = require("../../utilities/constants/modules");

const createSchema = Joi.object({
  name: Joi.string().trim().min(2).max(100).required(),
  description: Joi.string().allow("").default(""),
  // Defaults to Active, but a role can be created parked so it isn't
  // assignable until whoever set it up has finished its permissions.
  status: Joi.number().valid(0, 1).default(1),
});

const updateSchema = Joi.object({
  name: Joi.string().trim().min(2).max(100),
  description: Joi.string().allow(""),
  status: Joi.number().valid(0, 1),
});

const permissionEntry = Joi.object({
  module: Joi.string()
    .valid(...MODULE_KEYS)
    .required(),
  view: Joi.boolean().default(false),
  edit: Joi.boolean().default(false),
  fullAccess: Joi.boolean().default(false),
});

const updatePermissionsSchema = Joi.object({
  permissions: Joi.array().items(permissionEntry).required(),
});

module.exports = { createSchema, updateSchema, updatePermissionsSchema };
