const HallCategory = require("../../models/hall-categories");

/**
 * Column definitions for Hall's Excel import/export — mirrors
 * request-objects.js's createSchema. Excludes `hallImages` and `floorPlan`
 * (Cloudinary file uploads — same reasoning as every other master's image
 * exclusion).
 */
const fields = [
  { key: "name", header: "Name*", type: "string", required: true, maxLength: 100, helpText: "Hall name (max 100 characters)." },
  { key: "code", header: "Code*", type: "string", required: true, unique: true, maxLength: 30, helpText: "Unique code (max 30 characters). Stored in uppercase." },
  { key: "category", header: "Hall Category*", type: "ref", required: true, refModel: HallCategory, refLabelField: "name", helpText: "Must exactly match one of the active Hall Categories." },
  { key: "capacity", header: "Capacity*", type: "number", required: true, integer: true, min: 1, helpText: "Seating capacity, 1 or greater." },
  { key: "individualBookingRate", header: "Individual Booking Rate", type: "number", required: false, min: 0, default: null, helpText: "Rate when booked on its own, outside a Hall Package. Leave blank if not applicable." },
  { key: "minimumBookingDuration", header: "Minimum Booking Duration (hrs)", type: "number", required: false, min: 0, default: null, helpText: "Minimum booking duration in hours. Leave blank if not applicable." },
  { key: "depositAmount", header: "Deposit Amount", type: "number", required: false, min: 0, default: 0, helpText: "Leave blank for 0." },
];

function mapToDoc(resolved) {
  return {
    name: resolved.name,
    code: resolved.code,
    category: resolved.category,
    capacity: resolved.capacity,
    individualBookingRate: resolved.individualBookingRate,
    minimumBookingDuration: resolved.minimumBookingDuration,
    depositAmount: resolved.depositAmount,
  };
}

function sampleRows(refLookups) {
  const categoryName = refLookups.category?.docs?.[0]?.name ?? "Your Hall Category Name";
  return [{ name: "Main Wedding Hall", code: "WHALL01", category: categoryName, capacity: 300, individualBookingRate: 15000, minimumBookingDuration: 4, depositAmount: 5000 }];
}

module.exports = { fields, mapToDoc, sampleRows };
