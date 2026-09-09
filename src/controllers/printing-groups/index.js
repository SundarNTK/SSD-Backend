const express = require("express");
const requirePermission = require("../../common/middleware/require-permission");
const validateBody = require("../../common/middleware/validate");
const makeCrudController = require("../../common/factories/crud-controller");
const escapeRegex = require("../../common/utils/escape-regex");
const { responseHandler, exceptionHandler } = require("../../utilities/handlers");

const PrintingGroup = require("../../models/printing-groups");
const Deity = require("../../models/deities");
const Item = require("../../models/items");
const Service = require("../../models/services");
const { createSchema, updateSchema } = require("./request-objects");

const LINKED_FIELDS = "name tamilName code status";

/**
 * One batched query per collection across every group on the current page
 * (not one query per group per collection) — the same N+1 fix already
 * applied to the POS catalogue. Returns a Map keyed by group id string,
 * each value `{ deities, items, services }`.
 */
async function loadLinkedSummaries(groupIds) {
  const [deities, items, services] = await Promise.all([
    Deity.find(Deity.notDeletedFilter({ printingGroup: { $in: groupIds } })).select(`printingGroup ${LINKED_FIELDS}`).sort({ name: 1 }),
    Item.find(Item.notDeletedFilter({ printingGroup: { $in: groupIds } })).select(`printingGroup ${LINKED_FIELDS}`).sort({ name: 1 }),
    Service.find(Service.notDeletedFilter({ printingGroup: { $in: groupIds } })).select(`printingGroup ${LINKED_FIELDS}`).sort({ name: 1 }),
  ]);

  const summaries = new Map(groupIds.map((id) => [String(id), { deities: [], items: [], services: [] }]));
  const strip = ({ printingGroup, ...rest }) => rest;
  const addTo = (bucketKey) => (doc) => summaries.get(String(doc.printingGroup))?.[bucketKey].push(strip(doc.toObject()));

  deities.forEach(addTo("deities"));
  items.forEach(addTo("items"));
  services.forEach(addTo("services"));

  return summaries;
}

/**
 * GET /printing-groups/:id/links — the Deities and Items/Services this
 * group is currently mapped to, for the "what belongs to this group"
 * read-only view in the Admin form (see PrintingGroupPage). Deity always
 * carries a printingGroup; Item/Service only carry one directly when
 * isDeityMappingRequired is false (otherwise their print group comes from
 * their mapped deity instead — see models/items, models/services — so
 * those never show up here even if the deity they're mapped to belongs to
 * this group; that's an indirect link, not this group's own mapping).
 * Includes inactive records too (status shown, not filtered) so the list
 * stays a complete picture of what's mapped, not just what's live today.
 */
async function links(req, res) {
  try {
    const group = await PrintingGroup.findOne(PrintingGroup.notDeletedFilter({ _id: req.params.id }));
    if (!group) throw "Printing group not found.";

    const summaries = await loadLinkedSummaries([group._id]);
    return responseHandler({ res, response: summaries.get(String(group._id)) });
  } catch (error) {
    return exceptionHandler({ res, error, statusCode: typeof error === "string" ? 404 : undefined });
  }
}

/**
 * GET /printing-groups — same paginated/search list every master has, plus
 * each row's linked-records summary (see loadLinkedSummaries) so the list
 * table can show "which Deities/Items belong to this group" without a
 * per-row detail fetch. Custom instead of the generic crud.list purely for
 * this extra batched step.
 */
async function list(req, res) {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(100, Number(req.query.pageSize) || 20);
    const filter = PrintingGroup.notDeletedFilter();

    if (req.query.status !== undefined) filter.status = Number(req.query.status);
    if (req.query.search) {
      const regex = new RegExp(escapeRegex(req.query.search.trim()), "i");
      filter.$or = ["code", "name", "description"].map((field) => ({ [field]: regex }));
    }

    const [groups, total] = await Promise.all([
      PrintingGroup.find(filter).sort({ createdAt: -1 }).skip((page - 1) * pageSize).limit(pageSize),
      PrintingGroup.countDocuments(filter),
    ]);

    const summaries = await loadLinkedSummaries(groups.map((g) => g._id));
    const items = groups.map((g) => ({ ...g.toObject(), ...summaries.get(String(g._id)) }));

    return responseHandler({ res, response: { items, total, page, pageSize } });
  } catch (error) {
    return exceptionHandler({ res, error });
  }
}

// Mounted at /masters alongside every other master controller — see
// routes/index.js, where authGuard/adminOnly are now applied once for the
// whole /masters group (same for controllers/email-templates under the
// shared /notifications prefix), not per master.
const router = express.Router();

const crud = makeCrudController(PrintingGroup, {
  searchFields: ["code", "name", "description"],
  referencedBy: [
    { model: Deity, field: "printingGroup", label: "Deity" },
    { model: Item, field: "printingGroup", label: "Item" },
    { model: Service, field: "printingGroup", label: "Service" },
  ],
});

router.get("/printing-groups", requirePermission("printing-groups", "view"), list);
router.get("/printing-groups/:id/links", requirePermission("printing-groups", "view"), links);
router.post(
  "/printing-groups",
  requirePermission("printing-groups", "fullAccess"),
  validateBody(createSchema),
  crud.create
);
router.put(
  "/printing-groups/:id",
  requirePermission("printing-groups", "edit"),
  validateBody(updateSchema),
  crud.update
);
router.delete("/printing-groups/:id", requirePermission("printing-groups", "fullAccess"), crud.remove);

module.exports = router;
