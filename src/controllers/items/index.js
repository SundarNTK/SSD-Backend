const express = require("express");
const authGuard = require("../../common/middleware/auth-guard");
const adminOnly = require("../../common/middleware/admin-only");
const requirePermission = require("../../common/middleware/require-permission");
const validateBody = require("../../common/middleware/validate");
const makeCrudController = require("../../common/factories/crud-controller");

const Item = require("../../models/items");
const { createSchema, updateSchema } = require("./request-objects");

const POPULATE = [
  { path: "generalLedger", select: "name code" },
  { path: "printingGroup", select: "name" },
  { path: "categoryDetails.category", select: "name color" },
  { path: "categoryDetails.subCategory", select: "name color" },
];

// Mounted at /masters — see routes/index.js.
const router = express.Router();
router.use(authGuard, adminOnly);

const crud = makeCrudController(Item, { searchFields: ["name", "code", "tamilName"], populate: POPULATE });

router.get("/items", requirePermission("items", "view"), crud.list);
router.post("/items", requirePermission("items", "fullAccess"), validateBody(createSchema), crud.create);
router.put("/items/:id", requirePermission("items", "edit"), validateBody(updateSchema), crud.update);
router.delete("/items/:id", requirePermission("items", "fullAccess"), crud.remove);

module.exports = router;
