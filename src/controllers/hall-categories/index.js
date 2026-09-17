const express = require("express");
const validateBody = require("../../common/middleware/validate");
const { uploadHallCategoryImage, hydrateMultipartBody } = require("../../common/middleware/upload");
const makeCrudController = require("../../common/factories/crud-controller");
const { makeImportExportController } = require("../../common/factories/import-export-controller");

const HallCategory = require("../../models/hall-categories");
const Hall = require("../../models/halls");
const { createSchema, updateSchema } = require("./request-objects");
const { fields: importExportFields, sampleRows } = require("./import-export-fields");

// Mounted at /hall-meal — see routes/index.js (authGuard + hallMealAccessOnly
// applied once for the whole /hall-meal group there).
const router = express.Router();

const crud = makeCrudController(HallCategory, {
  searchFields: ["name", "code"],
  referencedBy: [{ model: Hall, field: "category", label: "Hall" }],
});

router.get("/hall-categories", crud.list);
router.post("/hall-categories", uploadHallCategoryImage, hydrateMultipartBody, validateBody(createSchema), crud.create);
router.put("/hall-categories/:id", uploadHallCategoryImage, hydrateMultipartBody, validateBody(updateSchema), crud.update);
router.delete("/hall-categories/:id", crud.remove);

// Excel import/export — see common/factories/import-export-controller.js.
const importExport = makeImportExportController(HallCategory, {
  entityLabel: "Hall Category",
  sheetName: "Hall Categories",
  fields: importExportFields,
  sampleRows,
  extraDefaults: { status: 1, image: null },
});

router.get("/hall-categories/export", importExport.exportList);
router.get("/hall-categories/import/template", importExport.downloadTemplate);
router.post("/hall-categories/import/validate", importExport.validateImport);
router.post("/hall-categories/import/commit", importExport.commitImport);

module.exports = router;
