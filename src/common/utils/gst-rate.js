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

/**
 * Splits GST out of a set of GST-inclusive line grosses, rate group by
 * rate group, so each group's line-level gstAmount/glAmount figures sum
 * EXACTLY to a single extraction on that group's combined gross — no
 * per-line rounding drift against the cart/order total. Lines sharing a
 * `gstRate` (typically every Standard Rated line at the current rate) are
 * one group; a 0%/missing rate line just gets gstAmount 0.
 *
 * Uses the largest-remainder method: the group's rounded GST (in cents) is
 * distributed across its lines by each line's ideal proportional share,
 * floored, with the leftover cents (there are at most a few, one per
 * group) handed one each to the lines with the largest fractional
 * remainder — the standard way to divide a rounded total across several
 * line items without any of them drifting from what the group's own total
 * says it should be.
 *
 * @param {{ gstRate: number, lineGross: number }[]} lines
 * @returns {{ gstAmount: number, glAmount: number }[]} one result per input line, same order
 */
function allocateGstAcrossLines(lines) {
  const results = new Array(lines.length);
  const groups = new Map();

  lines.forEach((line, index) => {
    if (!line.gstRate || line.gstRate <= 0) {
      results[index] = { gstAmount: 0, glAmount: +line.lineGross.toFixed(2) };
      return;
    }
    if (!groups.has(line.gstRate)) groups.set(line.gstRate, []);
    groups.get(line.gstRate).push({ index, lineGross: line.lineGross });
  });

  for (const [rate, group] of groups) {
    const groupGross = group.reduce((sum, g) => sum + g.lineGross, 0);
    const groupGstCents = Math.round(+(groupGross * (rate / (100 + rate))).toFixed(2) * 100);

    const shares = group.map((g) => {
      const idealCents = groupGross > 0 ? (g.lineGross / groupGross) * groupGstCents : 0;
      const flooredCents = Math.floor(idealCents);
      return { ...g, cents: flooredCents, remainder: idealCents - flooredCents };
    });

    const leftover = groupGstCents - shares.reduce((sum, s) => sum + s.cents, 0);
    const byRemainder = [...shares].sort((a, b) => b.remainder - a.remainder || a.index - b.index);
    for (let i = 0; i < leftover; i++) byRemainder[i].cents += 1;

    for (const s of shares) {
      const gstAmount = s.cents / 100;
      results[s.index] = { gstAmount, glAmount: +(s.lineGross - gstAmount).toFixed(2) };
    }
  }

  return results;
}

module.exports = { resolveGstRate, allocateGstAcrossLines };
