const { Customer } = require("../../../models/customers");
const generateCustomerCode = require("../generate-customer-code");

/**
 * Shared "create the booking/profile record" step — the public register
 * flow, the admin User Master, and the seed scripts all go through this,
 * exactly as they all go through user.service.js's createPendingUser():
 * same function, different caller, authorization already checked upstream.
 */
async function createCustomerProfile({
  entityId,
  linkedUserId,
  name,
  mobileNumber,
  email,
  familyMembers,
  // Every caller of this shared helper is a real registration (public
  // register, admin-created, seed data) except the POS walk-in flow, which
  // explicitly passes false — see models/customers' own comment on the field.
  isRegistered = true,
  // Passed by the bulk-import commit so every Customer created in the same
  // batch lands inside its one all-or-nothing transaction — omitted by every
  // other caller, which just create()s standalone.
  session,
}) {
  const customerCode = await generateCustomerCode();

  const docs = await Customer.create(
    [
      {
        customerCode,
        entity: entityId,
        linkedUserId: linkedUserId || null,
        name,
        mobileNumber: mobileNumber || null,
        email,
        familyMembers: familyMembers || [],
        isRegistered,
      },
    ],
    { session }
  );
  return docs[0];
}

module.exports = createCustomerProfile;
