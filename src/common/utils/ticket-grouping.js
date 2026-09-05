/**
 * Resolves a booking's lines into physical print tickets, per the Print
 * Split Setting master (models/print-split-settings). Pure, no I/O — every
 * input here is already-loaded/populated data, so this is unit-testable
 * without a database. The caller (controllers/pos-orders'
 * getBookingTicketGroups) owns loading the booking, the Item/Service docs,
 * and the PrintSplitSetting singleton; this file only owns the resolution
 * and grouping rules themselves, so the same tested logic can be reused by
 * a future reprint screen without re-deriving it.
 *
 * Two responsibilities, deliberately kept separate (this mirrors the
 * business rule as specified): WHICH Print Group a line belongs to is
 * resolveLineUnits()'s job; HOW those resolved units get split into tickets
 * is buildTicketGroups()'s job.
 *
 * Resolution rule:
 *   - offeringDoc.isDeityMappingRequired === true  -> one unit PER deity on
 *     the line (Deity.printingGroup). A line can carry more than one deity
 *     (posOrderLineSchema.deities is an array), and the line's own
 *     lineTotal is a single flat charge for the whole line regardless of
 *     how many deities were selected (controllers/pos-orders' createOrder
 *     computes it as unitPrice * quantity only — never multiplied by deity
 *     count). Each deity's resolved unit therefore carries an even split of
 *     that one lineTotal (splitAmountEvenly below), not the line's full
 *     amount replicated onto every deity — replicating it would make each
 *     deity's own ticket overstate what was actually charged, and a
 *     Print-Group-Wise ticket combining several of a line's deities would
 *     sum to more than the customer ever paid. Cents that don't divide
 *     evenly go to the first few deities (in selection order) so the split
 *     amounts always sum back to exactly the original lineTotal.
 *   - offeringDoc.isDeityMappingRequired === false -> exactly one unit,
 *     using offeringDoc.printingGroup directly. No deity is invented.
 *
 * Never silently drops a line: a line whose required deity/group mapping is
 * missing throws, rather than being skipped.
 */

/**
 * Splits `totalAmount` into `count` shares that sum back to exactly
 * `totalAmount` (to the cent) — a plain `totalAmount / count` would leave
 * silent rounding drift (e.g. $10 / 3 = $3.333... per share, summing to
 * $9.99 or $10.01 depending how it's later rounded). Works in integer cents
 * throughout so the split itself never introduces floating-point error.
 */
function splitAmountEvenly(totalAmount, count) {
  const totalCents = Math.round(totalAmount * 100);
  const baseCents = Math.floor(totalCents / count);
  const remainderCents = totalCents - baseCents * count;
  return Array.from({ length: count }, (_, i) => (baseCents + (i < remainderCents ? 1 : 0)) / 100);
}

/**
 * Same even-split reasoning as splitAmountEvenly, for a line's quantity —
 * a line's quantity, like its lineTotal, is a single flat count for the
 * whole line regardless of how many deities were selected (one archana
 * performed per unit of quantity, split across however many deities it
 * names), not the full quantity repeated onto every deity's own ticket.
 * Whole-unit remainder goes to the first deities in order, same as cents
 * above — e.g. quantity 3 across 2 deities splits to [2, 1], never [3, 3].
 */
function splitQuantityEvenly(totalQuantity, count) {
  const base = Math.floor(totalQuantity / count);
  const remainder = totalQuantity - base * count;
  return Array.from({ length: count }, (_, i) => base + (i < remainder ? 1 : 0));
}

