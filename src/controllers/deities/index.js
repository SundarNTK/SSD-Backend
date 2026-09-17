const express = require("express");
const requirePermission = require("../../common/middleware/require-permission");
const validateBody = require("../../common/middleware/validate");
const { uploadDeityImage, hydrateMultipartBody } = require("../../common/middleware/upload");
const makeCrudController = require("../../common/factories/crud-controller");
const { makeImportExportController } = require("../../common/factories/import-export-controller");

const Deity = require("../../models/deities");
const Item = require("../../models/items");
const Service = require("../../models/services");
const Event = require("../../models/events");
const { createSchema, updateSchema } = require("./request-objects");
const { fields: importExportFields, sampleRows } = require("./import-export-fields");

// Mounted at /masters — see routes/index.js (authGuard/adminOnly now applied
// once for the whole /masters group there, not per master).
const router = express.Router();

const crud = makeCrudController(Deity, {
  searchFields: ["code", "name", "tamilName"],
  populate: [{ path: "printingGroup", select: "name" }],
  referencedBy: [
    { model: Item, field: "deityMapping", label: "Item" },
    { model: Service, field: "deityMapping", label: "Service" },
    { model: Event, field: "deityMapping", label: "Event" },
  ],
  // Admin-assigned display order first, alphabetical among ties — see
  // models/deities' own displayOrder field comment. Every deity SELECTION
  // list elsewhere (POS/admin deity pickers, Item/Service/Event deity
  // mapping) sorts the same way, so Deity Master's own table matches what
  // an admin picking a deity sees everywhere else. Ticket PRINTING order
  // is the separate printOrder field instead — see controllers/pos-orders.
  sort: { displayOrder: 1, name: 1 },
});

router.get("/deities", requirePermission("deities", "view"), crud.list);
router.post(
  "/deities",
  requirePermission("deities", "fullAccess"),
  uploadDeityImage,
  hydrateMultipartBody,
  validateBody(createSchema),
  crud.create
);
router.put(
  "/deities/:id",
  requirePermission("deities", "edit"),
  uploadDeityImage,
  hydrateMultipartBody,
  validateBody(updateSchema),
  crud.update
);
router.delete("/deities/:id", requirePermission("deities", "fullAccess"), crud.remove);

// Excel import/export — see common/factories/import-export-controller.js for
// the generic scan-then-commit pipeline this builds on. Import is gated on
// the same "fullAccess" level as create/delete, since it writes new records;
// export/template download only need "view".
const importExport = makeImportExportController(Deity, {
  entityLabel: "Deity",
  sheetName: "Deities",
  fields: importExportFields,
  sampleRows,
  extraDefaults: { status: 1, image: null },
});

router.get("/deities/export", requirePermission("deities", "view"), importExport.exportList);
router.get("/deities/import/template", requirePermission("deities", "view"), importExport.downloadTemplate);
router.post("/deities/import/validate", requirePermission("deities", "fullAccess"), importExport.validateImport);
router.post("/deities/import/commit", requirePermission("deities", "fullAccess"), importExport.commitImport);

module.exports = router;
