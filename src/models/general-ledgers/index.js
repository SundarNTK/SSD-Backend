const mongoose = require("mongoose");
const { auditablePlugin, activeUniqueIndexOptions } = require("../../common/plugins/auditable");

/**
 * The chart-of-accounts entry every Item picks from — GST is derived
 * through this record's gstType rather than being stored again on the
 * item itself (see controllers/items).
 *
 * gstType is a GST Master *type* name (e.g. "Standard Rated"), not a
 * reference to one specific dated GST record — the applicable rate for
 * that type is resolved at calculation time against the transaction's
 * document date (see common/utils/gst-rate.js), since GST Master allows
 * several date-ranged records per type (rate history / scheduled changes).
 */
const generalLedgerSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  code: { type: String, required: true, trim: true, uppercase: true },
  gstType: { type: String, required: true, trim: true },
  groupLevel1: { type: mongoose.Schema.Types.ObjectId, ref: "GlGroup", required: true },
  groupLevel2: { type: mongoose.Schema.Types.ObjectId, ref: "GlGroup", default: null },
  groupLevel3: { type: mongoose.Schema.Types.ObjectId, ref: "GlGroup", default: null },
  description: { type: String, default: "" },
});

generalLedgerSchema.plugin(auditablePlugin);

generalLedgerSchema.index({ code: 1 }, activeUniqueIndexOptions({ collation: { locale: "en", strength: 2 } }));
generalLedgerSchema.index({ status: 1, createdAt: -1 });
generalLedgerSchema.index({ gstType: 1 });
generalLedgerSchema.index({ groupLevel1: 1 });
generalLedgerSchema.index({ groupLevel2: 1 });
generalLedgerSchema.index({ groupLevel3: 1 });

module.exports = mongoose.model("GeneralLedger", generalLedgerSchema);
