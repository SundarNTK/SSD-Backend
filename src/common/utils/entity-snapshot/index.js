/**
 * Denormalized snapshots embedded alongside every User/Customer ObjectId
 * reference throughout the system (createdBy, updatedBy, bookedBy,
 * processedBy, customer, ...) — lets any screen show "who did this" (name,
 * contact, role) without a populate() round trip. The ObjectId ref itself
 * is left completely untouched wherever this is used; the snapshot is a
 * pure addition, so every existing query/filter/populate keeps working
 * unchanged.
 *
 * The snapshot is frozen at write time, the same way Booking already
 * snapshots its line items (see models/bookings' own comment) — a later
 * name or role change doesn't retroactively rewrite history.
 *
 * User/Customer models are required lazily (inside the function bodies,
 * not at module load) because auditablePlugin — which calls these helpers
 * from a schema-level hook — is itself required BY those same model files,
 * so a top-level require here would be circular.
 */

async function buildUserSnapshot(userId) {
  if (!userId) return null;
  const { User } = require("../../../models/users");

  const user = await User.findById(userId)
    .select("name email mobileNumber userType entities")
    .populate("entities.roles", "name");
  if (!user) return null;

  let roleName = null;
  let roleId = null;
  if (user.userType === "SUPER_ADMIN") {
    roleName = "System Admin";
  } else {
    const defaultAssignment = user.getDefaultEntityAssignment?.() ?? user.entities?.[0];
    const firstRole = defaultAssignment?.roles?.[0];
    if (firstRole) {
      roleId = firstRole._id;
      roleName = firstRole.name;
    }
  }

  return {
    _id: user._id,
    name: user.name,
    email: user.email,
    mobileNo: user.mobileNumber ?? null,
    roleName,
    roleId,
  };
}

async function buildCustomerSnapshot(customerId) {
  if (!customerId) return null;
  const { Customer } = require("../../../models/customers");

  const customer = await Customer.findById(customerId).select("name email mobileNumber");
  if (!customer) return null;

  return {
    _id: customer._id,
    name: customer.name,
    email: customer.email,
    mobileNo: customer.mobileNumber ?? null,
  };
}

module.exports = { buildUserSnapshot, buildCustomerSnapshot };
