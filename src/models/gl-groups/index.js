const mongoose = require("mongoose");
const { auditablePlugin, activeUniqueIndexOptions } = require("../../common/plugins/auditable");

/**
 * One collection for all three levels of the GL Group tree, distinguished
 * by `level` — not three separate models. A level-2 document's `level1`
 * points at its parent; a level-3 document's `level1`/`level2` point at
 * both ancestors (kept as two fields, not just the immediate parent, so a
 * level-3 list can populate and display the full breadcrumb without an
 * extra lookup). Referenced by General Ledger's groupLevel1/2/3.
 */
const glGroupSchema = new mongoose.Schema({
  level: { type: Number, required: true, enum: [1, 2, 3] },
  name: { type: String, required: true, trim: true },
  description: { type: String, default: "" },
  level1: { type: mongoose.Schema.Types.ObjectId, ref: "GlGroup", default: null },
  level2: { type: mongoose.Schema.Types.ObjectId, ref: "GlGroup", default: null },
});

glGroupSchema.plugin(auditablePlugin);

// Unique within the same parent scope — two different Level 1 branches can
// each have a child named "Donation Income" without colliding.
glGroupSchema.index(
  { level: 1, level1: 1, level2: 1, name: 1 },
  activeUniqueIndexOptions({ collation: { locale: "en", strength: 2 } })
);
glGroupSchema.index({ level: 1, status: 1, createdAt: -1 });

module.exports = mongoose.model("GlGroup", glGroupSchema);
