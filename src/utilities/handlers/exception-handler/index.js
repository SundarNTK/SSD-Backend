/**
 * Field names worth naming in a duplicate-key message. Falls back to the
 * raw field name for anything not listed here — still far better than the
 * full Mongo error text, just not hand-phrased.
 */
const DUPLICATE_FIELD_LABELS = {
  email: "email",
  mobileNumber: "mobile number",
  code: "code",
  name: "name",
  uCode: "account code",
};

function describeDuplicateKeyError(error) {
  const field = Object.keys(error?.keyValue || {})[0];
  if (!field) return "This record already exists.";
  const label = DUPLICATE_FIELD_LABELS[field] || field;
  return `This ${label} is already in use.`;
}

/**
 * One shape for every error response too. Controllers `throw` a plain
 * string for expected/business errors ("Invalid credentials") — this is
 * the only place that decides the HTTP status and logs the raw error.
 *
 * A non-string error is, by that same convention, one nobody wrote a
 * user-facing message for — a driver failure, a bug, anything unexpected —
 * so its raw `.message` is never shown to the client. Left unguarded, that
 * message is frequently raw Mongo/Mongoose internals (a duplicate-key write
 * literally reads "E11000 duplicate key error collection: ssd-temple.
 * customers index: email_1 dup key: { email: \"...\" }"). Two shapes common
 * enough to deserve a real translation get one; everything else gets one
 * honest generic message, while the real error still reaches the server log.
 */
function exceptionHandler({ res, error, statusCode }) {
  if (typeof error === "string") {
    return res.status(statusCode || 400).json({ success: false, message: error });
  }

  console.error(">>> SSD-Backend error:", error);

  if (error?.code === 11000) {
    return res.status(statusCode || 409).json({ success: false, message: describeDuplicateKeyError(error) });
  }

  if (error?.name === "CastError") {
    return res.status(statusCode || 404).json({ success: false, message: "The requested record could not be found." });
  }

  return res.status(statusCode || 500).json({ success: false, message: "Something went wrong. Please try again." });
}

module.exports = exceptionHandler;
