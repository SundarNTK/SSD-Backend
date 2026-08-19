const mongoose = require("mongoose");
const { auditablePlugin, activeUniqueIndexOptions } = require("../../common/plugins/auditable");

/**
 * The reusable content library — mirrors HEB's `email-templates` model
 * (D:\PROJECTS\HEB\Notification-Service\source\models\email-templates).
 * A template is generic content with Handlebars placeholders (`{{name}}`,
 * `{{activationUrl}}`, ...); which template applies to which entity+event
 * is a separate EmailTemplateMapping record, not a field here.
 */
const emailTemplateSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  subject: { type: String, required: true },
  htmlContent: { type: String, required: true },
  description: { type: String, default: "" },
});

emailTemplateSchema.plugin(auditablePlugin);

emailTemplateSchema.index({ name: 1 }, activeUniqueIndexOptions({ collation: { locale: "en", strength: 2 } }));

module.exports = mongoose.model("EmailTemplate", emailTemplateSchema);
