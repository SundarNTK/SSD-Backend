const express = require("express");
const requirePermission = require("../../common/middleware/require-permission");
const validateBody = require("../../common/middleware/validate");
const makeCrudController = require("../../common/factories/crud-controller");

const EmailTemplateMapping = require("../../models/email-template-mappings");
const { createSchema, updateSchema } = require("./request-objects");

// Same gate as email-templates — see routes/index.js, applied once for the
// whole /notifications group.
const router = express.Router();

const controller = makeCrudController(EmailTemplateMapping, {
  populate: ["template", "entity"],
});
router.get("/email-template-mappings", requirePermission("email-templates", "view"), controller.list);
router.post(
  "/email-template-mappings",
  requirePermission("email-templates", "fullAccess"),
  validateBody(createSchema),
  controller.create
);
router.put(
  "/email-template-mappings/:id",
  requirePermission("email-templates", "edit"),
  validateBody(updateSchema),
  controller.update
);
router.delete(
  "/email-template-mappings/:id",
  requirePermission("email-templates", "fullAccess"),
  controller.remove
);

module.exports = router;
