const mongoose = require("mongoose");

/**
 * Atomic, race-safe sequence numbers — for customerCode today, and any
 * other master that needs an auto-incrementing display code (itemCode,
 * transactionNo, ...) later. A plain "count documents then +1" races under
 * concurrent creates (the exact class of bug the blueprint's concurrency
 * section warns about); this uses a single atomic $inc instead.
 */
const counterSchema = new mongoose.Schema(
  { name: { type: String, required: true, unique: true }, value: { type: Number, default: 0 } },
  { versionKey: false }
);
const Counter = mongoose.models.Counter || mongoose.model("Counter", counterSchema);

async function nextSequence(name) {
  const counter = await Counter.findOneAndUpdate(
    { name },
    { $inc: { value: 1 } },
    { upsert: true, returnDocument: "after" }
  );
  return counter.value;
}

module.exports = { nextSequence };