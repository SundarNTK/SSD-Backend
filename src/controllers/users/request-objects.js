const Joi = require("joi");

const objectId = Joi.string().hex().length(24);

/**
 * No `userType` field, on either schema.
 *
 * Everything created through the User master is an Admin_Users account —
 * the controller sets it, the request cannot. That removes a whole class of
 * question ("what happens if someone posts userType: SUPER_ADMIN?") rather
 * than answering it, and matches how the public register endpoint has always
 * worked: it only ever produces Customers, and takes no say in the matter
 * from the caller either.
 *
 * `roleIds` arrives as a JSON string when the form is submitted as
 * multipart (which it is, whenever a profile image is attached), so both
 * shapes are accepted and normalised to an array.
 */
const roleIdsField = Joi.alternatives()
  .try(
    Joi.array().items(objectId),
    Joi.string().custom((value, helpers) => {
      try {
        const parsed = JSON.parse(value);
        if (!Array.isArray(parsed)) return helpers.error("any.invalid");
        return parsed;
      } catch {
        return helpers.error("any.invalid");
      }
    })
  )
  .default([])
  .messages({ "any.invalid": "Roles must be a list of role ids." });

// Booleans arrive as the string "true"/"false" whenever the form is
// submitted as multipart (same reason roleIdsField accepts a JSON string —
// a profile image forces multipart, which flattens everything to strings).
const posAccessField = Joi.alternatives().try(Joi.boolean(), Joi.string().valid("true", "false")).custom((value) =>
  value === "true" ? true : value === "false" ? false : value
);

const createSchema = Joi.object({
  name: Joi.string().trim().min(2).max(100).required(),
  email: Joi.string().trim().email({ tlds: false }).required(),
  mobileNumber: Joi.string().trim().allow(null, "").default(null),
  roleIds: roleIdsField,
  accessUpto: Joi.date().iso().allow(null, "").default(null),
  status: Joi.number().valid(0, 1).default(1),
  profileImage: Joi.string().allow(null, "").default(null),
  posAccess: posAccessField.default(false),
});

const updateSchema = Joi.object({
  name: Joi.string().trim().min(2).max(100),
  email: Joi.string().trim().email({ tlds: false }),
  mobileNumber: Joi.string().trim().allow(null, ""),
  roleIds: roleIdsField,
  accessUpto: Joi.date().iso().allow(null, ""),
  status: Joi.number().valid(0, 1),
  profileImage: Joi.string().allow(null, ""),
  posAccess: posAccessField,
});

module.exports = { createSchema, updateSchema };
