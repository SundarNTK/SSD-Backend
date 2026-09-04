const express = require("express");
const requirePermission = require("../../common/middleware/require-permission");
const validateBody = require("../../common/middleware/validate");
const escapeRegex = require("../../common/utils/escape-regex");
const { responseHandler, exceptionHandler } = require("../../utilities/handlers");

const Gst = require("../../models/gst");
const GeneralLedger = require("../../models/general-ledgers");
const { canonicalGstType, gstTypeMatchValues, isOfficialType, isZeroRateGstType, validateGstPercentage } = require("../../utilities/constants/gst-types");
const { findBlockingReference } = require("../../common/utils/reference-guard");
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

async function findOtherActive(type, excludeId) {
  const filter = {
    isDeleted: false,
    status: 1,
    type: { $in: gstTypeMatchValues(type) },
  };
  if (excludeId) filter._id = { $ne: excludeId };
  return Gst.findOne(filter);
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

async function lastActiveMessage(type, excludeId) {
  if (!isOfficialType(type)) return null;
  const other = await findOtherActive(type, excludeId);
  if (other) return null;
  return `Can't inactivate this GST. At least one "${canonicalGstType(type)}" record must stay active.`;
}

async function deactivateGst(doc, userId) {
  doc.status = 0;
  doc.updatedBy = userId || null;
  await doc.save();
}

async function retargetLedgers(fromGstId, toGstId, userId) {
  if (!fromGstId || !toGstId || String(fromGstId) === String(toGstId)) return;
  await GeneralLedger.updateMany(GeneralLedger.notDeletedFilter({ gstType: fromGstId }), {
    $set: { gstType: toGstId, updatedBy: userId || null },
  });
}

async function create(req, res) {
  try {
    const { replaceActive, ...body } = req.body;
    const typeError = applyGstTypeRules(body);
    if (typeError) {
      return exceptionHandler({ res, error: typeError, statusCode: 400 });
    }
    const wantsActive = Number(body.status) === 1;
    let replaced = null;
    if (!wantsActive) {
      const existing = await findOtherActive(body.type);
      if (!existing) {
        return exceptionHandler({
          res,
          error: `Can't create this GST as inactive. At least one "${body.type}" record must be active.`,
          statusCode: 400,
        });
      }
    }
    if (wantsActive) {
      const existing = await findOtherActive(body.type);
      if (existing) {
        if (!replaceActive) {
          return exceptionHandler({
            res,
            error: `An active "${body.type}" GST record already exists (${existing.code}). Deactivate it first, or create this record as inactive.`,
            statusCode: 409,
          });
        }
        await deactivateGst(existing, req.auth?.userId);
        replaced = existing;
      }
    }
    const doc = await Gst.create({ ...body, createdBy: req.auth?.userId || null });
    if (replaced) {
      await retargetLedgers(replaced._id, doc._id, req.auth?.userId);
    }
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
    const { replaceActive, ...body } = req.body;
    const doc = await Gst.findOne(Gst.notDeletedFilter({ _id: req.params.id }));
    if (!doc) throw "Record not found.";

    const typeError = applyGstTypeRules(body, doc.type);
    if (typeError) {
      return exceptionHandler({ res, error: typeError, statusCode: 400 });
    }

    const nextType = body.type ?? doc.type;
    const nextStatus = body.status !== undefined ? Number(body.status) : doc.status;
    let replaced = null;

    if (doc.status === 1 && nextStatus === 0 && nextType === doc.type) {
      const message = await lastActiveMessage(doc.type, doc._id);
      if (message) {
        return exceptionHandler({ res, error: message, statusCode: 400 });
      }
    }

    if (nextStatus === 1) {
      const existing = await findOtherActive(nextType, doc._id);
      if (existing) {
        if (!replaceActive) {
          return exceptionHandler({
            res,
            error: `An active "${nextType}" GST record already exists (${existing.code}). Deactivate that record first, then activate this one.`,
            statusCode: 409,
          });
        }
        await deactivateGst(existing, req.auth?.userId);
        replaced = existing;
      }
    }

    Object.assign(doc, body, { updatedBy: req.auth?.userId || null });
    await doc.save();
    if (replaced) {
      await retargetLedgers(replaced._id, doc._id, req.auth?.userId);
    }
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
    const blockingMessage = await findBlockingReference(
      [{ model: GeneralLedger, field: "gstType", label: "General Ledger" }],
      doc._id
    );
    if (blockingMessage) {
      return exceptionHandler({ res, error: blockingMessage, statusCode: 409 });
    }
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
