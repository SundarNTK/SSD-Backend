const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const env = require("./config/env");
const routes = require("./routes");
const { exceptionHandler } = require("./utilities/handlers");
const { apiLimiter } = require("./common/middleware/rate-limit");

const app = express();

// One hop of trust — Render sits in front of this app as a single reverse
// proxy. Without this, every request looks like it comes from Render's
// proxy IP instead of the real client, which makes apiLimiter/authLimiter
// either share one bucket across every visitor or rate-limit nobody
// correctly, depending on how express-rate-limit falls back.
app.set("trust proxy", 1);

const allowedOrigins = env.CORS_ORIGIN.split(",").map((origin) => origin.trim());

app.use(helmet());
app.use(cors({ origin: allowedOrigins, credentials: true }));
app.use(express.json({ limit: "1mb" }));
app.use(morgan(env.NODE_ENV === "development" ? "dev" : "combined"));

// Loose, whole-API net — a second line of defense so even an authorized (or
// a stolen) token can't hammer the service at unlimited speed. The tighter
// authLimiter on top of this for /auth/* is what actually matters against
// brute-forcing a password — see common/middleware/rate-limit.js.
app.use(env.API_PREFIX, apiLimiter, routes);

// 404 — no matching route
app.use((req, res) => exceptionHandler({ res, error: `Not found: ${req.method} ${req.originalUrl}`, statusCode: 404 }));

// Final safety net — anything an individual controller didn't already catch
// still comes back in the same { success:false, message } shape.
app.use((err, req, res, _next) => exceptionHandler({ res, error: err }));

module.exports = app;