const Joi = require("joi");
const { GENDERS } = require("../../models/customers");
const familyMemberSchema = require("../../utilities/constants/schemas/family-member");

/**
 * What temple staff may change about someone else's devotee record. Wider
 * than the self-service schema — it adds `status` and the family-member cap,
 * both of which are the temple's call — but still excludes `customerCode`,
 * `entity`, and `linkedUserId`: the code is sequence-generated, and
 * repointing `linkedUserId` would silently hand one devotee's profile to a
 * different login.
 */
const adminUpdateSchema = Joi.object({
  name: Joi.string().trim().min(2).max(100),
  mobileNumber: Joi.string().trim().allow(null, ""),
  email: Joi.string().trim().email({ tlds: false }),
  dateOfBirth: Joi.date().iso().max("now").allow(null).messages({
    "date.max": "Date of birth can't be in the future.",
  }),
  gender: Joi.string()
    .valid(...GENDERS)
    .allow(null),
  familyMembers: Joi.array().items(familyMemberSchema),
  maxFamilyMembers: Joi.number().integer().min(1).max(20),
  status: Joi.number().valid(0, 1),
});

module.exports = { adminUpdateSchema };
