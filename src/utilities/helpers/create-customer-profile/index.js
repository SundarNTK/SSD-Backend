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
  dateOfBirth,
  gender,
  familyMembers,
  // Every caller of this shared helper is a real registration (public
  // register, admin-created, seed data) except the POS walk-in flow, which
  // explicitly passes false — see models/customers' own comment on the field.
  isRegistered = true,
}) {
  const customerCode = await generateCustomerCode();

  return Customer.create({
    customerCode,
    entity: entityId,
    linkedUserId: linkedUserId || null,
    name,
    mobileNumber: mobileNumber || null,
    email,
    dateOfBirth: dateOfBirth || null,
    gender: gender || null,
    familyMembers: familyMembers || [],
    isRegistered,
  });
}

module.exports = createCustomerProfile;
