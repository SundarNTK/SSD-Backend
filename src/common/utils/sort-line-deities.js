/**
 * Mongoose can't apply a populate-level `sort` to a path nested inside a
 * document array — `lines.deities`, where `lines` is itself an array of
 * subdocuments, throws "Cannot populate with sort on path lines.deities
 * because it is a subproperty of a document array" the moment it's asked
 * to. So every "print order" populate of a booking/order's line deities
 * (see controllers/pos-orders, controllers/pos) populates plain, then
 * calls this to sort each line's already-populated deities array in JS —
 * same field + alphabetical tie-break every other deity listing uses.
 */
function sortLineDeities(doc, field) {
  for (const line of doc?.lines ?? []) {
    if (Array.isArray(line.deities) && line.deities.length > 1) {
      line.deities.sort((a, b) => {
        const diff = (a?.[field] ?? 0) - (b?.[field] ?? 0);
        if (diff !== 0) return diff;
        return String(a?.name ?? "").localeCompare(String(b?.name ?? ""));
      });
    }
  }
  return doc;
}

module.exports = { sortLineDeities };
