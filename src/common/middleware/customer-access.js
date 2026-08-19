const { exceptionHandler } = require("../../utilities/handlers");
const ensureCustomerProfileForUser = require("../../utilities/helpers/ensure-customer-profile-for-user");

/**
 * The customer-side counterpart to adminOnly — and deliberately NOT its
 * mirror image.
 *
 * adminOnly is a restriction: CUSTOMER accounts are refused. This one is
 * not, because access runs one way only. Staff are devotees too, so every
 * signed-in account reaches the customer side; what an admin does NOT get
 * is a way to act as somebody else, which is why the profile is resolved
 * from `req.auth.userId` and never from anything the client sends. A
 * `customerId` in a body or query string is ignored by construction.
 *
 * Also acts as the backstop for the customer-pool invariant: accounts
 * created before enrolment was automatic get a profile here on first use,
 * so no route downstream has to handle "signed in but has no profile".
 *
 * Populates `req.customer`. Mount after authGuard.
 */
async function customerAccess(req, res, next) {
  try {
    const user = req.auth?.user;
    if (!user) {
      return exceptionHandler({ res, error: "Not authenticated.", statusCode: 401 });
    }

    const customer = await ensureCustomerProfileForUser(user, req.auth.entityId);
    if (!customer) {
      return exceptionHandler({
        res,
        error: "No devotee profile is available for this account.",
        statusCode: 404,
      });
    }

    req.customer = customer;
    return next();
  } catch (error) {
    return exceptionHandler({ res, error });
  }
}

module.exports = customerAccess;
