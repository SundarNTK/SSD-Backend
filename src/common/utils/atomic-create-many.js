const mongoose = require("mongoose");

/**
 * Mongo errors that mean "this deployment has no replica set, so multi-
 * document transactions aren't available at all" — a local standalone
 * `mongodb://127.0.0.1:27017` (see config/env.js's MONGO_URI default), unlike
 * Atlas which is always at least a 3-node replica set, even on the free
 * tier. Anything else (a real validation/duplicate-key failure inside the
 * transaction) should propagate as-is.
 */
function isTransactionsUnsupported(err) {
  const msg = String(err?.message || "");
  return (
    err?.code === 20 || // IllegalOperation
    err?.codeName === "IllegalOperation" ||
    msg.includes("Transaction numbers are only allowed") ||
    msg.includes("This MongoDB deployment does not support") ||
    msg.includes("Transactions are not supported")
  );
}

/**
 * Inserts every document or none — the bulk-import commit needs this
 * because a partial write would leave an admin unable to tell which rows of
 * their spreadsheet actually landed versus which silently didn't.
 *
 * Uses `Model.create()` (not `insertMany()`) deliberately: every schema's
 * `auditablePlugin` (common/plugins/auditable.js) generates `uid` and the
 * `createdByInfo` snapshot from `pre("validate")`/`pre("save")` hooks, which
 * only fire on `save()` — `insertMany()` bypasses `save()` entirely and
 * would silently skip both.
 *
 * On a real replica set (Atlas, in production) this runs inside one actual
 * multi-document transaction. A local standalone MongoDB has no replica set
 * at all, so transactions are never available there — in that case this
 * falls back to inserting one at a time and, the moment any single insert
 * fails, deleting every document that already succeeded, so the net effect
 * is still all-or-nothing even without engine-level transaction support.
 */
async function atomicCreateMany(Model, docs) {
  if (!docs.length) return [];

  const session = await mongoose.startSession();
  try {
    let created;
    await session.withTransaction(async () => {
      created = await Model.create(docs, { session });
    });
    return created;
  } catch (err) {
    if (!isTransactionsUnsupported(err)) throw err;
  } finally {
    await session.endSession();
  }

  const created = [];
  try {
    for (const docData of docs) {
      const doc = new Model(docData);
      await doc.save();
      created.push(doc);
    }
    return created;
  } catch (err) {
    if (created.length) {
      await Model.deleteMany({ _id: { $in: created.map((d) => d._id) } });
    }
    throw err;
  }
}

module.exports = { atomicCreateMany };
