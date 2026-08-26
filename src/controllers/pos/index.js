/**
 * POS / Admin Booking controller
 * Mounted at /pos — see routes/index.js.
 *
 * The same handler set is registered on two route trees, one per calling
 * surface, so the portal stamp on every Order/Booking/Transaction can be
 * derived server-side from the route rather than trusted from the client
 * body (see setPortal()/registerBookingRoutes() near the bottom):
 *
 *   /pos/booking/*        — POS Portal counter terminal → portal: "pos"
 *   /pos/admin/booking/*  — Admin Panel booking screen  → portal: "admin"
 *
 * Endpoints (identical shape under either prefix above):
 *
 *   GET  /customers/search?query=          — quick customer lookup
 *   GET  /customers/lookup?mobileNumber=   — exact match on an unregistered walk-in, for Create Customer auto-fill
 *   POST /customers                        — create a walk-in devotee profile (isRegistered: false)
 *   GET  /customers/:id/recent-bookings    — last N confirmed bookings, for "repeat a past booking"
 *   GET  /items?search=&category=&subCategory=    — POS item picker
 *   GET  /services?search=&category=&subCategory= — POS service picker
 *   GET  /catalogue                        — category tabs + sub-category folders
 *   GET  /deities                          — active deity roster
 *   GET  /nakshathirams                    — active nakshathiram roster
 *   GET  /payment-modes                    — active payment modes
 *   POST /summary                          — price + availability calc (no writes)
 *   POST /recheck-lines                    — re-validate past lines against the live catalogue
 *   POST /orders                           — create order + reserve inventory
 *   POST /orders/:id/confirm               — confirm order → Booking + Transaction + stock-out
 *   GET  /bookings?search=&status=&portal= — POS Transactions ledger
 *   GET  /bookings/:id                     — full booking + transaction detail
 *
 * Inventory reservation lifecycle: see inventory-reservation.js.
 */

const express = require("express");
const authGuard = require("../../common/middleware/auth-guard");
const adminOnly = require("../../common/middleware/admin-only");
const requirePermission = require("../../common/middleware/require-permission");
const validateBody = require("../../common/middleware/validate");
const { responseHandler, exceptionHandler } = require("../../utilities/handlers");
const { nextSequence } = require("../../common/utils/sequence");
const escapeRegex = require("../../common/utils/escape-regex");
const env = require("../../config/env");
const createCustomerProfile = require("../../utilities/helpers/create-customer-profile");

const Item = require("../../models/items");
const Service = require("../../models/services");
const Category = require("../../models/categories");
const SubCategory = require("../../models/sub-categories");
const Deity = require("../../models/deities");
const Nakshathiram = require("../../models/nakshathirams");
const Entity = require("../../models/entities");
const { Customer } = require("../../models/customers");
const PaymentMode = require("../../models/payment-modes");
const { Order } = require("../../models/orders");
const { Booking, BOOKING_STATUSES } = require("../../models/bookings");
const { Transaction } = require("../../models/transactions");

const {
  placeReservationsForOrder,
  consumeReservations,
  cancelReservations,
  getAvailability,
} = require("./inventory-reservation");

const {
  summarySchema,
  createOrderSchema,
  confirmOrderSchema,
  customerSearchSchema,
  createCustomerSchema,
  recheckLinesSchema,
} = require("./request-objects");

const mongoose = require("mongoose");

// ─── helpers ──────────────────────────────────────────────────────────────────

function searchRegex(term) {
  return new RegExp(escapeRegex(term.trim()), "i");
}

/**
 * Deity-mapped offerings (Coconut Archanai, Navagraha Archanai, ...) are
 * priced and stocked per deity, not per an independently-typed quantity —
 * picking 3 deities at $5 each is a $15 line, and reserves/consumes 3 units
 * of inventory, the same as if "3" had been typed into a quantity box. A
 * line with no deities selected falls back to its own `quantity` as before
 * (a plain item like Ghee Lamp has no deity concept at all).
 */
function effectiveQuantity(line) {
  return line.deities && line.deities.length > 0 ? line.deities.length : line.quantity;
}

/**
 * Generate the next sequential order number: POS-YYYYMMDD-NNNN
 * Uses the shared atomic sequence counter.
 */
async function generateOrderNumber() {
  const n = await nextSequence("pos_order");
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  return `POS${today}${String(n).padStart(4, "0")}`;
}

/**
 * Generate the next booking number: BKG-YYYYMMDD-NNNN
 */
async function generateBookingNumber() {
  const n = await nextSequence("booking");
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  return `BKG${today}${String(n).padStart(4, "0")}`;
}

/**
 * Generate the next receipt number: RCP-YYYYMMDD-NNNN
 * Uses its own sequence counter, distinct from the booking number's — a
 * receipt is the Transaction's identity, not the Booking's.
 */
async function generateReceiptNumber() {
  const n = await nextSequence("receipt");
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  return `RCP-${today}-${String(n).padStart(4, "0")}`;
}

/**
 * Fetch the GST percentage for a General Ledger (populated on Item/Service).
 * Returns 0 if the GL has no GST — the GST master's own `percentage` field
 * is the single source of truth for the rate (0 for "Exempted"/"Zero-rated"
 * rows), so there's no separate `type` string to special-case here.
 */
async function resolveGstRate(generalLedgerId) {
  if (!generalLedgerId) return 0;
  try {
    const GeneralLedger = mongoose.model("GeneralLedger");
    const gl = await GeneralLedger.findById(generalLedgerId).populate("gstType");
    return gl?.gstType?.percentage ?? 0;
  } catch {
    return 0;
  }
}

// ─── customer lookup ──────────────────────────────────────────────────────────

/**
 * GET /pos/booking/customers/search?query=
 * Search customers by mobile, email, or name for the Personal Details step.
 * Returns up to 10 matches.
 */
