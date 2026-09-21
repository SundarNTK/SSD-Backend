/**
 * Fixed vocabularies shared by the CMS Menu / CMS Page masters and the public
 * Customer Portal that renders them. Served to the admin form via
 * GET /cms/meta so the frontend never hand-types its own copy and drifts.
 */
const MENU_LOCATIONS = ["Header", "Footer"];

const LINK_TYPES = ["CMS Page", "Portal Page", "External URL"];

/**
 * Built-in Customer Portal destinations a menu can point at — screens that
 * have their own logic rather than admin-written content. `key` is what's
 * stored; `path` is where the portal serves it. Only screens that actually
 * exist belong here: a menu that opens a 404 is worse than a missing option.
 */
const PORTAL_ROUTES = [
  { key: "HOME", label: "Home", path: "/customer" },
  { key: "EVENTS", label: "Events (home section)", path: "/customer#events" },
  { key: "SERVICES", label: "Services (home section)", path: "/customer#services" },
  { key: "OFFERINGS", label: "Items (home section)", path: "/customer#items" },
  { key: "LOGIN", label: "Login", path: "/customer/login" },
  { key: "REGISTER", label: "Register", path: "/customer/login?tab=register" },
];

const PORTAL_ROUTE_KEYS = PORTAL_ROUTES.map((r) => r.key);

/**
 * The building blocks of a CMS page. A page is a plain HTML `content` body
 * and/or an ordered list of these sections — the home page is made entirely
 * of sections. Every visible section is filled from a master, so only its
 * heading and how many records to show live in the CMS:
 *
 *   Banner       the home-page image slider — up to BANNER_MAX_SLIDES uploaded
 *                images, managed right here in the CMS (not taken from events)
 *   Events       upcoming Events list                     — Event master
 *   Services     Service master
 *   Items        Item master
 *   SiteDetails  not drawn on the page: the temple's logo, address, phone,
 *                hours and social links, read by the portal's header, top
 *                bar and footer.
 *   Footer       not drawn on the page: the footer's own text (about blurb,
 *                column headings, hours, copyright). Footer links come from
 *                the CMS Menu master (location: Footer).
 */
const SECTION_TYPES = ["Banner", "Events", "Services", "Items", "SiteDetails", "Footer"];

/**
 * The CMS page that holds the portal's site-wide details (SiteDetails section)
 * and the footer text (Footer section). It is content for the layout, not a
 * page visitors can open, so the public page endpoints treat it as not found.
 */
const FOOTER_PAGE_SLUG = "site-footer";

/** The most images the home-page banner slider may hold. */
const BANNER_MAX_SLIDES = 5;

module.exports = { MENU_LOCATIONS, LINK_TYPES, PORTAL_ROUTES, PORTAL_ROUTE_KEYS, SECTION_TYPES, FOOTER_PAGE_SLUG, BANNER_MAX_SLIDES };
