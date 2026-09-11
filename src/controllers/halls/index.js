const express = require("express");
const validateBody = require("../../common/middleware/validate");
const { uploadHallMedia, hydrateMultipartBody } = require("../../common/middleware/upload");
const makeCrudController = require("../../common/factories/crud-controller");

const Hall = require("../../models/halls");
const HallPackage = require("../../models/hall-packages");
const { createSchema, updateSchema } = require("./request-objects");

// Mounted at /hall-meal — see routes/index.js.
const router = express.Router();

const crud = makeCrudController(Hall, {
  searchFields: ["name", "code"],
  populate: ["category"],
  referencedBy: [{ model: HallPackage, field: "halls", label: "Hall Package" }],
});

router.get("/halls", crud.list);
// uploadHallMedia runs before validateBody — multer has to parse the
// multipart body (and stream both files to Cloudinary) before Joi
// validates the resulting req.body, same ordering categories/index.js uses.
router.post("/halls", uploadHallMedia, hydrateMultipartBody, validateBody(createSchema), crud.create);
router.put("/halls/:id", uploadHallMedia, hydrateMultipartBody, validateBody(updateSchema), crud.update);
router.delete("/halls/:id", crud.remove);

module.exports = router;
