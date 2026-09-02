/**
 * Release Expired Inventory Reservations
 *
 * Runs on a fixed interval (every 5 minutes by default) after the server
 * boots. Finds every InventoryReservation that is still "active" but whose
 * expiresAt has passed, marks it "expired", and cancels the parent Order
 * if all of its reservations have now lapsed.
 *
 * No stock is decremented here — reservations are a SOFT hold. The real
 * currentStock only moves when a booking is confirmed (Stock Out via
 * InventoryAdjustment). Releasing a reservation simply means the held
 * quantity is once again available for new reservations.
 *
 * Why a periodic job instead of a MongoDB TTL index that auto-deletes?
 *   - We need to update the parent Order's status when its reservations
 *     expire — a TTL delete gives us no hook for that.
 *   - We want an "expired" audit trail, not a vanished document.
 *   - TTL resolution is only approximate (±60s by MongoDB spec), and this
 *     job runs at a shorter interval anyway.
 *
 * Scheduling: called from server.js after the DB connection is ready.
 */

const InventoryReservation = require("../../../models/inventory-reservations");
const { Order } = require("../../../models/orders");
const { PosOrder } = require("../../../models/pos-orders");

// InventoryReservation.orderId carries no discriminator for which
// collection minted it — Admin Booking's Order and the POS counter's own
// PosOrder (see models/pos-orders) both place reservations the exact same
// way (see controllers/pos/inventory-reservation.js, shared by both). So a
// reservation's parent is looked up in both, in order; the first match
// wins. An id can't collide between them (each is its own ObjectId space),
// so at most one of these two lookups ever finds anything.
const ORDER_MODELS = [Order, PosOrder];

/**
 * Process one batch of expired reservations.
 *
 * @returns {Promise<{ released: number, ordersCancelled: number }>}
 */
async function releaseExpiredReservations() {
  const now = new Date();

  // Find all active reservations that have passed their expiry
  const expired = await InventoryReservation.find({
    status: "active",
    expiresAt: { $lte: now },
  }).select("_id orderId");

  if (expired.length === 0) return { released: 0, ordersCancelled: 0 };

  const expiredIds = expired.map((r) => r._id);
  const affectedOrderIds = [...new Set(expired.map((r) => String(r.orderId)))];

  // Mark reservations expired
  await InventoryReservation.updateMany(
    { _id: { $in: expiredIds } },
    { $set: { status: "expired", releasedAt: now } }
  );

  // For each affected order: if it's still pending AND has no active
  // reservations left, mark it cancelled too
  let ordersCancelled = 0;
  for (const orderId of affectedOrderIds) {
    let OrderModel = null;
    for (const Model of ORDER_MODELS) {
      const match = await Model.findOne(Model.notDeletedFilter({ _id: orderId, orderStatus: "pending" })).select("_id");
      if (match) {
        OrderModel = Model;
        break;
      }
    }

    if (!OrderModel) continue; // already confirmed, cancelled, or not found in either collection

    // Check whether any reservation for this order is still active
    const stillActive = await InventoryReservation.countDocuments({
      orderId,
      status: "active",
      expiresAt: { $gt: now },
    });

    if (stillActive === 0) {
      await OrderModel.findByIdAndUpdate(orderId, { orderStatus: "cancelled" });
      ordersCancelled += 1;
    }
  }

  console.log(
    `>>> [reservation-cleanup] Released ${expiredIds.length} reservation(s), ` +
      `cancelled ${ordersCancelled} order(s) at ${now.toISOString()}`
  );

  return { released: expiredIds.length, ordersCancelled };
}

/**
 * Start the periodic cleanup job.
 *
 * @param {number} [intervalMs=300_000] How often to run (default: 5 minutes)
 * @returns {NodeJS.Timeout} The interval handle — store it if you need to
 *   stop the job cleanly (e.g. in tests).
 */
function startReservationCleanupJob(intervalMs = 5 * 60 * 1000) {
  // Run once immediately on startup to catch any reservations that expired
  // while the server was down
  releaseExpiredReservations().catch((err) => {
    console.error(">>> [reservation-cleanup] Initial run failed:", err);
  });

  const handle = setInterval(() => {
    releaseExpiredReservations().catch((err) => {
      console.error(">>> [reservation-cleanup] Interval run failed:", err);
    });
  }, intervalMs);

  // Don't keep Node alive just for the cleanup job
  if (handle.unref) handle.unref();

  console.log(
    `>>> [reservation-cleanup] Job scheduled every ${intervalMs / 1000}s`
  );

  return handle;
}

module.exports = { releaseExpiredReservations, startReservationCleanupJob };
