const express = require("express");
const authGuard = require("../../common/middleware/auth-guard");
const adminOnly = require("../../common/middleware/admin-only");
const requirePermission = require("../../common/middleware/require-permission");
const validateBody = require("../../common/middleware/validate");
const { responseHandler, exceptionHandler } = require("../../utilities/handlers");
const escapeRegex = require("../../common/utils/escape-regex");

const Item = require("../../models/items");
const Service = require("../../models/services");
const InventoryAdjustment = require("../../models/inventory-adjustments");
const { createAdjustmentSchema } = require("./request-objects");

// Not nested under the /masters group router (see routes/index.js), so
// authGuard/adminOnly are applied here directly — same as roles/users.
const REF_MODELS = { Item, Service };

function searchRegex(term) {
  return new RegExp(escapeRegex(term.trim()), "i");
}

/**
 * GET /inventory/options?refType=Item|Service
 * Feeds the "Select Item"/"Select Service" dropdown in the Add Inventory
 * Adjustment modal — only inventory-applicable, active records, gated on
 * the `inventory` module alone rather than also requiring items/services
 * view access.
 */
async function options(req, res) {
  try {
    const refType = req.query.refType;
    if (!["Item", "Service"].includes(refType)) throw "A valid refType (Item or Service) is required.";

    const Model = REF_MODELS[refType];
    const applicableField = refType === "Item" ? "isInventoryApplicable" : "isInventoryRequired";
    const rows = await Model.find(Model.notDeletedFilter({ [applicableField]: true, status: 1 }))
      .select("name code currentStock")
      .sort({ name: 1 })
      .limit(200);

    return responseHandler({ res, response: { items: rows } });
  } catch (error) {
    return exceptionHandler({ res, error, statusCode: typeof error === "string" ? 400 : undefined });
  }
}

/**
 * GET /inventory/available-stock
 * Items and Services live in different collections, so this merges both
 * into one list in application code instead of trying to paginate across
 * two collections in the database — realistic for a temple's item/service
 * catalogue (tens to low hundreds of rows), not a warehouse-scale count.
 */
async function availableStock(req, res) {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(100, Number(req.query.pageSize) || 20);
    const search = req.query.search ? searchRegex(req.query.search) : null;
    const type = req.query.type; // "Item" | "Service" | undefined

    async function loadItems() {
      if (type && type !== "Item") return [];
      const filter = Item.notDeletedFilter({ isInventoryApplicable: true, status: 1 });
      if (search) filter.$or = [{ name: search }, { code: search }];
      const rows = await Item.find(filter).select("name code currentStock").sort({ name: 1 });
      return rows.map((r) => ({
        _id: r._id,
        refType: "Item",
        name: r.name,
        code: r.code,
        availableQuantity: r.currentStock,
      }));
    }

    async function loadServices() {
      if (type && type !== "Service") return [];
      const filter = Service.notDeletedFilter({ isInventoryRequired: true, status: 1 });
      if (search) filter.$or = [{ name: search }, { code: search }];
      const rows = await Service.find(filter).select("name code currentStock").sort({ name: 1 });
      return rows.map((r) => ({
        _id: r._id,
        refType: "Service",
        name: r.name,
        code: r.code,
        availableQuantity: r.currentStock,
      }));
    }

    const [items, services] = await Promise.all([loadItems(), loadServices()]);
    const merged = [...items, ...services].sort((a, b) => a.name.localeCompare(b.name));

    const total = merged.length;
    const start = (page - 1) * pageSize;
    const pageItems = merged.slice(start, start + pageSize);

    return responseHandler({ res, response: { items: pageItems, total, page, pageSize } });
  } catch (error) {
    return exceptionHandler({ res, error });
  }
}

/**
 * GET /inventory/low-stock
 * Only Item carries a unit of measure, so — matching the reference
 * report — this is Item-only; Service has no UOM to show alongside a
 * stock level.
 */
async function lowStock(req, res) {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(100, Number(req.query.pageSize) || 20);

    const filter = Item.notDeletedFilter({
      isInventoryApplicable: true,
      status: 1,
      $expr: { $lt: ["$currentStock", "$threshold"] },
    });
    if (req.query.search) {
      const regex = searchRegex(req.query.search);
      filter.$or = [{ name: regex }, { code: regex }];
    }

    const [items, total] = await Promise.all([
      Item.find(filter)
        .select("name code currentStock threshold unitOfMeasure")
        .sort({ name: 1 })
        .skip((page - 1) * pageSize)
        .limit(pageSize),
      Item.countDocuments(filter),
    ]);

    return responseHandler({ res, response: { items, total, page, pageSize } });
  } catch (error) {
    return exceptionHandler({ res, error });
  }
}

