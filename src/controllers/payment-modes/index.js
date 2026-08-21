const express = require("express");
const authGuard = require("../../common/middleware/auth-guard");
const adminOnly = require("../../common/middleware/admin-only");
const requirePermission = require("../../common/middleware/require-permission");
const validateBody = require("../../common/middleware/validate");
const makeCrudController = require("../../common/factories/crud-controller");

const PaymentMode = require("../../models/payment-modes");
const { updateSchema } = require("./request-objects");

// Mounted at /masters — see routes/index.js.
// View + edit only — no create/delete route. Payment modes are a fixed,
// seeded set (seed/seedPaymentModes.js), not admin-authored records.
const router = express.Router();
router.use(authGuard, adminOnly);

const crud = makeCrudController(PaymentMode, { searchFields: ["name", "description"] });

router.get("/payment-modes", requirePermission("payment-modes", "view"), crud.list);
router.put("/payment-modes/:id", requirePermission("payment-modes", "edit"), validateBody(updateSchema), crud.update);

module.exports = router;