async function searchCustomers(req, res) {
  try {
    const { error, value } = customerSearchSchema.validate(req.query);
    if (error) throw error.details[0].message;

    const { query } = value;
    const regex = searchRegex(query);

    const customers = await Customer.find(
      Customer.notDeletedFilter({
        status: 1,
        $or: [{ name: regex }, { email: regex }, { mobileNumber: regex }],
      })
    )
      .select("customerCode name email mobileNumber familyMembers")
      .sort({ name: 1 })
      .limit(10);

    return responseHandler({ res, response: { items: customers } });
  } catch (error) {
    return exceptionHandler({ res, error, statusCode: typeof error === "string" ? 400 : undefined });
  }
}

/**
 * POST /pos/booking/customers
 * Creates a walk-in devotee profile at the counter — no login attached.
 * The admin-side Customer master deliberately has no create endpoint (see
 * controllers/customers's own comment): every other path into the Customer
 * collection carries context this doesn't need. A POS walk-in is exactly
 * the case that comment named as the reason this would eventually exist.
 */
async function createWalkInCustomer(req, res) {
  try {
    const { error, value } = createCustomerSchema.validate(req.body);
    if (error) throw error.details[0].message;

    const { name, email, mobileNumber, dateOfBirth, gender } = value;

    const emailTaken = await Customer.exists(Customer.notDeletedFilter({ email }));
    if (emailTaken) throw "A devotee profile already uses this email.";
    if (mobileNumber) {
      const mobileTaken = await Customer.exists(Customer.notDeletedFilter({ mobileNumber }));
      if (mobileTaken) throw "A devotee profile already uses this mobile number.";
    }

    const entityId = req.auth?.entityId || (await Entity.findOne({ code: env.DEFAULT_ENTITY_CODE }))?._id;
    if (!entityId) throw "No temple entity is configured.";

    const customer = await createCustomerProfile({
      entityId,
      name,
      email,
      mobileNumber: mobileNumber || null,
      dateOfBirth: dateOfBirth || null,
      gender: gender || null,
      // A walk-in starts unregistered — see models/customers' own comment.
      // A repeat visit on the same mobile is matched and reused (GET
      // .../customers/lookup) rather than hitting the mobile-uniqueness
      // error below a second time.
      isRegistered: false,
    });
    customer.createdBy = req.auth?.userId || null;
    await customer.save();

    return responseHandler({ res, response: customer, successMessage: "Devotee profile created.", statusCode: 201 });
  } catch (error) {
    if (error?.code === 11000) {
      return exceptionHandler({ res, error: "Those details are already used by another profile.", statusCode: 409 });
    }
    return exceptionHandler({ res, error, statusCode: typeof error === "string" ? 400 : undefined });
  }
}

/**
 * GET /pos/booking/customers/lookup?mobileNumber=
 * Exact-match lookup for the Create Customer form's auto-fill — as the
 * counter types a mobile number, this finds a matching *unregistered*
 * walk-in profile so a repeat visit reuses it instead of hitting the
 * mobile-uniqueness error on a second POST. Scoped to isRegistered: false
 * on purpose: a real registration is never silently pulled into the walk-in
 * create form this way — reusing one of those goes through customer search.
 */
async function lookupCustomerByMobile(req, res) {
  try {
    const mobileNumber = (req.query.mobileNumber || "").trim();
    if (!mobileNumber) return responseHandler({ res, response: null });

    const customer = await Customer.findOne(
      Customer.notDeletedFilter({ mobileNumber, status: 1, isRegistered: false })
    ).select("customerCode name email mobileNumber dateOfBirth gender");

    return responseHandler({ res, response: customer });
  } catch (error) {
    return exceptionHandler({ res, error });
  }
}

/**
 * GET /pos/booking/customers/:id/recent-bookings?limit=3
 * The counter's "repeat a past booking" feature — last N confirmed
 * bookings for a customer, with full line detail so the frontend can offer
 * to re-add them to the cart (after re-checking live availability via
 * recheckLines(), since the catalogue may have moved on since then).
 */
async function getRecentBookings(req, res) {
  try {
    const customerId = req.params.id;
    if (!mongoose.isValidObjectId(customerId)) throw "Invalid customer ID.";
    const limit = Math.min(10, Math.max(1, Number(req.query.limit) || 3));

    const bookings = await Booking.find({ customer: customerId, bookingStatus: "confirmed" })
      .select("bookingNumber orderId lines grandTotal bookedAt")
      .populate("orderId", "orderNumber")
      .populate("lines.deities", "name")
      .sort({ bookedAt: -1 })
      .limit(limit);

    const items = bookings.map((b) => ({
      _id: b._id,
      bookingNumber: b.bookingNumber,
      orderNumber: b.orderId?.orderNumber ?? null,
      lines: b.lines,
      grandTotal: b.grandTotal,
      bookedAt: b.bookedAt,
    }));

    return responseHandler({ res, response: { items } });
  } catch (error) {
    return exceptionHandler({ res, error, statusCode: typeof error === "string" ? 400 : undefined });
  }
}

// ─── item / service catalogue for POS picker ─────────────────────────────────

/**
 * GET /pos/booking/items?search=&category=&page=&pageSize=
 * Returns active items with posAvailability = true.
 */
async function listPosItems(req, res) {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(100, Number(req.query.pageSize) || 50);

    const filter = Item.notDeletedFilter({ status: 1, posAvailability: true });
    if (req.query.search) {
      const regex = searchRegex(req.query.search);
      filter.$or = [{ name: regex }, { code: regex }];
    }
    if (req.query.category) {
      filter["categoryDetails.category"] = req.query.category;
    }
    if (req.query.subCategory) {
      filter["categoryDetails.subCategory"] = req.query.subCategory;
    }

    const [items, total] = await Promise.all([
      Item.find(filter)
        .populate("categoryDetails.category", "name color")
        .populate("categoryDetails.subCategory", "name")
        .populate("generalLedger", "gstType")
        .populate("deityMapping", "name")
        .select("name tamilName code salePrice isInventoryApplicable currentStock threshold isDeityMappingRequired deityMapping isFamilyMembersRequired maxFamilyMembers minQuantity maxQuantity categoryDetails")
        .sort({ name: 1 })
        .skip((page - 1) * pageSize)
        .limit(pageSize),
      Item.countDocuments(filter),
    ]);

    const itemsWithAvailability = await decorateItems(items);

    return responseHandler({ res, response: { items: itemsWithAvailability, total, page, pageSize } });
  } catch (error) {
    return exceptionHandler({ res, error });
  }
}

