/**
 * Enriches booking-line devotees for thermal ticket print: Tamil star
 * (Nakshathiram.tamilName) and Tamil devotee name (transliterate Latin
 * input when needed). Pure side-effect-free helpers plus one I/O entry
 * used by computeBookingTicketGroups so print never depends on the POS
 * cashier having typed Tamil at the counter.
 */

const Nakshathiram = require("../../models/nakshathirams");

const TAMIL_SCRIPT = /[\u0B80-\u0BFF]/;
const HAS_LATIN = /[A-Za-z]/;

const translitCache = new Map();
const TRANSLIT_CACHE_LIMIT = 500;

function looksTamil(text) {
  return TAMIL_SCRIPT.test(String(text || ""));
}

function needsTamilName(text) {
  const t = String(text || "").trim();
  if (!t) return false;
  if (looksTamil(t)) return false;
  return HAS_LATIN.test(t);
}

async function transliterateToTamil(text) {
  const trimmed = String(text || "").trim();
  if (!trimmed) return "";
  if (looksTamil(trimmed)) return trimmed;

  const cacheKey = trimmed.toLowerCase();
  if (translitCache.has(cacheKey)) return translitCache.get(cacheKey);

  const url = `https://inputtools.google.com/request?text=${encodeURIComponent(trimmed)}&itc=ta-t-i0-und&num=5&cp=0&cs=1&ie=utf-8&oe=utf-8`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3500);
  let candidate = "";
  try {
    const apiRes = await fetch(url, { signal: controller.signal });
    if (apiRes.ok) {
      const body = await apiRes.json();
      if (body?.[0] === "SUCCESS") {
        candidate = body?.[1]?.[0]?.[1]?.[0] ?? "";
      }
    }
  } catch {
    candidate = "";
  } finally {
    clearTimeout(timeout);
  }

  // Multi-word names sometimes fail as one blob — try word-by-word.
  if (!candidate && /\s/.test(trimmed)) {
    const parts = trimmed.split(/\s+/).filter(Boolean);
    const translatedParts = [];
    for (const part of parts) {
      // eslint-disable-next-line no-await-in-loop -- sequential keeps the free API kinder
      translatedParts.push((await transliterateToTamil(part)) || part);
    }
    candidate = translatedParts.join(" ");
  }

  if (candidate) {
    if (translitCache.size >= TRANSLIT_CACHE_LIMIT) {
      translitCache.delete(translitCache.keys().next().value);
    }
    translitCache.set(cacheKey, candidate);
  }

  return candidate || trimmed;
}

async function loadNakshatraTamilMap() {
  const rows = await Nakshathiram.find(Nakshathiram.notDeletedFilter({ status: 1 }))
    .select("name tamilName")
    .lean();
  const map = new Map();
  for (const row of rows) {
    const key = String(row.name || "")
      .trim()
      .toLowerCase();
    if (key && row.tamilName) map.set(key, row.tamilName);
  }
  return map;
}

/**
 * Mutates a booking document's lines[].devotees in place (name + nakshatra
 * replaced with Tamil for print). Safe to call before ticket-grouping —
 * the in-memory booking is never saved back.
 */
async function enrichBookingDevoteesForPrint(booking) {
  if (!booking?.lines?.length) return booking;

  const hasDevotees = booking.lines.some((l) => (l.devotees || []).length > 0);
  if (!hasDevotees) return booking;

  const nakshatraMap = await loadNakshatraTamilMap();

  const uniqueNames = new Set();
  for (const line of booking.lines) {
    for (const d of line.devotees || []) {
      if (needsTamilName(d.name)) uniqueNames.add(String(d.name).trim());
    }
  }

  const nameTamilByEnglish = new Map();
  await Promise.all(
    [...uniqueNames].map(async (english) => {
      nameTamilByEnglish.set(english, await transliterateToTamil(english));
    })
  );

  for (const line of booking.lines) {
    if (!line.devotees?.length) continue;
    line.devotees = line.devotees.map((d) => {
      const englishName = String(d.name || "").trim();
      const englishStar = String(d.nakshatra || "").trim();
      const tamilName =
        (needsTamilName(englishName) ? nameTamilByEnglish.get(englishName) : null) ||
        (looksTamil(englishName) ? englishName : englishName);
      const tamilStar =
        nakshatraMap.get(englishStar.toLowerCase()) ||
        (looksTamil(englishStar) ? englishStar : englishStar);
      return {
        name: tamilName,
        nakshatra: tamilStar,
      };
    });
  }

  return booking;
}

module.exports = {
  enrichBookingDevoteesForPrint,
  transliterateToTamil,
  loadNakshatraTamilMap,
};
