const { HallBooking } = require("../../models/hall-bookings");
const { HallBookingPayment } = require("../../models/hall-booking-payments");
const { Customer } = require("../../models/customers");
const { Booking } = require("../../models/bookings");
// Transaction, PosBooking and PosTransaction are unioned by their raw
// collection name ("transactions", "pos_bookings", "pos_transactions") in
// the pipelines below, not through their Mongoose models — $unionWith/
// $lookup talk to MongoDB directly by collection name, so no import of
// those model files is needed here at all.

/**
 * The Report Builder's data catalog — one entry per selectable "report
 * type" (Salesforce calls this a report's Object; here it's `sourceKey`),
 * each declaring every field a user may pick and how to produce it.
 *
 * Why this shape, and why it's fast even at 10k+ documents:
 *
 * 1. Every source's "obvious" fields (booking number, customer name, hall
 *    name, payment mode name, amount, status, dates) are already
 *    DENORMALIZED onto the document at write time — every booking/
 *    transaction model in this system snapshots `customerInfo`,
 *    `hallName`, `paymentModeName`, etc. right when it's created (see each
 *    model's own comments), specifically so downstream reads never need a
 *    join for them. A report built from nothing but those fields is a
 *    plain `$match` + `$project` + `$sort` — genuinely millisecond-fast at
 *    10k+ rows with the indexes each model already carries.
 *
 * 2. The handful of fields that DO need a join (Item Sales' Category,
 *    Customer Report's rollup totals) declare their own `extraStages()` —
 *    a function returning the aggregation stages that compute them. The
 *    report runner (./report-runner.js) includes a field's stages ONLY
 *    when that field is actually selected, deduplicated by `stageKey` when
 *    two fields would need the same join. Deselect Category from an Item
 *    Sales report and its three extra $lookup stages never run at all —
 *    "select fewer fields" literally means "less work per row", not just
 *    a narrower response.
 *
 * 3. Every join that IS used is an indexed equality lookup — by `_id`
 *    (Category lookup) or by `customer` (Customer Report's rollup, using
 *    the exact `{ customer: 1, createdAt: -1 }` index each booking model
 *    already has) — never a full collection scan.
 *
 * Field descriptor shape:
 *   { key, label, type: "string"|"number"|"date"|"boolean",
 *     path,            // dot-path on the working aggregation document
 *     options?,         // fixed value list — marks this a dropdown/enum
 *                        // field for the filter builder's "equals/in" set
 *                        // instead of the free-text operator set
 *     extraStages?,     // () => stage[] — extra pipeline stages this field needs
 *     stageKey?,        // dedupe key when several fields share one join (defaults to `key`)
 *   }
 *
 * Source shape:
 *   { key, label, description, model, basePipeline, fields,
 *     defaultSort: { field, dir } }
 *
 * Filtering, sorting and grouping are all generic now (see
 * ./report-filters.js and ./report-runner.js) — every field is filterable
 * by the operators its own `type` (and `options`, if set) allow, every
 * field is a legal sort key, and any field can be a Group By key with
 * SUM/COUNT/AVG/MIN/MAX available on the numeric ones.
 */

