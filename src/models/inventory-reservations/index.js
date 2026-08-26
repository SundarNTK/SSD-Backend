const mongoose = require("mongoose");

/**
 * Inventory Reservation — a temporary hold placed when a cart/order is
 * created, released either when:
 *  (a) the order is confirmed   → reservation is marked "consumed"
 *  (b) 30 minutes elapse        → reservation is marked "expired" by the
 *                                  cleanup job and the held quantity is
 *                                  returned to the pool
 *  (c) the order is cancelled   → same as (b), but immediate
 *
 * The hold is a SOFT lock on Item/Service.currentStock. The real stock is
 * NOT decremented at order creation — only at confirmation. What IS
 * decremented at order creation is the "available for new reservations"
 * calculation:
 *
 *   available = currentStock
 *             - SUM(active reservation quantities for this ref)
 *
 * This is computed at booking time by the summary endpoint and re-checked
 * atomically inside createOrder. The 30-minute TTL ensures a crashed or
 * abandoned session never permanently consumes stock.
 *
 * NOTE: this model intentionally does NOT use auditablePlugin — these are
 * transient operational records, not master data. They carry their own
 * minimal index set and no soft-delete.
 */
const inventoryReservationSchema = new mongoose.Schema(
  {
    orderId: { type: mongoose.Schema.Types.ObjectId, ref: "Order", required: true },
    refType: { type: String, enum: ["Item", "Service"], required: true },
    refId: { type: mongoose.Schema.Types.ObjectId, required: true },
    quantity: { type: Number, required: true, min: 1 },
    // "active" → holds quantity from the pool
    // "consumed" → order confirmed; permanent stock-out via InventoryAdjustment
    // "expired" → 30-min window passed; quantity returned
    // "cancelled" → order explicitly abandoned
    status: {
      type: String,
      enum: ["active", "consumed", "expired", "cancelled"],
      default: "active",
    },
    expiresAt: { type: Date, required: true },
    releasedAt: { type: Date, default: null },
  },
  { timestamps: true, versionKey: false }
);

// Primary query: "how much is currently reserved for this ref?"
inventoryReservationSchema.index({ refType: 1, refId: 1, status: 1 });
// Cleanup job: find all active reservations that have expired
inventoryReservationSchema.index({ status: 1, expiresAt: 1 });
// Order cancellation: find all reservations for a given order
inventoryReservationSchema.index({ orderId: 1, status: 1 });

module.exports = mongoose.model("InventoryReservation", inventoryReservationSchema);
