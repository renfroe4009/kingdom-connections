'use strict';
// =============================================================================
// Generic AES-256-GCM encrypt/decrypt for secrets stored at rest (security
// remediation H-13) — same pattern already used for Google OAuth tokens in
// services/google.js, generalized and keyed separately (SECRETS_ENCRYPTION_KEY,
// not GOOGLE_TOKEN_SECRET) so a compromise of one key doesn't expose the other
// category of secret. Currently used for payment_gateway_settings' credential
// columns (transaction_key, signature_key, api_key, app_key, webhook_secret) —
// previously plaintext, meaning any database read (including via C-01's now-
// fixed path-traversal-to-.env chain) yielded live, usable gateway credentials.
//
// Format stored in DB: "iv:authTag:ciphertext" (all hex) — identical shape to
// google.js's, so the same "does this look encrypted?" check works for both.
// =============================================================================
const crypto = require('crypto');

const ENCRYPTED_FORMAT_RE = /^[0-9a-f]{24}:[0-9a-f]{32}:[0-9a-f]+$/i;

function encryptionKey() {
  const secret = process.env.SECRETS_ENCRYPTION_KEY;
  if (!secret) throw new Error('SECRETS_ENCRYPTION_KEY is not set in .env');
  return crypto.createHash('sha256').update(secret).digest();
}

function encrypt(plaintext) {
  if (!plaintext) return null;
  const key = encryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

function decrypt(stored) {
  if (!stored) return null;
  const key = encryptionKey();
  const [ivHex, tagHex, dataHex] = stored.split(':');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  return decipher.update(dataHex, 'hex', 'utf8') + decipher.final('utf8');
}

// True if `value` is already in our "iv:authTag:ciphertext" format — used by
// the one-time migration script to skip rows already encrypted, and as a
// defensive check before decrypting (a value that doesn't match is treated
// as legacy plaintext rather than fed into createDecipheriv, which would
// throw on malformed input anyway).
function looksEncrypted(value) {
  return typeof value === 'string' && ENCRYPTED_FORMAT_RE.test(value);
}

module.exports = { encrypt, decrypt, looksEncrypted };
