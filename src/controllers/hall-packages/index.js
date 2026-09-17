const express = require("express");
const validateBody = require("../../common/middleware/validate");
const { uploadHallPackageImage, hydrateMultipartBody } = require("../../common/middleware/upload");
const makeCrudController = require("../../common/factories/crud-controller");
const { makeImportExportController } = require("../../common/factories/import-export-controller");

const HallPackage = require("../../models/hall-packages");
const { createSchema, updateSchema } = require("./request-objects");
const { fields: importExportFields, mapToDoc, exportRow, exportPopulate, sampleRows } = require("./import-export-fields");

// Mounted at /hall-meal — see routes/index.js. Nothing references a Hall
// Package yet (Hall Booking will, in Phase 2), so no `referencedBy` guard
// is needed here.
const router = express.Router();

const crud = makeCrudController(HallPackage, {
  searchFields: ["name"],
  populate: ["hallPurpose", "halls", "additionalServices"],
});

router.get("/hall-packages", crud.list);
router.post("/hall-packages", uploadHallPackageImage, hydrateMultipartBody, validateBody(createSchema), crud.create);
router.put("/hall-packages/:id", uploadHallPackageImage, hydrateMultipartBody, validateBody(updateSchema), crud.update);
router.delete("/hall-packages/:id", crud.remove);

// Excel import/export — see common/factories/import-export-controller.js.
const importExport = makeImportExportController(HallPackage, {
  entityLabel: "Hall Package",
  sheetName: "Hall Packages",
  fields: importExportFields,
  mapToDoc,
  exportRow,
  exportPopulate,
  sampleRows,
  extraDefaults: { status: 1, image: null, termsAndConditions: "" },
});

router.get("/hall-packages/export", importExport.exportList);
router.get("/hall-packages/import/template", importExport.downloadTemplate);
router.post("/hall-packages/import/validate", importExport.validateImport);
router.post("/hall-packages/import/commit", importExport.commitImport);

module.exports = router;
