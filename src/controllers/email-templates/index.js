const express = require("express");
const authGuard = require("../../common/middleware/auth-guard");
const adminOnly = require("../../common/middleware/admin-only");
const requirePermission = require("../../common/middleware/require-permission");
const validateBody = require("../../common/middleware/validate");
const makeCrudController = require("../../common/factories/crud-controller");

const EmailTemplate = require("../../models/email-templates");
const { createSchema, updateSchema } = require("./request-objects");

const router = express.Router();

/**
 * These routes decide what the platform emails people. Until this gate
 * existed they sat behind `authGuard` alone — meaning any signed-in
 * account, CUSTOMER accounts included, could read every template. Now
 * gated by userType *and* module, same as every other master.
 */
router.use(authGuard, adminOnly);

const controller = makeCrudController(EmailTemplate, { searchFields: ["name", "subject"] });
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
