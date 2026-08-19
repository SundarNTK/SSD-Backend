const express = require("express");

// Printing Group, GST, GL, Category, Item, Service, Event, Nakshatra masters
// land here (see DashboardPage's "Coming up" list, Day 3-7 of the build
// sequence). Mounted at /masters — see routes/index.js.
const router = express.Router();

router.get("/health", (req, res) => res.json({ ok: true, service: "SSD-Backend", module: "masters" }));

module.exports = router;
