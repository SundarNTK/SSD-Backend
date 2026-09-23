const Joi = require("joi");

/** Shared by both the self-service and admin customer-update request objects. */
const familyMemberSchema = Joi.object({
  nameEnglish: Joi.string().trim().min(2).max(100).required(),
  nameTamil: Joi.string().trim().allow("").default(""),
  natchathiram: Joi.string().trim().hex().length(24).allow(null, ""),
});

module.exports = familyMemberSchema;
