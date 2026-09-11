const express = require("express");
const validateBody = require("../../common/middleware/validate");
const { uploadFoodPackageImage, hydrateMultipartBody } = require("../../common/middleware/upload");
const makeCrudController = require("../../common/factories/crud-controller");

const FoodPackage = require("../../models/food-packages");
const { createSchema, updateSchema } = require("./request-objects");

// Mounted at /hall-meal — see routes/index.js. Nothing references a Food
// Package yet (Hall Booking will, in Phase 2), so no `referencedBy` guard
// is needed here.
const router = express.Router();

const crud = makeCrudController(FoodPackage, {
  searchFields: ["name"],
  populate: ["menuItems.menuItem"],
});

router.get("/food-packages", crud.list);
router.post("/food-packages", uploadFoodPackageImage, hydrateMultipartBody, validateBody(createSchema), crud.create);
router.put("/food-packages/:id", uploadFoodPackageImage, hydrateMultipartBody, validateBody(updateSchema), crud.update);
router.delete("/food-packages/:id", crud.remove);

module.exports = router;
