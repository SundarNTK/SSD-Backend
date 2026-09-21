const express = require("express");
const requirePermission = require("../../common/middleware/require-permission");
const { uploadCmsImage } = require("../../common/middleware/upload");
const validateBody = require("../../common/middleware/validate");
const makeCrudController = require("../../common/factories/crud-controller");
const { responseHandler, exceptionHandler } = require("../../utilities/handlers");
const { MENU_LOCATIONS, LINK_TYPES, PORTAL_ROUTES, SECTION_TYPES, BANNER_MAX_SLIDES } = require("../../utilities/constants/cms");

const CmsMenu = require("../../models/cms-menus");
const CmsPage = require("../../models/cms-pages");
const { createPageSchema, updatePageSchema, createMenuSchema, updateMenuSchema } = require("./request-objects");
const { sanitizeContent } = require("./sanitize-content");

/**
 * Mounted at /cms — see routes/index.js, where authGuard/adminOnly are
 * applied once for the whole group. Public (customer-facing) reads of this
 * content belong to the Customer Portal phase and get their own unguarded
 * router; nothing here is public.
 */
const router = express.Router();

// ---- Meta — the fixed vocabularies the admin forms build their dropdowns from ----
router.get("/meta", requirePermission("cms-menus", "view"), (req, res) =>
  responseHandler({ res, response: { locations: MENU_LOCATIONS, linkTypes: LINK_TYPES, portalRoutes: PORTAL_ROUTES, sectionTypes: SECTION_TYPES } })
);

// ---- Image upload: banners, page photos and the site logo ----
// Stores the file on Cloudinary and hands back its URL, which the form then
// keeps in whichever image field it belongs to (page banner, section image).
// One endpoint for every image field keeps nested section images simple: no
// multipart form has to carry them. Gated like editing a page.
router.post("/upload", requirePermission("cms-pages", "edit"), uploadCmsImage, (req, res) => {
  if (!req.body.url) return exceptionHandler({ res, error: "Choose an image to upload.", statusCode: 422 });
  return responseHandler({ res, response: { url: req.body.url }, successMessage: "Image uploaded.", statusCode: 201 });
});

// ---- CMS Pages ----
const pageCrud = makeCrudController(CmsPage, {
  searchFields: ["title", "tamilTitle", "slug"],
  referencedBy: [{ model: CmsMenu, field: "cmsPage", label: "CMS Menu" }],
});

/** Sanitise whichever rich-text fields this request actually carries. */
function sanitizePageBody(req, res, next) {
  ["content", "tamilContent"].forEach((key) => {
    if (typeof req.body[key] === "string") req.body[key] = sanitizeContent(req.body[key]);
  });
  next();
}

/** The form limits the banner to a handful of images; the server enforces it too. */
function assertBannerLimit(req, res, next) {
  const tooMany = (req.body.sections || []).some((s) => s.type === "Banner" && (s.items || []).length > BANNER_MAX_SLIDES);
  if (tooMany) return exceptionHandler({ res, error: `The banner slider can hold at most ${BANNER_MAX_SLIDES} images.`, statusCode: 422 });
  return next();
}

router.get("/pages", requirePermission("cms-pages", "view"), pageCrud.list);
router.get("/pages/:id", requirePermission("cms-pages", "view"), async (req, res) => {
  try {
    const doc = await CmsPage.findOne(CmsPage.notDeletedFilter({ _id: req.params.id }));
    if (!doc) throw "Record not found.";
    return responseHandler({ res, response: doc });
  } catch (error) {
    return exceptionHandler({ res, error, statusCode: typeof error === "string" ? 404 : undefined });
  }
});
router.post("/pages", requirePermission("cms-pages", "fullAccess"), validateBody(createPageSchema), assertBannerLimit, sanitizePageBody, pageCrud.create);
router.put("/pages/:id", requirePermission("cms-pages", "edit"), validateBody(updatePageSchema), assertBannerLimit, sanitizePageBody, pageCrud.update);
router.delete("/pages/:id", requirePermission("cms-pages", "fullAccess"), pageCrud.remove);

