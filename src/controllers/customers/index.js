const express = require("express");
const authGuard = require("../../common/middleware/auth-guard");
const adminOnly = require("../../common/middleware/admin-only");
const requirePermission = require("../../common/middleware/require-permission");
const validateBody = require("../../common/middleware/validate");
const { responseHandler, exceptionHandler, queryHandler } = require("../../utilities/handlers");
const { Customer } = require("../../models/customers");
const { User } = require("../../models/users");
const { adminUpdateSchema } = require("./request-objects");

/**
 * Admin-side devotee master — staff looking at everyone's records, as
 * opposed to controllers/customer-profile where a person reads their own.
 *
 * There is deliberately no create here. A devotee record arrives either
 * with a registration or, once POS exists, as a walk-in at the counter —
 * both of which carry context (a login to link, or a sale in progress) that
 * a bare "add customer" form would lose.
 */
async function list(req, res) {
  try {
    const { page, pageSize, skip, filter, sort } = queryHandler(req, {
      notDeletedFilter: Customer.notDeletedFilter,
      searchFields: ["customerCode", "name", "mobileNumber", "email", "uid"],
    });

    const [items, total] = await Promise.all([
      Customer.find(filter).sort(sort).skip(skip).limit(pageSize),
      Customer.countDocuments(filter),
    ]);

    // "Has this devotee set their password yet?" lives on the User record,
    // not here — a walk-in profile has no login at all. Resolved in one
    // extra query for the whole page rather than per row.
    const linkedIds = items.map((c) => c.linkedUserId).filter(Boolean);
    const logins = linkedIds.length
      ? await User.find({ _id: { $in: linkedIds } }).select("passwordSetAt lastLoginAt uCode")
      : [];
    const loginById = new Map(logins.map((u) => [String(u._id), u]));

    const withLoginState = items.map((customer) => {
      const login = customer.linkedUserId ? loginById.get(String(customer.linkedUserId)) : null;
      return {
        ...customer.toObject(),
        uCode: login?.uCode ?? null,
        passwordSetAt: login?.passwordSetAt ?? null,
        hasSetPassword: Boolean(login?.passwordSetAt),
        hasLogin: Boolean(login),
      };
    });

    return responseHandler({ res, response: { items: withLoginState, total, page, pageSize } });
  } catch (error) {
    return exceptionHandler({ res, error });
  }
}

async function update(req, res) {
  try {
    const customer = await Customer.findOne(Customer.notDeletedFilter({ _id: req.params.id }));
    if (!customer) return exceptionHandler({ res, error: "Devotee profile not found.", statusCode: 404 });

    const { name, mobileNumber, email, dateOfBirth, gender, familyMembers, maxFamilyMembers, status } = req.body;

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

    if (email && email.toLowerCase() !== customer.email) {
      const taken = await Customer.exists(
        Customer.notDeletedFilter({ email: email.toLowerCase(), _id: { $ne: customer._id } })
      );
      if (taken) throw "Another devotee profile already uses this email.";
      customer.email = email.toLowerCase();
    }

    if (name !== undefined) customer.name = name;
    if (dateOfBirth !== undefined) customer.dateOfBirth = dateOfBirth;
    if (gender !== undefined) customer.gender = gender;
    if (familyMembers !== undefined) customer.familyMembers = familyMembers;
    if (maxFamilyMembers !== undefined) customer.maxFamilyMembers = maxFamilyMembers;
    if (status !== undefined) customer.status = status;

    customer.updatedBy = req.auth?.userId || null;
    await customer.save();

    return responseHandler({ res, response: customer, successMessage: "Devotee profile updated successfully." });
  } catch (error) {
    if (error?.code === 11000) {
      return exceptionHandler({ res, error: "Those details are already used by another profile.", statusCode: 409 });
    }
    return exceptionHandler({ res, error });
  }
}

/**
 * Kept in a separate router from controllers/customer-profile on purpose.
 * That one is the devotee's own `/me` surface with no module permission at
 * all; this one is staff reading other people's records and is gated like
 * every other master. Same model, two genuinely different authorization
 * stories, so two routers rather than one file with branching inside it.
 */
const router = express.Router();
router.use(authGuard, adminOnly);

router.get("/", requirePermission("customers", "view"), list);
router.put("/:id", requirePermission("customers", "edit"), validateBody(adminUpdateSchema), update);

module.exports = router;
