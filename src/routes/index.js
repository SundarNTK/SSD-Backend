const express = require("express");
const authGuard = require("../common/middleware/auth-guard");
const adminOnly = require("../common/middleware/admin-only");
const authRoutes = require("../controllers/auth");
const emailTemplateRoutes = require("../controllers/email-templates");
const emailTemplateMappingRoutes = require("../controllers/email-template-mappings");
const roleRoutes = require("../controllers/roles");
const userRoutes = require("../controllers/users");
const customerProfileRoutes = require("../controllers/customer-profile");
const customerAdminRoutes = require("../controllers/customers");
const mastersRoutes = require("../controllers/masters");
const printingGroupRoutes = require("../controllers/printing-groups");
const unitRoutes = require("../controllers/units");
const gstRoutes = require("../controllers/gst");
const glGroupRoutes = require("../controllers/gl-groups");
const deityRoutes = require("../controllers/deities");
const generalLedgerRoutes = require("../controllers/general-ledgers");
const categoryRoutes = require("../controllers/categories");
const subCategoryRoutes = require("../controllers/sub-categories");
const itemRoutes = require("../controllers/items");
const serviceRoutes = require("../controllers/services");
const eventRoutes = require("../controllers/events");
const nakshathiramRoutes = require("../controllers/nakshathirams");
const paymentModeRoutes = require("../controllers/payment-modes");
const translateRoutes = require("../controllers/translate");
const posRoutes = require("../controllers/pos");
const inventoryRoutes = require("../controllers/inventory");
const paymentsRoutes = require("../controllers/payments");
const posOrderConfirmationRoutes = require("../controllers/pos-order-confirmation");
const reportsRoutes = require("../controllers/reports");

const router = express.Router();

router.get("/health", (req, res) => res.json({ ok: true, service: "SSD-Backend" }));

/**
 * Every sub-router is mounted under an explicit path prefix, and that is a
 * correctness requirement rather than tidiness.
 *
 * A router mounted with no prefix is entered by Express for *any* path that
 * reaches this file, so its router-level middleware runs on unrelated
 * requests. That already broke things twice here: an unauthenticated
 * `/health` started returning 401 from the admin routers' `authGuard`, and
 * later `/me/customer-profile` returned "restricted to temple
 * administrators" because it fell through the same routers' `adminOnly`
 * before ever reaching the customer routes. Both times the symptom pointed
 * at the wrong file entirely.
 *
 * With prefixes, `router.use(authGuard, adminOnly)` inside a sub-router
 * applies to that sub-router's paths and nothing else.
 */
router.use("/auth", authRoutes); // public + token-holder routes

/**
 * `authGuard` + `adminOnly` applied ONCE here, for the whole group — not
 * inside each individual master's own controller file.
 *
 * Every master under /masters (and both routers under /notifications) used
 * to call `router.use(authGuard, adminOnly)` at its own top. That looked
 * safe in isolation, but every one of those routers is mounted at the exact
 * same prefix below, and Express doesn't stop at the first one that doesn't
 * match a route — it falls through to the next `router.use("/masters", X)`
 * in this list. `authGuard` and `adminOnly` are still just middleware, and
 * middleware attached via a path-less `router.use()` runs for *any* request
 * that reaches that router, whether or not that router turns out to have a
 * matching route. So a single request to `GET /masters/items` was running
 * `authGuard` — a real database round-trip to re-read the account and its
 * roles — once for every OTHER masters router mounted before `itemRoutes`
 * in this list, not once. With thirteen routers sharing the /masters
 * prefix, that's up to twelve wasted database round-trips before the
 * request ever reached the code that actually answers it, and it only got
 * worse the later a master sits in this list (Payment Mode, last in line,
 * paid for all twelve of the others). Grouping the shared prefix under one
 * router with the guard applied once fixes this for every master at once,
 * structurally, rather than needing to remember it per file.
 *
 * `/users`, `/roles`, and `/customers` are NOT part of this — each of those
 * is the only router mounted at its prefix, so they never had this problem,
 * and keep their own `authGuard`/`adminOnly` exactly as before.
 */
const notificationsRouter = express.Router();
notificationsRouter.use(authGuard, adminOnly);
notificationsRouter.use(emailTemplateRoutes); // admin-side: email template master
notificationsRouter.use(emailTemplateMappingRoutes); // admin-side: email template mapping master
router.use("/notifications", notificationsRouter);

router.use("/roles", roleRoutes); // admin-side: role master, permissions, module list
router.use("/users", userRoutes); // admin-side: user master
router.use("/customers", customerAdminRoutes); // admin-side: devotee master
router.use("/me", customerProfileRoutes); // customer-side: the caller's own devotee profile

const mastersRouter = express.Router();
mastersRouter.use(authGuard, adminOnly);
mastersRouter.use(mastersRoutes);
mastersRouter.use(printingGroupRoutes);
mastersRouter.use(unitRoutes);
mastersRouter.use(gstRoutes);
mastersRouter.use(glGroupRoutes);
mastersRouter.use(deityRoutes);
mastersRouter.use(generalLedgerRoutes);
mastersRouter.use(categoryRoutes);
mastersRouter.use(subCategoryRoutes);
mastersRouter.use(itemRoutes);
mastersRouter.use(serviceRoutes);
mastersRouter.use(eventRoutes);
mastersRouter.use(nakshathiramRoutes);
mastersRouter.use(paymentModeRoutes);
mastersRouter.use(translateRoutes);
router.use("/masters", mastersRouter);

router.use("/pos", posRoutes);
router.use("/inventory", inventoryRoutes);
router.use("/payments", paymentsRoutes);
router.use("/pos-order-confirmation", posOrderConfirmationRoutes);
router.use("/reports", reportsRoutes);

module.exports = router;
