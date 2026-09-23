const Joi = require("joi");
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
  familyMembers: Joi.array().items(familyMemberSchema),
  maxFamilyMembers: Joi.number().integer().min(1).max(20),
  status: Joi.number().valid(0, 1),
});

/**
 * What staff may set when manually adding a devotee from the Customer
 * Master. Same login-creation contract as public self-registration's
 * `registerSchema` (name/email/mobile drive the account + activation
 * email) — family members can be filled in on the same form since staff
 * often already have them on hand, but `status`/`maxFamilyMembers` stay
 * admin-update-only concerns, set afterwards through the update route.
 */
const adminCreateSchema = Joi.object({
  name: Joi.string().trim().min(2).max(100).required(),
  email: Joi.string().trim().email({ tlds: false }).required(),
  mobileNumber: Joi.string().trim().min(6).required(),
  familyMembers: Joi.array().items(familyMemberSchema).max(5).default([]),
});

module.exports = { adminUpdateSchema, adminCreateSchema };
