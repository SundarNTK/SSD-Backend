/**
 * Inventory Reservation helpers — the atomic mechanics of placing and
 * releasing temporary stock holds during the Admin Booking flow.
 *
 * Design decisions:
 *
 * 1. The "available quantity" a new cart line can claim is:
 *
 *      available = currentStock
 *                - SUM(active reservation quantities for this ref)
 *
 *    We never read a projected "net stock" column — it doesn't exist.
 *    We compute it here from two indexed queries, both cheap for the
 *    realistic catalogue size of a temple (tens to low hundreds of items).
 *
 * 2. The threshold acts as a permanent safety buffer, not a hard floor for
 *    individual reservations. The rule is:
 *
 *      max_reservable = currentStock - threshold
 *
 *    so if stock = 30 and threshold = 2, at most 28 units may be held at
 *    once across ALL active reservations. A single user asking for more than
 *    (max_reservable - already_reserved) is refused.
 *
 * 3. No MongoDB transactions are used here (no replica-set requirement).
 *    The write ordering is:
 *      a. Re-read currentStock and sum active reservations (both indexed).
 *      b. Write the InventoryReservation document.
 *      c. If (b) fails mid-flight, no stock was touched — safe.
 *    A concurrent request that sneaks in between (a) and (b) may
 *    over-reserve by a tiny amount. This is acceptable for a temple counter
 *    staffed by one or two admins; add a Mongo transaction if that changes.
 *
 * 4. The 30-minute hold is enforced by the cleanup job
 *    (src/utilities/helpers/release-expired-reservations.js), which is
 *    scheduled in server.js. The TTL index on InventoryReservation is a
 *    belt-and-suspenders fallback for the MongoDB TTL background task.
 */

const Item = require("../../models/items");
const Service = require("../../models/services");
const InventoryReservation = require("../../models/inventory-reservations");

const RESERVATION_TTL_MS = 30 * 60 * 1000; // 30 minutes

const REF_MODELS = { Item, Service };

/**
 * Returns the field name that gates inventory tracking for a given refType.
 */
function inventoryFlag(refType) {
  return refType === "Item" ? "isInventoryApplicable" : "isInventoryRequired";
}

/**
 * Returns the threshold field name for a given refType.
 */
function thresholdField(refType) {
  return refType === "Item" ? "threshold" : "thresholdCount";
}

/**
 * Sum of all active (non-expired, non-consumed, non-cancelled) reservation
 * quantities for a specific ref.
 *
 * Called inside createOrder to calculate how much stock remains claimable.
 */
async function sumActiveReservations(refType, refId) {
  const result = await InventoryReservation.aggregate([
    {
      $match: {
        refType,
        refId: typeof refId === "string" ? require("mongoose").Types.ObjectId.createFromHexString(refId) : refId,
        status: "active",
        expiresAt: { $gt: new Date() }, // belt-and-suspenders: ignore rows the cleanup job hasn't touched yet
      },
    },
    { $group: { _id: null, total: { $sum: "$quantity" } } },
  ]);
  return result[0]?.total ?? 0;
}

/**
 * Checks whether `requestedQty` units of `refType:refId` can be reserved
 * right now, and if so writes the InventoryReservation row.
 *
 * Returns the new reservation document on success.
 * Throws a plain string on business-rule violations (caught by exceptionHandler).
 *
 * @param {string} refType       "Item" | "Service"
 * @param {string|ObjectId} refId
 * @param {number} requestedQty
 * @param {string|ObjectId} orderId  The order this reservation belongs to
 */
async function placeReservation(refType, refId, requestedQty, orderId) {
  const Model = REF_MODELS[refType];
  const flag = inventoryFlag(refType);
  const tField = thresholdField(refType);

  const ref = await Model.findOne(
    Model.notDeletedFilter({ _id: refId, [flag]: true, status: 1 })
  ).select(`name code currentStock ${tField}`);

  if (!ref) {
    // Inventory not applicable for this item/service — no reservation needed
    return null;
  }

  const currentStock = ref.currentStock ?? 0;
  const threshold = ref[tField] ?? 0;
  // Maximum units that may ever be held simultaneously (stock minus safety buffer)
  const maxReservable = Math.max(0, currentStock - threshold);

  // How much is already held by other active reservations?
  const alreadyReserved = await sumActiveReservations(refType, refId);
  const remaining = maxReservable - alreadyReserved;

  if (requestedQty > remaining) {
    throw `Insufficient stock for "${ref.name}": only ${remaining} unit(s) available for booking (${currentStock} in stock, ${alreadyReserved} already reserved, ${threshold} safety buffer).`;
  }

  const expiresAt = new Date(Date.now() + RESERVATION_TTL_MS);

  const reservation = await InventoryReservation.create({
    orderId,
    refType,
    refId,
    quantity: requestedQty,
    status: "active",
    expiresAt,
  });

  return reservation;
}

