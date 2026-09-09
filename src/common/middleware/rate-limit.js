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

// The customer-display tablet (PosCustomerDisplayPage) polls this one route
// every 700ms for as long as a counter is open — that's ~1,280 requests in
// 15 minutes from a single IP, well past apiLimiter's general 300 budget by
// design. Without this exemption every display would 429 itself out after
// under 4 minutes of normal use. Matched on the path Express hands this
// middleware — already stripped of the API_PREFIX mount — not the full URL.
const DISPLAY_POLL_PATTERN = /^\/pos-display\/session\/[^/]+$/;
function isDisplayPoll(req) {
  return req.method === "GET" && DISPLAY_POLL_PATTERN.test(req.path);
}

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 300,
  standardHeaders: true,
  legacyHeaders: false,
  skip: isDisplayPoll,
  handler: (req, res) =>
    exceptionHandler({
      res,
      error: "Too many requests. Please slow down and try again shortly.",
      statusCode: 429,
    }),
});

// Sized for sustained 700ms polling (see isDisplayPoll above) with real
// headroom, not left unlimited — a genuinely runaway client still gets
// capped, just at a ceiling normal use never approaches.
const displayPollLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 3000,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) =>
    exceptionHandler({
      res,
      error: "Too many requests. Please slow down and try again shortly.",
      statusCode: 429,
    }),
});

module.exports = { authLimiter, apiLimiter, displayPollLimiter };
