const openpgp = require("openpgp");
const fs = require("fs");
const path = require("path");
const env = require("../../../../config/env");

/**
 * Decrypts + verifies one DBS PayNow ICN (Instant Credit Notification)
 * message — the same OpenPGP decrypt/verify HEB's Payment-Service does
 * (D:\PROJECTS\HEB\Payment-Service\source\controllers\paynow\icn-response\decrypt-resposne.js),
 * just taking the armored text directly (already read off the live
 * request) instead of reading it from a file first.
 *
 * @param {string} armoredMessage  the raw "-----BEGIN PGP MESSAGE-----...” text
 * @returns {Promise<string>} the decrypted JSON string
 */
async function decryptIcnResponse(armoredMessage) {
  const publicKeyPath = path.isAbsolute(env.PAYNOW_PUBLIC_KEY_PATH)
    ? env.PAYNOW_PUBLIC_KEY_PATH
    : path.join(process.cwd(), env.PAYNOW_PUBLIC_KEY_PATH);
  const privateKeyPath = path.isAbsolute(env.PAYNOW_PRIVATE_KEY_PATH)
    ? env.PAYNOW_PRIVATE_KEY_PATH
    : path.join(process.cwd(), env.PAYNOW_PRIVATE_KEY_PATH);

  if (!fs.existsSync(publicKeyPath) || !fs.existsSync(privateKeyPath)) {
    throw `PayNow DBS key material not found (expected at ${publicKeyPath} / ${privateKeyPath}) — see docs/paynow-integration.md.`;
  }

  const publicKeyFile = fs.readFileSync(publicKeyPath, "utf8");
  const privateKeyFile = fs.readFileSync(privateKeyPath, "utf8");

  const publicKey = await openpgp.readKey({ armoredKey: publicKeyFile });
  const privateKey = await openpgp.readPrivateKey({ armoredKey: privateKeyFile });
  const message = await openpgp.readMessage({ armoredMessage });

  const { data: decrypted } = await openpgp.decrypt({
    message,
    verificationKeys: publicKey,
    decryptionKeys: privateKey,
  });

  return decrypted;
}

module.exports = decryptIcnResponse;
