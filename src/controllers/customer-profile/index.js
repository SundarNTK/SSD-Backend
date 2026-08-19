const express = require("express");
const authGuard = require("../../common/middleware/auth-guard");
const customerAccess = require("../../common/middleware/customer-access");
const validateBody = require("../../common/middleware/validate");
const { responseHandler, exceptionHandler } = require("../../utilities/handlers");
const { Customer } = require("../../models/customers");
const { updateMyProfileSchema } = require("./request-objects");

/**
 * Customer-side, self-service. Every handler here operates on
 * `req.customer` — the profile the customerAccess middleware resolved from
 * the session — so there is no id in any of these routes to tamper with,
 * and an admin hitting them acts as themselves rather than as a devotee
 * they picked.
 *
 * Mounted at /me so the path itself states the scope — see routes/index.js.
 * Note what is absent: no requirePermission. Module permissions answer
 * "which parts of the temple's administration may this staff member touch",
 * and none of that applies to a devotee reading their own profile. The
 * authorization here is structural instead — every route resolves its
 * subject from the session, so the only record you can reach is your own.
 */

async function getMyProfile(req, res) {
  return responseHandler({ res, response: req.customer });
}

async function updateMyProfile(req, res) {
  try {
    const customer = req.customer;
    const { name, mobileNumber, dateOfBirth, gender, familyMembers } = req.body;

    if (mobileNumber !== undefined && mobileNumber !== customer.mobileNumber) {
      const normalized = mobileNumber || null;
      if (normalized) {
        const taken = await Customer.exists(
          Customer.notDeletedFilter({ mobileNumber: normalized, _id: { $ne: customer._id } })
        );
        if (taken) throw "Another devotee profile already uses this mobile number.";
      }
      customer.mobileNumber = normalized;
    }

    if (name !== undefined) customer.name = name;
    if (dateOfBirth !== undefined) customer.dateOfBirth = dateOfBirth;
    if (gender !== undefined) customer.gender = gender;
    // The pre-validate hook enforces maxFamilyMembers — the cap is the
    // temple's setting, so it is never read from the request body.
    if (familyMembers !== undefined) customer.familyMembers = familyMembers;

    customer.updatedBy = req.auth?.userId || null;
    await customer.save();

    return responseHandler({ res, response: customer, successMessage: "Profile updated successfully." });
  } catch (error) {
    if (error?.code === 11000) {
      return exceptionHandler({ res, error: "Another devotee profile already uses this mobile number.", statusCode: 409 });
    }
    return exceptionHandler({ res, error });
  }
}

const router = express.Router();
router.use(authGuard, customerAccess);

router.get("/customer-profile", getMyProfile);
router.put("/customer-profile", validateBody(updateMyProfileSchema), updateMyProfile);

module.exports = router;
