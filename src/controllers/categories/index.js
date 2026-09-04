const express = require("express");
const requirePermission = require("../../common/middleware/require-permission");
const validateBody = require("../../common/middleware/validate");
const { uploadCategoryImage, hydrateMultipartBody } = require("../../common/middleware/upload");
const makeCrudController = require("../../common/factories/crud-controller");

const Category = require("../../models/categories");
const SubCategory = require("../../models/sub-categories");
const Item = require("../../models/items");
const Service = require("../../models/services");
const Event = require("../../models/events");
const { createSchema, updateSchema } = require("./request-objects");

// Mounted at /masters — see routes/index.js (authGuard/adminOnly now applied
// once for the whole /masters group there, not per master).
const router = express.Router();

const crud = makeCrudController(Category, {
  searchFields: ["name", "tamilName", "code"],
  referencedBy: [
    { model: SubCategory, field: "category", label: "Sub Category" },
    { model: Item, field: "categoryDetails.category", label: "Item" },
    { model: Service, field: "categoryDetails.category", label: "Service" },
    { model: Event, field: "category", label: "Event" },
  ],
});

router.get("/categories", requirePermission("categories", "view"), crud.list);
// uploadCategoryImage runs before validateBody on the write routes, same
// order controllers/users uses for its avatar upload — multer has to parse
// the multipart body into req.body before Joi can validate it.
router.post(
  "/categories",
  requirePermission("categories", "fullAccess"),
  uploadCategoryImage,
  hydrateMultipartBody,
  validateBody(createSchema),
  crud.create
);
router.put(
  "/categories/:id",
  requirePermission("categories", "edit"),
  uploadCategoryImage,
  hydrateMultipartBody,
  validateBody(updateSchema),
  crud.update
);
router.delete("/categories/:id", requirePermission("categories", "fullAccess"), crud.remove);

module.exports = router;
