const express = require("express");
const requirePermission = require("../../common/middleware/require-permission");
const validateBody = require("../../common/middleware/validate");
const escapeRegex = require("../../common/utils/escape-regex");
const { responseHandler, exceptionHandler } = require("../../utilities/handlers");

const Gst = require("../../models/gst");
const { canonicalGstType, gstTypeMatchValues, isZeroRateGstType, validateGstPercentage } = require("../../utilities/constants/gst-types");
const { createSchema, updateSchema } = require("./request-objects");

const router = express.Router();

async function list(req, res) {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(100, Number(req.query.pageSize) || 20);
    const filter = { isDeleted: false };

    if (req.query.status !== undefined && req.query.status !== "") {
      filter.status = Number(req.query.status);
    }
    if (req.query.type) filter.type = { $in: gstTypeMatchValues(String(req.query.type)) };

    if (req.query.search) {
      const regex = new RegExp(escapeRegex(req.query.search.trim()), "i");
      filter.$or = [{ type: regex }, { code: regex }];
    }

    const query = Gst.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * pageSize)
      .limit(pageSize);

    const [items, total] = await Promise.all([query.exec(), Gst.countDocuments(filter)]);
    return responseHandler({ res, response: { items, total, page, pageSize } });
  } catch (error) {
    return exceptionHandler({ res, error });
  }
}

function rangesOverlap(aStart, aEnd, bStart, bEnd) {
  const aEndT = aEnd ? new Date(aEnd).getTime() : Infinity;
  const bEndT = bEnd ? new Date(bEnd).getTime() : Infinity;
  return new Date(aStart).getTime() <= bEndT && new Date(bStart).getTime() <= aEndT;
}

/**
 * "Same GST Type date ranges should not overlap" — checked against active
 * records only. Several date-ranged records of the same type are expected
 * (rate history, a scheduled future change); calculation picks whichever
 * one's range covers the transaction's document date (see
 * common/utils/gst-rate.js), so overlap is the only thing that would make
 * that pick ambiguous.
 */
async function findOverlapping(type, startDate, endDate, excludeId) {
  const filter = { isDeleted: false, status: 1, type: { $in: gstTypeMatchValues(type) } };
  if (excludeId) filter._id = { $ne: excludeId };
  const candidates = await Gst.find(filter).select("code effectiveStartDate effectiveEndDate");
  return candidates.find((c) => rangesOverlap(startDate, endDate, c.effectiveStartDate, c.effectiveEndDate)) ?? null;
}

function overlapMessage(type, existing) {
  const range = `${new Date(existing.effectiveStartDate).toISOString().slice(0, 10)} – ${
    existing.effectiveEndDate ? new Date(existing.effectiveEndDate).toISOString().slice(0, 10) : "ongoing"
  }`;
  return `This date range overlaps an active "${type}" record (${existing.code}, ${range}). Adjust the dates so they don't overlap.`;
}

function applyGstTypeRules(body, fallbackType) {
  if (body.type) body.type = canonicalGstType(body.type);
  const type = body.type ?? fallbackType;
  if (type && isZeroRateGstType(type)) {
    if (body.percentage !== undefined || body.type) body.percentage = 0;
  }
  const percentage = body.percentage;
  if (type && percentage !== undefined) {
    return validateGstPercentage(type, percentage);
  }
  return null;
}

async function create(req, res) {
  try {
    const body = { ...req.body };
    const typeError = applyGstTypeRules(body);
    if (typeError) {
      return exceptionHandler({ res, error: typeError, statusCode: 400 });
    }

    if (Number(body.status) === 1) {
      const existing = await findOverlapping(body.type, body.effectiveStartDate, body.effectiveEndDate);
      if (existing) {
        return exceptionHandler({ res, error: overlapMessage(body.type, existing), statusCode: 409 });
      }
    }

    const doc = await Gst.create({ ...body, createdBy: req.auth?.userId || null });
    return responseHandler({ res, response: doc, successMessage: "Created successfully.", statusCode: 201 });
  } catch (error) {
    if (error?.code === 11000) {
      return exceptionHandler({ res, error: "A record with this value already exists.", statusCode: 409 });
    }
    return exceptionHandler({ res, error });
  }
}

async function update(req, res) {
  try {
    const body = { ...req.body };
    const doc = await Gst.findOne(Gst.notDeletedFilter({ _id: req.params.id }));
    if (!doc) throw "Record not found.";

    const typeError = applyGstTypeRules(body, doc.type);
    if (typeError) {
      return exceptionHandler({ res, error: typeError, statusCode: 400 });
    }

    const nextType = body.type ?? doc.type;
    const nextStart = body.effectiveStartDate ?? doc.effectiveStartDate;
    const nextEnd = body.effectiveEndDate !== undefined ? body.effectiveEndDate : doc.effectiveEndDate;
    const nextStatus = body.status !== undefined ? Number(body.status) : doc.status;

    if (nextStatus === 1) {
      const existing = await findOverlapping(nextType, nextStart, nextEnd, doc._id);
      if (existing) {
        return exceptionHandler({ res, error: overlapMessage(nextType, existing), statusCode: 409 });
      }
    }

    Object.assign(doc, body, { updatedBy: req.auth?.userId || null });
    await doc.save();
    return responseHandler({ res, response: doc, successMessage: "Updated successfully." });
  } catch (error) {
    return exceptionHandler({ res, error, statusCode: typeof error === "string" ? 404 : undefined });
  }
}

async function remove(req, res) {
  try {
    const doc = await Gst.findOne(Gst.notDeletedFilter({ _id: req.params.id }));
    if (!doc) throw "Record not found.";
    if (doc.status === 1) {
      return exceptionHandler({
        res,
        error: "An active GST record cannot be deleted. Deactivate it first.",
        statusCode: 400,
      });
    }
    // No blocking-reference check here — a General Ledger account picks a
    // GST *type*, not this specific dated record (see models/general-ledgers),
    // so deleting one date-scoped rate row never strands a GL reference.
    await doc.softDelete(req.auth?.userId);
    return responseHandler({ res, successMessage: "Deactivated successfully." });
  } catch (error) {
    return exceptionHandler({ res, error, statusCode: typeof error === "string" ? 404 : undefined });
  }
}

router.get("/gst", requirePermission("gst", "view"), list);
router.post("/gst", requirePermission("gst", "fullAccess"), validateBody(createSchema), create);
router.put("/gst/:id", requirePermission("gst", "edit"), validateBody(updateSchema), update);
router.delete("/gst/:id", requirePermission("gst", "fullAccess"), remove);

module.exports = router;
