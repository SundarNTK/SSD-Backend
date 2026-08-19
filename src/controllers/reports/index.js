const express = require("express");

// Audit trail and operational reports (Day 10 of the build sequence).
// Mounted at /reports — see routes/index.js.
const router = express.Router();

router.get("/health", (req, res) => res.json({ ok: true, service: "SSD-Backend", module: "reports" }));

module.exports = router;
