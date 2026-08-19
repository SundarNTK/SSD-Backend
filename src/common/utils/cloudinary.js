const { v2: cloudinary } = require("cloudinary");
const env = require("../../config/env");

/**
 * One configured client, imported wherever an upload needs to leave the
 * request/response cycle and land somewhere durable. Cloudinary rather than
 * local disk or S3 by explicit choice: this runs on Render today (ephemeral
 * filesystem — anything written to disk is gone on the next deploy) and
 * moves to AWS later, and Cloudinary is the one storage target that behaves
 * identically on both without a code change at the point of migration.
 */
cloudinary.config({
  cloud_name: env.CLOUDINARY_CLOUD_NAME,
  api_key: env.CLOUDINARY_API_KEY,
  api_secret: env.CLOUDINARY_API_SECRET,
});

module.exports = cloudinary;
