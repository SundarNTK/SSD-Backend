const express = require("express");
const authGuard = require("../../common/middleware/auth-guard");
const adminOnly = require("../../common/middleware/admin-only");
const requirePermission = require("../../common/middleware/require-permission");
const validateBody = require("../../common/middleware/validate");
const makeCrudController = require("../../common/factories/crud-controller");

const Deity = require("../../models/deities");
const { createSchema, updateSchema } = require("./request-objects");

// Mounted at /masters — see routes/index.js.
const router = express.Router();
router.use(authGuard, adminOnly);

const crud = makeCrudController(Deity, {
  searchFields: ["name", "tamilName"],
  populate: [{ path: "printingGroup", select: "name" }],
});

router.get("/deities", requirePermission("deities", "view"), crud.list);
router.post("/deities", requirePermission("deities", "fullAccess"), validateBody(createSchema), crud.create);
router.put("/deities/:id", requirePermission("deities", "edit"), validateBody(updateSchema), crud.update);
router.delete("/deities/:id", requirePermission("deities", "fullAccess"), crud.remove);

module.exports = router;
