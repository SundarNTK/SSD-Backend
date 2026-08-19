const handlebars = require("handlebars");
const EmailTemplateMapping = require("../../../models/email-template-mappings");
const { sendRawEmail } = require("../../../common/mailer/transport");

/**
 * Event → entity → template → render → send. The one function every
 * other module calls to email someone — nobody else touches
 * EmailTemplateMapping or handlebars directly.
 */
async function sendTemplatedEmail(event, entityId, to, data = {}) {
  const mapping = await EmailTemplateMapping.findOne(
    EmailTemplateMapping.notDeletedFilter({ entity: entityId, event: String(event).toUpperCase() })
  ).populate("template");

  if (!mapping || !mapping.template) {
    throw new Error(
      `No email template mapped for event "${event}" on entity "${entityId}". Configure one in the Email Template Master.`
    );
  }

  const subject = handlebars.compile(mapping.template.subject)(data);
  const html = handlebars.compile(mapping.template.htmlContent)(data);

  return sendRawEmail({
    to,
    subject,
    html,
    cc: mapping.cc,
    bcc: mapping.bcc,
    from: mapping.fromOverride,
  });
}

module.exports = sendTemplatedEmail;
