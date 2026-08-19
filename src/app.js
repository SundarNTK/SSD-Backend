const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const env = require("./config/env");
const routes = require("./routes");
const { exceptionHandler } = require("./utilities/handlers");

const app = express();

const allowedOrigins = env.CORS_ORIGIN.split(",").map((origin) => origin.trim());

app.use(helmet());
app.use(cors({ origin: allowedOrigins, credentials: true }));
app.use(express.json({ limit: "1mb" }));
app.use(morgan(env.NODE_ENV === "development" ? "dev" : "combined"));

app.use(env.API_PREFIX, routes);

// 404 — no matching route
app.use((req, res) => exceptionHandler({ res, error: `Not found: ${req.method} ${req.originalUrl}`, statusCode: 404 }));

// Final safety net — anything an individual controller didn't already catch
// still comes back in the same { success:false, message } shape.
app.use((err, req, res, _next) => exceptionHandler({ res, error: err }));

module.exports = app;