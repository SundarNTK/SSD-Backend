const findCustomerByLinkedUserId = require("../find-customer-by-linked-user-id");
const createCustomerProfile = require("../create-customer-profile");

/**
 * Enrols a login in the customer pool, idempotently.
 *
 * Every account that can sign in — staff included — gets a profile here, so
 * that "am I allowed on the customer side" is never a question about role.
 * Temple staff are devotees too; an admin has to be able to book a pooja
 * for their own family without a second, separate account.
 *
 * Safe to call repeatedly: returns the existing profile if there is one.
 * That matters because it runs from four places (registration, admin user
 * create, admin user update, and the customer-side guard as a backstop for
 * accounts that predate this) and must never produce a second profile.
 */
async function ensureCustomerProfileForUser(user, entityId) {
  const existing = await findCustomerByLinkedUserId(user._id);
  if (existing) return existing;

  return createCustomerProfile({
    entityId: entityId || user.getDefaultEntityAssignment?.()?.entity,
    linkedUserId: user._id,
    name: user.name,
    mobileNumber: user.mobileNumber,
    email: user.email,
  });
}

module.exports = ensureCustomerProfileForUser;
