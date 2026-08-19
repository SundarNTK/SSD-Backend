const express = require("express");

// Counter billing, payment, receipt, printing (Day 8-9 of the build
// sequence). Mounted at /pos — see routes/index.js.
const router = express.Router();

router.get("/health", (req, res) => res.json({ ok: true, service: "SSD-Backend", module: "pos" }));

module.exports = router;
