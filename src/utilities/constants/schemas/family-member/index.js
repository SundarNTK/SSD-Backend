const Joi = require("joi");

/**
 * Shared by both the self-service and admin customer-update request objects.
 * Neither name is `.required()` — a family member may be recorded in only
 * one language (e.g. typed in Tamil at the POS counter and saved straight
 * onto the profile) without a matching English value invented to satisfy
 * validation.
 */
const familyMemberSchema = Joi.object({
  nameEnglish: Joi.string().trim().min(2).max(100).allow("").default(""),
  nameTamil: Joi.string().trim().allow("").default(""),
  natchathiram: Joi.string().trim().hex().length(24).allow(null, ""),
});

module.exports = familyMemberSchema;
