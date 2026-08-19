/**
 * One shape for every error response too. Controllers `throw` a plain
 * string for expected/business errors ("Invalid credentials") — this is
 * the only place that decides the HTTP status and logs the raw error.
 */
function exceptionHandler({ res, error, statusCode }) {
  const message = typeof error === "string" ? error : error?.message || "Something went wrong.";

  if (!(typeof error === "string")) {
    console.error(">>> SSD-Backend error:", error);
  }

  const resolvedStatus = statusCode || (typeof error === "string" ? 400 : 500);

  return res.status(resolvedStatus).json({
    success: false,
    message,
  });
}

module.exports = exceptionHandler;