/**
 * GET /pos/booking/services?search=&category=&page=&pageSize=
 * Returns active services with isPosAvailable = true.
 */
async function listPosServices(req, res) {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(100, Number(req.query.pageSize) || 50);

    const filter = Service.notDeletedFilter({ status: 1, isPosAvailable: true });
    if (req.query.search) {
      const regex = searchRegex(req.query.search);
      filter.$or = [{ name: regex }, { code: regex }];
    }
    if (req.query.category) {
      filter["categoryDetails.category"] = req.query.category;
    }
    if (req.query.subCategory) {
      filter["categoryDetails.subCategory"] = req.query.subCategory;
    }

    const [services, total] = await Promise.all([
      Service.find(filter)
        .populate("categoryDetails.category", "name color")
        .populate("categoryDetails.subCategory", "name")
        .populate("deityMapping", "name")
        .select("name tamilName code categoryDetails isInventoryRequired currentStock thresholdCount isDeityMappingRequired deityMapping isFamilyMembersRequired maxFamilyMembers sessionRequired")
        .sort({ name: 1 })
        .skip((page - 1) * pageSize)
        .limit(pageSize),
      Service.countDocuments(filter),
    ]);

    const servicesWithAvailability = await decorateServices(services);

    return responseHandler({ res, response: { items: servicesWithAvailability, total, page, pageSize } });
  } catch (error) {
    return exceptionHandler({ res, error });
  }
}

/**
 * Shared shaping for the two catalogue endpoints above and for the
 * "uncategorized" bucket in getCatalogue() below — one definition of what a
 * POS-facing item/service payload looks like, instead of copies that drift.
 */
async function decorateItems(items) {
  return Promise.all(
    items.map(async (item) => {
      const avail = await getAvailability("Item", item._id);
      return {
        _id: item._id,
        code: item.code,
        name: item.name,
        tamilName: item.tamilName,
        salePrice: item.salePrice,
        isDeityMappingRequired: item.isDeityMappingRequired,
        deityMapping: item.deityMapping,
        isFamilyMembersRequired: item.isFamilyMembersRequired,
        maxFamilyMembers: item.maxFamilyMembers,
        minQuantity: item.minQuantity,
        maxQuantity: item.maxQuantity,
        categoryDetails: item.categoryDetails,
        inventory: avail,
      };
    })
  );
}

async function decorateServices(services) {
  return Promise.all(
    services.map(async (svc) => {
      const avail = await getAvailability("Service", svc._id);
      // salePrice lives in categoryDetails — expose the first one as a
      // default (admin can override per-line pricing in a future pass).
      const firstCatPrice = svc.categoryDetails[0]?.salePrice ?? 0;
      return {
        _id: svc._id,
        code: svc.code,
        name: svc.name,
        tamilName: svc.tamilName,
        defaultSalePrice: firstCatPrice,
        categoryDetails: svc.categoryDetails,
        isDeityMappingRequired: svc.isDeityMappingRequired,
        deityMapping: svc.deityMapping,
        isFamilyMembersRequired: svc.isFamilyMembersRequired,
        maxFamilyMembers: svc.maxFamilyMembers,
        sessionRequired: svc.sessionRequired,
        inventory: avail,
      };
    })
  );
}

/**
 * GET /pos/booking/payment-modes
 * Returns all active payment modes. The frontend shows only Cash for now
 * but this endpoint returns all so the screen can expand later.
 */
async function listPaymentModes(req, res) {
  try {
    const modes = await PaymentMode.find(
      PaymentMode.notDeletedFilter({ status: 1 })
    )
      .select("name description")
      .sort({ name: 1 });

    return responseHandler({ res, response: { items: modes } });
  } catch (error) {
    return exceptionHandler({ res, error });
  }
}

// ─── catalogue browsing (categories → sub-category folders) ─────────────────

/**
 * GET /pos/booking/catalogue
 *
 * Powers the POS Portal's folder browser. SubCategory carries no parent
 * Category reference at the master level (see models/sub-categories) — the
 * only place a (category, subCategory) pairing actually exists is on each
 * Item/Service's own `categoryDetails` rows. So "folders" here are derived
 * by scanning the live catalogue rather than read off a fixed hierarchy:
 * every distinct (category, subCategory) pair present in an active,
 * POS-available Item or Service becomes one folder card, with its own
 * item/service counts. Anything with no categoryDetails at all (legal —
 * the field isn't required) has nowhere to file into, so it's returned
 * separately as "uncategorized" for the screen to show alongside the folders.
 */
