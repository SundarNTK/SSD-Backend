const Joi = require("joi");

// Deliberately its own definition, not utilities/constants/schemas/family-member
// (used by the customer-update request objects) — that one requires a 2-100
// char name; this one only requires 1+. Register's validation predates the
// shared schema and unifying them would silently tighten what a public
// registrant is allowed to submit.
const familyMemberSchema = Joi.object({
  name: Joi.string().trim().min(1).required(),
  nakshatra: Joi.string().trim().allow("").default(""),
});

const loginSchema = Joi.object({
  email: Joi.string().trim().email({ tlds: false }).required(),
  password: Joi.string().min(1).required(),
});

const activateSchema = Joi.object({
  token: Joi.string().required(),
  newPassword: Joi.string().min(12).required(),
  confirmPassword: Joi.any().valid(Joi.ref("newPassword")).required().messages({
    "any.only": "Confirm password must match the new password.",
  }),
});

const forgotPasswordSchema = Joi.object({
  identifier: Joi.string().trim().min(3).required(),
});

// Mirrors the Customer Master fields (FSD §3.12) — register captures the full
// profile, not just login credentials, since a devotee's DOB/gender/family
// details are needed for temple service bookings from day one.
// `maxFamilyMembers`/`status` are deliberately NOT accepted here — those are
// admin-only concerns (the User Master), not something a public registrant
// can set on themselves.
const registerSchema = Joi.object({
  name: Joi.string().trim().min(2).max(100).required(),
  email: Joi.string().trim().email({ tlds: false }).required(),
  mobileNumber: Joi.string().trim().min(6).required(),
  dateOfBirth: Joi.date().iso().max("now").allow(null).default(null),
  gender: Joi.string().valid("MALE", "FEMALE", "OTHER").allow(null).default(null),
  familyMembers: Joi.array().items(familyMemberSchema).max(5).default([]),
});

const resetPasswordSchema = Joi.object({
  token: Joi.string().required(),
  newPassword: Joi.string().min(12).required(),
  confirmPassword: Joi.any().valid(Joi.ref("newPassword")).required().messages({
    "any.only": "Confirm password must match the new password.",
  }),
});

module.exports = { loginSchema, activateSchema, forgotPasswordSchema, resetPasswordSchema, registerSchema };
