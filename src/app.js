const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const env = require("./config/env");
const routes = require("./routes");
const { exceptionHandler } = require("./utilities/handlers");

const app = express();

app.use(helmet());
app.use(cors({ origin: env.CORS_ORIGIN, credentials: true }));
app.use(express.json({ limit: "1mb" }));
app.use(morgan(env.NODE_ENV === "development" ? "dev" : "combined"));

// Uploaded avatars. `crossOriginResourcePolicy` is relaxed for this path
// only: helmet's default blocks the Admin Panel on :5001 from loading an
// image served by this origin on :5003, and the files here are non-secret
// by nature. Everything else keeps helmet's stricter default.
app.use(
  "/uploads",
  (req, res, next) => {
    res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
    next();
  },
  express.static(require("path").join(process.cwd(), "uploads"), { maxAge: "7d" })
);

app.use(env.API_PREFIX, routes);

// 404 — no matching route
app.use((req, res) => exceptionHandler({ res, error: `Not found: ${req.method} ${req.originalUrl}`, statusCode: 404 }));

// Final safety net — anything an individual controller didn't already catch
// still comes back in the same { success:false, message } shape.
app.use((err, req, res, _next) => exceptionHandler({ res, error: err }));

module.exports = app;