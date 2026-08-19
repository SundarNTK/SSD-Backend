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
  });
}

module.exports = createCustomerProfile;
