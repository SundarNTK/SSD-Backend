const express = require("express");
const { responseHandler, exceptionHandler } = require("../../utilities/handlers");
const { PORTAL_ROUTES, FOOTER_PAGE_SLUG, BANNER_MAX_SLIDES } = require("../../utilities/constants/cms");

const CmsMenu = require("../../models/cms-menus");
const CmsPage = require("../../models/cms-pages");
const Service = require("../../models/services");
const Item = require("../../models/items");
const Event = require("../../models/events");

/**
 * Public, unauthenticated read API for the Customer Portal — mounted at
 * /public (see routes/index.js, outside every authGuard group). It only ever
 * returns ACTIVE, non-deleted records, and only the fields the portal
 * renders: no audit fields, no internal ids beyond what a link needs.
 */
const router = express.Router();

const HOME_SLUG = "home";
const PORTAL_PATH_BY_KEY = Object.fromEntries(PORTAL_ROUTES.map((r) => [r.key, r.path]));

// Content changes rarely; a short shared-cache window keeps a busy front page
// from hitting the database on every visit while still showing edits promptly.
const cacheBriefly = (req, res, next) => {
  res.set("Cache-Control", "public, max-age=30, stale-while-revalidate=60");
  next();
};

const livePage = (extra = {}) => CmsPage.notDeletedFilter({ status: 1, ...extra });

// ---------- Menus ----------

/** Where a menu entry goes, or null when its destination is gone (page deleted/deactivated). */
function hrefFor(menu) {
  if (menu.linkType === "CMS Page") {
    const page = menu.cmsPage;
    if (!page || page.isDeleted || page.status !== 1) return null;
    return page.slug === HOME_SLUG ? "/customer" : `/customer/pages/${page.slug}`;
  }
  if (menu.linkType === "Portal Page") return PORTAL_PATH_BY_KEY[menu.portalRoute] || null;
  if (menu.linkType === "External URL") return menu.externalUrl || null;
  return null;
}

const toNode = (menu, href) => ({
  id: String(menu._id),
  name: menu.name,
  tamilName: menu.tamilName || "",
  href,
  openInNewTab: Boolean(menu.openInNewTab),
  loginRequired: Boolean(menu.loginRequired),
  children: [],
});

async function loadMenus() {
  const rows = await CmsMenu.find(CmsMenu.notDeletedFilter({ status: 1 }))
    .populate("cmsPage", "slug status isDeleted")
    .sort({ displayOrder: 1, name: 1 })
    .lean();

  const result = { Header: [], Footer: [] };
  for (const location of Object.keys(result)) {
    const inLocation = rows.filter((m) => m.location === location);
    const parents = new Map();
    inLocation
      .filter((m) => !m.parentMenu)
      .forEach((m) => {
        const href = hrefFor(m);
        // A parent with no destination of its own can still be a dropdown
        // heading, so it's kept — it's dropped later if it ends up empty.
        parents.set(String(m._id), toNode(m, href));
      });
    inLocation
      .filter((m) => m.parentMenu)
      .forEach((m) => {
        const parent = parents.get(String(m.parentMenu));
        const href = hrefFor(m);
        if (parent && href) parent.children.push(toNode(m, href));
      });
    result[location] = [...parents.values()].filter((n) => n.href || n.children.length);
  }
  return result;
}

// ---------- Site details + footer text (from the Site Footer page) ----------

const CONTACT_LABELS = {
  address: "address",
  phone: "phone",
  email: "email",
  "working hours": "hours",
  facebook: "facebook",
  instagram: "instagram",
  youtube: "youtube",
};

const enabledSection = (page, type) => (page?.sections || []).find((s) => s.type === type && s.enabled !== false);

/**
 * Logo, address, phone, hours and socials come from the SiteDetails section of
 * the Site Footer page (falling back to the Home page, where earlier versions
 * kept it), so one place in the CMS drives the header top bar, the footer and
 * the logo on every portal page.
 */
function siteFromPages(pages) {
  const site = { logo: "", tagline: "", address: "", phone: "", email: "", hours: "", facebook: "", instagram: "", youtube: "" };
  const details = pages.map((p) => enabledSection(p, "SiteDetails")).find(Boolean);
  if (!details) return site;
  site.logo = details.image || "";
  site.tagline = details.content || "";
  (details.items || []).forEach((item) => {
    const key = CONTACT_LABELS[String(item.label || "").trim().toLowerCase()];
    if (key) site[key] = item.text || "";
  });
  return site;
}

/** The footer's own wording, with sensible defaults for anything left blank in the CMS. */
function footerFromPage(page, site) {
  const f = enabledSection(page, "Footer");
  const hours = (f?.items || []).filter((r) => r.text).map((r) => ({ days: r.label || "", time: r.text }));
  return {
    about: f?.content || site.tagline || "",
    linksTitle: f?.primaryLabel || "Quick Links",
    hoursTitle: f?.secondaryLabel || "Working Hours",
    hours: hours.length ? hours : site.hours ? [{ days: "", time: site.hours }] : [],
    hoursNote: f?.eyebrow || "",
    copyright: f?.subtitle || "© {year} Sri Siva Durga Temple. All rights reserved.",
  };
}

// ---------- Page shaping ----------

