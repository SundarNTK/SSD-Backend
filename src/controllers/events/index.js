const express = require("express");
const authGuard = require("../../common/middleware/auth-guard");
const adminOnly = require("../../common/middleware/admin-only");
const requirePermission = require("../../common/middleware/require-permission");
const validateBody = require("../../common/middleware/validate");
const makeCrudController = require("../../common/factories/crud-controller");
const { responseHandler, exceptionHandler } = require("../../utilities/handlers");

const Event = require("../../models/events");
const { createSchema, updateSchema } = require("./request-objects");

const POPULATE = [
  { path: "category", select: "name color" },
  { path: "subCategory", select: "name color" },
  { path: "deityMapping", select: "name" },
];

/**
 * Business rules Joi can't express on its own: the date range has to make
 * sense, and — matching the reference screenshot's own hint text — every
 * slot's date has to fall inside that range once slots are required at all.
 */
function assertDatesValid({ startDate, endDate, isSlotRequired, slotDetails }) {
  const start = new Date(startDate);
  const end = new Date(endDate);
  if (end < start) throw "End date cannot be before the start date.";

  if (isSlotRequired) {
    if (!slotDetails || slotDetails.length === 0) {
      throw "At least one slot is required when Slot Required is set to Yes.";
    }
    for (const slot of slotDetails) {
      const slotDate = new Date(slot.date);
      if (slotDate < start || slotDate > end) {
        throw `Slot "${slot.slotName}" date must be between the event's start and end date.`;
      }
    }
  }
}

async function create(req, res) {
  try {
    assertDatesValid(req.body);
    const doc = await Event.create({ ...req.body, createdBy: req.auth?.userId || null });
    const populated = await doc.populate(POPULATE);
    return responseHandler({ res, response: populated, successMessage: "Created successfully.", statusCode: 201 });
  } catch (error) {
    if (error?.code === 11000) {
      return exceptionHandler({ res, error: "An event with this code already exists.", statusCode: 409 });
    }
    return exceptionHandler({ res, error, statusCode: typeof error === "string" ? 400 : undefined });
  }
}

async function update(req, res) {
  try {
    const existing = await Event.findOne(Event.notDeletedFilter({ _id: req.params.id }));
    if (!existing) throw "Event not found.";

    assertDatesValid({
      startDate: req.body.startDate ?? existing.startDate,
      endDate: req.body.endDate ?? existing.endDate,
      isSlotRequired: req.body.isSlotRequired ?? existing.isSlotRequired,
      slotDetails: req.body.slotDetails ?? existing.slotDetails,
    });

    Object.assign(existing, req.body, { updatedBy: req.auth?.userId || null });
    await existing.save();
    const populated = await existing.populate(POPULATE);
    return responseHandler({ res, response: populated, successMessage: "Updated successfully." });
  } catch (error) {
    if (error?.code === 11000) {
      return exceptionHandler({ res, error: "An event with this code already exists.", statusCode: 409 });
    }
    return exceptionHandler({ res, error, statusCode: typeof error === "string" ? 404 : undefined });
  }
}

// Mounted at /masters — see routes/index.js.
const router = express.Router();
router.use(authGuard, adminOnly);

const crud = makeCrudController(Event, { searchFields: ["name", "code", "tamilName"], populate: POPULATE });

router.get("/events", requirePermission("events", "view"), crud.list);
router.post("/events", requirePermission("events", "fullAccess"), validateBody(createSchema), create);
router.put("/events/:id", requirePermission("events", "edit"), validateBody(updateSchema), update);
router.delete("/events/:id", requirePermission("events", "fullAccess"), crud.remove);

module.exports = router;