/**
 * Place reservations for ALL inventory-applicable lines in a cart.
 * If any line fails, all previously placed reservations for this order
 * are immediately cancelled (best-effort rollback).
 *
 * @param {Array<{refType, refId, quantity}>} lines
 * @param {string|ObjectId} orderId
 * @returns {Array} array of InventoryReservation documents (null entries for non-inventory lines)
 */
async function placeReservationsForOrder(lines, orderId) {
  const placed = [];
  try {
    for (const line of lines) {
      const r = await placeReservation(line.refType, line.refId, line.quantity, orderId);
      placed.push(r);
    }
    return placed;
  } catch (err) {
    // Roll back any reservations already placed in this loop before re-throwing
    if (placed.length > 0) {
      const ids = placed.filter(Boolean).map((r) => r._id);
      await InventoryReservation.updateMany(
        { _id: { $in: ids } },
        { $set: { status: "cancelled", releasedAt: new Date() } }
      ).catch(() => {
        /* best-effort; cleanup job will catch any stragglers */
      });
    }
    throw err; // re-throw so the controller surfaces the message
  }
}

/**
 * Mark all active reservations for an order as "consumed" and write a
 * permanent InventoryAdjustment "Stock Out" row + decrement currentStock for
 * each inventory-applicable line.
 *
 * Called inside confirmBooking, after the Booking document is written.
 * Write ordering matches the inventory controller's existing pattern:
 *   1. Decrement currentStock on Item/Service
 *   2. Write InventoryAdjustment log row
 *   3. Mark reservation consumed
 *
 * @param {string|ObjectId} orderId
 * @param {Array<{refType, refId, quantity}>} lines
 * @param {string|ObjectId} bookedByUserId
 * @param {string} bookingNumber  used as remarks in the stock-out log
 */
async function consumeReservations(orderId, lines, bookedByUserId, bookingNumber) {
  const InventoryAdjustment = require("../../models/inventory-adjustments");

  for (const line of lines) {
    const Model = REF_MODELS[line.refType];
    const flag = inventoryFlag(line.refType);

    const ref = await Model.findOne(
      Model.notDeletedFilter({ _id: line.refId, [flag]: true })
    ).select("currentStock name code");

    if (!ref) continue; // not inventory-applicable — nothing to do

    const nextBalance = Math.max(0, (ref.currentStock ?? 0) - line.quantity);
    ref.currentStock = nextBalance;
    await ref.save();

    await InventoryAdjustment.create({
      refType: line.refType,
      refId: line.refId,
      inventoryType: "Stock Out",
      quantity: line.quantity,
      balance: nextBalance,
      remarks: `Booking ${bookingNumber}`,
      createdBy: bookedByUserId ?? null,
    });
  }

  // Mark all active reservations for this order consumed
  await InventoryReservation.updateMany(
    { orderId, status: "active" },
    { $set: { status: "consumed", releasedAt: new Date() } }
  );
}

/**
 * Immediately cancel all active reservations for an order (e.g. on
 * explicit cancellation or error rollback).
 */
async function cancelReservations(orderId) {
  await InventoryReservation.updateMany(
    { orderId, status: "active" },
    { $set: { status: "cancelled", releasedAt: new Date() } }
  );
}

/**
 * Quick availability check — returns the available-to-reserve quantity for
 * a ref WITHOUT writing anything. Used by the summary endpoint.
 *
 * @param {string} refType
 * @param {string|ObjectId} refId
 * @returns {{ isInventoryApplicable: boolean, currentStock: number, reservedQty: number, availableQty: number, threshold: number }}
 */
async function getAvailability(refType, refId) {
  const Model = REF_MODELS[refType];
  const flag = inventoryFlag(refType);
  const tField = thresholdField(refType);

  const ref = await Model.findOne(
    Model.notDeletedFilter({ _id: refId, status: 1 })
  ).select(`${flag} currentStock ${tField}`);

  if (!ref || !ref[flag]) {
    return { isInventoryApplicable: false, currentStock: 0, reservedQty: 0, availableQty: Infinity, threshold: 0 };
  }

  const currentStock = ref.currentStock ?? 0;
  const threshold = ref[tField] ?? 0;
  const reservedQty = await sumActiveReservations(refType, refId);
  const availableQty = Math.max(0, currentStock - threshold - reservedQty);

  return { isInventoryApplicable: true, currentStock, reservedQty, availableQty, threshold };
}

module.exports = {
  placeReservationsForOrder,
  consumeReservations,
  cancelReservations,
  getAvailability,
  RESERVATION_TTL_MS,
};
