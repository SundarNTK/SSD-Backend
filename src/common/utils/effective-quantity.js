/**
 * Deity-mapped offerings (Coconut Archanai, Navagraha Archanai, ...) are
 * priced and stocked per deity, not per an independently-typed quantity —
 * picking 3 deities at $5 each is a $15 line, and reserves/consumes 3 units
 * of inventory, the same as if "3" had been typed into a quantity box. A
 * line with no deities selected falls back to its own `quantity` as before
 * (a plain item like Ghee Lamp has no deity concept at all).
 *
 * Shared by controllers/pos and controllers/pos-orders — both price and
 * reserve/consume cart lines the same way, so this stays one definition
 * rather than two copies that could drift.
 */
function effectiveQuantity(line) {
  return line.deities && line.deities.length > 0 ? line.deities.length : line.quantity;
}

module.exports = { effectiveQuantity };
