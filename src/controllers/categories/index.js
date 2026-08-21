const express = require("express");
const requirePermission = require("../../common/middleware/require-permission");
const validateBody = require("../../common/middleware/validate");
const { uploadCategoryImage } = require("../../common/middleware/upload");
const makeCrudController = require("../../common/factories/crud-controller");

const Category = require("../../models/categories");
const { createSchema, updateSchema } = require("./request-objects");

// Mounted at /masters — see routes/index.js (authGuard/adminOnly now applied
// once for the whole /masters group there, not per master).
const router = express.Router();

const crud = makeCrudController(Category, { searchFields: ["name", "tamilName", "code"] });

router.get("/categories", requirePermission("categories", "view"), crud.list);
// uploadCategoryImage runs before validateBody on the write routes, same
// order controllers/users uses for its avatar upload — multer has to parse
// the multipart body into req.body before Joi can validate it.
router.post(
  "/categories",
  requirePermission("categories", "fullAccess"),
  uploadCategoryImage,
  validateBody(createSchema),
  crud.create
);
router.put(
  "/categories/:id",
  requirePermission("categories", "edit"),
  uploadCategoryImage,
  validateBody(updateSchema),
  crud.update
);
router.delete("/categories/:id", requirePermission("categories", "fullAccess"), crud.remove);

module.exports = router;
