const CmsPage = require("../models/cms-pages");
const CmsMenu = require("../models/cms-menus");
const { FOOTER_PAGE_SLUG } = require("../utilities/constants/cms");

/**
 * Starter CMS content for the Customer Portal. The home page is made of
 * sections that are filled live from the masters (Banner + Events from the
 * Event master, Services, Items), plus a SiteDetails section that holds the
 * logo, address, phone, hours and social links every portal page shows in its
 * header and footer (on the Site Footer page, together with the footer wording).
 * The contact details below are SAMPLE values: the administrator replaces them
 * from CMS Pages -> Site Footer.
 */

const HOME_SECTIONS = [
  {
    type: "Banner",
    title: "Welcome to Sri Siva Durga Temple",
    // The image slider: up to 5 images, uploaded in the CMS. `heading` is the alt text (not shown);
    // `link` is optional — where a click on the image goes.
    items: [
      { image: "/MSR.webp", heading: "Maha Shivaratri 2026" },
      { image: "/cutomerLogin_bg.webp", heading: "Lord Shiva and Goddess Durga" },
    ],
  },
  {
    type: "Events",
    title: "Upcoming Events",
    subtitle: "Festivals and special occasions at the temple",
    limit: 9,
  },
  {
    type: "Services",
    title: "Book a Service",
    subtitle: "Choose from our available pooja and seva services",
    limit: 9,
  },
  {
    type: "Items",
    title: "Offerings & Items",
    subtitle: "Make an offering online",
    limit: 30,
  },
];

const FOOTER_SECTIONS = [
  {
    type: "SiteDetails",
    image: "/SSD_Full_Logo-Transparant.webp",
    content: "A place of worship and community for devotees of Lord Shiva and Goddess Durga.",
    items: [
      { label: "Address", text: "123 Serangoon Road, Singapore 218232" },
      { label: "Phone", text: "+65 6234 5678" },
      { label: "Email", text: "info@ssdtemple.sg" },
      { label: "Working Hours", text: "Mon-Sun: 6:00 AM - 9:00 PM" },
      { label: "Facebook", text: "https://www.facebook.com/" },
      { label: "Instagram", text: "https://www.instagram.com/" },
      { label: "YouTube", text: "https://www.youtube.com/" },
    ],
  },
  {
    type: "Footer",
    content: "A place of worship and community for devotees of Lord Shiva and Goddess Durga.",
    primaryLabel: "Quick Links",
    secondaryLabel: "Working Hours",
    eyebrow: "Open every day including public holidays",
    subtitle: "© {year} Sri Siva Durga Temple. All rights reserved.",
    items: [{ label: "Mon-Sun", text: "6:00 AM - 9:00 PM" }],
  },
];