async function getCatalogue(req, res) {
  try {
    const [items, services, categories] = await Promise.all([
      Item.find(Item.notDeletedFilter({ status: 1, posAvailability: true })).select("categoryDetails"),
      Service.find(Service.notDeletedFilter({ status: 1, isPosAvailable: true })).select("categoryDetails"),
      Category.find(Category.notDeletedFilter({ status: 1 })).select("name color").sort({ displayOrder: 1, name: 1 }),
    ]);

    const subCategoryIds = new Set();
    for (const doc of [...items, ...services]) {
      for (const cd of doc.categoryDetails || []) subCategoryIds.add(String(cd.subCategory));
    }
    const subCategories = await SubCategory.find({ _id: { $in: [...subCategoryIds] } }).select("name color");
    const subCategoryById = new Map(subCategories.map((s) => [String(s._id), s]));
    const categoryById = new Map(categories.map((c) => [String(c._id), c]));

    const folderMap = new Map(); // "categoryId::subCategoryId" -> folder accumulator
    const categoryItemIds = new Map(); // categoryId -> Set(itemId)
    const categoryServiceIds = new Map(); // categoryId -> Set(serviceId)

    function addToFolder(cd, kind, docId) {
      const catId = String(cd.category);
      const subId = String(cd.subCategory);
      const key = `${catId}::${subId}`;
      if (!folderMap.has(key)) {
        folderMap.set(key, {
          categoryId: catId,
          categoryName: categoryById.get(catId)?.name ?? "—",
          subCategoryId: subId,
          subCategoryName: subCategoryById.get(subId)?.name ?? "—",
          color: subCategoryById.get(subId)?.color ?? categoryById.get(catId)?.color ?? null,
          itemIds: new Set(),
          serviceIds: new Set(),
        });
      }
      const folder = folderMap.get(key);
      const bucket = kind === "Item" ? folder.itemIds : folder.serviceIds;
      bucket.add(String(docId));

      const perCategory = kind === "Item" ? categoryItemIds : categoryServiceIds;
      if (!perCategory.has(catId)) perCategory.set(catId, new Set());
      perCategory.get(catId).add(String(docId));
    }

    const uncategorizedItemIds = [];
    for (const item of items) {
      if (!item.categoryDetails || item.categoryDetails.length === 0) {
        uncategorizedItemIds.push(item._id);
        continue;
      }
      for (const cd of item.categoryDetails) addToFolder(cd, "Item", item._id);
    }

    const uncategorizedServiceIds = [];
    for (const svc of services) {
      if (!svc.categoryDetails || svc.categoryDetails.length === 0) {
        uncategorizedServiceIds.push(svc._id);
        continue;
      }
      for (const cd of svc.categoryDetails) addToFolder(cd, "Service", svc._id);
    }

    const folders = [...folderMap.values()]
      .map((f) => ({
        categoryId: f.categoryId,
        categoryName: f.categoryName,
        subCategoryId: f.subCategoryId,
        subCategoryName: f.subCategoryName,
        color: f.color,
        itemCount: f.itemIds.size,
        serviceCount: f.serviceIds.size,
        total: f.itemIds.size + f.serviceIds.size,
      }))
      .sort((a, b) => a.subCategoryName.localeCompare(b.subCategoryName));

    const categoriesOut = categories
      .map((c) => {
        const catId = String(c._id);
        const itemCount = categoryItemIds.get(catId)?.size ?? 0;
        const serviceCount = categoryServiceIds.get(catId)?.size ?? 0;
        return { _id: c._id, name: c.name, color: c.color, count: itemCount + serviceCount };
      })
      .filter((c) => c.count > 0);

    const [uncategorizedItems, uncategorizedServices] = await Promise.all([
      uncategorizedItemIds.length
        ? decorateItems(
            await Item.find({ _id: { $in: uncategorizedItemIds } })
              .populate("deityMapping", "name")
              .select(
                "name tamilName code salePrice isInventoryApplicable currentStock threshold isDeityMappingRequired deityMapping isFamilyMembersRequired maxFamilyMembers minQuantity maxQuantity categoryDetails"
              )
          )
        : [],
      uncategorizedServiceIds.length
        ? decorateServices(
            await Service.find({ _id: { $in: uncategorizedServiceIds } })
              .populate("deityMapping", "name")
              .select(
                "name tamilName code categoryDetails isInventoryRequired currentStock thresholdCount isDeityMappingRequired deityMapping isFamilyMembersRequired maxFamilyMembers sessionRequired"
              )
          )
        : [],
    ]);

    return responseHandler({
      res,
      response: {
        categories: categoriesOut,
        totalCount: items.length + services.length,
        folders,
        uncategorizedItems,
        uncategorizedServices,
      },
    });
  } catch (error) {
    return exceptionHandler({ res, error });
  }
}

/**
 * GET /pos/booking/deities
 * Full active Deity roster for the "which deity is this offering for" picker.
 * Both Item and Service now carry their own curated `deityMapping` (returned
 * inline on each offering by decorateItems/decorateServices) — the frontend
 * prefers that curated list and falls back to this full roster only when an
 * offering's own mapping is empty.
 */
async function listDeities(req, res) {
  try {
    const deities = await Deity.find(Deity.notDeletedFilter({ status: 1 }))
      .select("name tamilName")
      .sort({ name: 1 });
    return responseHandler({ res, response: { items: deities } });
  } catch (error) {
    return exceptionHandler({ res, error });
  }
}

/**
 * GET /pos/booking/nakshathirams
 * Active Nakshathiram master, for the devotee-details Nakshatra dropdown —
 * sourced from the real master (Nakshathiram Master) rather than a
 * hardcoded list, and exposed under /pos so POS counter staff don't also
 * need the Nakshathiram master's own view permission.
 */
async function listNakshathirams(req, res) {
  try {
    const rows = await Nakshathiram.find(Nakshathiram.notDeletedFilter({ status: 1 }))
      .select("name tamilName rasi")
      .sort({ displayOrder: 1, name: 1 });
    return responseHandler({ res, response: { items: rows } });
  } catch (error) {
    return exceptionHandler({ res, error });
  }
}

// ─── booking summary (no writes) ─────────────────────────────────────────────

/**
 * POST /pos/booking/summary
 *
 * Accepts the cart lines, validates them, resolves current prices and
 * availability, and returns a full cost breakdown. Does NOT write anything
 * to the database.
 *
 * Used by the frontend "Cart Summary" panel in real time as items are added.
 */