// ---- CMS Menus ----
const menuCrud = makeCrudController(CmsMenu, {
  searchFields: ["code", "name", "tamilName"],
  populate: [
    { path: "cmsPage", select: "title slug" },
    { path: "parentMenu", select: "name code" },
  ],
  referencedBy: [{ model: CmsMenu, field: "parentMenu", label: "sub-menu" }],
  // Header before Footer, then the admin-assigned order within each.
  sort: { location: 1, displayOrder: 1, name: 1 },
});

const LINK_FIELDS = ["linkType", "cmsPage", "portalRoute", "externalUrl"];
const PARENT_FIELDS = ["parentMenu", "location"];
const touches = (body, keys) => keys.some((k) => k in body);

/**
 * The rules a flat Joi schema can't express — run after validateBody, on
 * create and update alike. A partial update (e.g. the table's Active/Inactive
 * toggle sends `{ status }` only) is judged against the stored record merged
 * with the incoming fields, and each rule group only runs when the request
 * actually touches its fields, so toggling status on a menu whose page was
 * deactivated since isn't blocked by an unrelated check.
 */
async function applyMenuRules(req, res, next) {
  try {
    const existing = req.params.id ? await CmsMenu.findOne(CmsMenu.notDeletedFilter({ _id: req.params.id })) : null;
    if (req.params.id && !existing) throw "Record not found.";

    const body = req.body;
    for (const key of ["parentMenu", "cmsPage", "portalRoute"]) {
      if (key in body && !body[key]) body[key] = null;
    }
    const merged = { ...(existing ? existing.toObject() : {}), ...body };

    if (touches(body, LINK_FIELDS)) {
      if (merged.linkType === "CMS Page") {
        if (!merged.cmsPage) throw "Choose the CMS page this menu opens.";
        const page = await CmsPage.findOne(CmsPage.notDeletedFilter({ _id: merged.cmsPage, status: 1 }));
        if (!page) throw "The selected CMS page doesn't exist or isn't active.";
        Object.assign(body, { portalRoute: null, externalUrl: "" });
      } else if (merged.linkType === "Portal Page") {
        if (!merged.portalRoute) throw "Choose the portal page this menu opens.";
        Object.assign(body, { cmsPage: null, externalUrl: "" });
      } else if (merged.linkType === "External URL") {
        if (!merged.externalUrl) throw "Enter the external URL this menu opens.";
        Object.assign(body, { cmsPage: null, portalRoute: null });
      }
    }

    // The portal can only gate its own pages: it has no say over another website.
    if (touches(body, [...LINK_FIELDS, "loginRequired"]) && merged.linkType === "External URL" && merged.loginRequired) {
      throw "An external link can't require sign-in — the portal can't protect another website. Turn Login Required off, or point this menu at a CMS page or a portal page.";
    }

    if (touches(body, PARENT_FIELDS)) {
      const hasChildren = existing ? await CmsMenu.exists(CmsMenu.notDeletedFilter({ parentMenu: existing._id })) : false;

      if (merged.parentMenu) {
        if (existing && String(merged.parentMenu) === String(existing._id)) throw "A menu can't be its own parent.";
        if (hasChildren) throw "This menu has sub-menus of its own, so it can't be placed under another menu.";
        const parent = await CmsMenu.findOne(CmsMenu.notDeletedFilter({ _id: merged.parentMenu }));
        if (!parent) throw "The selected parent menu doesn't exist.";
        if (parent.parentMenu) throw "Menus can only be nested one level deep — pick a top-level menu as the parent.";
        if (parent.location !== merged.location) throw `The parent menu is in the ${parent.location}, so this menu must be too.`;
      } else if (existing && hasChildren && body.location && body.location !== existing.location) {
        throw "Move or delete this menu's sub-menus before changing its location.";
      }
    }

    return next();
  } catch (error) {
    return exceptionHandler({ res, error, statusCode: typeof error === "string" ? 422 : undefined });
  }
}

router.get("/menus", requirePermission("cms-menus", "view"), menuCrud.list);
router.post("/menus", requirePermission("cms-menus", "fullAccess"), validateBody(createMenuSchema), applyMenuRules, menuCrud.create);
router.put("/menus/:id", requirePermission("cms-menus", "edit"), validateBody(updateMenuSchema), applyMenuRules, menuCrud.update);
router.delete("/menus/:id", requirePermission("cms-menus", "fullAccess"), menuCrud.remove);

module.exports = router;
