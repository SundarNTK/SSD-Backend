const express = require("express");
const requirePermission = require("../../common/middleware/require-permission");
const validateBody = require("../../common/middleware/validate");
const { uploadServiceImage, hydrateMultipartBody } = require("../../common/middleware/upload");
const makeCrudController = require("../../common/factories/crud-controller");

const Service = require("../../models/services");
const { createSchema, updateSchema } = require("./request-objects");

const POPULATE = [
  { path: "generalLedger", select: "name code" },
  { path: "printingGroup", select: "name" },
  { path: "deityMapping", select: "name" },
  { path: "categoryDetails.category", select: "name color" },
  { path: "categoryDetails.subCategory", select: "name color" },
];

// Mounted at /masters — see routes/index.js (authGuard/adminOnly now applied
// once for the whole /masters group there, not per master).
const router = express.Router();

const crud = makeCrudController(Service, { searchFields: ["name", "code", "tamilName"], populate: POPULATE });

router.get("/services", requirePermission("services", "view"), crud.list);
router.post(
  "/services",
  requirePermission("services", "fullAccess"),
  uploadServiceImage,
  hydrateMultipartBody,
  validateBody(createSchema),
  crud.create
);
router.put(
  "/services/:id",
  requirePermission("services", "edit"),
  uploadServiceImage,
  hydrateMultipartBody,
  validateBody(updateSchema),
  crud.update
);
router.delete("/services/:id", requirePermission("services", "fullAccess"), crud.remove);

module.exports = router;
