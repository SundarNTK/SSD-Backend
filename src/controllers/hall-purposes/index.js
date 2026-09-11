const express = require("express");
const validateBody = require("../../common/middleware/validate");
const { uploadHallPurposeImage, hydrateMultipartBody } = require("../../common/middleware/upload");
const makeCrudController = require("../../common/factories/crud-controller");

const HallPurpose = require("../../models/hall-purposes");
const HallPackage = require("../../models/hall-packages");
const { createSchema, updateSchema } = require("./request-objects");

// Mounted at /hall-meal — see routes/index.js.
const router = express.Router();

const crud = makeCrudController(HallPurpose, {
  searchFields: ["name"],
  referencedBy: [{ model: HallPackage, field: "hallPurpose", label: "Hall Package" }],
});

router.get("/hall-purposes", crud.list);
router.post("/hall-purposes", uploadHallPurposeImage, hydrateMultipartBody, validateBody(createSchema), crud.create);
router.put("/hall-purposes/:id", uploadHallPurposeImage, hydrateMultipartBody, validateBody(updateSchema), crud.update);
router.delete("/hall-purposes/:id", crud.remove);

module.exports = router;
