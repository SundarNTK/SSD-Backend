const express = require("express");
const validateBody = require("../../common/middleware/validate");
const { uploadAdditionalServiceImage, hydrateMultipartBody } = require("../../common/middleware/upload");
const makeCrudController = require("../../common/factories/crud-controller");
const { makeImportExportController } = require("../../common/factories/import-export-controller");

const AdditionalService = require("../../models/additional-services");
const HallPackage = require("../../models/hall-packages");
const { createSchema, updateSchema } = require("./request-objects");
const { fields: importExportFields, sampleRows } = require("./import-export-fields");

// Mounted at /hall-meal — see routes/index.js.
const router = express.Router();

const crud = makeCrudController(AdditionalService, {
  searchFields: ["name", "code"],
  referencedBy: [{ model: HallPackage, field: "additionalServices", label: "Hall Package" }],
});

router.get("/additional-services", crud.list);
router.post("/additional-services", uploadAdditionalServiceImage, hydrateMultipartBody, validateBody(createSchema), crud.create);
router.put("/additional-services/:id", uploadAdditionalServiceImage, hydrateMultipartBody, validateBody(updateSchema), crud.update);
router.delete("/additional-services/:id", crud.remove);

// Excel import/export — see common/factories/import-export-controller.js.
const importExport = makeImportExportController(AdditionalService, {
  entityLabel: "Additional Service",
  sheetName: "Additional Services",
  fields: importExportFields,
  sampleRows,
  extraDefaults: { status: 1, image: null },
});

router.get("/additional-services/export", importExport.exportList);
router.get("/additional-services/import/template", importExport.downloadTemplate);
router.post("/additional-services/import/validate", importExport.validateImport);
router.post("/additional-services/import/commit", importExport.commitImport);

module.exports = router;
