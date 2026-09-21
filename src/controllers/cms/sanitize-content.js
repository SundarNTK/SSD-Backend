const sanitizeHtml = require("sanitize-html");

/**
 * Whitelist for admin-authored page content. The Customer Portal renders this
 * HTML directly, so anything outside the whitelist — <script>, inline event
 * handlers, javascript: links, iframes — is stripped at save time.
 */
const OPTIONS = {
  allowedTags: [
    "h2", "h3", "h4", "p", "br", "hr", "blockquote",
    "strong", "b", "em", "i", "u", "span",
    "ul", "ol", "li",
    "a", "img",
    "table", "thead", "tbody", "tr", "th", "td",
  ],
  allowedAttributes: {
    a: ["href", "target", "rel"],
    img: ["src", "alt"],
    th: ["colspan", "rowspan"],
    td: ["colspan", "rowspan"],
  },
  allowedSchemes: ["http", "https", "mailto", "tel"],
  allowedSchemesByTag: { img: ["http", "https"] },
  transformTags: {
    // Links that open a new tab must not hand the new page a handle back to this one.
    a: (tagName, attribs) => ({
      tagName,
      attribs: attribs.target === "_blank" ? { ...attribs, rel: "noopener noreferrer" } : attribs,
    }),
  },
};

const sanitizeContent = (html) => sanitizeHtml(String(html ?? ""), OPTIONS);

module.exports = { sanitizeContent };
