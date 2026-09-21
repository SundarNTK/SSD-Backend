const mongoose = require("mongoose");
const { auditablePlugin, activeUniqueIndexOptions } = require("../../common/plugins/auditable");
const { MENU_LOCATIONS, LINK_TYPES, PORTAL_ROUTE_KEYS } = require("../../utilities/constants/cms");

/**
 * One entry in the Customer Portal's navigation — header bar or footer.
 * Two levels at most: a top-level menu, optionally with sub-menus pointing at
 * it through `parentMenu` (rules enforced in controllers/cms).
 *
 * `linkType` decides which one destination field is meaningful:
 *   "CMS Page"     → `cmsPage`
 *   "Portal Page"  → `portalRoute` (a built-in screen — see constants/cms)
 *   "External URL" → `externalUrl`
 * The controller nulls out the other two on every save, so a menu never
 * carries a stale destination from an earlier link type.
 */
const cmsMenuSchema = new mongoose.Schema({
  code: { type: String, required: true, trim: true, uppercase: true },
  name: { type: String, required: true, trim: true },
  tamilName: { type: String, default: "", trim: true },
  location: { type: String, enum: MENU_LOCATIONS, default: "Header" },
  parentMenu: { type: mongoose.Schema.Types.ObjectId, ref: "CmsMenu", default: null },
  linkType: { type: String, enum: LINK_TYPES, required: true },
  cmsPage: { type: mongoose.Schema.Types.ObjectId, ref: "CmsPage", default: null },
  portalRoute: { type: String, enum: [...PORTAL_ROUTE_KEYS, null], default: null },
  externalUrl: { type: String, default: "", trim: true },
  openInNewTab: { type: Boolean, default: false },
  // Show this entry only to a signed-in customer (e.g. "My Bookings").
  loginRequired: { type: Boolean, default: false },
  displayOrder: { type: Number, default: 0 },
});

cmsMenuSchema.plugin(auditablePlugin);

cmsMenuSchema.index({ code: 1 }, activeUniqueIndexOptions({ collation: { locale: "en", strength: 2 } }));
cmsMenuSchema.index({ status: 1, location: 1, displayOrder: 1 });
cmsMenuSchema.index({ parentMenu: 1 });
cmsMenuSchema.index({ cmsPage: 1 });

module.exports = mongoose.model("CmsMenu", cmsMenuSchema);
