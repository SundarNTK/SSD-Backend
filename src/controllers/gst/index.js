const express = require("express");
const authGuard = require("../../common/middleware/auth-guard");
const adminOnly = require("../../common/middleware/admin-only");
const requirePermission = require("../../common/middleware/require-permission");
const validateBody = require("../../common/middleware/validate");
const makeCrudController = require("../../common/factories/crud-controller");

const Gst = require("../../models/gst");
const { createSchema, updateSchema } = require("./request-objects");

// Mounted at /masters — see routes/index.js.
const router = express.Router();
router.use(authGuard, adminOnly);

const crud = makeCrudController(Gst, { searchFields: ["type", "code"] });

router.get("/gst", requirePermission("gst", "view"), crud.list);
router.post("/gst", requirePermission("gst", "fullAccess"), validateBody(createSchema), crud.create);
router.put("/gst/:id", requirePermission("gst", "edit"), validateBody(updateSchema), crud.update);
router.delete("/gst/:id", requirePermission("gst", "fullAccess"), crud.remove);

module.exports = router;
