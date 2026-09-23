const Joi = require("joi");
const familyMemberSchema = require("../../utilities/constants/schemas/family-member");

/**
 * What a devotee may change about their own profile. Deliberately excludes
 * `customerCode`, `entity`, `linkedUserId`, `status`, and `maxFamilyMembers`
 * — those are the temple's to set, not the account holder's, and letting a
 * self-service route write them would be a quiet way to reassign a profile
 * or lift your own family-member cap.
 */
const updateMyProfileSchema = Joi.object({
  name: Joi.string().trim().min(2).max(100),
  mobileNumber: Joi.string().trim().allow(null, ""),
  familyMembers: Joi.array().items(familyMemberSchema),
});

module.exports = { updateMyProfileSchema };
