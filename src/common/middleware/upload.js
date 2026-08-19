const multer = require("multer");
const cloudinary = require("../utils/cloudinary");
const { exceptionHandler } = require("../../utilities/handlers");

/**
 * Profile image uploads, streamed straight to Cloudinary — never touch
 * local disk. Render's filesystem is ephemeral (anything written to disk
 * is gone on the next deploy/restart), and this same code runs unchanged
 * once the app moves to AWS, so local disk was never a real option here.
 */
const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_BYTES = 2 * 1024 * 1024; // 2 MB

const uploader = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BYTES, files: 1 },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_MIME.has(file.mimetype)) {
      return cb(new Error("Profile image must be a JPG, PNG or WebP file."));
    }
    return cb(null, true);
  },
});

/**
 * Uploads a buffer to Cloudinary via its streaming API — multer already has
 * the whole file in memory (2 MB cap above), so there's no benefit to
 * writing it to a temp file first just to re-read it.
 */
function uploadBufferToCloudinary(buffer) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder: "ssd-temple/avatars", resource_type: "image" },
      (error, result) => (error ? reject(error) : resolve(result))
    );
    stream.end(buffer);
  });
}

/**
 * Wraps multer + the Cloudinary round-trip so failures come back in the
 * app's usual `{ success, message }` shape instead of multer's own error
 * format or a raw Cloudinary error.
 */
function uploadAvatar(req, res, next) {
  uploader.single("profileImage")(req, res, async (err) => {
    if (err) {
      const message =
        err.code === "LIMIT_FILE_SIZE" ? "Profile image must be 2 MB or smaller." : err.message;
      return exceptionHandler({ res, error: message, statusCode: 422 });
    }
    if (!req.file) return next();

    try {
      const result = await uploadBufferToCloudinary(req.file.buffer);
      // The full secure_url is stored as-is — resolveImageUrl() on the
      // frontend already passes absolute https:// URLs through unchanged.
      req.body.profileImage = result.secure_url;
      return next();
    } catch (error) {
      return exceptionHandler({ res, error: "Could not upload the profile image. Please try again.", statusCode: 502 });
    }
  });
}

module.exports = { uploadAvatar };
