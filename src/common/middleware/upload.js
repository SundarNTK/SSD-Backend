const multer = require("multer");
const cloudinary = require("../utils/cloudinary");
const { exceptionHandler } = require("../../utilities/handlers");

/**
 * Image uploads, streamed straight to Cloudinary — never touch local disk.
 * Render's filesystem is ephemeral (anything written to disk is gone on
 * the next deploy/restart), and this same code runs unchanged once the
 * app moves to AWS, so local disk was never a real option here.
 */
const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_BYTES = 100 * 1024; // 100 KB — every master's image upload shares this one cap

const uploader = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BYTES, files: 1 },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_MIME.has(file.mimetype)) {
      return cb(new Error("Image must be a JPG, PNG or WebP file."));
    }
    return cb(null, true);
  },
});

/**
 * Uploads a buffer to Cloudinary via its streaming API — multer already has
 * the whole file in memory (2 MB cap above), so there's no benefit to
 * writing it to a temp file first just to re-read it.
 */
function uploadBufferToCloudinary(buffer, folder) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder, resource_type: "image" },
      (error, result) => (error ? reject(error) : resolve(result))
    );
    stream.end(buffer);
  });
}

/**
 * Builds an Express middleware that takes one multipart file field, uploads
 * it to Cloudinary, and rewrites `req.body[targetField]` to the returned
 * secure_url — so every image upload (avatar, category image, and whatever
 * comes next) shares one implementation instead of each hand-rolling its
 * own multer + Cloudinary round-trip.
 *
 * `formField` and `targetField` are usually the same name; they're kept
 * separate only because `uploadAvatar` predates this factory and its form
 * field is `profileImage`, not `avatar`.
 *
 * Also reads a companion `existing<TargetField>` text field (e.g.
 * `existingImage` for `targetField: "image"`) — the edit form's way of
 * saying "here's what to keep" independent of whether a new file arrived.
 * Without it there was no way to represent "the person clicked Remove and
 * picked nothing new": no file meant this middleware did nothing at all,
 * so a removed image silently stayed on the record. A caller that never
 * sends the companion field (older frontend code, or one that hasn't been
 * updated to offer removal yet) sees no change in behaviour — this only
 * activates once something actually sends it.
 */
function makeImageUpload({ formField, targetField = formField, folder, label = "Image" }) {
  const existingField = `existing${targetField.charAt(0).toUpperCase()}${targetField.slice(1)}`;

  return function uploadImage(req, res, next) {
    uploader.single(formField)(req, res, async (err) => {
      if (err) {
        const message = err.code === "LIMIT_FILE_SIZE" ? `${label} must be 100 KB or smaller.` : err.message;
        return exceptionHandler({ res, error: message, statusCode: 422 });
      }

      const hasExistingField = req.body[existingField] !== undefined;
      const existingValue = req.body[existingField] || null;
      delete req.body[existingField];

      if (!req.file) {
        if (hasExistingField) req.body[targetField] = existingValue;
        return next();
      }

      try {
        const result = await uploadBufferToCloudinary(req.file.buffer, folder);
        // The full secure_url is stored as-is — resolveImageUrl() on the
        // frontend already passes absolute https:// URLs through unchanged.
        req.body[targetField] = result.secure_url;
        return next();
      } catch (error) {
        return exceptionHandler({ res, error: `Could not upload the ${label.toLowerCase()}. Please try again.`, statusCode: 502 });
      }
    });
  };
}

const uploadAvatar = makeImageUpload({
  formField: "profileImage",
  folder: "ssd-temple/avatars",
  label: "Profile image",
});

const uploadCategoryImage = makeImageUpload({
  formField: "image",
  folder: "ssd-temple/categories",
  label: "Category image",
});

const uploadDeityImage = makeImageUpload({
  formField: "image",
  folder: "ssd-temple/deities",
  label: "Deity image",
});

const uploadSubCategoryImage = makeImageUpload({
  formField: "image",
  folder: "ssd-temple/sub-categories",
  label: "Sub-category image",
});

const uploadItemImage = makeImageUpload({
  formField: "image",
  folder: "ssd-temple/items",
  label: "Item image",
});

const uploadServiceImage = makeImageUpload({
  formField: "image",
  folder: "ssd-temple/services",
  label: "Service image",
});

const uploadEventImage = makeImageUpload({
  formField: "image",
  folder: "ssd-temple/events",
  label: "Event image",
});

const uploadHallPurposeImage = makeImageUpload({
  formField: "image",
  folder: "ssd-temple/hall-purposes",
  label: "Hall Purpose image",
});

const uploadHallCategoryImage = makeImageUpload({
  formField: "image",
  folder: "ssd-temple/hall-categories",
  label: "Hall Category image",
});

const uploadAdditionalServiceImage = makeImageUpload({
  formField: "image",
  folder: "ssd-temple/additional-services",
  label: "Additional Service image",
});

const uploadHallPackageImage = makeImageUpload({
  formField: "image",
  folder: "ssd-temple/hall-packages",
  label: "Hall Package image",
});

