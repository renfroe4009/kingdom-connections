// =============================================================================
// Admin management for the Praying Planet mobile API, surfaced on the
// Integrations settings page (client/src/admin/pages/SettingsPage.jsx).
// Gated exactly like the other integration settings routes
// (routes/connectwise.js, routes/usps.js) — requirePermission('settings.manage').
//
// Client secrets and webhook signing secrets are returned ONLY from the
// create/rotate endpoints, at the moment of generation — never re-readable
// afterward (same one-time-reveal discipline as scripts/create-api-client.js,
// which now shares this same generation logic via services/apiClients.js).
// =============================================================================
const router = require('express').Router();
const { z } = require('zod');
const { db } = require('../db');
const { requireAuth, requirePermission } = require('../middleware/auth');
const {
  createApiClient, rotateClientSecret, setClientActive,
  createWebhookEndpoint, setWebhookActive, deleteWebhookEndpoint,
} = require('../services/apiClients');

// Kept in sync with the scopes middleware/apiClientAuth.js's requireApiClient()
// checks and the events services/ppWebhooks.js actually fires — an allowlist
// so a typo or made-up value doesn't silently create a client/webhook that
// can never actually do anything (or worse, looks granted but isn't checked
// anywhere).
const VALID_SCOPES = ['organizations:read', 'members:read', 'members:write', 'members:delete'];
const VALID_EVENTS = ['member.created', 'member.updated', 'member.app_data_deleted'];

router.use(requireAuth, requirePermission('settings.manage'));

router.get('/status', async (req, res, next) => {
  try {
    const [clients] = await db.query(
      `SELECT id, name, client_id, scopes, is_active, created_at, last_used_at
         FROM api_clients ORDER BY id DESC`
    );
    const [webhooks] = await db.query(
      `SELECT w.id, w.api_client_id, w.target_url, w.subscribed_events, w.is_active, w.created_at,
              c.name AS client_name
         FROM webhook_endpoints w
         JOIN api_clients c ON c.id = w.api_client_id
        ORDER BY w.id DESC`
    );
    const [[orgCount]] = await db.query(
      `SELECT COUNT(*) AS cnt FROM organizations WHERE app_enabled = 1`
    );
    res.json({
      clients: clients.map((c) => ({
        ...c,
        scopes: typeof c.scopes === 'string' ? JSON.parse(c.scopes) : c.scopes,
      })),
      webhooks: webhooks.map((w) => ({
        ...w,
        subscribed_events: typeof w.subscribed_events === 'string' ? JSON.parse(w.subscribed_events) : w.subscribed_events,
      })),
      app_enabled_org_count: orgCount.cnt,
      valid_scopes: VALID_SCOPES,
      valid_events: VALID_EVENTS,
    });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// Clients
// ---------------------------------------------------------------------------
const createClientSchema = z.object({
  name: z.string().trim().min(1).max(150),
  scopes: z.array(z.enum(VALID_SCOPES)).min(1),
});

router.post('/clients', async (req, res, next) => {
  try {
    const { name, scopes } = createClientSchema.parse(req.body);
    const client = await createApiClient({ name, scopes });
    // client_secret is returned exactly once — the response is not persisted
    // anywhere the browser could re-fetch it from later.
    res.status(201).json({
      id: client.id, client_id: client.clientId, client_secret: client.clientSecret, scopes,
    });
  } catch (err) { next(err); }
});

const toggleSchema = z.object({ is_active: z.boolean() });

router.patch('/clients/:id', async (req, res, next) => {
  try {
    const { is_active } = toggleSchema.parse(req.body);
    const ok = await setClientActive(Number(req.params.id), is_active);
    if (!ok) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.post('/clients/:id/rotate-secret', async (req, res, next) => {
  try {
    const result = await rotateClientSecret(Number(req.params.id));
    if (!result) return res.status(404).json({ error: 'Not found' });
    res.json({ client_secret: result.clientSecret });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// Webhooks
// ---------------------------------------------------------------------------
const createWebhookSchema = z.object({
  api_client_id: z.number().int(),
  target_url: z.string().url().max(500),
  subscribed_events: z.array(z.enum(VALID_EVENTS)).min(1),
});

router.post('/webhooks', async (req, res, next) => {
  try {
    const { api_client_id, target_url, subscribed_events } = createWebhookSchema.parse(req.body);
    const [[client]] = await db.query('SELECT id FROM api_clients WHERE id = :id', { id: api_client_id });
    if (!client) return res.status(404).json({ error: 'Unknown client' });

    const webhook = await createWebhookEndpoint({ apiClientId: api_client_id, targetUrl: target_url, subscribedEvents: subscribed_events });
    // signing_secret is returned exactly once, same reveal-once discipline as client_secret above.
    res.status(201).json({ id: webhook.id, signing_secret: webhook.signingSecret });
  } catch (err) {
    if (err.status === 400) return res.status(400).json({ error: err.message });
    next(err);
  }
});

router.patch('/webhooks/:id', async (req, res, next) => {
  try {
    const { is_active } = toggleSchema.parse(req.body);
    const ok = await setWebhookActive(Number(req.params.id), is_active);
    if (!ok) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.delete('/webhooks/:id', async (req, res, next) => {
  try {
    const ok = await deleteWebhookEndpoint(Number(req.params.id));
    if (!ok) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;
