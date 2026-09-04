const express = require("express");
const requirePermission = require("../../common/middleware/require-permission");
const validateBody = require("../../common/middleware/validate");
const makeCrudController = require("../../common/factories/crud-controller");
const { responseHandler, exceptionHandler } = require("../../utilities/handlers");

const GeneralLedger = require("../../models/general-ledgers");
const GlGroup = require("../../models/gl-groups");
const Item = require("../../models/items");
const Service = require("../../models/services");
const { createSchema, updateSchema } = require("./request-objects");

const POPULATE = [
  { path: "gstType", select: "type percentage code" },
  { path: "groupLevel1", select: "name" },
  { path: "groupLevel2", select: "name" },
  { path: "groupLevel3", select: "name" },
];

/**
 * Same integrity check GL Group's own create() runs on itself: a chosen
 * Level 2/3 group has to actually belong to the Level 1/2 chosen alongside
 * it, not just exist somewhere in the tree.
 */
async function assertGroupChainValid({ groupLevel1, groupLevel2, groupLevel3 }) {
  const parent1 = await GlGroup.findOne(GlGroup.notDeletedFilter({ _id: groupLevel1, level: 1 }));
  if (!parent1) throw "The selected Level 1 group doesn't exist.";

  if (groupLevel2) {
    const parent2 = await GlGroup.findOne(GlGroup.notDeletedFilter({ _id: groupLevel2, level: 2, level1: groupLevel1 }));
    if (!parent2) throw "The selected Level 2 group doesn't belong to the selected Level 1 group.";
  }
  if (groupLevel3) {
    const parent3 = await GlGroup.findOne(
      GlGroup.notDeletedFilter({ _id: groupLevel3, level: 3, level1: groupLevel1, level2: groupLevel2 })
    );
    if (!parent3) throw "The selected Level 3 group doesn't belong to the selected Level 1/2 group.";
  }
}

async function create(req, res) {
  try {
    await assertGroupChainValid(req.body);
    const doc = await GeneralLedger.create({ ...req.body, createdBy: req.auth?.userId || null });
    const populated = await doc.populate(POPULATE);
    return responseHandler({ res, response: populated, successMessage: "Created successfully.", statusCode: 201 });
  } catch (error) {
    if (error?.code === 11000) {
      return exceptionHandler({ res, error: "A GL account with this code already exists.", statusCode: 409 });
    }
    return exceptionHandler({ res, error, statusCode: typeof error === "string" ? 400 : undefined });
  }
}

async function update(req, res) {
  try {
    const existing = await GeneralLedger.findOne(GeneralLedger.notDeletedFilter({ _id: req.params.id }));
    if (!existing) throw "GL account not found.";

    const merged = {
      groupLevel1: req.body.groupLevel1 ?? existing.groupLevel1,
      groupLevel2: req.body.groupLevel2 !== undefined ? req.body.groupLevel2 : existing.groupLevel2,
      groupLevel3: req.body.groupLevel3 !== undefined ? req.body.groupLevel3 : existing.groupLevel3,
    };
    if (req.body.groupLevel1 || req.body.groupLevel2 !== undefined || req.body.groupLevel3 !== undefined) {
      await assertGroupChainValid(merged);
    }

    Object.assign(existing, req.body, { updatedBy: req.auth?.userId || null });
    await existing.save();
    const populated = await existing.populate(POPULATE);
    return responseHandler({ res, response: populated, successMessage: "Updated successfully." });
  } catch (error) {
    if (error?.code === 11000) {
      return exceptionHandler({ res, error: "A GL account with this code already exists.", statusCode: 409 });
    }
    return exceptionHandler({ res, error, statusCode: typeof error === "string" ? 404 : undefined });
  }
}

// Mounted at /masters — see routes/index.js (authGuard/adminOnly now applied
// once for the whole /masters group there, not per master).
const router = express.Router();

const crud = makeCrudController(GeneralLedger, {
  searchFields: ["name", "code"],
  populate: POPULATE,
  referencedBy: [
    { model: Item, field: "generalLedger", label: "Item" },
    { model: Service, field: "generalLedger", label: "Service" },
  ],
});

router.get("/general-ledgers", requirePermission("general-ledgers", "view"), crud.list);
router.post("/general-ledgers", requirePermission("general-ledgers", "fullAccess"), validateBody(createSchema), create);
router.put("/general-ledgers/:id", requirePermission("general-ledgers", "edit"), validateBody(updateSchema), update);
router.delete("/general-ledgers/:id", requirePermission("general-ledgers", "fullAccess"), crud.remove);

module.exports = router;
