// =============================================================================
// Praying Planet mobile-API client/webhook provisioning — the single place
// that generates credentials, so both the CLI script
// (scripts/create-api-client.js) and the admin UI's create/manage routes
// (routes/mobileApiAdmin.js) do it identically. A raw secret is only ever
// returned from the functions here at the moment of creation/rotation —
// never stored or retrievable again afterward.
// =============================================================================
const crypto = require('crypto');
const { db } = require('../db');
const { encrypt } = require('./secretsCrypto');
const { isSafeTargetUrl } = require('./urlSafety');

function hashSecret(secret) {
  return crypto.createHash('sha256').update(secret).digest('hex');
}

function generateClientId() {
  return `pp_${crypto.randomBytes(12).toString('hex')}`;
}

function generateSecret() {
  return crypto.randomBytes(32).toString('base64url');
}

async function createApiClient({ name, scopes }) {
  const clientId = generateClientId();
  const clientSecret = generateSecret();
  const [ins] = await db.query(
    `INSERT INTO api_clients (name, client_id, client_secret_hash, scopes, is_active)
     VALUES (:name, :clientId, :hash, CAST(:scopes AS JSON), 1)`,
    { name, clientId, hash: hashSecret(clientSecret), scopes: JSON.stringify(scopes) }
  );
  return { id: ins.insertId, clientId, clientSecret, scopes };
}

async function rotateClientSecret(id) {
  const clientSecret = generateSecret();
  const [result] = await db.query(
    'UPDATE api_clients SET client_secret_hash = :hash WHERE id = :id',
    { hash: hashSecret(clientSecret), id }
  );
  if (!result.affectedRows) return null;
  return { clientSecret };
}

async function setClientActive(id, isActive) {
  const [result] = await db.query(
    'UPDATE api_clients SET is_active = :isActive WHERE id = :id',
    { isActive: isActive ? 1 : 0, id }
  );
  return !!result.affectedRows;
}

// Throws with a user-facing message if the target URL fails the SSRF check
// (same guard every actual delivery is checked against — see
// services/ppWebhooks.js) so a bad URL is rejected at registration time,
// not silently accepted and failing forever after.
async function createWebhookEndpoint({ apiClientId, targetUrl, subscribedEvents }) {
  if (!(await isSafeTargetUrl(targetUrl))) {
    const err = new Error('Webhook target URL is not allowed (must be a public http/https address)');
    err.status = 400;
    throw err;
  }
  const signingSecret = generateSecret();
  const [ins] = await db.query(
    `INSERT INTO webhook_endpoints (api_client_id, target_url, signing_secret, subscribed_events, is_active)
     VALUES (:apiClientId, :targetUrl, :encryptedSecret, CAST(:events AS JSON), 1)`,
    { apiClientId, targetUrl, encryptedSecret: encrypt(signingSecret), events: JSON.stringify(subscribedEvents) }
  );
  return { id: ins.insertId, signingSecret };
}

async function setWebhookActive(id, isActive) {
  const [result] = await db.query(
    'UPDATE webhook_endpoints SET is_active = :isActive WHERE id = :id',
    { isActive: isActive ? 1 : 0, id }
  );
  return !!result.affectedRows;
}

async function deleteWebhookEndpoint(id) {
  const [result] = await db.query('DELETE FROM webhook_endpoints WHERE id = :id', { id });
  return !!result.affectedRows;
}

module.exports = {
  hashSecret, generateClientId, generateSecret,
  createApiClient, rotateClientSecret, setClientActive,
  createWebhookEndpoint, setWebhookActive, deleteWebhookEndpoint,
};