/** Resolves BOTH Category and Sub Category off the item/service's first categoryDetails pairing in one pass — selecting either field triggers this same lookup group once (shared `stageKey: "categoryLookup"`). */
function categoryLookupStages() {
  return [
    {
      $lookup: {
        from: "items",
        let: { rid: "$_refId", rtype: "$_refType" },
        pipeline: [
          { $match: { $expr: { $and: [{ $eq: ["$_id", "$$rid"] }, { $eq: ["$$rtype", "Item"] }] } } },
          { $project: { categoryId: { $arrayElemAt: ["$categoryDetails.category", 0] }, subCategoryId: { $arrayElemAt: ["$categoryDetails.subCategory", 0] } } },
        ],
        as: "__itemCat",
      },
    },
    {
      $lookup: {
        from: "services",
        let: { rid: "$_refId", rtype: "$_refType" },
        pipeline: [
          { $match: { $expr: { $and: [{ $eq: ["$_id", "$$rid"] }, { $eq: ["$$rtype", "Service"] }] } } },
          { $project: { categoryId: { $arrayElemAt: ["$categoryDetails.category", 0] }, subCategoryId: { $arrayElemAt: ["$categoryDetails.subCategory", 0] } } },
        ],
        as: "__serviceCat",
      },
    },
    {
      $addFields: {
        __categoryId: {
          $ifNull: [{ $arrayElemAt: ["$__itemCat.categoryId", 0] }, { $arrayElemAt: ["$__serviceCat.categoryId", 0] }],
        },
        __subCategoryId: {
          $ifNull: [{ $arrayElemAt: ["$__itemCat.subCategoryId", 0] }, { $arrayElemAt: ["$__serviceCat.subCategoryId", 0] }],
        },
      },
    },
    { $lookup: { from: "categories", localField: "__categoryId", foreignField: "_id", as: "__categoryDoc" } },
    { $lookup: { from: "subcategories", localField: "__subCategoryId", foreignField: "_id", as: "__subCategoryDoc" } },
    {
      $addFields: {
        _categoryName: { $arrayElemAt: ["$__categoryDoc.name", 0] },
        _subCategoryName: { $arrayElemAt: ["$__subCategoryDoc.name", 0] },
      },
    },
    { $project: { __itemCat: 0, __serviceCat: 0, __categoryId: 0, __subCategoryId: 0, __categoryDoc: 0, __subCategoryDoc: 0 } },
  ];
}

/** Resolves the line's mapped Deity name(s) — comma-joined when there's more than one — off `lines.deities`. */
function deityLookupStages() {
  return [
    { $lookup: { from: "deities", localField: "_deityIds", foreignField: "_id", as: "__deityDocs" } },
    {
      $addFields: {
        _deityNames: {
          $reduce: {
            input: "$__deityDocs.name",
            initialValue: "",
            in: { $concat: ["$$value", { $cond: [{ $eq: ["$$value", ""] }, "", ", "] }, "$$this"] },
          },
        },
      },
    },
    { $project: { __deityDocs: 0 } },
  ];
}

/** One member of the Item Sales union — reshapes Booking/PosBooking's per-line data into one common shape, right after $unwind, so the rest of the pipeline never needs to know which collection a row came from. */
function itemSalesBranch({ sourceLabel }) {
  return [
    { $match: { isDeleted: false, bookingStatus: "confirmed" } },
    { $unwind: "$lines" },
    {
      $addFields: {
        _refType: "$lines.refType",
        _refId: "$lines.refId",
        _name: "$lines.name",
        _code: "$lines.code",
        _quantity: "$lines.quantity",
        _unitPrice: "$lines.unitPrice",
        _lineTotal: "$lines.lineTotal",
        // No per-line GST is stored (see models/bookings — only the booking-
        // level gstAmount is) — this line's proportional share of it, by
        // its share of the booking's subtotal. An honest approximation
        // given what's actually persisted, not a stored/audited GST split.
        _gstAmount: {
          $cond: [
            { $gt: ["$subtotal", 0] },
            { $multiply: [{ $divide: ["$lines.lineTotal", "$subtotal"] }, "$gstAmount"] },
            0,
          ],
        },
        _customerName: "$customerInfo.name",
        _customerMobile: "$customerInfo.mobileNumber",
        _bookingNumber: "$bookingNumber",
        _bookingTotal: "$grandTotal",
        _paymentModeName: "$paymentModeName",
        _paymentStatus: "$paymentStatus",
        _saleDate: "$bookedAt",
        _deityIds: "$lines.deities",
        _devoteeNames: {
          $reduce: {
            input: "$lines.devotees.name",
            initialValue: "",
            in: { $concat: ["$$value", { $cond: [{ $eq: ["$$value", ""] }, "", ", "] }, "$$this"] },
          },
        },
        _source: sourceLabel,
      },
    },
    {
      $project: {
        _refType: 1,
        _refId: 1,
        _name: 1,
        _code: 1,
        _quantity: 1,
        _unitPrice: 1,
        _lineTotal: 1,
        _gstAmount: 1,
        _customerName: 1,
        _customerMobile: 1,
        _bookingNumber: 1,
        _bookingTotal: 1,
        _paymentModeName: 1,
        _paymentStatus: 1,
        _saleDate: 1,
        _deityIds: 1,
        _devoteeNames: 1,
        _source: 1,
      },
    },
  ];
}

