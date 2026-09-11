const express = require("express");
const validateBody = require("../../common/middleware/validate");
const { uploadAdditionalServiceImage, hydrateMultipartBody } = require("../../common/middleware/upload");
const makeCrudController = require("../../common/factories/crud-controller");

const AdditionalService = require("../../models/additional-services");
const HallPackage = require("../../models/hall-packages");
const { createSchema, updateSchema } = require("./request-objects");

// Mounted at /hall-meal — see routes/index.js.
const router = express.Router();

const crud = makeCrudController(AdditionalService, {
  searchFields: ["name", "code"],
  referencedBy: [{ model: HallPackage, field: "additionalServices", label: "Hall Package" }],
});

router.get("/additional-services", crud.list);
router.post("/additional-services", uploadAdditionalServiceImage, hydrateMultipartBody, validateBody(createSchema), crud.create);
router.put("/additional-services/:id", uploadAdditionalServiceImage, hydrateMultipartBody, validateBody(updateSchema), crud.update);
router.delete("/additional-services/:id", crud.remove);

module.exports = router;
