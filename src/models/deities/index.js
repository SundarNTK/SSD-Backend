const mongoose = require("mongoose");
const { auditablePlugin, activeUniqueIndexOptions } = require("../../common/plugins/auditable");

const deitySchema = new mongoose.Schema({
  code: { type: String, required: true, trim: true, uppercase: true },
  name: { type: String, required: true, trim: true },
  tamilName: { type: String, default: "" },
  printingGroup: { type: mongoose.Schema.Types.ObjectId, ref: "PrintingGroup", required: true },
});

deitySchema.plugin(auditablePlugin);

deitySchema.index({ code: 1 }, activeUniqueIndexOptions({ collation: { locale: "en", strength: 2 } }));
deitySchema.index({ name: 1 }, activeUniqueIndexOptions({ collation: { locale: "en", strength: 2 } }));
deitySchema.index({ status: 1, createdAt: -1 });
// Mongoose only auto-indexes _id — a `ref` field gets nothing for free.
// Without this, "which deities point at printing group X" (a future
// filter, and any later check for whether a group is still referenced
// before it's deleted) is a full collection scan instead of an index
// lookup once the table has any real size to it.
deitySchema.index({ printingGroup: 1 });

module.exports = mongoose.model("Deity", deitySchema);