/**
 * One member of the Payment Report union — HallBookingPayment, Transaction
 * and PosTransaction reshaped into one common shape. `bookingNumber` needs
 * a tiny by-_id lookup (only when selected) since none of the three
 * denormalizes it. Payment Type and Reference No only really exist on
 * HallBookingPayment — the other two collections fold to "" for them
 * rather than the row disappearing or the field simply not existing.
 */
function paymentBranch({ bookingRefCollection, bookingRefField, sourceLabel }) {
  return [
    { $match: { isDeleted: false, paymentStatus: { $in: ["paid"] } } },
    {
      $addFields: {
        _receiptNo: "$receiptNo",
        _bookingRef: `$${bookingRefField}`,
        _bookingRefCollection: bookingRefCollection,
        _customerName: "$customerInfo.name",
        _customerMobile: "$customerInfo.mobileNumber",
        _paymentDate: { $ifNull: ["$paymentDate", "$transactionDate"] },
        _paymentModeName: "$paymentModeName",
        _paymentType: { $ifNull: ["$paymentType", ""] },
        _referenceNo: { $ifNull: ["$referenceNo", { $ifNull: ["$gatewayReference", ""] }] },
        _processedByName: { $ifNull: ["$collectedByInfo.name", "$processedByInfo.name"] },
        _amount: "$amount",
        _source: sourceLabel,
      },
    },
    {
      $project: {
        _receiptNo: 1,
        _bookingRef: 1,
        _bookingRefCollection: 1,
        _customerName: 1,
        _customerMobile: 1,
        _paymentDate: 1,
        _paymentModeName: 1,
        _paymentType: 1,
        _referenceNo: 1,
        _processedByName: 1,
        _amount: 1,
        _source: 1,
      },
    },
  ];
}

/** Booking-number lookup for the Payment Report — `_bookingRefCollection` tags which of the three booking collections `_bookingRef` points into, since the union mixes rows from all three. */
function bookingNumberLookupStages() {
  return [
    { $lookup: { from: "hallbookings", localField: "_bookingRef", foreignField: "_id", as: "__hb" } },
    { $lookup: { from: "bookings", localField: "_bookingRef", foreignField: "_id", as: "__b" } },
    { $lookup: { from: "pos_bookings", localField: "_bookingRef", foreignField: "_id", as: "__pb" } },
    {
      $addFields: {
        _bookingNumber: {
          $switch: {
            branches: [
              { case: { $eq: ["$_bookingRefCollection", "hallbookings"] }, then: { $arrayElemAt: ["$__hb.bookingNumber", 0] } },
              { case: { $eq: ["$_bookingRefCollection", "bookings"] }, then: { $arrayElemAt: ["$__b.bookingNumber", 0] } },
              { case: { $eq: ["$_bookingRefCollection", "pos_bookings"] }, then: { $arrayElemAt: ["$__pb.bookingNumber", 0] } },
            ],
            default: null,
          },
        },
      },
    },
    { $project: { __hb: 0, __b: 0, __pb: 0 } },
  ];
}

/** No join at all — just the size of the customer's own embedded array. Still a proper extraStages (not a plain path) because $project only supports a bare "$field" reference, not an expression like $size. */
function familyMemberCountStages() {
  return [{ $addFields: { _familyMemberCount: { $size: { $ifNull: ["$familyMembers", []] } } } }];
}

