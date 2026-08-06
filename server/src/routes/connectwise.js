// =============================================================================
// /api/connectwise — settings, test connection, sync log, manual push
// =============================================================================
const router = require('express').Router();
const { z } = require('zod');
const { db } = require('../db');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { testConnection, getCwSettings, cwFetch, importFromConnectWise, searchCwContacts, importCwContact } = require('../services/connectwise');

router.use(requireAuth);

// -------- Settings (CW Manage) --------
router.get('/settings', requirePermission('settings.manage'), async (_req, res, next) => {
  try {
    const [rows] = await db.query('SELECT * FROM cw_manage_settings ORDER BY id DESC LIMIT 1');
    const r = rows[0] ? {
      ...rows[0],
      private_key: rows[0].private_key ? '********' : '',
    } : null;
    res.json(r);
  } catch (err) { next(err); }
});

const settingsSchema = z.object({
  site_url:    z.string().min(1).transform((v) => {
    const s = v.trim().replace(/\/$/, '');
    return /^https?:\/\//i.test(s) ? s : `https://${s}`;
  }),
  company_id:  z.string().min(1),
  public_key:  z.string().min(1),
  private_key: z.string().min(1),
  client_id:   z.string().optional().nullable(),
  api_version:         z.string().optional(),
  push_on_won:         z.union([z.boolean(), z.number()]).optional(),
  webhook_url:         z.string().optional().nullable(),
  is_active:           z.union([z.boolean(), z.number()]).optional(),
  cw_member_id:        z.string().optional().nullable(),
  cw_stage_name:       z.string().optional().nullable(),
  cw_status_name:      z.string().optional().nullable(),
  cw_location_id:      z.union([z.string(), z.number()]).optional().nullable(),
  cw_business_unit_id: z.union([z.string(), z.number()]).optional().nullable(),
});

