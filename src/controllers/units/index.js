const express = require("express");
const requirePermission = require("../../common/middleware/require-permission");
const validateBody = require("../../common/middleware/validate");
const makeCrudController = require("../../common/factories/crud-controller");

const Unit = require("../../models/units");
const { createSchema, updateSchema } = require("./request-objects");

// Mounted at /masters alongside every other master controller — see
// routes/index.js, where authGuard/adminOnly are applied once for the whole
// /masters group.
const router = express.Router();

const crud = makeCrudController(Unit, { searchFields: ["unitCode", "unitName", "description"] });

router.get("/units", requirePermission("units", "view"), crud.list);
router.post("/units", requirePermission("units", "fullAccess"), validateBody(createSchema), crud.create);
router.put("/units/:id", requirePermission("units", "edit"), validateBody(updateSchema), crud.update);
router.delete("/units/:id", requirePermission("units", "fullAccess"), crud.remove);

module.exports = router;