async function bookingSummary(req, res) {
  try {
    const { error, value } = summarySchema.validate(req.body);
    if (error) throw error.details[0].message;

    const { customerId, lines } = value;

    // Validate customer exists
    const customer = await Customer.findOne(
      Customer.notDeletedFilter({ _id: customerId, status: 1 })
    ).select("customerCode name email mobileNumber");
    if (!customer) throw "Customer not found or inactive.";

    const resolvedLines = [];
    let subtotal = 0;
    let totalGst = 0;

    for (const line of lines) {
      const { refType, refId, quantity, deities, devotees } = line;

      let name, code, unitPrice, gstRate;

      if (refType === "Item") {
        const item = await Item.findOne(
          Item.notDeletedFilter({ _id: refId, status: 1, posAvailability: true })
        ).populate("generalLedger", "gstType");
        if (!item) throw `Item not found or not available at POS.`;

        name = item.name;
        code = item.code;
        unitPrice = item.salePrice;
        gstRate = await resolveGstRate(item.generalLedger?._id);
      } else {
        // Service — price from categoryDetails
        const svc = await Service.findOne(
          Service.notDeletedFilter({ _id: refId, status: 1, isPosAvailable: true })
        ).populate("categoryDetails.category");
        if (!svc) throw `Service not found or not available at POS.`;

        name = svc.name;
        code = svc.code;
        // Use the first category price as default (admin can override in future)
        unitPrice = svc.categoryDetails[0]?.salePrice ?? 0;
        gstRate = 0; // Services typically exempt; can extend later
      }

      // Check availability (read-only — no reservation written here)
      const avail = await getAvailability(refType, refId);
      const available = avail.isInventoryApplicable ? avail.availableQty : Infinity;

      // Deity-mapped lines price (and reserve) per selected deity, not per
      // the raw `quantity` the client sent — see effectiveQuantity().
      const qty = effectiveQuantity(line);
      const lineTotal = unitPrice * qty;
      const lineGst = +(lineTotal * (gstRate / 100)).toFixed(2);

      subtotal += lineTotal;
      totalGst += lineGst;

      resolvedLines.push({
        refType,
        refId,
        name,
        code,
        quantity: qty,
        unitPrice,
        gstRate,
        lineGst,
        lineTotal,
        deities,
        devotees,
        inventory: avail.isInventoryApplicable
          ? {
              isApplicable: true,
              currentStock: avail.currentStock,
              reservedQty: avail.reservedQty,
              availableQty: avail.availableQty,
              threshold: avail.threshold,
            }
          : { isApplicable: false },
        availableForBooking: available,
        quantityExceedsStock: avail.isInventoryApplicable && qty > avail.availableQty,
      });
    }

    const grandTotal = +(subtotal + totalGst).toFixed(2);

    return responseHandler({
      res,
      response: {
        customer: {
          _id: customer._id,
          customerCode: customer.customerCode,
          name: customer.name,
          email: customer.email,
          mobileNumber: customer.mobileNumber,
        },
        lines: resolvedLines,
        subtotal: +subtotal.toFixed(2),
        gstAmount: +totalGst.toFixed(2),
        grandTotal,
        hasStockIssues: resolvedLines.some((l) => l.quantityExceedsStock),
      },
    });
  } catch (error) {
    return exceptionHandler({ res, error, statusCode: typeof error === "string" ? 400 : undefined });
  }
}

/**
 * POST /pos/booking/recheck-lines
 *
 * Same per-line lookups as bookingSummary(), but tolerant — used by the
 * "repeat a past booking" flow, where some lines from an old order may no
 * longer be valid (deactivated, no longer POS-available, or genuinely out
 * of stock) while others still are. Unlike bookingSummary(), a bad line
 * never throws; it comes back with `available: false` and a reason so the
 * caller can offer "add just the available ones" instead of an all-or-
 * nothing failure.
 */
async function recheckLines(req, res) {
  try {
    const { error, value } = recheckLinesSchema.validate(req.body);
    if (error) throw error.details[0].message;

    const results = await Promise.all(
      value.lines.map(async (line) => {
        const { refType, refId, quantity, deities, devotees } = line;
        const base = { refType, refId, quantity, deities, devotees };

        let name, code, unitPrice;
        if (refType === "Item") {
          const item = await Item.findOne(Item.notDeletedFilter({ _id: refId, status: 1, posAvailability: true }));
          if (!item) return { ...base, available: false, reason: "No longer available for sale." };
          name = item.name;
          code = item.code;
          unitPrice = item.salePrice;
        } else {
          const svc = await Service.findOne(Service.notDeletedFilter({ _id: refId, status: 1, isPosAvailable: true }));
          if (!svc) return { ...base, available: false, reason: "No longer available for sale." };
          name = svc.name;
          code = svc.code;
          unitPrice = svc.categoryDetails[0]?.salePrice ?? 0;
        }

        const qty = effectiveQuantity(line);
        const avail = await getAvailability(refType, refId);
        if (avail.isInventoryApplicable && qty > avail.availableQty) {
          return {
            ...base,
            available: false,
            name,
            code,
            reason:
              avail.availableQty > 0
                ? `Only ${avail.availableQty} available (need ${qty}).`
                : "Out of stock.",
          };
        }

        return { ...base, available: true, name, code, unitPrice, lineTotal: +(unitPrice * qty).toFixed(2), quantity: qty };
      })
    );

    return responseHandler({ res, response: { lines: results } });
  } catch (error) {
    return exceptionHandler({ res, error, statusCode: typeof error === "string" ? 400 : undefined });
  }
}

// ─── create order ─────────────────────────────────────────────────────────────

/**
 * POST /pos/booking/orders
 *
 * 1. Validate all lines (price, availability).
 * 2. Atomically place inventory reservations for inventory-applicable lines.
 *    If ANY line fails the availability check, ALL previously-placed
 *    reservations for this order are immediately rolled back.
 * 3. Write the Order document (status: "pending").
 * 4. Return the order with a 30-minute hold expiry timestamp.
 *
 * For Cash payment the frontend immediately calls /confirm after receiving
 * the order — the 30-minute window is never visible to the user in that
 * case, but the hold still exists for consistency.
 */
