const mongoose = require("mongoose");
const { auditablePlugin, activeUniqueIndexOptions } = require("../../common/plugins/auditable");
const { SECTION_TYPES } = require("../../utilities/constants/cms");

/**
 * One row inside a section's list — the meaning of each field depends on the
 * section type (see the table in controllers/cms/request-objects.js):
 * a Banner slide, a Site Details row, or an opening-hours row.
 */
const sectionItemSchema = new mongoose.Schema(
  {
    image: { type: String, default: "", trim: true },
    label: { type: String, default: "", trim: true },
    heading: { type: String, default: "", trim: true },
    text: { type: String, default: "", trim: true },
    link: { type: String, default: "", trim: true },
  },
  { _id: false }
);

/**
 * A block of a CMS page. Deliberately one loose shape shared by every type
 * rather than eight strict ones: the portal picks the fields each type uses,
 * and a section can change type in the admin without a migration.
 * All fields are plain text — nothing here is rendered as HTML.
 */
const sectionSchema = new mongoose.Schema(
  {
    type: { type: String, enum: SECTION_TYPES, required: true },
    enabled: { type: Boolean, default: true },
    eyebrow: { type: String, default: "", trim: true },
    title: { type: String, default: "", trim: true },
    subtitle: { type: String, default: "", trim: true },
    content: { type: String, default: "", trim: true },
    image: { type: String, default: "", trim: true },
    primaryLabel: { type: String, default: "", trim: true },
    primaryLink: { type: String, default: "", trim: true },
    secondaryLabel: { type: String, default: "", trim: true },
    secondaryLink: { type: String, default: "", trim: true },
    // Dynamic sections: cards per page (Events / Services), slides (Banner) or
    // how many records to load (Items).
    limit: { type: Number, default: 9, min: 1, max: 60 },
    items: { type: [sectionItemSchema], default: [] },
  },
  { _id: false }
);

/**
 * An admin-written page for the Customer Portal (Home, About the Temple,
 * Privacy Policy, ...). A CMS Menu links to a page by reference; the portal
 * serves it at /customer/pages/<slug> — except the page whose slug is
 * "home", which IS the portal's front page at /customer.
 *
 * `content` / `tamilContent` hold HTML that has been run through the
 * sanitiser in controllers/cms before being saved — the portal renders it
 * as-is, so nothing unsanitised should ever reach these fields.
 */
const cmsPageSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true },
  tamilTitle: { type: String, default: "", trim: true },
  slug: { type: String, required: true, trim: true, lowercase: true },
  summary: { type: String, default: "", trim: true },
  content: { type: String, default: "" },
  tamilContent: { type: String, default: "" },
  sections: { type: [sectionSchema], default: [] },
  bannerImage: { type: String, default: "", trim: true },
  metaTitle: { type: String, default: "", trim: true },
  metaDescription: { type: String, default: "", trim: true },
});

cmsPageSchema.plugin(auditablePlugin);

cmsPageSchema.index({ slug: 1 }, activeUniqueIndexOptions({ collation: { locale: "en", strength: 2 } }));
cmsPageSchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.model("CmsPage", cmsPageSchema);
