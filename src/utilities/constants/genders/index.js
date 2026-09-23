/**
 * Booking-time devotee gender (POS/hall-booking pooja details) — independent
 * of the Customer Master's own profile fields, which no longer carry a
 * gender field at all. Previously re-exported from models/customers; moved
 * here once that model stopped having a gender field of its own.
 */
const GENDERS = ["MALE", "FEMALE", "OTHER"];

module.exports = { GENDERS };