async function createOrder(req, res) {
  try {
    const { error, value } = createOrderSchema.validate(req.body);
    if (error) throw error.details[0].message;

    const { customerId, lines, paymentModeId } = value;

    const customer = await Customer.findOne(
      Customer.notDeletedFilter({ _id: customerId, status: 1 })
    ).select("customerCode name email mobileNumber");
    if (!customer) throw "Customer not found or inactive.";

    const paymentMode = await PaymentMode.findOne(
      PaymentMode.notDeletedFilter({ _id: paymentModeId, status: 1 })
    ).select("name");
    if (!paymentMode) throw "Payment mode not found or inactive.";

    // ── 1. Resolve all line details (prices, names, codes) ──────────────────
    const resolvedLines = [];
    let subtotal = 0;
    let totalGst = 0;

    for (const line of lines) {
      const { refType, refId, quantity, deities, devotees } = line;
      let name, code, unitPrice;

      if (refType === "Item") {
        const item = await Item.findOne(
          Item.notDeletedFilter({ _id: refId, status: 1, posAvailability: true })
        );
        if (!item) throw `An item in the cart is no longer available.`;
        name = item.name;
        code = item.code;
        unitPrice = item.salePrice;
      } else {
        const svc = await Service.findOne(
          Service.notDeletedFilter({ _id: refId, status: 1, isPosAvailable: true })
        );
        if (!svc) throw `A service in the cart is no longer available.`;
        name = svc.name;
        code = svc.code;
        unitPrice = svc.categoryDetails[0]?.salePrice ?? 0;
      }

      // Deity-mapped lines price (and later reserve/consume stock) per
      // selected deity — see effectiveQuantity(). This value becomes the
      // Order's stored line quantity, so the fix here also covers the
      // reservation and stock-out steps below without touching them.
      const qty = effectiveQuantity(line);
      const lineTotal = unitPrice * qty;
      subtotal += lineTotal;

      resolvedLines.push({ refType, refId, quantity: qty, name, code, unitPrice, lineTotal, deities, devotees });
    }

    const grandTotal = +(subtotal + totalGst).toFixed(2);
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000);
    const orderNumber = await generateOrderNumber();

    // ── 2. Write the Order first (gives us an _id for reservations) ─────────
    const order = await Order.create({
      orderNumber,
      customer: customerId,
      lines: resolvedLines.map((l) => ({
        refType: l.refType,
        refId: l.refId,
        name: l.name,
        code: l.code,
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        lineTotal: l.lineTotal,
        deities: l.deities,
        devotees: l.devotees,
      })),
      subtotal: +subtotal.toFixed(2),
      gstAmount: +totalGst.toFixed(2),
      grandTotal,
      paymentMode: paymentModeId,
      paymentModeName: paymentMode.name,
      orderStatus: "pending",
      // Stamped from req.posPortal, which is set by the setPortal()
      // middleware on whichever route tree received this request — never
      // from the client body, so a POS terminal cannot forge "admin".
      portal: req.posPortal ?? "admin",
      expiresAt,
      bookedBy: req.auth?.userId ?? null,
      entity: req.auth?.entityId ?? null,
      createdBy: req.auth?.userId ?? null,
    });

    // ── 3. Place inventory reservations ─────────────────────────────────────
    // If this throws, we cancel the order too and re-throw to the client.
    try {
      await placeReservationsForOrder(resolvedLines, order._id);
    } catch (reservationError) {
      // Roll back the order so the order number isn't a ghost
      await Order.findByIdAndUpdate(order._id, { orderStatus: "cancelled" });
      throw reservationError;
    }

    return responseHandler({
      res,
      response: {
        _id: order._id,
        orderNumber: order.orderNumber,
        customer: {
          _id: customer._id,
          customerCode: customer.customerCode,
          name: customer.name,
          email: customer.email,
          mobileNumber: customer.mobileNumber,
        },
        lines: order.lines,
        subtotal: order.subtotal,
        gstAmount: order.gstAmount,
        grandTotal: order.grandTotal,
        paymentModeName: order.paymentModeName,
        orderStatus: order.orderStatus,
        expiresAt: order.expiresAt,
      },
      successMessage: "Order created. Inventory held for 30 minutes.",
      statusCode: 201,
    });
  } catch (error) {
    return exceptionHandler({ res, error, statusCode: typeof error === "string" ? 400 : undefined });
  }
}

// ─── confirm order → booking ──────────────────────────────────────────────────

/**
 * POST /pos/booking/orders/:id/confirm
 *
 * 1. Verify the order is still pending and not expired.
 * 2. Write the Booking (permanent confirmed record), then the Transaction
 *    (payment/receipt record), then mark the Order confirmed — plain
 *    sequential writes, not a MongoDB multi-document transaction. A
 *    transaction was tried here first for atomicity, but it measurably
 *    added latency (its own start/commit round trips on top of an already
 *    slow shared Atlas cluster — this was the actual cause of "Confirm
 *    Booking" stalling in the browser). For this system's scale, a crash
 *    landing exactly between these three writes is rare enough that a
 *    best-effort cleanup (delete whatever landed, then re-throw so the
 *    order stays retryable) is the better trade than paying transaction
 *    overhead on every single booking.
 * 3. consumeReservations() — permanently decrement currentStock on each
 *    inventory-applicable ref and write InventoryAdjustment "Stock Out" rows.
 *
 * For Cash, the frontend calls this immediately after createOrder succeeds.
 * For other payment modes (future), the payment gateway callback calls it.
 */
