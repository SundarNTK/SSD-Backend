const express = require("express");
const requirePermission = require("../../common/middleware/require-permission");
const validateBody = require("../../common/middleware/validate");
const makeCrudController = require("../../common/factories/crud-controller");

const Nakshathiram = require("../../models/nakshathirams");
const { createSchema, updateSchema } = require("./request-objects");

// Mounted at /masters — see routes/index.js (authGuard/adminOnly now applied
// once for the whole /masters group there, not per master).
const router = express.Router();

const crud = makeCrudController(Nakshathiram, { searchFields: ["name", "tamilName", "code", "rasi"] });

router.get("/nakshathirams", requirePermission("nakshathirams", "view"), crud.list);
router.post("/nakshathirams", requirePermission("nakshathirams", "fullAccess"), validateBody(createSchema), crud.create);
router.put("/nakshathirams/:id", requirePermission("nakshathirams", "edit"), validateBody(updateSchema), crud.update);
router.delete("/nakshathirams/:id", requirePermission("nakshathirams", "fullAccess"), crud.remove);

module.exports = router;
