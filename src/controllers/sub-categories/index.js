const express = require("express");
const requirePermission = require("../../common/middleware/require-permission");
const validateBody = require("../../common/middleware/validate");
const { uploadSubCategoryImage, hydrateMultipartBody } = require("../../common/middleware/upload");
const makeCrudController = require("../../common/factories/crud-controller");

const SubCategory = require("../../models/sub-categories");
const Item = require("../../models/items");
const Service = require("../../models/services");
const Event = require("../../models/events");
const { createSchema, updateSchema } = require("./request-objects");

// Mounted at /masters — see routes/index.js (authGuard/adminOnly now applied
// once for the whole /masters group there, not per master).
const router = express.Router();

const crud = makeCrudController(SubCategory, {
  searchFields: ["name", "tamilName", "code"],
  populate: [{ path: "category", select: "name" }],
  referencedBy: [
    { model: Item, field: "categoryDetails.subCategory", label: "Item" },
    { model: Service, field: "categoryDetails.subCategory", label: "Service" },
    { model: Event, field: "subCategory", label: "Event" },
  ],
});

router.get("/sub-categories", requirePermission("sub-categories", "view"), crud.list);
router.post(
  "/sub-categories",
  requirePermission("sub-categories", "fullAccess"),
  uploadSubCategoryImage,
  hydrateMultipartBody,
  validateBody(createSchema),
  crud.create
);
router.put(
  "/sub-categories/:id",
  requirePermission("sub-categories", "edit"),
  uploadSubCategoryImage,
  hydrateMultipartBody,
  validateBody(updateSchema),
  crud.update
);
router.delete("/sub-categories/:id", requirePermission("sub-categories", "fullAccess"), crud.remove);

module.exports = router;