async function confirmOrder(req, res) {
  try {
    const orderId = req.params.id;
    if (!mongoose.isValidObjectId(orderId)) throw "Invalid order ID.";

    // No required body for cash — just validate whatever comes
    const { error } = confirmOrderSchema.validate(req.body ?? {});
    if (error) throw error.details[0].message;

    const order = await Order.findOne(
      Order.notDeletedFilter({ _id: orderId })
    ).populate("customer", "customerCode name email mobileNumber");

    if (!order) throw "Order not found.";
    if (order.orderStatus === "confirmed") {
      // Idempotent — return the existing booking + its transaction.
      // Guard against the edge case where the booking doc was force-deleted
      // after the order was already confirmed (should never happen in normal
      // operation, but failing with a clear message is better than a crash).
      const [existing, existingTxn] = await Promise.all([
        Booking.findById(order.bookingId)
          .populate("customer", "customerCode name email mobileNumber")
          .populate("lines.deities", "name")
          .populate("bookedBy", "name email"),
        Transaction.findOne({ orderId: order._id }),
      ]);
      if (!existing) throw "Booking record not found for this confirmed order.";
      return responseHandler({
        res,
        response: {
          ...existing.toObject(),
          receiptNo: existingTxn?.receiptNo ?? null,
          orderNumber: order.orderNumber,
        },
        successMessage: "Booking already confirmed.",
      });
    }
    if (order.orderStatus === "cancelled") throw "This order has been cancelled and cannot be confirmed.";

    // Check the 30-minute hold hasn't expired
    if (new Date() > order.expiresAt) {
      await cancelReservations(order._id);
      await Order.findByIdAndUpdate(order._id, { orderStatus: "cancelled" });
      throw "Order expired — the 30-minute hold has lapsed. Please create a new order.";
    }

    const [bookingNumber, receiptNo] = await Promise.all([generateBookingNumber(), generateReceiptNumber()]);
    const now = new Date();
    const customerId = order.customer._id ?? order.customer;

    let booking;
    let transaction;
    try {
      // ── 1. Write Booking (permanent record) ──────────────────────────────
      booking = await Booking.create({
        bookingNumber,
        orderId: order._id,
        customer: customerId,
        lines: order.lines,
        subtotal: order.subtotal,
        gstAmount: order.gstAmount,
        grandTotal: order.grandTotal,
        paymentMode: order.paymentMode,
        paymentModeName: order.paymentModeName,
        paymentStatus: "paid",
        bookingStatus: "confirmed",
        portal: order.portal,
        bookedBy: order.bookedBy,
        entity: order.entity,
        bookedAt: now,
        createdBy: order.bookedBy ?? null,
      });

      // ── 2. Write Transaction (payment/receipt record) ─────────────────────
      transaction = await Transaction.create({
        receiptNo,
        bookingId: booking._id,
        orderId: order._id,
        customer: customerId,
        paymentMode: order.paymentMode,
        paymentModeName: order.paymentModeName,
        amount: order.grandTotal,
        paymentStatus: "paid",
        portal: order.portal,
        transactionDate: now,
        processedBy: order.bookedBy,
        createdBy: order.bookedBy ?? null,
      });

      // ── 3. Update Order ─────────────────────────────────────────────────
      await Order.findByIdAndUpdate(order._id, { orderStatus: "confirmed", bookingId: booking._id });
    } catch (writeError) {
      // Best-effort cleanup so a retry doesn't leave orphaned rows or try to
      // confirm again against a half-written state — order stays "pending"
      // (never touched above), so the client can safely retry the same order.
      if (transaction) await Transaction.deleteOne({ _id: transaction._id }).catch(() => {});
      if (booking) await Booking.deleteOne({ _id: booking._id }).catch(() => {});
      throw writeError;
    }

    // ── 4. Permanently decrement stock + consume reservations ────────────────
    await consumeReservations(
      order._id,
      order.lines,
      order.bookedBy,
      bookingNumber
    );

    const customerSnap = order.customer?.customerCode
      ? order.customer
      : await Customer.findById(order.customer).select("customerCode name email mobileNumber");

    return responseHandler({
      res,
      response: {
        _id: booking._id,
        bookingNumber: booking.bookingNumber,
        orderNumber: order.orderNumber,
        receiptNo: transaction.receiptNo,
        customer: {
          _id: customerSnap._id,
          customerCode: customerSnap.customerCode,
          name: customerSnap.name,
          email: customerSnap.email,
          mobileNumber: customerSnap.mobileNumber,
        },
        lines: booking.lines,
        subtotal: booking.subtotal,
        gstAmount: booking.gstAmount,
        grandTotal: booking.grandTotal,
        paymentModeName: booking.paymentModeName,
        paymentStatus: booking.paymentStatus,
        bookingStatus: booking.bookingStatus,
        bookedAt: booking.bookedAt,
      },
      successMessage: "Booking confirmed successfully.",
      statusCode: 201,
    });
  } catch (error) {
    return exceptionHandler({ res, error, statusCode: typeof error === "string" ? 400 : undefined });
  }
}

// ─── POS Transactions (read-only ledger) ──────────────────────────────────────

function deriveLineType(lines) {
  const types = new Set((lines || []).map((l) => l.refType));
  if (types.size === 0) return "—";
  if (types.size === 1) return [...types][0];
  return "Mixed";
}

/**
 * GET /pos/booking/bookings?search=&status=&portal=&page=&pageSize=
 *
 * Read-only ledger backing the "POS Transactions" admin screen. Lists
 * confirmed/cancelled Bookings — pending Orders that never got confirmed are
 * abandoned holds, not transactions, so they don't appear here.
 *
 * `portal` filters by the surface that created the booking:
 *   "admin"    → Admin Booking screen (Admin Panel)
 *   "pos"      → POS Portal counter terminal
 *   "customer" → Customer Portal self-service (future)
 * Omit to see all portals together (default for the transactions screen).
 */
async function listBookings(req, res) {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(100, Number(req.query.pageSize) || 20);

    const filter = {};
    if (req.query.status && BOOKING_STATUSES.includes(req.query.status)) {
      filter.bookingStatus = req.query.status;
    }
    if (req.query.portal && ["admin", "pos", "customer"].includes(req.query.portal)) {
      filter.portal = req.query.portal;
    }
    if (req.query.search) {
      const regex = searchRegex(req.query.search);
      const [matchingCustomers, matchingTransactions] = await Promise.all([
        Customer.find({ name: regex }).select("_id"),
        Transaction.find({ receiptNo: regex }).select("bookingId"),
      ]);
      filter.$or = [
        { bookingNumber: regex },
        { customer: { $in: matchingCustomers.map((c) => c._id) } },
        { _id: { $in: matchingTransactions.map((t) => t.bookingId) } },
      ];
    }

    const [bookings, total] = await Promise.all([
      Booking.find(filter)
        .populate("customer", "customerCode name email mobileNumber")
        .populate("orderId", "orderNumber")
        .select("bookingNumber orderId customer lines subtotal gstAmount grandTotal paymentModeName bookingStatus portal bookedAt")
        .sort({ bookedAt: -1 })
        .skip((page - 1) * pageSize)
        .limit(pageSize),
      Booking.countDocuments(filter),
    ]);

    // Receipt numbers live on Transaction, not Booking (see models/transactions'
    // own comment on why) — one batched lookup instead of populate, since
    // Booking↔Transaction isn't a declared ref in either direction.
    const bookingIds = bookings.map((b) => b._id);
    const transactions = await Transaction.find({ bookingId: { $in: bookingIds } }).select("bookingId receiptNo");
    const receiptByBooking = new Map(transactions.map((t) => [String(t.bookingId), t.receiptNo]));

    const items = bookings.map((b) => ({
      _id: b._id,
      bookingNumber: b.bookingNumber,
      receiptNo: receiptByBooking.get(String(b._id)) ?? null,
      orderNumber: b.orderId?.orderNumber ?? null,
      customer: b.customer
        ? { _id: b.customer._id, customerCode: b.customer.customerCode, name: b.customer.name }
        : null,
      lineType: deriveLineType(b.lines),
      paymentModeName: b.paymentModeName,
      subtotal: b.subtotal,
      gstAmount: b.gstAmount,
      grandTotal: b.grandTotal,
      bookingStatus: b.bookingStatus,
      portal: b.portal,
      bookedAt: b.bookedAt,
    }));

    return responseHandler({ res, response: { items, total, page, pageSize } });
  } catch (error) {
    return exceptionHandler({ res, error });
  }
}