/** Customer Report's rollup — total bookings / total amount / last booking date, summed across all three sale collections via one indexed $lookup each (see the module comment above). */
function customerRollupStages() {
  const branch = (from, statusMatch, amountField, dateField) => ({
    $lookup: {
      from,
      let: { cid: "$_id" },
      pipeline: [
        { $match: { $expr: { $eq: ["$customer", "$$cid"] }, isDeleted: false, ...statusMatch } },
        { $group: { _id: null, count: { $sum: 1 }, total: { $sum: `$${amountField}` }, last: { $max: `$${dateField}` } } },
      ],
      as: "__agg",
    },
  });

  return [
    branch("hallbookings", { bookingStatus: { $ne: "cancelled" } }, "finalAmount", "eventDate"),
    { $addFields: { __hallAgg: { $arrayElemAt: ["$__agg", 0] } } },
    { $project: { __agg: 0 } },
    branch("bookings", { bookingStatus: "confirmed" }, "grandTotal", "bookedAt"),
    { $addFields: { __bookingAgg: { $arrayElemAt: ["$__agg", 0] } } },
    { $project: { __agg: 0 } },
    branch("pos_bookings", { bookingStatus: "confirmed" }, "grandTotal", "bookedAt"),
    { $addFields: { __posAgg: { $arrayElemAt: ["$__agg", 0] } } },
    { $project: { __agg: 0 } },
    {
      $addFields: {
        _totalBookings: {
          $add: [
            { $ifNull: ["$__hallAgg.count", 0] },
            { $ifNull: ["$__bookingAgg.count", 0] },
            { $ifNull: ["$__posAgg.count", 0] },
          ],
        },
        _totalAmount: {
          $add: [
            { $ifNull: ["$__hallAgg.total", 0] },
            { $ifNull: ["$__bookingAgg.total", 0] },
            { $ifNull: ["$__posAgg.total", 0] },
          ],
        },
        _lastBookingDate: {
          $max: ["$__hallAgg.last", "$__bookingAgg.last", "$__posAgg.last"],
        },
      },
    },
    { $project: { __hallAgg: 0, __bookingAgg: 0, __posAgg: 0 } },
  ];
}

