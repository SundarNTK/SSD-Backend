const express = require("express");
const authGuard = require("../../common/middleware/auth-guard");
const adminOnly = require("../../common/middleware/admin-only");
const requirePermission = require("../../common/middleware/require-permission");
const validateBody = require("../../common/middleware/validate");
const makeCrudController = require("../../common/factories/crud-controller");

const Service = require("../../models/services");
const { createSchema, updateSchema } = require("./request-objects");

const POPULATE = [
  { path: "generalLedger", select: "name code" },
  { path: "deityMapping", select: "name" },
  { path: "categoryDetails.category", select: "name color" },
  { path: "categoryDetails.subCategory", select: "name color" },
];

// Mounted at /masters — see routes/index.js.
const router = express.Router();
router.use(authGuard, adminOnly);

const crud = makeCrudController(Service, { searchFields: ["name", "code", "tamilName"], populate: POPULATE });

router.get("/services", requirePermission("services", "view"), crud.list);
router.post("/services", requirePermission("services", "fullAccess"), validateBody(createSchema), crud.create);
router.put("/services/:id", requirePermission("services", "edit"), validateBody(updateSchema), crud.update);
router.delete("/services/:id", requirePermission("services", "fullAccess"), crud.remove);

module.exports = router;
