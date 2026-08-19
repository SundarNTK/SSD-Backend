const express = require("express");
const authGuard = require("../../common/middleware/auth-guard");
const adminOnly = require("../../common/middleware/admin-only");
const requirePermission = require("../../common/middleware/require-permission");
const validateBody = require("../../common/middleware/validate");
const makeCrudController = require("../../common/factories/crud-controller");
const { responseHandler, exceptionHandler } = require("../../utilities/handlers");

const GlGroup = require("../../models/gl-groups");
const { createSchema, updateSchema } = require("./request-objects");

/**
 * `level` is required — the three tabs on GL Group Master each ask for one
 * level's rows, never a mixed list. `level1` is an *optional* extra filter,
 * used only by the cascading "Select Level 1"/"Select Level 2" dropdowns
 * inside the Add Level 2/3 modals (see components/admin/GlGroupPage.tsx and
 * GeneralLedgerPage.tsx, which reuses this same endpoint for its own
 * cascading GL Group selects) — the tab tables themselves always show every
 * row at that level, unfiltered.
 */
async function list(req, res) {
  try {
    const level = Number(req.query.level);
    if (![1, 2, 3].includes(level)) throw "A valid level (1, 2, or 3) is required.";

    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(100, Number(req.query.pageSize) || 20);
    const filter = GlGroup.notDeletedFilter({ level });

    if (req.query.level1) filter.level1 = req.query.level1;
    if (req.query.level2) filter.level2 = req.query.level2;
    if (req.query.status !== undefined) filter.status = Number(req.query.status);
    if (req.query.search) {
      filter.name = new RegExp(req.query.search.trim(), "i");
    }

    let query = GlGroup.find(filter).sort({ createdAt: -1 }).skip((page - 1) * pageSize).limit(pageSize);
    if (level >= 2) query = query.populate("level1", "name");
    if (level === 3) query = query.populate("level2", "name");

    const [items, total] = await Promise.all([query.exec(), GlGroup.countDocuments(filter)]);
    return responseHandler({ res, response: { items, total, page, pageSize } });
  } catch (error) {
    return exceptionHandler({ res, error, statusCode: typeof error === "string" ? 400 : undefined });
  }
}

/**
 * Beyond the required-field shape Joi already enforces, a Level 3 group's
 * chosen Level 2 parent has to actually belong to the chosen Level 1 parent
 * — the cascading dropdowns keep this true in the UI, but the API can't
 * assume a client honoured that.
 */
async function create(req, res) {
  try {
    const { level, level1, level2 } = req.body;

    if (level >= 2) {
      const parent1 = await GlGroup.findOne(GlGroup.notDeletedFilter({ _id: level1, level: 1 }));
      if (!parent1) throw "The selected Level 1 group doesn't exist.";
    }
    if (level === 3) {
      const parent2 = await GlGroup.findOne(GlGroup.notDeletedFilter({ _id: level2, level: 2, level1 }));
      if (!parent2) throw "The selected Level 2 group doesn't belong to the selected Level 1 group.";
    }

    const doc = await GlGroup.create({ ...req.body, createdBy: req.auth?.userId || null });
    return responseHandler({ res, response: doc, successMessage: "Created successfully.", statusCode: 201 });
  } catch (error) {
    if (error?.code === 11000) {
      return exceptionHandler({ res, error: "A group with this name already exists at this level.", statusCode: 409 });
    }
    return exceptionHandler({ res, error, statusCode: typeof error === "string" ? 400 : undefined });
  }
}

// Mounted at /masters — see routes/index.js.
const router = express.Router();
router.use(authGuard, adminOnly);

const crud = makeCrudController(GlGroup);

router.get("/gl-groups", requirePermission("gl-groups", "view"), list);
router.post("/gl-groups", requirePermission("gl-groups", "fullAccess"), validateBody(createSchema), create);
router.put("/gl-groups/:id", requirePermission("gl-groups", "edit"), validateBody(updateSchema), crud.update);
router.delete("/gl-groups/:id", requirePermission("gl-groups", "fullAccess"), crud.remove);

module.exports = router;
