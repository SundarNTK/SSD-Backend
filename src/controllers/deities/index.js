const express = require("express");
const requirePermission = require("../../common/middleware/require-permission");
const validateBody = require("../../common/middleware/validate");
const makeCrudController = require("../../common/factories/crud-controller");

const Deity = require("../../models/deities");
const Item = require("../../models/items");
const Service = require("../../models/services");
const Event = require("../../models/events");
const { createSchema, updateSchema } = require("./request-objects");

// Mounted at /masters — see routes/index.js (authGuard/adminOnly now applied
// once for the whole /masters group there, not per master).
const router = express.Router();

const crud = makeCrudController(Deity, {
  searchFields: ["code", "name", "tamilName"],
  populate: [{ path: "printingGroup", select: "name" }],
  referencedBy: [
    { model: Item, field: "deityMapping", label: "Item" },
    { model: Service, field: "deityMapping", label: "Service" },
    { model: Event, field: "deityMapping", label: "Event" },
  ],
});

router.get("/deities", requirePermission("deities", "view"), crud.list);
router.post("/deities", requirePermission("deities", "fullAccess"), validateBody(createSchema), crud.create);
router.put("/deities/:id", requirePermission("deities", "edit"), validateBody(updateSchema), crud.update);
router.delete("/deities/:id", requirePermission("deities", "fullAccess"), crud.remove);

module.exports = router;
