const express = require("express");
const requirePermission = require("../../common/middleware/require-permission");
const validateBody = require("../../common/middleware/validate");
const makeCrudController = require("../../common/factories/crud-controller");

const Gst = require("../../models/gst");
const { createSchema, updateSchema } = require("./request-objects");

// Mounted at /masters — see routes/index.js (authGuard/adminOnly now applied
// once for the whole /masters group there, not per master).
const router = express.Router();

const crud = makeCrudController(Gst, { searchFields: ["type", "code"] });

router.get("/gst", requirePermission("gst", "view"), crud.list);
router.post("/gst", requirePermission("gst", "fullAccess"), validateBody(createSchema), crud.create);
router.put("/gst/:id", requirePermission("gst", "edit"), validateBody(updateSchema), crud.update);
router.delete("/gst/:id", requirePermission("gst", "fullAccess"), crud.remove);

module.exports = router;