const uploadFoodMenuItemImage = makeImageUpload({
  formField: "image",
  folder: "ssd-temple/food-menu-items",
  label: "Food Menu Item image",
});

const uploadFoodPackageImage = makeImageUpload({
  formField: "image",
  folder: "ssd-temple/food-packages",
  label: "Food Package image",
});

/**
 * Multipart fields arrive as strings. Nested arrays (categoryDetails,
 * deityMapping) are JSON.stringified by the frontend; booleans/nulls are
 * "true"/"false"/"null". Joi can coerce numbers from strings, but a JSON
 * array string fails Joi.array() — parse those here so every master with
 * an image upload can keep one Joi schema for JSON and multipart.
 */
function hydrateMultipartBody(req, res, next) {
  if (!req.body || typeof req.body !== "object") return next();
  for (const [key, value] of Object.entries(req.body)) {
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (trimmed === "true") {
      req.body[key] = true;
      continue;
    }
    if (trimmed === "false") {
      req.body[key] = false;
      continue;
    }
    if (trimmed === "null" || trimmed === "") {
      if (trimmed === "null") req.body[key] = null;
      continue;
    }
    if (
      (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
      (trimmed.startsWith("[") && trimmed.endsWith("]"))
    ) {
      try {
        req.body[key] = JSON.parse(trimmed);
      } catch {
        // leave the original string; Joi will report a useful error
      }
    }
  }
  return next();
}

/**
 * Hall Master needs two file fields in the same submission — several
 * `hallImages` plus one `floorPlan` — which `makeImageUpload()` can't give
 * it: that factory calls `uploader.single(field)`, and a second `.single()`
 * call on the same request would try to re-read a multipart stream multer
 * already consumed. `uploader.fields([...])` parses both in one pass
 * instead, then each file is streamed to Cloudinary the same way
 * `uploadBufferToCloudinary` already does for every other master.
 */
const hallMediaUploader = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BYTES, files: 7 }, // up to 6 hallImages + 1 floorPlan
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_MIME.has(file.mimetype)) {
      return cb(new Error("Image must be a JPG, PNG or WebP file."));
    }
    return cb(null, true);
  },
});

function uploadHallMedia(req, res, next) {
  hallMediaUploader.fields([
    { name: "hallImages", maxCount: 6 },
    { name: "floorPlan", maxCount: 1 },
  ])(req, res, async (err) => {
    if (err) {
      const message = err.code === "LIMIT_FILE_SIZE" ? "Each Hall image must be 100 KB or smaller." : err.message;
      return exceptionHandler({ res, error: message, statusCode: 422 });
    }

    const files = req.files || {};
    try {
      // `existingHallImages` / `existingFloorPlan` are the edit form's own
      // fields, not part of the Hall schema — they carry the *kept* subset
      // after the person deleted zero or more already-saved images, since
      // multer's non-file text fields land in req.body right alongside the
      // files. Without this there was no way to represent "remove this one
      // saved image and keep the rest" at all: new uploads used to just
      // replace the whole gallery, and a lone `floorPlan` file field could
      // only ever add a new plan, never clear an old one. Deleted before
      // validateBody runs so neither ever reaches Joi or gets persisted as
      // if it were a real Hall field.
      let keptHallImages = [];
      if (typeof req.body.existingHallImages === "string") {
        try {
          keptHallImages = JSON.parse(req.body.existingHallImages);
        } catch {
          keptHallImages = [];
        }
      }
      const hallImagesTouched = req.body.existingHallImages !== undefined || Boolean(files.hallImages?.length);
      delete req.body.existingHallImages;

      const floorPlanTouched = req.body.existingFloorPlan !== undefined;
      const keptFloorPlan = req.body.existingFloorPlan || null;
      delete req.body.existingFloorPlan;

      if (files.hallImages?.length) {
        const uploaded = await Promise.all(
          files.hallImages.map((file) => uploadBufferToCloudinary(file.buffer, "ssd-temple/halls"))
        );
        keptHallImages = [...keptHallImages, ...uploaded.map((r) => r.secure_url)];
      }
      if (hallImagesTouched) req.body.hallImages = keptHallImages;

      if (files.floorPlan?.[0]) {
        const result = await uploadBufferToCloudinary(files.floorPlan[0].buffer, "ssd-temple/halls/floor-plans");
        req.body.floorPlan = result.secure_url;
      } else if (floorPlanTouched) {
        req.body.floorPlan = keptFloorPlan;
      }

      return next();
    } catch (error) {
      return exceptionHandler({ res, error: "Could not upload the Hall media. Please try again.", statusCode: 502 });
    }
  });
}

module.exports = {
  makeImageUpload,
  uploadAvatar,
  uploadCategoryImage,
  uploadDeityImage,
  uploadSubCategoryImage,
  uploadItemImage,
  uploadServiceImage,
  uploadEventImage,
  uploadHallPurposeImage,
  uploadHallCategoryImage,
  uploadAdditionalServiceImage,
  uploadHallPackageImage,
  uploadFoodMenuItemImage,
  uploadFoodPackageImage,
  uploadHallMedia,
  hydrateMultipartBody,
};
