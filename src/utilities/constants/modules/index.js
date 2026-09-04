/**
 * Single source of truth for permission module keys — the live permission
 * resolver (common/middleware/auth-guard.js), the Role Permission screen
 * (via GET /modules), and every route guard read from this list, so the
 * module tree is never hand-typed twice and drifting.
 *
 * RULE: a module key only belongs here if real routes are actually gated on
 * it. A key with no API behind it is worse than useless — it renders a
 * toggle in the Permission screen that silently grants nothing, which reads
 * to an admin as "access denied is broken". ("entities" used to sit here
 * for exactly that reason; there are no /entities routes, so it's gone
 * until the Entity Master is built.)
 *
 * Current key → route mapping:
 *   users            → GET/POST/PUT  /users
 *   customers        → GET/PUT       /customers   (admin-side devotee master;
 *                      distinct from /me/customer-profile, which is a devotee
 *                      reading their own record and needs no module grant)
 *   roles            → GET/POST/PUT/DELETE /roles, PUT /roles/:id/permissions, GET /modules
 *   email-templates  → CRUD /notifications/email-templates
 *                      CRUD /notifications/email-template-mappings
 *   inventory        → GET /inventory/options, /available-stock, /low-stock, /history
 *                      POST /inventory/adjustments
 *   pos-transactions → GET /pos/booking/bookings, /pos/booking/bookings/:id
 *                      POST /pos/booking/bookings/:id/payments (fullAccess —
 *                      collecting a partial-payment installment)
 *                      GET /pos/booking/payment-modes also accepts this
 *                      module's view level (or admin-booking's) — see
 *                      requirePaymentModeAccess() in controllers/pos
 *   pos-order-confirmation → GET /pos-order-confirmation/pending, /pending/:referenceId
 *                      POST /pos-order-confirmation/:referenceId/confirm (fullAccess —
 *                      manually confirming a PayNow/NETS payment that hasn't
 *                      had its real bank/terminal confirmation arrive)
 *
 * Level semantics, applied consistently by every route:
 *   view       → read-only (GET)
 *   edit       → modify something that already exists (PUT)
 *   fullAccess → bring into or remove from existence (POST, DELETE), and
 *                any operation that changes who can do what
 */
/**
 * `group` mirrors the Admin Panel's main-menu heading, so the Permission
 * screen can lay itself out the same way the sidebar does — main menu, then
 * the modules beneath it. It ships from here rather than being hardcoded in
 * the frontend so a new master declares its home once and appears under the
 * right heading automatically.
 */
const AVAILABLE_MODULES = [
  { key: "users", label: "Admin Users", group: "Administration" },
  { key: "customers", label: "Customers", group: "Administration" },
  { key: "roles", label: "Roles & Permissions", group: "Administration" },
  { key: "email-templates", label: "Email Templates", group: "Administration" },
  { key: "printing-groups", label: "Printing Group Master", group: "Masters" },
  { key: "units", label: "Unit Master", group: "Masters" },
  { key: "gst", label: "GST Master", group: "Masters" },
  { key: "gl-groups", label: "GL Group Master", group: "Masters" },
  { key: "deities", label: "Deity Master", group: "Masters" },
  { key: "general-ledgers", label: "General Ledger (GL) Master", group: "Masters" },
  { key: "categories", label: "Category Master", group: "Masters" },
  { key: "sub-categories", label: "Sub Category Master", group: "Masters" },
  { key: "items", label: "Item Master", group: "Masters" },
  { key: "services", label: "Service Master", group: "Masters" },
  { key: "events", label: "Event Master", group: "Masters" },
  { key: "nakshathirams", label: "Nakshathiram Master", group: "Masters" },
  { key: "payment-modes", label: "Payment Mode Master", group: "Masters" },
  { key: "inventory", label: "Inventory", group: "Inventory" },
  { key: "admin-booking", label: "Admin Booking", group: "Transactions" },
  { key: "pos-transactions", label: "POS Transactions", group: "Transactions" },
  { key: "pos-order-confirmation", label: "POS Order Confirmation", group: "Transactions" },
];

const MODULE_KEYS = AVAILABLE_MODULES.map((m) => m.key);
const PERMISSION_LEVELS = ["view", "edit", "fullAccess"];

module.exports = { AVAILABLE_MODULES, MODULE_KEYS, PERMISSION_LEVELS };
