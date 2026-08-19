const mongoose = require("mongoose");
const { auditablePlugin, activeUniqueIndexOptions } = require("../../common/plugins/auditable");

/**
 * The chart-of-accounts entry every Item picks from — GST is derived
 * through this record's gstType rather than being stored again on the
 * item itself (see controllers/items).
 */
const generalLedgerSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  code: { type: String, required: true, trim: true, uppercase: true },
  gstType: { type: mongoose.Schema.Types.ObjectId, ref: "Gst", required: true },
  groupLevel1: { type: mongoose.Schema.Types.ObjectId, ref: "GlGroup", required: true },
  groupLevel2: { type: mongoose.Schema.Types.ObjectId, ref: "GlGroup", default: null },
  groupLevel3: { type: mongoose.Schema.Types.ObjectId, ref: "GlGroup", default: null },
  description: { type: String, default: "" },
});

generalLedgerSchema.plugin(auditablePlugin);

generalLedgerSchema.index({ code: 1 }, activeUniqueIndexOptions({ collation: { locale: "en", strength: 2 } }));
generalLedgerSchema.index({ status: 1, createdAt: -1 });
// Every ref field indexed — this is the master Item picks a GL account
// from, and reporting/"is this still referenced" checks will filter by
// each of these as the platform grows.
generalLedgerSchema.index({ gstType: 1 });
generalLedgerSchema.index({ groupLevel1: 1 });
generalLedgerSchema.index({ groupLevel2: 1 });
generalLedgerSchema.index({ groupLevel3: 1 });

module.exports = mongoose.model("GeneralLedger", generalLedgerSchema);