function resolveLineUnits(line, offeringDoc, populatedDeities) {
  if (!offeringDoc) {
    throw `Cannot resolve a print group for "${line.name}" — its Item/Service record could not be found.`;
  }

  if (offeringDoc.isDeityMappingRequired) {
    if (!populatedDeities || populatedDeities.length === 0) {
      throw `"${line.name}" requires a deity, but none was selected on this booking line.`;
    }
    const perDeityAmounts = splitAmountEvenly(line.lineTotal, populatedDeities.length);
    const perDeityQuantities = splitQuantityEvenly(line.quantity, populatedDeities.length);
    return populatedDeities.map((deity, index) => {
      const group = deity.printingGroup;
      if (!group) {
        throw `Deity "${deity.name}" has no Print Group configured — cannot resolve a ticket for "${line.name}".`;
      }
      return {
        line,
        isDeityBased: true,
        deityId: String(deity._id),
        deityName: deity.name,
        deityTamilName: deity.tamilName || null,
        offeringTamilName: offeringDoc.tamilName || null,
        printGroupId: String(group._id ?? group),
        printGroupName: group.name ?? null,
        allocatedLineTotal: perDeityAmounts[index],
        allocatedQuantity: perDeityQuantities[index],
      };
    });
  }

  const group = offeringDoc.printingGroup;
  if (!group) {
    throw `"${line.name}" has no Print Group configured (and does not require a deity) — cannot resolve a ticket.`;
  }
  return [
    {
      line,
      isDeityBased: false,
      deityId: null,
      deityName: null,
      deityTamilName: null,
      offeringTamilName: offeringDoc.tamilName || null,
      printGroupId: String(group._id ?? group),
      printGroupName: group.name ?? null,
      allocatedLineTotal: line.lineTotal,
      allocatedQuantity: line.quantity,
    },
  ];
}

function toTicketLine(unit) {
  return {
    name: unit.line.name,
    tamilName: unit.offeringTamilName,
    code: unit.line.code,
    quantity: unit.allocatedQuantity,
    unitPrice: unit.line.unitPrice,
    lineTotal: unit.allocatedLineTotal,
    deityName: unit.deityName,
    deityTamilName: unit.deityTamilName,
  };
}

function groupUnitsByKey(units, keyFn, headerFn) {
  const groups = new Map();
  // Accumulated in integer cents alongside each group, same reasoning as
  // splitAmountEvenly above — summing the already-rounded per-line amounts
  // as floats (0.1 + 0.2 style drift) could print a "Total" one cent off
  // from what the lines above it visibly add up to.
  const totalCentsByKey = new Map();
  for (const unit of units) {
    const key = keyFn(unit);
    if (!groups.has(key)) groups.set(key, { ...headerFn(unit), lines: [], devotees: [] });
    const group = groups.get(key);
    group.lines.push(toTicketLine(unit));
    totalCentsByKey.set(key, (totalCentsByKey.get(key) || 0) + Math.round((unit.allocatedLineTotal || 0) * 100));
    for (const devotee of unit.line.devotees || []) {
      const alreadyListed = group.devotees.some((d) => d.name === devotee.name && d.nakshatra === devotee.nakshatra);
      if (!alreadyListed) group.devotees.push({ name: devotee.name, nakshatra: devotee.nakshatra });
    }
  }
  for (const [key, group] of groups) {
    group.total = totalCentsByKey.get(key) / 100;
  }
  return Array.from(groups.values());
}

/**
 * @param {Array} units  flattened output of resolveLineUnits() across every
 *   line in the booking
 * @param {"DEITY_WISE"|"PRINT_GROUP_WISE"} splitMode
 * @returns {Array<{splitType, deityId, deityName, printGroupId, printGroupName, lines, devotees}>}
 */
function buildTicketGroups(units, splitMode) {
  if (splitMode === "DEITY_WISE") {
    // Deity-based units: one ticket per deity, merging across lines that
    // reference the same deity. Non-deity units are NEVER folded into a
    // deity's ticket — they keep grouping among themselves by their own
    // Print Group, same as PRINT_GROUP_WISE would.
    return groupUnitsByKey(
      units,
      (unit) => (unit.isDeityBased ? `deity:${unit.deityId}` : `group:${unit.printGroupId}`),
      (unit) => ({
        splitType: unit.isDeityBased ? "DEITY" : "GROUP",
        deityId: unit.isDeityBased ? unit.deityId : null,
        deityName: unit.isDeityBased ? unit.deityName : null,
        printGroupId: unit.isDeityBased ? null : unit.printGroupId,
        printGroupName: unit.isDeityBased ? null : unit.printGroupName,
      })
    );
  }

  // PRINT_GROUP_WISE (default) — every unit groups by its resolved Print
  // Group, whether that group came from a deity or directly from the
  // Item/Service.
  return groupUnitsByKey(units, (unit) => `group:${unit.printGroupId}`, (unit) => ({
    splitType: "GROUP",
    deityId: null,
    deityName: null,
    printGroupId: unit.printGroupId,
    printGroupName: unit.printGroupName,
  }));
}

module.exports = { resolveLineUnits, buildTicketGroups };
