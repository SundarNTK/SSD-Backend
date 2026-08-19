const path = require("path");
const fs = require("fs");
const multer = require("multer");
const crypto = require("crypto");
const { exceptionHandler } = require("../../utilities/handlers");

/**
 * Profile image uploads, written to disk under `uploads/` and served
 * statically. Local disk is the right call while this runs on one box; the
 * day it runs on more than one, this is the single place that changes to an
 * S3 client, because nothing else in the app knows where the bytes live —
 * the User record stores a relative path, not a filesystem location.
 */
const UPLOAD_ROOT = path.join(process.cwd(), "uploads");
const AVATAR_DIR = path.join(UPLOAD_ROOT, "avatars");

fs.mkdirSync(AVATAR_DIR, { recursive: true });

const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_BYTES = 2 * 1024 * 1024; // 2 MB

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, AVATAR_DIR),
  filename: (req, file, cb) => {
    // Never reuse the client's filename. It is attacker-controlled, and
    // path segments in it ("../../server.js") are a directory-traversal
    // write. A random name with an extension derived from the *verified*
    // mime type removes the whole category.
    const ext = file.mimetype === "image/png" ? ".png" : file.mimetype === "image/webp" ? ".webp" : ".jpg";
    cb(null, `${crypto.randomBytes(16).toString("hex")}${ext}`);
  },
});

const uploader = multer({
  storage,
  limits: { fileSize: MAX_BYTES, files: 1 },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_MIME.has(file.mimetype)) {
      return cb(new Error("Profile image must be a JPG, PNG or WebP file."));
    }
    return cb(null, true);
  },
});

/**
 * Wraps multer so its failures come back in the app's usual
 * `{ success, message }` shape rather than multer's own error format.
 */
function uploadAvatar(req, res, next) {
  uploader.single("profileImage")(req, res, (err) => {
    if (err) {
      const message =
        err.code === "LIMIT_FILE_SIZE" ? "Profile image must be 2 MB or smaller." : err.message;
      return exceptionHandler({ res, error: message, statusCode: 422 });
    }
    if (req.file) req.body.profileImage = `/uploads/avatars/${req.file.filename}`;
    return next();
  });
}

module.exports = { uploadAvatar, UPLOAD_ROOT };
