const Joi = require("joi");
const { MENU_LOCATIONS, LINK_TYPES, PORTAL_ROUTE_KEYS, SECTION_TYPES } = require("../../utilities/constants/cms");

const objectId = Joi.string().hex().length(24);
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

// A link or image the portal may render: an absolute http(s) URL, a site path
// ("/customer/login", "/customer#services", "#contact"). Anything else —
// notably "javascript:" — is rejected, since these end up in href/src.
const SAFE_URL = /^(https?:\/\/\S+|\/\S*|#\S*)$/i;
const safeUrl = Joi.string().trim().allow("").max(500).pattern(SAFE_URL).messages({
  "string.pattern.base": "Enter a full http(s) URL or a site path such as /customer/login.",
});
const text = (max) => Joi.string().trim().allow("").max(max);

/**
 * What each section type reads (everything else is ignored by the portal):
 *
 *  Banner       title (headline for search engines), items -> the slides
 *               (at most BANNER_MAX_SLIDES): image (upload), heading (alt text,
 *               not shown), link (optional: where a click on the image goes)
 *  Events       title, subtitle, limit (cards per page)    (Event master)
 *  Services     title, subtitle, limit (cards per page)    (Service master)
 *  Items        title, subtitle, limit (items to load)     (Item master)
 *  SiteDetails  image (logo), content (footer blurb), items -> label = Address |
 *               Phone | Email | Working Hours | Facebook | Instagram | YouTube,
 *               text = value. Not drawn on the page; feeds header + footer.
 *  Footer       content (about blurb under the logo), primaryLabel (links column
 *               heading), secondaryLabel (hours column heading), eyebrow (note
 *               under the hours), subtitle (copyright; {year} = current year),
 *               items -> label = days, text = opening times.
 *               Not drawn on the page; feeds the footer.
 */
const sectionItemSchema = Joi.object({
  image: safeUrl,
  label: text(60),
  heading: text(150),
  text: text(400),
  link: safeUrl,
});

const sectionSchema = Joi.object({
  type: Joi.string().valid(...SECTION_TYPES).required(),
  enabled: Joi.boolean().default(true),
  eyebrow: text(100),
  title: text(150),
  subtitle: text(300),
  content: text(2000),
  image: safeUrl,
  primaryLabel: text(40),
  primaryLink: safeUrl,
  secondaryLabel: text(40),
  secondaryLink: safeUrl,
  limit: Joi.number().integer().min(1).max(60).default(9),
  items: Joi.array().items(sectionItemSchema).max(24).default([]),
});

const pageFields = {
  title: Joi.string().trim().min(1).max(150),
  tamilTitle: Joi.string().trim().allow("").max(150),
  slug: Joi.string().trim().lowercase().pattern(SLUG).max(100).messages({
    "string.pattern.base": "Slug may only contain lowercase letters, numbers and single hyphens (e.g. about-the-temple).",
  }),
  summary: Joi.string().trim().allow("").max(300),
  content: Joi.string().allow("").max(100000),
  tamilContent: Joi.string().allow("").max(100000),
  sections: Joi.array().items(sectionSchema).max(30),
  bannerImage: safeUrl,
  metaTitle: Joi.string().trim().allow("").max(70),
  metaDescription: Joi.string().trim().allow("").max(160),
  status: Joi.number().valid(0, 1),
};

const createPageSchema = Joi.object({
  ...pageFields,
  title: pageFields.title.required(),
  slug: pageFields.slug.required(),
  status: pageFields.status.default(1),
});
const updatePageSchema = Joi.object(pageFields);

const menuFields = {
  code: Joi.string().trim().min(1).max(30),
  name: Joi.string().trim().min(1).max(100),
  tamilName: Joi.string().trim().allow("").max(100),
  location: Joi.string().valid(...MENU_LOCATIONS),
  parentMenu: objectId.allow(null, ""),
  linkType: Joi.string().valid(...LINK_TYPES),
  cmsPage: objectId.allow(null, ""),
  portalRoute: Joi.string().valid(...PORTAL_ROUTE_KEYS).allow(null, ""),
  externalUrl: Joi.string().trim().allow("").uri({ scheme: ["http", "https"] }).max(500),
  openInNewTab: Joi.boolean(),
  loginRequired: Joi.boolean(),
  displayOrder: Joi.number().integer().min(0),
  status: Joi.number().valid(0, 1),
};

const createMenuSchema = Joi.object({
  ...menuFields,
  code: menuFields.code.required(),
  name: menuFields.name.required(),
  linkType: menuFields.linkType.required(),
  location: menuFields.location.default("Header"),
  openInNewTab: menuFields.openInNewTab.default(false),
  loginRequired: menuFields.loginRequired.default(false),
  displayOrder: menuFields.displayOrder.default(0),
  status: menuFields.status.default(1),
});
const updateMenuSchema = Joi.object(menuFields);

module.exports = { createPageSchema, updatePageSchema, createMenuSchema, updateMenuSchema };
