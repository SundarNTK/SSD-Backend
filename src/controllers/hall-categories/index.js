const express = require("express");
const validateBody = require("../../common/middleware/validate");
const { uploadHallCategoryImage, hydrateMultipartBody } = require("../../common/middleware/upload");
const makeCrudController = require("../../common/factories/crud-controller");

const HallCategory = require("../../models/hall-categories");
const Hall = require("../../models/halls");
const { createSchema, updateSchema } = require("./request-objects");

// Mounted at /hall-meal — see routes/index.js (authGuard + hallMealAccessOnly
// applied once for the whole /hall-meal group there).
const router = express.Router();

const crud = makeCrudController(HallCategory, {
  searchFields: ["name", "code"],
  referencedBy: [{ model: Hall, field: "category", label: "Hall" }],
});

router.get("/hall-categories", crud.list);
router.post("/hall-categories", uploadHallCategoryImage, hydrateMultipartBody, validateBody(createSchema), crud.create);
router.put("/hall-categories/:id", uploadHallCategoryImage, hydrateMultipartBody, validateBody(updateSchema), crud.update);
router.delete("/hall-categories/:id", crud.remove);

module.exports = router;
