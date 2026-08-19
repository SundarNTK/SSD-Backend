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
const MAX_BYTES = 2 * 1024 * 1024; // 2 MB

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
 */
function makeImageUpload({ formField, targetField = formField, folder, label = "Image" }) {
  return function uploadImage(req, res, next) {
    uploader.single(formField)(req, res, async (err) => {
      if (err) {
        const message = err.code === "LIMIT_FILE_SIZE" ? `${label} must be 2 MB or smaller.` : err.message;
        return exceptionHandler({ res, error: message, statusCode: 422 });
      }
      if (!req.file) return next();

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

module.exports = { makeImageUpload, uploadAvatar, uploadCategoryImage };
