const express = require("express");
const authGuard = require("../../common/middleware/auth-guard");
const adminOnly = require("../../common/middleware/admin-only");
const requirePermission = require("../../common/middleware/require-permission");
const validateBody = require("../../common/middleware/validate");
const makeCrudController = require("../../common/factories/crud-controller");

const SubCategory = require("../../models/sub-categories");
const { createSchema, updateSchema } = require("./request-objects");

// Mounted at /masters — see routes/index.js.
const router = express.Router();
router.use(authGuard, adminOnly);

const crud = makeCrudController(SubCategory, { searchFields: ["name", "tamilName", "code"] });

router.get("/sub-categories", requirePermission("sub-categories", "view"), crud.list);
router.post("/sub-categories", requirePermission("sub-categories", "fullAccess"), validateBody(createSchema), crud.create);
router.put("/sub-categories/:id", requirePermission("sub-categories", "edit"), validateBody(updateSchema), crud.update);
router.delete("/sub-categories/:id", requirePermission("sub-categories", "fullAccess"), crud.remove);

module.exports = router;