const PAGES = [
  {
    slug: "home",
    title: "Home",
    tamilTitle: "முகப்பு",
    summary: "Sri Siva Durga Temple — book poojas and services, make offerings and stay connected with temple events.",
    sections: HOME_SECTIONS,
    metaTitle: "Sri Siva Durga Temple — Customer Portal",
    metaDescription: "Book poojas and services, make offerings and donations, and follow events at Sri Siva Durga Temple.",
  },
  {
    // Layout content, not a public page: the logo, contact details and footer wording.
    slug: FOOTER_PAGE_SLUG,
    title: "Site Footer",
    summary: "Logo, contact details, social links and the wording of the portal footer.",
    sections: FOOTER_SECTIONS,
  },
  {
    slug: "about-the-temple",
    title: "About the Temple",
    tamilTitle: "கோயில் பற்றி",
    summary: "Who we are, what the temple stands for, and how devotees can take part in its daily life.",
    content:
      "<h2>Welcome to Sri Siva Durga Temple</h2>" +
      "<p>Sri Siva Durga Temple has been a place of worship and community for devotees of Lord Shiva and Goddess Durga since 1985. " +
      "Our priests conduct daily poojas, and the temple hosts festivals, special abhishekams and community programmes throughout the year.</p>" +
      "<h3>What you can do here</h3>" +
      "<ul><li>Offer daily and special poojas and archanas</li><li>Sponsor abhishekams and festival services</li>" +
      "<li>Make offerings and donations online</li><li>Take part in community and cultural events</li></ul>" +
      "<p>[Temple history and founding details — to be added by the temple administrator.]</p>",
    metaTitle: "About Sri Siva Durga Temple",
    metaDescription: "Learn about Sri Siva Durga Temple, its daily poojas, festivals and community services.",
  },
  {
    slug: "visiting-information",
    title: "Visiting Information",
    tamilTitle: "தரிசன விவரங்கள்",
    summary: "Temple opening hours, dress code and guidance for first-time visitors.",
    content:
      "<h2>Plan your visit</h2>" +
      "<h3>Opening hours</h3>" +
      "<table><thead><tr><th>Day</th><th>Hours</th></tr></thead>" +
      "<tbody><tr><td>Monday – Sunday</td><td>6:00 AM – 9:00 PM</td></tr></tbody></table>" +
      "<h3>Dress code</h3>" +
      "<p>Devotees are kindly requested to dress modestly. Footwear must be left at the designated area before entering the temple.</p>" +
      "<h3>Etiquette</h3>" +
      "<ul><li>Please maintain silence and respect within the prayer hall</li>" +
      "<li>Photography inside the sanctum is not permitted</li><li>Follow the guidance of temple volunteers during festivals</li></ul>",
    metaTitle: "Visiting Sri Siva Durga Temple",
    metaDescription: "Opening hours, dress code and etiquette for visiting Sri Siva Durga Temple.",
  },
  {
    slug: "contact-us",
    title: "Contact Us",
    tamilTitle: "தொடர்புக்கு",
    summary: "How to reach the temple office for enquiries, bookings and support.",
    content:
      "<h2>Get in touch</h2>" +
      "<p>Our temple office is happy to help with enquiries about poojas, services and events.</p>" +
      "<ul><li><strong>Address:</strong> 123 Serangoon Road, Singapore 218232</li><li><strong>Phone:</strong> +65 6234 5678</li>" +
      "<li><strong>Email:</strong> <a href=\"mailto:info@ssdtemple.sg\">info@ssdtemple.sg</a></li>" +
      "<li><strong>Office hours:</strong> Mon-Sun: 6:00 AM - 9:00 PM</li></ul>",
    metaTitle: "Contact Sri Siva Durga Temple",
    metaDescription: "Address, phone and e-mail for the Sri Siva Durga Temple office.",
  },
  {
    slug: "privacy-policy",
    title: "Privacy Policy",
    tamilTitle: "தனியுரிமைக் கொள்கை",
    summary: "How the temple collects, uses and protects devotees' personal information.",
    content:
      "<h2>Privacy Policy</h2>" +
      "<p>We respect your privacy. This page explains what personal information we collect through this portal and how we use it.</p>" +
      "<h3>Information we collect</h3>" +
      "<ul><li>Contact details you provide when you register (name, mobile number, e-mail)</li>" +
      "<li>Family member and nakshatra details you enter for pooja bookings</li>" +
      "<li>Booking and payment records</li></ul>" +
      "<h3>How we use it</h3>" +
      "<p>Your information is used only to process bookings, issue receipts, send booking confirmations and reminders, and manage the temple's records. " +
      "We do not sell or share your personal information with third parties, except payment providers needed to complete your payment.</p>" +
      "<p>[Retention period, data-access requests and legal wording — to be reviewed and finalised by the temple management.]</p>",
    metaTitle: "Privacy Policy — Sri Siva Durga Temple",
    metaDescription: "How Sri Siva Durga Temple collects, uses and protects your personal information.",
  },
  {
    slug: "terms-of-service",
    title: "Terms of Service",
    tamilTitle: "சேவை விதிமுறைகள்",
    summary: "The terms that apply when you use the portal to book poojas and services.",
    content:
      "<h2>Terms of Service</h2>" +
      "<ol><li>Bookings are confirmed only after payment is received in full, or as stated for the booking type.</li>" +
      "<li>Please provide accurate names and details — they are printed on your receipt and used during the pooja.</li>" +
      "<li>The temple may reschedule or cancel a service for religious or operational reasons and will inform you where possible.</li></ol>" +
      "<p>[Final legal wording — to be reviewed by the temple management.]</p>",
    metaTitle: "Terms of Service — Sri Siva Durga Temple",
    metaDescription: "Terms of service for booking poojas and services online.",
  },
  {
    slug: "refund-and-cancellation-policy",
    title: "Refund & Cancellation Policy",
    tamilTitle: "பணத்திருப்பம் மற்றும் ரத்து கொள்கை",
    summary: "When a booking can be cancelled and how refunds are handled.",
    content:
      "<h2>Refund &amp; Cancellation Policy</h2>" +
      "<p>Pooja and service bookings are offered on behalf of the devotee on the chosen date and are generally non-refundable once performed.</p>" +
      "<ul><li>[Cancellation window for pooja and service bookings]</li><li>[Refund processing time and method]</li></ul>" +
      "<p>For any request, please contact the temple office.</p>",
    metaTitle: "Refund & Cancellation Policy — Sri Siva Durga Temple",
    metaDescription: "Cancellation and refund terms for bookings made through the Sri Siva Durga Temple portal.",
  },
];