/**
 * GET /pos/booking/bookings/:id
 *
 * Full detail for one booking — every line (with deity/devotee breakdown),
 * customer profile, order reference, payment info, and the Transaction
 * record (receipt number, amount, transaction date).
 */
async function getBookingDetail(req, res) {
  try {
    const id = req.params.id;
    if (!mongoose.isValidObjectId(id)) throw "Invalid booking ID.";

    const [booking, transaction] = await Promise.all([
      Booking.findOne({ _id: id })
        .populate("customer", "customerCode name email mobileNumber")
        .populate("orderId", "orderNumber orderStatus")
        .populate("paymentMode", "name")
        .populate("lines.deities", "name")
        .populate("bookedBy", "name email"),
      Transaction.findOne({ bookingId: id }).select(
        "receiptNo amount paymentStatus paymentModeName transactionDate processedBy"
      ),
    ]);

    if (!booking) throw "Booking not found.";

    return responseHandler({
      res,
      response: {
        ...booking.toObject(),
        // Attach the transaction snapshot — the receipt number lives here,
        // not on the Booking itself, by design (1:many for future partial
        // payments / refunds). For the current cash-only flow it's always
        // exactly one row.
        transaction: transaction ?? null,
      },
    });
  } catch (error) {
    return exceptionHandler({ res, error, statusCode: typeof error === "string" ? 404 : undefined });
  }
}

// ─── router assembly ──────────────────────────────────────────────────────────

/**
 * Portal middleware factory — stamps req.posPortal with the correct value
 * derived from which route tree received the request, so handler functions
 * never trust anything from the client body to decide what portal stamped a
 * booking. This mirrors how HEB's OBS controller derives the booking
 * platform from the URL segment rather than a client-supplied field.
 *
 * Route layout:
 *   /pos/booking/*        → portal: "pos"   (POS Portal counter terminal)
 *   /pos/admin/booking/*  → portal: "admin" (Admin Panel booking screen)
 *   (future) /pos/customer/booking/* → portal: "customer"
 */
function setPortal(portalValue) {
  return function stampPortal(req, _res, next) {
    req.posPortal = portalValue;
    next();
  };
}

/**
 * Register the shared booking route handlers onto a given Express Router.
 * Called twice: once for the POS sub-router ("pos") and once for the Admin
 * sub-router ("admin"). Handler functions themselves just read req.posPortal
 * — the portal value is never passed as an argument, so there is one code
 * path for all surfaces and no risk of the two trees drifting.
 */
function registerBookingRoutes(r) {
  // ── Lookup / catalogue (read) ──────────────────────────────────────────
  r.get("/customers/search",    requirePermission("admin-booking", "view"),       searchCustomers);
  r.get("/customers/lookup",    requirePermission("admin-booking", "view"),       lookupCustomerByMobile);
  r.post("/customers",          requirePermission("admin-booking", "fullAccess"), validateBody(createCustomerSchema), createWalkInCustomer);
  r.get("/customers/:id/recent-bookings", requirePermission("admin-booking", "view"), getRecentBookings);
  r.get("/items",               requirePermission("admin-booking", "view"),       listPosItems);
  r.get("/services",            requirePermission("admin-booking", "view"),       listPosServices);
  r.get("/payment-modes",       requirePermission("admin-booking", "view"),       listPaymentModes);
  r.get("/catalogue",           requirePermission("admin-booking", "view"),       getCatalogue);
  r.get("/deities",             requirePermission("admin-booking", "view"),       listDeities);
  r.get("/nakshathirams",       requirePermission("admin-booking", "view"),       listNakshathirams);

  // ── Booking flow (write) ───────────────────────────────────────────────
  r.post("/summary",            requirePermission("admin-booking", "view"),       validateBody(summarySchema),      bookingSummary);
  r.post("/recheck-lines",      requirePermission("admin-booking", "view"),       validateBody(recheckLinesSchema), recheckLines);
  r.post("/orders",             requirePermission("admin-booking", "fullAccess"), validateBody(createOrderSchema),  createOrder);
  r.post("/orders/:id/confirm", requirePermission("admin-booking", "fullAccess"),                                   confirmOrder);

  // ── Transaction ledger (read) ──────────────────────────────────────────
  r.get("/bookings",            requirePermission("pos-transactions", "view"),    listBookings);
  r.get("/bookings/:id",        requirePermission("pos-transactions", "view"),    getBookingDetail);
}

const router = express.Router();

// All POS routes require an authenticated admin
router.use(authGuard, adminOnly);

router.get("/health", (_req, res) =>
  res.json({ ok: true, service: "SSD-Backend", module: "pos" })
);

// ── POS Portal: /pos/booking/* → portal = "pos" ───────────────────────────
const posBookingRouter = express.Router();
registerBookingRoutes(posBookingRouter);
router.use("/booking", setPortal("pos"), posBookingRouter);

// ── Admin Panel: /pos/admin/booking/* → portal = "admin" ─────────────────
const adminBookingRouter = express.Router();
registerBookingRoutes(adminBookingRouter);
router.use("/admin/booking", setPortal("admin"), adminBookingRouter);

module.exports = router;
// Exposed for unit testing (src/controllers/pos/__tests__) — the router
// object is a function, so these are just extra properties on it and don't
// change how routes/index.js consumes the default export.
module.exports.createOrder = createOrder;
module.exports.confirmOrder = confirmOrder;
module.exports.effectiveQuantity = effectiveQuantity;
