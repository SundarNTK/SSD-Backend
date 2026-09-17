const express = require("express");
const validateBody = require("../../common/middleware/validate");
const { uploadHallPurposeImage, hydrateMultipartBody } = require("../../common/middleware/upload");
const makeCrudController = require("../../common/factories/crud-controller");
const { makeImportExportController } = require("../../common/factories/import-export-controller");

const HallPurpose = require("../../models/hall-purposes");
const HallPackage = require("../../models/hall-packages");
const { createSchema, updateSchema } = require("./request-objects");
const { fields: importExportFields, sampleRows } = require("./import-export-fields");

// Mounted at /hall-meal — see routes/index.js.
const router = express.Router();

const crud = makeCrudController(HallPurpose, {
  searchFields: ["name"],
  referencedBy: [{ model: HallPackage, field: "hallPurpose", label: "Hall Package" }],
});

router.get("/hall-purposes", crud.list);
router.post("/hall-purposes", uploadHallPurposeImage, hydrateMultipartBody, validateBody(createSchema), crud.create);
router.put("/hall-purposes/:id", uploadHallPurposeImage, hydrateMultipartBody, validateBody(updateSchema), crud.update);
router.delete("/hall-purposes/:id", crud.remove);

// Excel import/export — see common/factories/import-export-controller.js.
const importExport = makeImportExportController(HallPurpose, {
  entityLabel: "Hall Purpose",
  sheetName: "Hall Purposes",
  fields: importExportFields,
  sampleRows,
  extraDefaults: { status: 1, image: null },
});

router.get("/hall-purposes/export", importExport.exportList);
router.get("/hall-purposes/import/template", importExport.downloadTemplate);
router.post("/hall-purposes/import/validate", importExport.validateImport);
router.post("/hall-purposes/import/commit", importExport.commitImport);

module.exports = router;
