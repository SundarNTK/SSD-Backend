const express = require("express");
const requirePermission = require("../../common/middleware/require-permission");
const validateBody = require("../../common/middleware/validate");
const makeCrudController = require("../../common/factories/crud-controller");

const PrintingGroup = require("../../models/printing-groups");
const { createSchema, updateSchema } = require("./request-objects");

// Mounted at /masters alongside every other master controller — see
// routes/index.js, where authGuard/adminOnly are now applied once for the
// whole /masters group (same for controllers/email-templates under the
// shared /notifications prefix), not per master.
const router = express.Router();

const crud = makeCrudController(PrintingGroup, { searchFields: ["name", "description"] });

router.get("/printing-groups", requirePermission("printing-groups", "view"), crud.list);
router.post(
  "/printing-groups",
  requirePermission("printing-groups", "fullAccess"),
  validateBody(createSchema),
  crud.create
);
router.put(
  "/printing-groups/:id",
  requirePermission("printing-groups", "edit"),
  validateBody(updateSchema),
  crud.update
);
router.delete("/printing-groups/:id", requirePermission("printing-groups", "fullAccess"), crud.remove);

module.exports = router;