const REPORT_SOURCES = [
  {
    key: "hallBookings",
    label: "Hall Booking Report",
    description: "One row per Hall Booking — every field here is denormalized on the booking itself, so this report never needs a join.",
    model: HallBooking,
    basePipeline: [{ $match: { isDeleted: false } }],
    defaultSort: { field: "eventDate", dir: "desc" },
    fields: [
      { key: "bookingNumber", label: "Booking No", type: "string", path: "bookingNumber" },
      { key: "customerName", label: "Customer", type: "string", path: "customerInfo.name" },
      { key: "customerMobile", label: "Customer Mobile", type: "string", path: "customerInfo.mobileNumber" },
      { key: "customerEmail", label: "Customer Email", type: "string", path: "customerInfo.email" },
      { key: "hallName", label: "Hall", type: "string", path: "hallName" },
      { key: "hallPurposeName", label: "Hall Purpose", type: "string", path: "hallPurposeName" },
      { key: "hallPackageName", label: "Hall Package", type: "string", path: "hallPackageName" },
      { key: "bookingType", label: "Booking Type", type: "string", path: "bookingType", options: ["individual", "package"] },
      { key: "eventDate", label: "Event Date", type: "date", path: "eventDate" },
      { key: "startTime", label: "Start Time", type: "string", path: "startTime" },
      { key: "endTime", label: "End Time", type: "string", path: "endTime" },
      { key: "foodRequired", label: "Food Required", type: "boolean", path: "foodRequired" },
      { key: "foodPackageName", label: "Food Package", type: "string", path: "foodPackageName" },
      { key: "paxCount", label: "Pax Count", type: "number", path: "paxCount" },
      { key: "amount", label: "Amount", type: "number", path: "finalAmount" },
      { key: "subtotalAmount", label: "Subtotal", type: "number", path: "subtotalAmount" },
      { key: "hallAmount", label: "Hall Amount", type: "number", path: "hallAmount" },
      { key: "foodAmount", label: "Food Amount", type: "number", path: "foodAmount" },
      { key: "additionalHourAmount", label: "Additional Hour Amount", type: "number", path: "additionalHourAmount" },
      { key: "gstAmount", label: "GST Amount", type: "number", path: "gstAmount" },
      { key: "discountAmount", label: "Discount Amount", type: "number", path: "discountAmount" },
      { key: "advanceAmount", label: "Advance Amount", type: "number", path: "advanceAmount" },
      { key: "depositAmount", label: "Deposit Amount", type: "number", path: "depositAmount" },
      { key: "paymentStatus", label: "Payment Status", type: "string", path: "paymentStatus", options: ["unpaid", "partial", "paid"] },
      { key: "bookingStatus", label: "Booking Status", type: "string", path: "bookingStatus", options: ["confirmed", "completed", "cancelled"] },
      { key: "membershipNumber", label: "Membership Number", type: "string", path: "membershipNumber" },
      { key: "memberName", label: "Member Name", type: "string", path: "memberName" },
      { key: "remarks", label: "Remarks", type: "string", path: "remarks" },
      { key: "bookedByName", label: "Booked By", type: "string", path: "bookedByInfo.name" },
      { key: "bookedAt", label: "Booked At", type: "date", path: "bookedAt" },
    ],
  },

  {
    key: "customers",
    label: "Customer Report",
    description: "One row per Customer. Total Bookings/Amount/Last Booking Date are rolled up live across Hall Bookings, Admin Bookings and POS Bookings — only computed when one of those fields is actually selected.",
    model: Customer,
    basePipeline: [{ $match: { isDeleted: false } }],
    defaultSort: { field: "name", dir: "asc" },
    fields: [
      { key: "customerCode", label: "Customer Code", type: "string", path: "customerCode" },
      { key: "name", label: "Customer Name", type: "string", path: "name" },
      { key: "mobileNumber", label: "Contact No", type: "string", path: "mobileNumber" },
      { key: "email", label: "Email", type: "string", path: "email" },
      { key: "isRegistered", label: "Registered", type: "boolean", path: "isRegistered" },
      { key: "dateOfBirth", label: "Date of Birth", type: "date", path: "dateOfBirth" },
      { key: "gender", label: "Gender", type: "string", path: "gender", options: ["MALE", "FEMALE", "OTHER"] },
      {
        key: "familyMemberCount",
        label: "Family Member Count",
        type: "number",
        path: "_familyMemberCount",
        stageKey: "familyMemberCount",
        extraStages: familyMemberCountStages,
      },
      { key: "registeredAt", label: "Registered On", type: "date", path: "createdAt" },
      {
        key: "totalBookings",
        label: "Total Bookings",
        type: "number",
        path: "_totalBookings",
        stageKey: "customerRollup",
        extraStages: customerRollupStages,
      },
      {
        key: "totalAmount",
        label: "Total Amount",
        type: "number",
        path: "_totalAmount",
        stageKey: "customerRollup",
        extraStages: customerRollupStages,
      },
      {
        key: "lastBookingDate",
        label: "Last Booking Date",
        type: "date",
        path: "_lastBookingDate",
        stageKey: "customerRollup",
        extraStages: customerRollupStages,
      },
    ],
  },

  {
    key: "itemSales",
    label: "Item Sales Report",
    description: "One row per item/service line sold — Admin Bookings and POS Bookings combined. Category needs one small lookup, included only when selected.",
    model: Booking,
    basePipeline: [
      ...itemSalesBranch({ sourceLabel: "Admin Booking" }),
      { $unionWith: { coll: "pos_bookings", pipeline: itemSalesBranch({ sourceLabel: "POS Counter" }) } },
    ],
    defaultSort: { field: "saleDate", dir: "desc" },
    fields: [
      { key: "bookingNumber", label: "Booking No", type: "string", path: "_bookingNumber" },
      { key: "itemName", label: "Item/Service Name", type: "string", path: "_name" },
      { key: "code", label: "Code", type: "string", path: "_code" },
      { key: "refType", label: "Type", type: "string", path: "_refType", options: ["Item", "Service"] },
      {
        key: "category",
        label: "Category",
        type: "string",
        path: "_categoryName",
        stageKey: "categoryLookup",
        extraStages: categoryLookupStages,
      },
      {
        key: "subCategory",
        label: "Sub Category",
        type: "string",
        path: "_subCategoryName",
        stageKey: "categoryLookup",
        extraStages: categoryLookupStages,
      },
      { key: "quantity", label: "Quantity", type: "number", path: "_quantity" },
      { key: "unitPrice", label: "Unit Price", type: "number", path: "_unitPrice" },
      { key: "saleAmount", label: "Sale Amount", type: "number", path: "_lineTotal" },
      { key: "gstAmount", label: "GST", type: "number", path: "_gstAmount" },
      {
        key: "deityNames",
        label: "Deity Mapping",
        type: "string",
        path: "_deityNames",
        stageKey: "deityLookup",
        extraStages: deityLookupStages,
      },
      { key: "devoteeNames", label: "Devotee Name(s)", type: "string", path: "_devoteeNames" },
      { key: "customerName", label: "Customer", type: "string", path: "_customerName" },
      { key: "customerMobile", label: "Customer Mobile", type: "string", path: "_customerMobile" },
      { key: "paymentModeName", label: "Payment Mode", type: "string", path: "_paymentModeName" },
      { key: "paymentStatus", label: "Payment Status", type: "string", path: "_paymentStatus", options: ["paid", "partial", "pending"] },
      { key: "bookingTotal", label: "Booking Total", type: "number", path: "_bookingTotal" },
      { key: "source", label: "Source", type: "string", path: "_source", options: ["Admin Booking", "POS Counter"] },
      { key: "saleDate", label: "Sale Date", type: "date", path: "_saleDate" },
    ],
  },

  {
    key: "payments",
    label: "Payment Report",
    description: "One row per payment receipt — Hall Booking payments, Admin Booking transactions and POS Counter transactions combined. Booking No needs one small by-_id lookup, included only when selected.",
    model: HallBookingPayment,
    basePipeline: [
      ...paymentBranch({ bookingRefCollection: "hallbookings", bookingRefField: "booking", sourceLabel: "Hall Booking" }),
      {
        $unionWith: {
          coll: "transactions",
          pipeline: paymentBranch({ bookingRefCollection: "bookings", bookingRefField: "bookingId", sourceLabel: "Admin Booking" }),
        },
      },
      {
        $unionWith: {
          coll: "pos_transactions",
          pipeline: paymentBranch({ bookingRefCollection: "pos_bookings", bookingRefField: "bookingId", sourceLabel: "POS Counter" }),
        },
      },
    ],
    defaultSort: { field: "paymentDate", dir: "desc" },
    fields: [
      { key: "receiptNo", label: "Receipt No", type: "string", path: "_receiptNo" },
      {
        key: "bookingNumber",
        label: "Booking No",
        type: "string",
        path: "_bookingNumber",
        stageKey: "bookingNumberLookup",
        extraStages: bookingNumberLookupStages,
      },
      { key: "customerName", label: "Customer", type: "string", path: "_customerName" },
      { key: "customerMobile", label: "Customer Mobile", type: "string", path: "_customerMobile" },
      { key: "paymentDate", label: "Payment Date", type: "date", path: "_paymentDate" },
      { key: "paymentModeName", label: "Payment Mode", type: "string", path: "_paymentModeName" },
      { key: "paymentType", label: "Payment Type", type: "string", path: "_paymentType", options: ["deposit", "advance", "balance"] },
      { key: "referenceNo", label: "Reference No", type: "string", path: "_referenceNo" },
      { key: "processedByName", label: "Collected / Processed By", type: "string", path: "_processedByName" },
      { key: "amount", label: "Amount", type: "number", path: "_amount" },
      { key: "source", label: "Source", type: "string", path: "_source", options: ["Hall Booking", "Admin Booking", "POS Counter"] },
    ],
  },
];

function getReportSource(sourceKey) {
  const source = REPORT_SOURCES.find((s) => s.key === sourceKey);
  if (!source) throw `Unknown report source "${sourceKey}".`;
  return source;
}

/** The catalog shape the frontend's report builder renders from — no Mongoose models leaked across the wire. */
function listReportSourcesForClient() {
  return REPORT_SOURCES.map((s) => ({
    key: s.key,
    label: s.label,
    description: s.description,
    defaultSort: s.defaultSort,
    fields: s.fields.map((f) => ({ key: f.key, label: f.label, type: f.type, options: f.options ?? null })),
  }));
}

module.exports = { REPORT_SOURCES, getReportSource, listReportSourcesForClient };