router.put('/settings', requirePermission('settings.manage'), async (req, res, next) => {
  try {
    const d = settingsSchema.parse(req.body);
    const [rows] = await db.query('SELECT id, private_key FROM cw_manage_settings ORDER BY id DESC LIMIT 1');
    const existing = rows[0];
    const private_key = d.private_key === '********' ? existing?.private_key : d.private_key;

    const payload = {
      site_url: d.site_url,
      company_id: d.company_id,
      public_key: d.public_key,
      private_key,
      client_id: d.client_id || null,
      api_version: d.api_version || '2025.1',
      push_on_won:         (d.push_on_won === false || d.push_on_won === 0) ? 0 : 1,
      webhook_url:         d.webhook_url         || null,
      is_active:           (d.is_active  === false || d.is_active  === 0) ? 0 : 1,
      cw_member_id:        d.cw_member_id        || null,
      cw_stage_name:       d.cw_stage_name       || null,
      cw_status_name:      d.cw_status_name      || null,
      cw_location_id:      d.cw_location_id      || null,
      cw_business_unit_id: d.cw_business_unit_id || null,
    };

    if (existing) {
      payload.id = existing.id;
      await db.query(
        `UPDATE cw_manage_settings SET
            site_url=:site_url, company_id=:company_id,
            public_key=:public_key, private_key=:private_key, client_id=:client_id,
            api_version=:api_version, push_on_won=:push_on_won,
            webhook_url=:webhook_url, is_active=:is_active,
            cw_member_id=:cw_member_id, cw_stage_name=:cw_stage_name,
            cw_status_name=:cw_status_name, cw_location_id=:cw_location_id,
            cw_business_unit_id=:cw_business_unit_id
          WHERE id=:id`, payload);
    } else {
      await db.query(
        `INSERT INTO cw_manage_settings
           (site_url, company_id, public_key, private_key, client_id, api_version,
            push_on_won, webhook_url, is_active,
            cw_member_id, cw_stage_name, cw_status_name, cw_location_id, cw_business_unit_id)
         VALUES
           (:site_url,:company_id,:public_key,:private_key,:client_id,:api_version,
            :push_on_won,:webhook_url,:is_active,
            :cw_member_id,:cw_stage_name,:cw_status_name,:cw_location_id,:cw_business_unit_id)`,
        payload);
    }
    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.post('/test', requirePermission('settings.manage'), async (_req, res, next) => {
  try {
    const info = await testConnection();
    res.json({ ok: true, info });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

// -------- Active check (lightweight — no permission required beyond auth) --------
router.get('/active', async (_req, res, next) => {
  try {
    const cfg = await getCwSettings();
    if (!cfg) return res.json({ active: false });
    // Web UI path uses version with dots→underscores: "2025.1" → "v2025_1"
    const webVersion = cfg.api_version
      ? `v${String(cfg.api_version).replace(/\./g, '_')}`
      : 'v2025_1';
    const baseUrl = `${cfg.site_url.replace(/\/$/, '')}/${webVersion}/ConnectWise.aspx?locale=en_US`;
    res.json({
      active:       true,
      site_url:     cfg.site_url,
      opportunity_url: `${baseUrl}&routeTo=OpportunityFV&recid=`,
      company_url:     `${baseUrl}&routeTo=CompanyFV&recid=`,
    });
  } catch (err) { next(err); }
});

// -------- CW record proxies (fetch live data from CW for inline display) --------
router.get('/opportunities/:cwId', async (req, res, next) => {
  try {
    const cfg = await getCwSettings();
    if (!cfg) return res.status(400).json({ error: 'ConnectWise not configured' });
    const data = await cwFetch(cfg, `/sales/opportunities/${req.params.cwId}`);
    res.json(data);
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

router.get('/companies/:cwId', async (req, res, next) => {
  try {
    const cfg = await getCwSettings();
    if (!cfg) return res.status(400).json({ error: 'ConnectWise not configured' });
    const data = await cwFetch(cfg, `/company/companies/${req.params.cwId}`);
    res.json(data);
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

// -------- Member lookup / verify --------
router.get('/members/:identifier', requirePermission('settings.manage'), async (req, res, next) => {
  try {
    const cfg = await getCwSettings();
    if (!cfg) return res.status(400).json({ error: 'ConnectWise not configured' });
    const encoded = encodeURIComponent(`identifier="${req.params.identifier}"`);
    const members = await cwFetch(cfg, `/system/members?conditions=${encoded}&pageSize=1`);
    if (!Array.isArray(members) || !members[0]) {
      return res.status(404).json({ error: `Member "${req.params.identifier}" not found in ConnectWise` });
    }
    res.json({ ok: true, member: members[0] });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// -------- Sync log --------
router.get('/sync-log', requirePermission('settings.manage'), async (req, res, next) => {
  try {
    const { entity_type, entity_id, status } = req.query;
    const where = []; const params = {};
    if (entity_type) { where.push('entity_type = :et');  params.et  = entity_type; }
    if (entity_id)   { where.push('entity_id = :eid');   params.eid = entity_id; }
    if (status)      { where.push('status = :s');         params.s   = status; }
    const [rows] = await db.query(
      `SELECT * FROM cw_sync_log ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
        ORDER BY created_at DESC LIMIT 200`, params);
    res.json(rows);
  } catch (err) { next(err); }
});

// -------- Single-contact search + import --------

// GET /api/connectwise/contacts/search?q=...
router.get('/contacts/search', async (req, res, next) => {
  try {
    const q = (req.query.q || '').trim();
    if (!q) return res.json([]);
    const results = await searchCwContacts(q);
    res.json(results);
  } catch (err) { next(err); }
});

// POST /api/connectwise/contacts/import  { cwContactId }
router.post('/contacts/import', async (req, res, next) => {
  try {
    const { cwContactId } = req.body;
    if (!cwContactId) return res.status(400).json({ error: 'cwContactId required' });
    const result = await importCwContact(Number(cwContactId));
    res.json({ ok: true, ...result });
  } catch (err) { next(err); }
});

// -------- Inbound import: pull all CW Companies + Contacts into CRM --------

// POST /api/connectwise/import — kick off async import, returns run id immediately
router.post('/import', requirePermission('settings.manage'), async (_req, res, next) => {
  try {
    const [result] = await db.query(
      `INSERT INTO cw_import_run (status) VALUES ('running')`
    );
    const runId = result.insertId;

    // Run async so the HTTP response returns immediately
    importFromConnectWise(runId)
      .then(async (stats) => {
        await db.query(
          `UPDATE cw_import_run SET status='completed', finished_at=NOW(),
             orgs_created=:oc, orgs_updated=:ou, contacts_created=:cc, contacts_updated=:cu
           WHERE id=:id`,
          { oc: stats.orgs_created, ou: stats.orgs_updated,
            cc: stats.contacts_created, cu: stats.contacts_updated, id: runId }
        );
      })
      .catch(async (err) => {
        await db.query(
          `UPDATE cw_import_run SET status='failed', finished_at=NOW(), error=:e WHERE id=:id`,
          { e: err.message?.slice(0, 999), id: runId }
        );
      });

    res.json({ ok: true, runId });
  } catch (err) { next(err); }
});

// GET /api/connectwise/import/:runId — poll status of an import run
router.get('/import/:runId', requirePermission('settings.manage'), async (req, res, next) => {
  try {
    const [rows] = await db.query(
      'SELECT * FROM cw_import_run WHERE id = :id',
      { id: req.params.runId }
    );
    if (!rows[0]) return res.status(404).json({ error: 'Run not found' });
    res.json(rows[0]);
  } catch (err) { next(err); }
});

// GET /api/connectwise/import-history — last 10 runs
router.get('/import-history', requirePermission('settings.manage'), async (_req, res, next) => {
  try {
    const [rows] = await db.query(
      'SELECT * FROM cw_import_run ORDER BY id DESC LIMIT 10'
    );
    res.json(rows);
  } catch (err) { next(err); }
});

// -------- Inbound webhook (for future CW -> localCRM events) --------
router.post('/webhook', async (req, res, next) => {
  try {
    await db.query(
      `INSERT INTO cw_sync_log (entity_type, entity_id, direction, action, request_json, status)
       VALUES ('deal', 0, 'inbound', 'webhook_in', CAST(:body AS JSON), 'success')`,
      { body: JSON.stringify(req.body || {}) }
    );
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;
