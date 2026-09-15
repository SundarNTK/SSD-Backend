const { HallBooking } = require("../../models/hall-bookings");

/** "13:30" -> 810. Used only for in-memory comparison, never persisted. */
function toMinutes(hhmm) {
  const [h, m] = String(hhmm).split(":").map(Number);
  return h * 60 + m;
}

function startOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function endOfDay(date) {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}

/**
 * The one overlap check every availability screen, Hall Booking's final
 * pre-confirm revalidation, and Reschedule's revalidation all share.
 *
 * Deliberately does the date/hall narrowing in the database (a Mongo query
 * on `eventDate` + `halls: {$in: hallIds}` is cheap and well-indexed — see
 * models/hall-bookings' own `{halls, eventDate, bookingStatus}` index) and
 * the actual time-overlap comparison in application code, the same way
 * controllers/gst's `rangesOverlap` does it for GST date ranges — the
 * per-hall, per-day result set is always small, so there's no need for a
 * more elaborate time-range query operator.
 *
 * A Hall Package is available only when EVERY hall in it clears this check
 * — since `halls` is populated the same way for an individual booking and
 * a package booking (see models/hall-bookings), passing every relevant
 * hall ID here handles both cases with the same query, no branching needed.
 */
async function checkHallAvailability({ hallIds, eventDate, startTime, endTime, excludeBookingId }) {
  const requestedStart = toMinutes(startTime);
  const requestedEnd = toMinutes(endTime);

  const filter = {
    bookingStatus: "confirmed",
    halls: { $in: hallIds },
    eventDate: { $gte: startOfDay(eventDate), $lte: endOfDay(eventDate) },
  };
  if (excludeBookingId) filter._id = { $ne: excludeBookingId };

  const candidates = await HallBooking.find(filter).select(
    "bookingNumber halls startTime endTime hallName hallPackageName customerInfo"
  );

  const conflicts = [];
  for (const candidate of candidates) {
    const candidateStart = toMinutes(candidate.startTime);
    const candidateEnd = toMinutes(candidate.endTime);
    const overlaps = requestedStart < candidateEnd && candidateStart < requestedEnd;
    if (!overlaps) continue;

    const conflictingHalls = candidate.halls
      .map((h) => String(h))
      .filter((h) => hallIds.some((id) => String(id) === h));

    conflicts.push({
      bookingNumber: candidate.bookingNumber,
      startTime: candidate.startTime,
      endTime: candidate.endTime,
      hallOrPackage: candidate.hallPackageName || candidate.hallName,
      conflictingHalls,
      customerName: candidate.customerInfo?.name ?? null,
    });
  }

  return { available: conflicts.length === 0, conflicts };
}

module.exports = { checkHallAvailability, toMinutes };
