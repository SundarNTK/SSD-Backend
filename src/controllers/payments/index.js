const express = require("express");

// Payment capture/reconciliation for POS transactions — was Payment-Service's
// scope before the merge, and never got past an empty repo. Mounted at
// /payments — see routes/index.js.
const router = express.Router();

router.get("/health", (req, res) => res.json({ ok: true, service: "SSD-Backend", module: "payments" }));

module.exports = router;
