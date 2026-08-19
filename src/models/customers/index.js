const mongoose = require("mongoose");
const {
  auditablePlugin,
  activeUniqueIndexOptions,
  activeUniqueWhenPresent,
} = require("../../common/plugins/auditable");

/**
 * The booking/profile record — FSD §3.12. Distinct from `User` (the login
 * identity): a Customer can exist without ever having a login (a walk-in
 * POS entry, once POS is built), and a User's `entities[].roles` govern
 * what they can *do*, not who they *are* for booking purposes. When a
 * Customer is created alongside a registration or admin-created account,
 * `linkedUserId` connects the two; it's null for a pure walk-in.
 *
 * `nakshatra` on family members is plain text for now — it becomes an
 * ObjectId ref once the Nakshatra Master exists (Build Sequence §13, Day 3).
 */
const familyMemberSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    nakshatra: { type: String, default: "" },
  },
  { _id: false }
);

const GENDERS = ["MALE", "FEMALE", "OTHER"];

const customerSchema = new mongoose.Schema({
  customerCode: { type: String, required: true }, // uniqueness enforced by the partial index below, not here
  entity: { type: mongoose.Schema.Types.ObjectId, ref: "Entity", required: true },
  linkedUserId: { type: mongoose.Schema.Types.ObjectId, default: null }, // User lives in this same service — ref kept informal, see auditable.js's note on cross-service refs

  name: { type: String, required: true, trim: true },
  // Optional at the schema level, required by the flows that genuinely need
  // it (public registration, and POS walk-ins when that lands). Staff
  // accounts are enrolled in the customer pool automatically and may not
  // have supplied a mobile yet — refusing them a profile over it would mean
  // an admin couldn't book a pooja for their own family.
  mobileNumber: { type: String, default: null, trim: true },
  email: { type: String, required: true, trim: true, lowercase: true },
  dateOfBirth: { type: Date, default: null },
  gender: { type: String, enum: GENDERS, default: null },

  familyMembers: { type: [familyMemberSchema], default: [] },
  maxFamilyMembers: { type: Number, default: 5 },
});

customerSchema.plugin(auditablePlugin);

customerSchema.index({ customerCode: 1 }, activeUniqueIndexOptions());
customerSchema.index({ mobileNumber: 1 }, activeUniqueWhenPresent("mobileNumber")); // the primary POS lookup field (§10)
customerSchema.index({ email: 1 }, activeUniqueIndexOptions());
customerSchema.index({ linkedUserId: 1 }); // "which profile belongs to this login" — read on every customer-side request

customerSchema.pre("validate", function enforceFamilyMemberCap() {
  if (this.familyMembers.length > this.maxFamilyMembers) {
    throw new Error(`Only ${this.maxFamilyMembers} family member(s) allowed for this customer.`);
  }
});

module.exports = { Customer: mongoose.model("Customer", customerSchema), GENDERS };
