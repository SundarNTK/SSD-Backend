const Joi = require("joi");

/** Shared by both the self-service and admin customer-update request objects. */
const familyMemberSchema = Joi.object({
  name: Joi.string().trim().min(2).max(100).required(),
  nakshatra: Joi.string().trim().allow("").default(""),
});

module.exports = familyMemberSchema;
