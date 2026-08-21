const rateLimit = require("express-rate-limit");
const { exceptionHandler } = require("../../utilities/handlers");

/**
 * Two tiers, both keyed by IP (express-rate-limit's default — relies on
 * `app.set("trust proxy", 1)` in app.js to read the real client IP through
 * Render's single reverse-proxy hop instead of rate-limiting the proxy
 * itself as if it were one caller).
 *
 * authLimiter — the tight one. /auth/login, /auth/register,
 * /auth/forgot-password and /auth/reset-password are the only routes in
 * this service an attacker can call *without* holding a valid token at
 * all, which makes them the only routes where "guess repeatedly until it
 * works" or "spam requests at someone else's inbox" is even possible.
 * Every other route already requires a valid, live-checked session — rate
 * limiting doesn't add anything there that authGuard/adminOnly/
 * requirePermission don't already enforce per request.
 *
 * apiLimiter — a much looser net over the whole API, as a second line of
 * defense: even a genuinely authorized (or a stolen) token shouldn't be
 * able to hammer the service at unlimited speed.
 */
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) =>
    exceptionHandler({
      res,
      error: "Too many attempts. Please wait a few minutes and try again.",
      statusCode: 429,
    }),
});

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 300,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) =>
    exceptionHandler({
      res,
      error: "Too many requests. Please slow down and try again shortly.",
      statusCode: 429,
    }),
});

module.exports = { authLimiter, apiLimiter };
