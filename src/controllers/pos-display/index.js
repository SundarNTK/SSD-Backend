/**
 * Customer-facing POS display channel.
 *
 * Mixed auth on purpose (same pattern as controllers/payments):
 *   POST /session          — cashier, creates/reuses a 6-character pairing code
 *   PUT  /session/:code    — cashier, publishes cart / QR / totals
 *   GET  /session/:code    — public, tablet polls this with no login
 *
 * The tablet never creates orders or QR codes; it only renders what the
 * signed-in counter last published.
 */

const express = require("express");
const crypto = require("crypto");
const authGuard = require("../../common/middleware/auth-guard");
const adminOnly = require("../../common/middleware/admin-only");
const requirePermission = require("../../common/middleware/require-permission");
const validateBody = require("../../common/middleware/validate");
const { displayPollLimiter } = require("../../common/middleware/rate-limit");
const { responseHandler, exceptionHandler } = require("../../utilities/handlers");
const PosDisplaySession = require("../../models/pos-display-sessions");
const { CODE_PATTERN, createSessionSchema, putPayloadSchema } = require("./request-objects");

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function randomCode() {
  const bytes = crypto.randomBytes(6);
  let out = "";
  for (let i = 0; i < 6; i += 1) out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return out;
}

async function uniqueCode() {
  for (let i = 0; i < 12; i += 1) {
    const code = randomCode();
    const clash = await PosDisplaySession.exists({ code });
    if (!clash) return code;
  }
  throw "Could not allocate a display pairing code. Please try again.";
}

async function createOrReuseSession(req, res) {
  try {
    const ownerUserId = req.auth.userId;
    const existing = await PosDisplaySession.findOne({ ownerUserId });
    if (existing) {
      return responseHandler({
        res,
        response: { code: existing.code },
        successMessage: "Customer display session ready.",
      });
    }

    const requested = req.body?.code;
    const code =
      requested && CODE_PATTERN.test(requested) && !(await PosDisplaySession.exists({ code: requested }))
        ? requested
        : await uniqueCode();

    const created = await PosDisplaySession.create({
      code,
      ownerUserId,
      entityId: req.auth.entityId ?? null,
      payload: { phase: "idle", lines: [], grandTotal: 0, payingNow: 0, balanceDue: 0 },
    });

    return responseHandler({
      res,
      response: { code: created.code },
      successMessage: "Customer display session created.",
      statusCode: 201,
    });
  } catch (error) {
    return exceptionHandler({ res, error });
  }
}

async function putSessionPayload(req, res) {
  try {
    const code = String(req.params.code || "").trim().toUpperCase();
    if (!CODE_PATTERN.test(code)) {
      return exceptionHandler({ res, error: "Invalid display code.", statusCode: 400 });
    }

    const session = await PosDisplaySession.findOne({ code, ownerUserId: req.auth.userId });
    if (!session) {
      return exceptionHandler({
        res,
        error: "No customer display session for this code. Open Customer Display on the POS again.",
        statusCode: 404,
      });
    }

    session.payload = req.body.payload;
    await session.save();

    return responseHandler({
      res,
      response: { code: session.code, updatedAt: session.updatedAt },
      successMessage: "Customer display updated.",
    });
  } catch (error) {
    return exceptionHandler({ res, error });
  }
}

async function getSessionPayload(req, res) {
  try {
    const code = String(req.params.code || "").trim().toUpperCase();
    if (!CODE_PATTERN.test(code)) {
      return exceptionHandler({ res, error: "Invalid display code.", statusCode: 400 });
    }

    const session = await PosDisplaySession.findOne({ code }).lean();
    if (!session) {
      return exceptionHandler({
        res,
        error: "This display code is not active. Ask the cashier to open Customer Display.",
        statusCode: 404,
      });
    }

    return responseHandler({
      res,
      response: {
        code: session.code,
        payload: session.payload,
        updatedAt: session.updatedAt,
      },
    });
  } catch (error) {
    return exceptionHandler({ res, error });
  }
}

const router = express.Router();

router.get("/health", (_req, res) =>
  res.json({ ok: true, service: "SSD-Backend", module: "pos-display" }),
);

router.get("/session/:code", displayPollLimiter, getSessionPayload);

router.post(
  "/session",
  authGuard,
  adminOnly,
  requirePermission("admin-booking", "view"),
  validateBody(createSessionSchema),
  createOrReuseSession,
);

router.put(
  "/session/:code",
  authGuard,
  adminOnly,
  requirePermission("admin-booking", "view"),
  validateBody(putPayloadSchema),
  putSessionPayload,
);

module.exports = router;
