const express = require("express");
const requirePermission = require("../../common/middleware/require-permission");
const validateBody = require("../../common/middleware/validate");
const { uploadItemImage, hydrateMultipartBody } = require("../../common/middleware/upload");
const makeCrudController = require("../../common/factories/crud-controller");

const Item = require("../../models/items");
const { createSchema, updateSchema } = require("./request-objects");

const POPULATE = [
  { path: "generalLedger", select: "name code" },
  { path: "printingGroup", select: "name" },
  { path: "deityMapping", select: "name printingGroup", populate: { path: "printingGroup", select: "name" } },
  { path: "categoryDetails.category", select: "name color" },
  { path: "categoryDetails.subCategory", select: "name color" },
];

// Mounted at /masters — see routes/index.js (authGuard/adminOnly now applied
// once for the whole /masters group there, not per master).
const router = express.Router();

const crud = makeCrudController(Item, { searchFields: ["name", "code", "tamilName"], populate: POPULATE });

router.get("/items", requirePermission("items", "view"), crud.list);
router.post(
  "/items",
  requirePermission("items", "fullAccess"),
  uploadItemImage,
  hydrateMultipartBody,
  validateBody(createSchema),
  crud.create
);
router.put(
  "/items/:id",
  requirePermission("items", "edit"),
  uploadItemImage,
  hydrateMultipartBody,
  validateBody(updateSchema),
  crud.update
);
router.delete("/items/:id", requirePermission("items", "fullAccess"), crud.remove);

module.exports = router;
