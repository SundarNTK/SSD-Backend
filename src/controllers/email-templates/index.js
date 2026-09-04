const express = require("express");
const requirePermission = require("../../common/middleware/require-permission");
const validateBody = require("../../common/middleware/validate");
const makeCrudController = require("../../common/factories/crud-controller");

const EmailTemplate = require("../../models/email-templates");
const EmailTemplateMapping = require("../../models/email-template-mappings");
const { createSchema, updateSchema } = require("./request-objects");

// These routes decide what the platform emails people, so they need both
// userType *and* module gating — applied once for the whole /notifications
// group in routes/index.js now, not here (see that file's comment for why
// each router used to apply its own copy).
const router = express.Router();

const controller = makeCrudController(EmailTemplate, {
  searchFields: ["name", "subject"],
  referencedBy: [{ model: EmailTemplateMapping, field: "template", label: "Email Template Mapping" }],
});
router.get("/email-templates", requirePermission("email-templates", "view"), controller.list);
router.post(
  "/email-templates",
  requirePermission("email-templates", "fullAccess"),
  validateBody(createSchema),
  controller.create
);
router.put(
  "/email-templates/:id",
  requirePermission("email-templates", "edit"),
  validateBody(updateSchema),
  controller.update
);
router.delete(
  "/email-templates/:id",
  requirePermission("email-templates", "fullAccess"),
  controller.remove
);

module.exports = router;
