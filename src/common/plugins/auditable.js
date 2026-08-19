const mongoose = require("mongoose");
const { generateUid } = require("../utils/uid");

/**
 * Shared schema plugin — every master/collection in the platform blueprint
 * (§10) carries the same uid/status/isDeleted/audit fields and the same
 * soft-delete rule. Apply this plugin once per schema instead of retyping
 * these fields on every model.
 */
function auditablePlugin(schema) {
  // `uid` is skipped where a schema already declares its own (Entity carries
  // a UUID predating this), so applying the plugin never silently redefines
  // a field a model deliberately set up differently.
  const hasOwnUid = Boolean(schema.path("uid"));

  schema.add({
    // No `index: true` here — that auto-creates a plain non-unique `uid_1`,
    // which then collides by name with the explicit unique index declared
    // below and makes syncIndexes fail outright.
    ...(hasOwnUid ? {} : { uid: { type: String, default: null } }),
    status: { type: Number, enum: [0, 1], default: 1 }, // 1 = Active, 0 = Inactive
    isDeleted: { type: Boolean, default: false },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  });

  if (!hasOwnUid) {
    /**
     * Generated in a pre-validate hook rather than as a `default` so the
     * retry below can reissue it. A 10-char uid from this alphabet has ~10^18
     * combinations, so a collision is vanishingly unlikely — but "vanishingly
     * unlikely" across every master forever is not the same as impossible,
     * and the unique index would surface it as a hard write failure.
     */
    schema.pre("validate", function assignUid() {
      if (!this.uid) this.uid = generateUid();
    });

    schema.post("save", function retryOnUidCollision(error, doc, next) {
      const isUidCollision =
        error?.code === 11000 && Object.keys(error?.keyPattern || {}).includes("uid");
      if (isUidCollision) {
        doc.uid = generateUid();
        return next(new Error("uid collision — a fresh uid was assigned, please retry the save"));
      }
      return next(error);
    });

    schema.index({ uid: 1 }, { unique: true, partialFilterExpression: { uid: { $type: "string" } } });
  }

  schema.set("timestamps", true);
  schema.set("versionKey", false);

  // Every "list active records" query on every master shares this shape —
  // controllers should spread this in rather than writing { isDeleted: false } by hand.
  schema.statics.notDeletedFilter = function notDeletedFilter(extra = {}) {
    return { isDeleted: false, ...extra };
  };

  schema.methods.softDelete = function softDelete(byUserId) {
    this.isDeleted = true;
    this.status = 0;
    this.updatedBy = byUserId || this.updatedBy;
    return this.save();
  };
}

/**
 * The partial-unique-index shape documented in the blueprint's soft-delete
 * standard — a uniqueness rule that only applies among non-deleted
 * documents, so a soft-deleted email/code can be reused later.
 *
 * Do NOT pass `sparse: true` in `extra` to make a field "unique only when
 * present": MongoDB rejects an index that combines `sparse` with
 * `partialFilterExpression`, and the rejection is quiet — Mongoose logs it
 * and the app runs on with no index at all, so the constraint you think you
 * declared isn't enforced. Use `activeUniqueWhenPresent()` below instead.
 */
function activeUniqueIndexOptions(extra = {}) {
  return {
    unique: true,
    partialFilterExpression: { isDeleted: { $eq: false } },
    ...extra,
  };
}

/**
 * Unique among non-deleted documents, but only across those that actually
 * hold a value — so any number of records may leave the field null.
 *
 * Needed wherever an optional field still has to be unique when filled in
 * (mobile numbers on both User and Customer). Expressing "only when present"
 * as part of the partial filter is the one way to combine it with the
 * soft-delete scoping above.
 */
function activeUniqueWhenPresent(field, extra = {}) {
  return {
    unique: true,
    partialFilterExpression: {
      isDeleted: { $eq: false },
      [field]: { $type: "string" },
    },
    ...extra,
  };
}

module.exports = { auditablePlugin, activeUniqueIndexOptions, activeUniqueWhenPresent };