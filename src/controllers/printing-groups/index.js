const express = require("express");
const authGuard = require("../../common/middleware/auth-guard");
const adminOnly = require("../../common/middleware/admin-only");
const requirePermission = require("../../common/middleware/require-permission");
const validateBody = require("../../common/middleware/validate");
const makeCrudController = require("../../common/factories/crud-controller");

const PrintingGroup = require("../../models/printing-groups");
const { createSchema, updateSchema } = require("./request-objects");

// Mounted at /masters alongside every other master controller — see
// routes/index.js. Own path segment here, same as
// controllers/email-templates does under the shared /notifications prefix.
const router = express.Router();
router.use(authGuard, adminOnly);

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
