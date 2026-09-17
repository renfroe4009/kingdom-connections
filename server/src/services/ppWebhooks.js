// =============================================================================
// Outbound webhook delivery for the Praying Planet mobile-API integration.
// Reuses this repo's existing SSRF guard (services/urlSafety.js, already
// used by automations.js's webhook action) and secret-encryption helper
// (services/secretsCrypto.js, already used for payment_gateway_settings).
//
// Unlike automations.js's webhook action (fire-once, no signing — internal,
// staff-configured workflows), deliveries here are signed (a genuine 3rd
// party consumes these) and retried on failure via jobs/pp-webhook-retry-cron.js,
// since a missed member.app_data_deleted event is a compliance-relevant miss,
// not just a nice-to-have automation.
// =============================================================================
const crypto = require('crypto');
const { db } = require('../db');
const { isSafeTargetUrl } = require('./urlSafety');
const { decrypt } = require('./secretsCrypto');
const { logPpSync } = require('./ppSyncLog');

const DELIVERY_TIMEOUT_MS = 10000;
const MAX_ATTEMPTS = 5;
// Exponential backoff in minutes, indexed by attempt number (1-based).
const BACKOFF_MINUTES = [1, 5, 15, 60, 180];

function signPayload(secret, timestamp, body) {
  return crypto.createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
}

async function deliverToEndpoint(endpoint, eventType, payload, attempt) {
  const body = JSON.stringify({ event: eventType, data: payload });
  const meta = { endpointId: endpoint.id, targetUrl: endpoint.target_url, eventType, attempt };

  if (!(await isSafeTargetUrl(endpoint.target_url))) {
    await logPpSync({
      apiClientId: endpoint.api_client_id, direction: 'out', eventType,
      entityType: payload?.entity_type || null, entityId: payload?.id || null,
      request: { ...meta, payload }, status: 'failed',
      error: 'Webhook target URL is not allowed (must be a public http/https address)',
    });
    return { ok: false };
  }

  const timestamp = Math.floor(Date.now() / 1000);
  const signature = signPayload(decrypt(endpoint.signing_secret), timestamp, body);

  try {
    const res = await fetch(endpoint.target_url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-KC-Signature': `t=${timestamp},v1=${signature}`,
      },
      body,
      signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
      redirect: 'manual',
    });
    const ok = res.status >= 200 && res.status < 300;
    await logPpSync({
      apiClientId: endpoint.api_client_id, direction: 'out', eventType,
      entityType: payload?.entity_type || null, entityId: payload?.id || null,
      request: { ...meta, payload }, response: { status: res.status },
      status: ok ? 'success' : 'failed',
      error: ok ? null : `Upstream responded ${res.status}`,
    });
    return { ok };
  } catch (err) {
    await logPpSync({
      apiClientId: endpoint.api_client_id, direction: 'out', eventType,
      entityType: payload?.entity_type || null, entityId: payload?.id || null,
      request: { ...meta, payload }, status: 'failed', error: err.message,
    });
    return { ok: false };
  }
}

// Fires `eventType` to every active endpoint subscribed to it. Best-effort —
// a delivery failure here is logged (and later retried by the cron job),
// never thrown back to the caller, since the caller is a real CRM write
// (e.g. saving a contact) that must succeed regardless of a partner's
// webhook uptime.
async function fireWebhookEvent(eventType, payload) {
  try {
    const [endpoints] = await db.query(
      `SELECT we.id, we.api_client_id, we.target_url, we.signing_secret
         FROM webhook_endpoints we
         JOIN api_clients ac ON ac.id = we.api_client_id
        WHERE we.is_active = 1 AND ac.is_active = 1
          AND JSON_CONTAINS(we.subscribed_events, :event)`,
      { event: JSON.stringify(eventType) }
    );
    for (const endpoint of endpoints) {
      deliverToEndpoint(endpoint, eventType, payload, 1).catch(() => {});
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[ppWebhooks] fireWebhookEvent lookup failed:', err.message);
  }
}

// Convenience wrapper for the two call sites that mutate a contact
// (routes/contacts.js's create/update, routes/mobileApi.js's app-profile
// patch) — only notifies Praying Planet when the contact's org is actually
// app_enabled, so a partner never learns about activity in orgs it was
// never granted visibility into.
async function notifyMemberChange(eventType, contact) {
  if (!contact?.organization_id) return;
  const [[org]] = await db.query(
    'SELECT app_enabled FROM organizations WHERE id = :id', { id: contact.organization_id }
  );
  if (!org?.app_enabled) return;
  await fireWebhookEvent(eventType, {
    entity_type: 'contact',
    id: contact.id,
    organization_id: contact.organization_id,
    first_name: contact.first_name,
    last_name: contact.last_name,
    email: contact.email,
    updated_at: contact.updated_at,
  });
}

module.exports = { fireWebhookEvent, notifyMemberChange, deliverToEndpoint, signPayload, MAX_ATTEMPTS, BACKOFF_MINUTES };
