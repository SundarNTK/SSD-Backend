const express = require("express");

// Stock adjustment, available stock, history, low-stock report (Day 7 of
// the build sequence). Mounted at /inventory — see routes/index.js.
const router = express.Router();

router.get("/health", (req, res) => res.json({ ok: true, service: "SSD-Backend", module: "inventory" }));

module.exports = router;
