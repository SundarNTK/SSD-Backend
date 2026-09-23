const express = require("express");
const requirePermission = require("../../common/middleware/require-permission");
const validateBody = require("../../common/middleware/validate");
const makeCrudController = require("../../common/factories/crud-controller");
const { makeImportExportController } = require("../../common/factories/import-export-controller");

const Nakshathiram = require("../../models/nakshathirams");
const { createSchema, updateSchema } = require("./request-objects");
const { fields: importExportFields, sampleRows } = require("./import-export-fields");

// Mounted at /masters — see routes/index.js (authGuard/adminOnly now applied
// once for the whole /masters group there, not per master).
const router = express.Router();

const crud = makeCrudController(Nakshathiram, { searchFields: ["name", "tamilName", "code", "rasi"] });

router.get("/nakshathirams", requirePermission("nakshathirams", "view"), crud.list);
router.post("/nakshathirams", requirePermission("nakshathirams", "fullAccess"), validateBody(createSchema), crud.create);
router.put("/nakshathirams/:id", requirePermission("nakshathirams", "edit"), validateBody(updateSchema), crud.update);
router.delete("/nakshathirams/:id", requirePermission("nakshathirams", "fullAccess"), crud.remove);

// Excel import/export — see common/factories/import-export-controller.js.
const importExport = makeImportExportController(Nakshathiram, {
  entityLabel: "Nakshathiram",
  sheetName: "Nakshathirams",
  fields: importExportFields,
  sampleRows,
  extraDefaults: { status: 1 },
});

router.get("/nakshathirams/export", requirePermission("nakshathirams", "view"), importExport.exportList);
router.get("/nakshathirams/import/template", requirePermission("nakshathirams", "view"), importExport.downloadTemplate);
router.post("/nakshathirams/import/validate", requirePermission("nakshathirams", "fullAccess"), importExport.validateImport);
router.post("/nakshathirams/import/commit", requirePermission("nakshathirams", "fullAccess"), importExport.commitImport);

module.exports = router;