/**
 * `parent` names another entry's `code` — parents come first in the array so
 * the reference always resolves. `page` names a CMS page slug.
 */
const MENUS = [
  { code: "HDR-HOME", name: "Home", tamilName: "முகப்பு", location: "Header", displayOrder: 1, linkType: "Portal Page", portalRoute: "HOME" },
  { code: "HDR-ABOUT", name: "About Us", tamilName: "எங்களைப் பற்றி", location: "Header", displayOrder: 2, linkType: "CMS Page", page: "about-the-temple" },
  { code: "HDR-ABOUT-TEMPLE", name: "About the Temple", tamilName: "கோயில் பற்றி", location: "Header", displayOrder: 1, linkType: "CMS Page", page: "about-the-temple", parent: "HDR-ABOUT" },
  { code: "HDR-ABOUT-VISIT", name: "Visiting Information", tamilName: "தரிசன விவரங்கள்", location: "Header", displayOrder: 2, linkType: "CMS Page", page: "visiting-information", parent: "HDR-ABOUT" },
  { code: "HDR-EVENTS", name: "Events", tamilName: "நிகழ்வுகள்", location: "Header", displayOrder: 3, linkType: "Portal Page", portalRoute: "EVENTS" },
  { code: "HDR-SERVICES", name: "Services", tamilName: "சேவைகள்", location: "Header", displayOrder: 4, linkType: "Portal Page", portalRoute: "SERVICES" },
  { code: "HDR-OFFERINGS", name: "Offerings", tamilName: "காணிக்கைகள்", location: "Header", displayOrder: 5, linkType: "Portal Page", portalRoute: "OFFERINGS" },
  { code: "HDR-CONTACT", name: "Contact", tamilName: "தொடர்புக்கு", location: "Header", displayOrder: 6, linkType: "CMS Page", page: "contact-us" },
  { code: "FTR-PRIVACY", name: "Privacy Policy", tamilName: "தனியுரிமைக் கொள்கை", location: "Footer", displayOrder: 1, linkType: "CMS Page", page: "privacy-policy" },
  { code: "FTR-TERMS", name: "Terms of Service", tamilName: "சேவை விதிமுறைகள்", location: "Footer", displayOrder: 2, linkType: "CMS Page", page: "terms-of-service" },
  { code: "FTR-REFUND", name: "Refund & Cancellation Policy", tamilName: "ரத்து கொள்கை", location: "Footer", displayOrder: 3, linkType: "CMS Page", page: "refund-and-cancellation-policy" },
  { code: "FTR-CONTACT", name: "Contact Us", tamilName: "தொடர்புக்கு", location: "Footer", displayOrder: 4, linkType: "CMS Page", page: "contact-us" },
];

/**
 * Idempotent — a record that already exists (matched by slug / code) is left
 * exactly as it is, so re-running this never overwrites an admin's edits.
 */
async function ensureDefaultCms() {
  const pageIdBySlug = {};
  for (const def of PAGES) {
    let page = await CmsPage.findOne(CmsPage.notDeletedFilter({ slug: def.slug }));
    if (!page) {
      page = await CmsPage.create({ ...def, status: 1 });
      console.log(`>>> Seed: CMS page "${def.slug}" created`);
    }
    pageIdBySlug[def.slug] = page._id;
  }

  const menuIdByCode = {};
  for (const { page, parent, ...def } of MENUS) {
    let menu = await CmsMenu.findOne(CmsMenu.notDeletedFilter({ code: def.code }));
    if (!menu) {
      menu = await CmsMenu.create({
        ...def,
        cmsPage: page ? pageIdBySlug[page] : null,
        parentMenu: parent ? menuIdByCode[parent] : null,
        status: 1,
      });
      console.log(`>>> Seed: CMS menu "${def.code}" created`);
    }
    menuIdByCode[def.code] = menu._id;
  }
}

module.exports = { ensureDefaultCms, PAGES, MENUS };

/** Also runnable on its own — `pnpm run seed:cms`. */
if (require.main === module) {
  require("dotenv").config();
  const connectDatabase = require("../config/database");

  (async () => {
    await connectDatabase();
    await ensureDefaultCms();
    console.log(">>> Seed: CMS pages and menus ready.");
    process.exit(0);
  })().catch((err) => {
    console.error(">>> seed:cms failed:", err.message || err);
    process.exit(1);
  });
}
