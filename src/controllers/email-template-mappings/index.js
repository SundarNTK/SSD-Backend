const express = require("express");
const authGuard = require("../../common/middleware/auth-guard");
const adminOnly = require("../../common/middleware/admin-only");
const requirePermission = require("../../common/middleware/require-permission");
const validateBody = require("../../common/middleware/validate");
const makeCrudController = require("../../common/factories/crud-controller");

const EmailTemplateMapping = require("../../models/email-template-mappings");
const { createSchema, updateSchema } = require("./request-objects");

const router = express.Router();

/**
 * Same gate as email-templates — this decides which template fires for
 * which entity+event, including the ACCOUNT_ACTIVATION mapping the whole
 * registration flow depends on.
 */
router.use(authGuard, adminOnly);

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
