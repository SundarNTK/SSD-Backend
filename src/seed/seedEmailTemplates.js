const EmailTemplate = require("../models/email-templates");
const EmailTemplateMapping = require("../models/email-template-mappings");

// Same palette as the Admin Panel itself (app/globals.css's --color-* tokens
// in SSD-Frontend), inlined as literal hex — email clients don't read CSS
// custom properties, so the values have to be copied rather than referenced.
const baseWrap = (title, bodyHtml) => `
  <div style="font-family:Georgia,serif;background:#fbf6ea;padding:40px 0;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr><td align="center">
        <table role="presentation" width="480" cellpadding="0" cellspacing="0"
          style="background:#ffffff;border:1px solid #d4af3740;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(42,32,19,0.08);">
          <tr><td style="padding:32px 36px;">
            <p style="color:#96691b;letter-spacing:3px;font-size:11px;text-transform:uppercase;margin:0 0 8px;">
              Sri Siva Durga Temple
            </p>
            <h1 style="color:#2a2013;font-size:22px;margin:0 0 20px;">${title}</h1>
            ${bodyHtml}
          </td></tr>
        </table>
      </td></tr>
    </table>
  </div>`;

const buttonHtml = (href, label) => `
  <a href="${href}" style="display:inline-block;margin-top:20px;padding:12px 28px;
    background:linear-gradient(#f0d17e,#b8892a);color:#2a2013;text-decoration:none;
    border-radius:10px;font-weight:600;">${label}</a>`;

const DEFAULT_TEMPLATES = [
  {
    name: "Account Activation",
    event: "ACCOUNT_ACTIVATION",
    subject: "Set your password — Sri Siva Durga Temple",
    htmlContent: baseWrap(
      "Welcome to the Temple",
      `<p style="color:#5c4d33;font-size:14.5px;line-height:1.6;">Namaste {{name}},</p>
       <p style="color:#5c4d33;font-size:14.5px;line-height:1.6;">
         An account has been created for you. Set your password to continue.
       </p>
       ${buttonHtml("{{activationUrl}}", "Set Your Password")}
       <p style="color:#7d6c4d;font-size:12.5px;margin-top:24px;">
         This link stays valid until you use it, and works only once. If you weren't expecting this, you can ignore it.
       </p>`
    ),
  },
  {
    name: "Password Reset",
    event: "PASSWORD_RESET",
    subject: "Reset your password — Sri Siva Durga Temple",
    htmlContent: baseWrap(
      "Reset Your Password",
      `<p style="color:#5c4d33;font-size:14.5px;line-height:1.6;">Namaste {{name}},</p>
       <p style="color:#5c4d33;font-size:14.5px;line-height:1.6;">
         We received a request to reset your password. Click below to choose a new one.
       </p>
       ${buttonHtml("{{resetUrl}}", "Reset Password")}
       <p style="color:#7d6c4d;font-size:12.5px;margin-top:24px;">
         This link expires in {{expiresInMinutes}} minutes. If you didn't request this, your password is still safe — just ignore this email.
       </p>`
    ),
  },
];

/**
 * Idempotent — safe to run on every seed. Creates the template + its
 * entity-scoped mapping for each default event, only if that entity+event
 * combination doesn't already have one (an admin may have since customized
 * it through the Email Template Master).
 */
async function ensureDefaultEmailTemplates(entityId) {
  for (const def of DEFAULT_TEMPLATES) {
    let template = await EmailTemplate.findOne(EmailTemplate.notDeletedFilter({ name: def.name }));
    if (!template) {
      template = await EmailTemplate.create({
        name: def.name,
        subject: def.subject,
        htmlContent: def.htmlContent,
        description: `Seeded default for the ${def.event} event.`,
      });
      console.log(`>>> Seed: email template "${def.name}" created`);
    }

    const existingMapping = await EmailTemplateMapping.findOne(
      EmailTemplateMapping.notDeletedFilter({ entity: entityId, event: def.event })
    );
    if (!existingMapping) {
      await EmailTemplateMapping.create({ entity: entityId, event: def.event, template: template._id });
      console.log(`>>> Seed: mapped event "${def.event}" → "${def.name}" for entity ${entityId}`);
    }
  }
}

module.exports = { ensureDefaultEmailTemplates, DEFAULT_TEMPLATES };