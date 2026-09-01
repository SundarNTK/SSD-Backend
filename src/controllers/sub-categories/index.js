const express = require("express");
const requirePermission = require("../../common/middleware/require-permission");
const validateBody = require("../../common/middleware/validate");
const makeCrudController = require("../../common/factories/crud-controller");

const SubCategory = require("../../models/sub-categories");
const { createSchema, updateSchema } = require("./request-objects");

// Mounted at /masters — see routes/index.js (authGuard/adminOnly now applied
// once for the whole /masters group there, not per master).
const router = express.Router();

const crud = makeCrudController(SubCategory, {
  searchFields: ["name", "tamilName", "code"],
  populate: [{ path: "category", select: "name" }],
});

router.get("/sub-categories", requirePermission("sub-categories", "view"), crud.list);
router.post("/sub-categories", requirePermission("sub-categories", "fullAccess"), validateBody(createSchema), crud.create);
router.put("/sub-categories/:id", requirePermission("sub-categories", "edit"), validateBody(updateSchema), crud.update);
router.delete("/sub-categories/:id", requirePermission("sub-categories", "fullAccess"), crud.remove);

module.exports = router;
