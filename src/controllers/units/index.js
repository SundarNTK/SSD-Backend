const express = require("express");
const requirePermission = require("../../common/middleware/require-permission");
const validateBody = require("../../common/middleware/validate");
const makeCrudController = require("../../common/factories/crud-controller");
const { makeImportExportController } = require("../../common/factories/import-export-controller");

const Unit = require("../../models/units");
const { createSchema, updateSchema } = require("./request-objects");
const { fields: importExportFields, sampleRows } = require("./import-export-fields");

// Mounted at /masters alongside every other master controller — see
// routes/index.js, where authGuard/adminOnly are applied once for the whole
// /masters group.
const router = express.Router();

const crud = makeCrudController(Unit, { searchFields: ["unitCode", "unitName", "description"] });

router.get("/units", requirePermission("units", "view"), crud.list);
router.post("/units", requirePermission("units", "fullAccess"), validateBody(createSchema), crud.create);
router.put("/units/:id", requirePermission("units", "edit"), validateBody(updateSchema), crud.update);
router.delete("/units/:id", requirePermission("units", "fullAccess"), crud.remove);

// Excel import/export — see common/factories/import-export-controller.js.
const importExport = makeImportExportController(Unit, {
  entityLabel: "Unit",
  sheetName: "Units",
  fields: importExportFields,
  sampleRows,
  extraDefaults: { status: 1 },
});

router.get("/units/export", requirePermission("units", "view"), importExport.exportList);
router.get("/units/import/template", requirePermission("units", "view"), importExport.downloadTemplate);
router.post("/units/import/validate", requirePermission("units", "fullAccess"), importExport.validateImport);
router.post("/units/import/commit", requirePermission("units", "fullAccess"), importExport.commitImport);

module.exports = router;
