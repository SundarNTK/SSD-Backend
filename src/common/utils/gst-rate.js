const Gst = require("../../models/gst");
const { canonicalGstType, isZeroRateGstType, gstTypeMatchValues } = require("../../utilities/constants/gst-types");

/**
 * The one place "which GST rate applies" gets decided. A General Ledger
 * account picks a GST Type (e.g. "Standard Rated"), not a specific dated
 * GST Master record — the actual percentage is resolved here by matching
 * that type against whichever record's effective date range covers
 * `documentDate` (defaults to now, i.e. transaction time for a live POS
 * sale). GST Master enforces non-overlapping date ranges per type (see
 * controllers/gst), so at most one record should ever match.
 *
 * Falls back to 0 if the type is zero-rated (Zero-Rated/Exempt/Out of
 * Scope/NA) or if no record is configured for that type/date yet — a
 * missing rate never blocks a sale, it just charges no GST on it.
 */
async function resolveGstRate(gstType, documentDate = new Date()) {
  if (!gstType) return 0;
  const type = canonicalGstType(gstType);
  if (isZeroRateGstType(type)) return 0;

  const doc = new Date(documentDate);
  const record = await Gst.findOne({
    isDeleted: false,
    status: 1,
    type: { $in: gstTypeMatchValues(type) },
    effectiveStartDate: { $lte: doc },
    $or: [{ effectiveEndDate: null }, { effectiveEndDate: { $gte: doc } }],
  }).sort({ effectiveStartDate: -1 });

  return record?.percentage ?? 0;
}

module.exports = { resolveGstRate };