/**
 * GET /inventory/history
 * When a search term is given, resolve it against Item/Service name/code
 * first (across both collections), then filter movements by those ids —
 * correct and index-backed, versus filtering the populated result set in
 * memory.
 */
async function history(req, res) {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(100, Number(req.query.pageSize) || 20);
    const filter = {};

    const refType = req.query.refType; // "Item" | "Service" | undefined
    if (refType === "Item" || refType === "Service") filter.refType = refType;

    if (req.query.search) {
      const regex = searchRegex(req.query.search);
      const [matchingItems, matchingServices] = await Promise.all([
        refType === "Service" ? [] : Item.find({ isDeleted: false, $or: [{ name: regex }, { code: regex }] }).select("_id"),
        refType === "Item" ? [] : Service.find({ isDeleted: false, $or: [{ name: regex }, { code: regex }] }).select("_id"),
      ]);
      filter.refId = { $in: [...matchingItems, ...matchingServices].map((r) => r._id) };
    }

    const [rows, total] = await Promise.all([
      InventoryAdjustment.find(filter)
        .populate("refId", "name code")
        .populate("createdBy", "name")
        .sort({ createdAt: -1 })
        .skip((page - 1) * pageSize)
        .limit(pageSize),
      InventoryAdjustment.countDocuments(filter),
    ]);

    const items = rows.map((r) => ({
      _id: r._id,
      createdAt: r.createdAt,
      refType: r.refType,
      name: r.refId?.name ?? "—",
      code: r.refId?.code ?? "—",
      inventoryType: r.inventoryType,
      quantity: r.quantity,
      balance: r.balance,
      remarks: r.remarks,
      user: r.createdBy?.name ?? "—",
    }));

    return responseHandler({ res, response: { items, total, page, pageSize } });
  } catch (error) {
    return exceptionHandler({ res, error });
  }
}

/**
 * POST /inventory/adjustments
 * The one write in this module — refuses a Stock Out that would take the
 * ref below zero, then updates its currentStock and writes the log row in
 * the same request. Not wrapped in a Mongo transaction (no replica-set
 * requirement elsewhere in this codebase); the two writes are ordered so a
 * crash between them only ever leaves the ref's stock updated with no
 * matching log row — never a log row that doesn't match real stock.
 */
async function createAdjustment(req, res) {
  try {
    const { refType, refId, inventoryType, quantity, remarks } = req.body;
    const Model = REF_MODELS[refType];
    const applicableField = refType === "Item" ? "isInventoryApplicable" : "isInventoryRequired";

    const ref = await Model.findOne(Model.notDeletedFilter({ _id: refId, [applicableField]: true }));
    if (!ref) throw `The selected ${refType.toLowerCase()} doesn't exist or isn't inventory-applicable.`;

    const delta = inventoryType === "Stock In" ? quantity : -quantity;
    const nextBalance = (ref.currentStock || 0) + delta;
    if (nextBalance < 0) throw "Not enough stock available for this stock-out.";

    ref.currentStock = nextBalance;
    await ref.save();

    const doc = await InventoryAdjustment.create({
      refType,
      refId,
      inventoryType,
      quantity,
      balance: nextBalance,
      remarks,
      createdBy: req.auth?.userId || null,
    });

    return responseHandler({ res, response: doc, successMessage: "Inventory adjusted successfully.", statusCode: 201 });
  } catch (error) {
    return exceptionHandler({ res, error, statusCode: typeof error === "string" ? 400 : undefined });
  }
}

const router = express.Router();
router.use(authGuard, adminOnly);

router.get("/options", requirePermission("inventory", "view"), options);
router.get("/available-stock", requirePermission("inventory", "view"), availableStock);
router.get("/low-stock", requirePermission("inventory", "view"), lowStock);
router.get("/history", requirePermission("inventory", "view"), history);
router.post("/adjustments", requirePermission("inventory", "fullAccess"), validateBody(createAdjustmentSchema), createAdjustment);

module.exports = router;
