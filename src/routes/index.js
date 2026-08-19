const express = require("express");
const authRoutes = require("../controllers/auth");
const emailTemplateRoutes = require("../controllers/email-templates");
const emailTemplateMappingRoutes = require("../controllers/email-template-mappings");
const roleRoutes = require("../controllers/roles");
const userRoutes = require("../controllers/users");
const customerProfileRoutes = require("../controllers/customer-profile");
const customerAdminRoutes = require("../controllers/customers");
const mastersRoutes = require("../controllers/masters");
const printingGroupRoutes = require("../controllers/printing-groups");
const gstRoutes = require("../controllers/gst");
const glGroupRoutes = require("../controllers/gl-groups");
const posRoutes = require("../controllers/pos");
const inventoryRoutes = require("../controllers/inventory");
const paymentsRoutes = require("../controllers/payments");
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
router.use("/notifications", emailTemplateRoutes); // admin-side: email template master
router.use("/notifications", emailTemplateMappingRoutes); // admin-side: email template mapping master
router.use("/roles", roleRoutes); // admin-side: role master, permissions, module list
router.use("/users", userRoutes); // admin-side: user master
router.use("/customers", customerAdminRoutes); // admin-side: devotee master
router.use("/me", customerProfileRoutes); // customer-side: the caller's own devotee profile

// Reserved namespaces — real masters/POS/inventory/payments/reports modules
// mount here as they're built (see DashboardPage's "Coming up" list). Each
// is a working health-check router today, not a placeholder file, so every
// folder under controllers/ does something rather than sitting empty.
router.use("/masters", mastersRoutes);
router.use("/masters", printingGroupRoutes);
router.use("/masters", gstRoutes);
router.use("/masters", glGroupRoutes);
router.use("/pos", posRoutes);
router.use("/inventory", inventoryRoutes);
router.use("/payments", paymentsRoutes);
router.use("/reports", reportsRoutes);

module.exports = router;
