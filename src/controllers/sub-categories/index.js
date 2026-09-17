const express = require("express");
const requirePermission = require("../../common/middleware/require-permission");
const validateBody = require("../../common/middleware/validate");
const { uploadSubCategoryImage, hydrateMultipartBody } = require("../../common/middleware/upload");
const makeCrudController = require("../../common/factories/crud-controller");
const { makeImportExportController } = require("../../common/factories/import-export-controller");

const SubCategory = require("../../models/sub-categories");
const Item = require("../../models/items");
const Service = require("../../models/services");
const Event = require("../../models/events");
const { createSchema, updateSchema } = require("./request-objects");
const { fields: importExportFields, validateRow, sampleRows } = require("./import-export-fields");

// Mounted at /masters — see routes/index.js (authGuard/adminOnly now applied
// once for the whole /masters group there, not per master).
const router = express.Router();

const crud = makeCrudController(SubCategory, {
  searchFields: ["name", "tamilName", "code"],
  populate: [{ path: "category", select: "name" }],
  referencedBy: [
    { model: Item, field: "categoryDetails.subCategory", label: "Item" },
    { model: Service, field: "categoryDetails.subCategory", label: "Service" },
    { model: Event, field: "subCategory", label: "Event" },
  ],
});

router.get("/sub-categories", requirePermission("sub-categories", "view"), crud.list);
router.post(
  "/sub-categories",
  requirePermission("sub-categories", "fullAccess"),
  uploadSubCategoryImage,
  hydrateMultipartBody,
  validateBody(createSchema),
  crud.create
);
router.put(
  "/sub-categories/:id",
  requirePermission("sub-categories", "edit"),
  uploadSubCategoryImage,
  hydrateMultipartBody,
  validateBody(updateSchema),
  crud.update
);
router.delete("/sub-categories/:id", requirePermission("sub-categories", "fullAccess"), crud.remove);

// Excel import/export — see common/factories/import-export-controller.js.
const importExport = makeImportExportController(SubCategory, {
  entityLabel: "Sub Category",
  sheetName: "Sub Categories",
  fields: importExportFields,
  validateRow,
  sampleRows,
  extraDefaults: { status: 1, image: null },
});

router.get("/sub-categories/export", requirePermission("sub-categories", "view"), importExport.exportList);
router.get("/sub-categories/import/template", requirePermission("sub-categories", "view"), importExport.downloadTemplate);
router.post("/sub-categories/import/validate", requirePermission("sub-categories", "fullAccess"), importExport.validateImport);
router.post("/sub-categories/import/commit", requirePermission("sub-categories", "fullAccess"), importExport.commitImport);

module.exports = router;