const money = (n) => Number(n) || 0;
const toRecord = (doc) => ({
  id: String(doc._id),
  name: doc.name,
  tamilName: doc.tamilName || "",
  description: doc.description || "",
  price: money(doc.salePrice),
  image: doc.image || null,
});

// An event card shows the Event master's own image. (The home-page banner is
// separate: its slides are entered in the CMS, not taken from events.)
const toEventRecord = (doc) => ({
  ...toRecord(doc),
  startDate: doc.startDate,
  endDate: doc.endDate,
});

// Lists are paged in the browser, so the server hands over the whole (capped) set.
const MAX_LIST = 120;

/** Midnight (UTC) today: an event that ends today is still upcoming. */
function startOfTodayUtc() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/**
 * The portal shows only what the Event master marks public and active, and
 * only events that have not finished, soonest first.
 */
async function loadUpcomingEvents(limit) {
  const docs = await Event.find(Event.notDeletedFilter({ status: 1, publicVisibility: true, endDate: { $gte: startOfTodayUtc() } }))
    .select("name tamilName description salePrice image startDate endDate")
    .sort({ startDate: 1, displayOrder: 1, name: 1 })
    .limit(limit)
    .lean();
  return docs.map(toEventRecord);
}

async function loadServices(limit) {
  const docs = await Service.find(
    Service.notDeletedFilter({
      status: 1,
      publicAvailability: true,
      $or: [{ bookingCutoffDate: null }, { bookingCutoffDate: { $gte: new Date() } }],
    })
  )
    .select("name tamilName description salePrice image")
    .sort({ name: 1 })
    .limit(limit)
    .lean();
  return docs.map(toRecord);
}

async function loadItems(limit) {
  const docs = await Item.find(Item.notDeletedFilter({ status: 1, customerPortalAvailability: true }))
    .select("name tamilName description salePrice image")
    .sort({ name: 1 })
    .limit(limit)
    .lean();
  return docs.map(toRecord);
}

/**
 * Events / Services / Items carry no records of their own: every record and
 * image comes live from its master. The Banner is the exception — it is a
 * plain image slider whose images are uploaded in the CMS (up to five), so
 * they are passed through as `slides`. SiteDetails and Footer feed the layout and are
 * never drawn on a page.
 */
async function hydrateSection(section) {
  const base = { ...section };
  if (section.type === "Banner") {
    // Just images: a slide without one would be an empty frame, so it is skipped.
    base.slides = (section.items || [])
      .filter((i) => i.image)
      .slice(0, BANNER_MAX_SLIDES)
      .map((i) => ({ image: i.image, alt: i.heading || "", link: i.link || "" }));
    base.items = [];
  } else if (section.type === "Events") base.records = await loadUpcomingEvents(MAX_LIST);
  else if (section.type === "Services") base.records = await loadServices(MAX_LIST);
  else if (section.type === "Items") base.records = await loadItems(Math.max(section.limit || 24, 24));
  return base;
}

async function toPortalPage(page) {
  // SiteDetails and Footer feed the layout (header/footer), they are never drawn as page sections.
  const visible = (page.sections || []).filter((s) => s.enabled !== false && s.type !== "SiteDetails" && s.type !== "Footer");
  const sections = await Promise.all(visible.map(hydrateSection));
  return {
    slug: page.slug,
    title: page.title,
    tamilTitle: page.tamilTitle || "",
    summary: page.summary || "",
    content: page.content || "",
    tamilContent: page.tamilContent || "",
    bannerImage: page.bannerImage || "",
    metaTitle: page.metaTitle || page.title,
    metaDescription: page.metaDescription || page.summary || "",
    sections,
  };
}

// ---------- Routes ----------

/** Navigation, site details and footer text every portal page needs — one call for the layout. */
router.get("/cms/layout", cacheBriefly, async (req, res) => {
  try {
    const [menus, footerPage, home] = await Promise.all([
      loadMenus(),
      CmsPage.findOne(livePage({ slug: FOOTER_PAGE_SLUG })).lean(),
      CmsPage.findOne(livePage({ slug: HOME_SLUG })).lean(),
    ]);
    const site = siteFromPages([footerPage, home]);
    return responseHandler({ res, response: { header: menus.Header, footer: menus.Footer, site, footerInfo: footerFromPage(footerPage, site) } });
  } catch (error) {
    return exceptionHandler({ res, error });
  }
});

async function sendPage(res, slug) {
  // The footer page is layout content, not a page a visitor can open.
  if (slug === FOOTER_PAGE_SLUG) throw "Page not found.";
  const page = await CmsPage.findOne(livePage({ slug })).lean();
  if (!page) throw "Page not found.";
  return responseHandler({ res, response: await toPortalPage(page) });
}

router.get("/cms/home", cacheBriefly, async (req, res) => {
  try {
    return await sendPage(res, HOME_SLUG);
  } catch (error) {
    return exceptionHandler({ res, error, statusCode: typeof error === "string" ? 404 : undefined });
  }
});

router.get("/cms/pages/:slug", cacheBriefly, async (req, res) => {
  try {
    return await sendPage(res, String(req.params.slug).toLowerCase());
  } catch (error) {
    return exceptionHandler({ res, error, statusCode: typeof error === "string" ? 404 : undefined });
  }
});

module.exports = router;
