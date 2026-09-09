const mongoose = require("mongoose");
const { auditablePlugin, activeUniqueIndexOptions } = require("../../common/plugins/auditable");

const deitySchema = new mongoose.Schema({
  code: { type: String, required: true, trim: true, uppercase: true },
  name: { type: String, required: true, trim: true },
  tamilName: { type: String, default: "" },
  printingGroup: { type: mongoose.Schema.Types.ObjectId, ref: "PrintingGroup", required: true },
  // Admin-entered ordering — every place a deity list is shown or offered
  // for selection (Deity Master itself, the Item/Service/Event "Deity
  // Mapping" pickers, the POS cart's Deities multi-select, ticket printing
  // order) sorts by this ascending, then by name for deities sharing the
  // same value. Defaults to 0 so an unset deity sorts alongside every other
  // unset one purely alphabetically, rather than landing first/last by
  // accident.
  displayOrder: { type: Number, default: 0 },
});

deitySchema.plugin(auditablePlugin);

deitySchema.index({ code: 1 }, activeUniqueIndexOptions({ collation: { locale: "en", strength: 2 } }));
deitySchema.index({ name: 1 }, activeUniqueIndexOptions({ collation: { locale: "en", strength: 2 } }));
deitySchema.index({ status: 1, createdAt: -1 });
// Matches the actual list/sort shape every deity-listing query now uses
// (status filter + displayOrder/name sort) — see crud-controller.js's new
// `sort` option and every populate({ options: { sort } }) call this feature
// added.
deitySchema.index({ status: 1, displayOrder: 1, name: 1 });
// Mongoose only auto-indexes _id — a `ref` field gets nothing for free.
// Without this, "which deities point at printing group X" (a future
// filter, and any later check for whether a group is still referenced
// before it's deleted) is a full collection scan instead of an index
// lookup once the table has any real size to it.
deitySchema.index({ printingGroup: 1 });

module.exports = mongoose.model("Deity", deitySchema);
