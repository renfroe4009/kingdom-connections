// =============================================================================
// Cloudflare DNS Management — proxy routes to Cloudflare API
// Token stored in settings table (key: cloudflare.account); falls back to
// CF_API_TOKEN env var for legacy deployments.
// =============================================================================
const express = require('express');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { readSettings } = require('./seo-settings');
const { db } = require('../db');

const router = express.Router();
router.use(requireAuth);
router.use(requirePermission('settings.manage'));

const CF_BASE   = 'https://api.cloudflare.com/client/v4';
const MASKED    = '••••••••••••••••••••••';
const DB_KEY    = 'cloudflare.account';

async function getToken() {
  try {
    const [[row]] = await db.query(
      "SELECT value_json FROM settings WHERE `key` = :k LIMIT 1",
      { k: DB_KEY },
    );
    if (row) {
      const val = JSON.parse(row.value_json);
      if (val?.api_token) return val.api_token;
    }
  } catch (_) {}
  const token = process.env.CF_API_TOKEN;
  if (!token) throw Object.assign(new Error('Cloudflare API token not configured'), { status: 503 });
  return token;
}

async function cfFetch(path, opts = {}) {
  const token = await getToken();
  const headers = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    ...opts.headers,
  };
  const res  = await fetch(`${CF_BASE}${path}`, { ...opts, headers });
  const body = await res.json();
  if (!body.success) {
    const msg = body.errors?.[0]?.message || 'Cloudflare API error';
    const err = new Error(msg);
    err.status = res.status >= 400 ? res.status : 502;
    throw err;
  }
  return body;
}

// ── Account settings ──────────────────────────────────────────────────────────
router.get('/account', async (_req, res, next) => {
  try {
    const [[row]] = await db.query(
      "SELECT value_json FROM settings WHERE `key` = :k LIMIT 1",
      { k: DB_KEY },
    );
    if (!row) return res.json({ api_token: '', from_env: !!process.env.CF_API_TOKEN });
    const val = JSON.parse(row.value_json);
    res.json({ api_token: val.api_token ? MASKED : '', from_env: false });
  } catch (e) { next(e); }
});

router.put('/account', async (req, res, next) => {
  try {
    const { api_token } = req.body;
    if (!api_token || typeof api_token !== 'string') {
      return res.status(400).json({ error: 'api_token required' });
    }
    // Client sent back the masked placeholder — nothing changed
    if (api_token === MASKED || api_token.startsWith('••')) {
      return res.json({ ok: true, unchanged: true });
    }
    if (api_token.trim().length < 10) {
      return res.status(400).json({ error: 'Token too short — check your Cloudflare API token' });
    }
    const val = JSON.stringify({ api_token: api_token.trim() });
    await db.query(
      "INSERT INTO settings (`key`, value_json) VALUES (:k, :v) ON DUPLICATE KEY UPDATE value_json = :v",
      { k: DB_KEY, v: val },
    );
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// ── Zones ─────────────────────────────────────────────────────────────────────
router.get('/zones', async (req, res, next) => {
  try {
    const data = await cfFetch('/zones?per_page=50&status=active');
    const zones = (data.result || []).map((z) => ({
      id: z.id,
      name: z.name,
      status: z.status,
      nameServers: z.name_servers,
    }));
    const settings    = readSettings();
    const defaultZone = process.env.CF_ZONE_ID || settings.primary_zone_id || null;
    res.json({ zones, defaultZone });
  } catch (e) { next(e); }
});

// PUT /api/dns/primary-zone — save the selected zone as the analytics primary
router.put('/primary-zone', requirePermission('settings.manage'), async (req, res, next) => {
  try {
    const { zoneId } = req.body;
    if (!zoneId) return res.status(400).json({ error: 'zoneId required' });
    // Verify zone exists in the account before saving
    const data = await cfFetch(`/zones/${zoneId}`);
    const zone = data.result;
    // Write to seo-settings
    const path = require('path');
    const fs   = require('fs');
    const FILE = path.resolve(__dirname, '../../data/seo-settings.json');
    let current = {};
    try { current = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch (_) {}
    current.primary_zone_id = zoneId;
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(current, null, 2), 'utf8');
    res.json({ ok: true, zoneName: zone.name, zoneId });
  } catch (e) { next(e); }
});

// ── Zone Security Settings ────────────────────────────────────────────────────
router.get('/zones/:zoneId/security', async (req, res, next) => {
  try {
    const { zoneId } = req.params;
    const data = await cfFetch(`/zones/${zoneId}/settings/security_level`);
    res.json({ security_level: data.result.value });
  } catch (e) { next(e); }
});

router.patch('/zones/:zoneId/security', async (req, res, next) => {
  try {
    const { zoneId } = req.params;
    const { security_level } = req.body;
    const VALID = ['essentially_off', 'low', 'medium', 'high', 'under_attack'];
    if (!security_level || !VALID.includes(security_level)) {
      return res.status(400).json({ error: `security_level must be one of: ${VALID.join(', ')}` });
    }
    await cfFetch(`/zones/${zoneId}/settings/security_level`, {
      method: 'PATCH',
      body: JSON.stringify({ value: security_level }),
    });
    res.json({ ok: true, security_level });
  } catch (e) { next(e); }
});

// ── DNS Records ───────────────────────────────────────────────────────────────
router.get('/zones/:zoneId/records', async (req, res, next) => {
  try {
    const { zoneId } = req.params;
    const { type, name, page = 1 } = req.query;
    let qs = `?per_page=100&page=${page}`;
    if (type) qs += `&type=${encodeURIComponent(type)}`;
    if (name) qs += `&name=${encodeURIComponent(name)}`;
    const data = await cfFetch(`/zones/${zoneId}/dns_records${qs}`);
    res.json({
      records: data.result || [],
      total: data.result_info?.total_count || 0,
    });
  } catch (e) { next(e); }
});

router.post('/zones/:zoneId/records', async (req, res, next) => {
  try {
    const { zoneId } = req.params;
    const { type, name, content, ttl = 1, proxied = false, priority } = req.body;
    const payload = { type, name, content, ttl: Number(ttl), proxied };
    if (priority !== undefined) payload.priority = Number(priority);
    const data = await cfFetch(`/zones/${zoneId}/dns_records`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    res.status(201).json(data.result);
  } catch (e) { next(e); }
});

router.put('/zones/:zoneId/records/:recordId', async (req, res, next) => {
  try {
    const { zoneId, recordId } = req.params;
    const { type, name, content, ttl = 1, proxied = false, priority } = req.body;
    const payload = { type, name, content, ttl: Number(ttl), proxied };
    if (priority !== undefined) payload.priority = Number(priority);
    const data = await cfFetch(`/zones/${zoneId}/dns_records/${recordId}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
    res.json(data.result);
  } catch (e) { next(e); }
});

router.delete('/zones/:zoneId/records/:recordId', async (req, res, next) => {
  try {
    const { zoneId, recordId } = req.params;
    await cfFetch(`/zones/${zoneId}/dns_records/${recordId}`, { method: 'DELETE' });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

module.exports = router;
