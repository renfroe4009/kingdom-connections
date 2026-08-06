'use strict';
// =============================================================================
// /api/ai — AI assistant chat + knowledge base CRUD
// =============================================================================

const router = require('express').Router();
const { z }  = require('zod');
const { db } = require('../db');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { streamChat, loadKnowledge, getSettings } = require('../services/ai');

router.use(requireAuth);

// ── POST /api/ai/chat ─────────────────────────────────────────────────────────
// Body: { messages: [{role, content}], module?: string }
// Returns an SSE stream of { text } chunks, ending with [DONE].
router.post('/chat', async (req, res, next) => {
  try {
    const { messages, module } = req.body;
    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'messages array required' });
    }
    const [[biz]] = await db.query('SELECT business_name FROM business_settings LIMIT 1').catch(() => [[null]]);
    await streamChat(res, messages, module || null, biz?.business_name || 'LIT-CRM', req.user.id);
  } catch (err) {
    if (!res.headersSent) return next(err);
    res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
    res.end();
  }
});

// ── GET /api/ai/kb ────────────────────────────────────────────────────────────
router.get('/kb', requirePermission('settings.manage'), async (_req, res, next) => {
  try {
    const articles = await loadKnowledge(null);
    res.json(articles);
  } catch (err) { next(err); }
});

// ── GET /api/ai/kb/all ────────────────────────────────────────────────────────
// Returns all articles (including inactive) for the admin UI.
router.get('/kb/all', requirePermission('settings.manage'), async (_req, res, next) => {
  try {
    const [rows] = await db.query(
      `SELECT * FROM ai_knowledge_base ORDER BY module, sort_order, id`,
    );
    res.json(rows);
  } catch (err) { next(err); }
});

const articleSchema = z.object({
  module:     z.string().min(1).max(100),
  title:      z.string().min(1).max(255),
  content:    z.string().min(1),
  sort_order: z.number().int().optional().default(0),
  active:     z.boolean().optional().default(true),
});

// ── POST /api/ai/kb ───────────────────────────────────────────────────────────
router.post('/kb', requirePermission('settings.manage'), async (req, res, next) => {
  try {
    const d = articleSchema.parse(req.body);
    const [result] = await db.query(
      `INSERT INTO ai_knowledge_base (module, title, content, sort_order, active)
       VALUES (:module, :title, :content, :sort_order, :active)`,
      { ...d, active: d.active ? 1 : 0 },
    );
    res.json({ ok: true, id: result.insertId });
  } catch (err) { next(err); }
});

// ── PUT /api/ai/kb/:id ────────────────────────────────────────────────────────
router.put('/kb/:id', requirePermission('settings.manage'), async (req, res, next) => {
  try {
    const d = articleSchema.partial().parse(req.body);
    const sets = Object.keys(d).map((k) => `${k} = :${k}`).join(', ');
    if (!sets) return res.status(400).json({ error: 'Nothing to update' });
    if ('active' in d) d.active = d.active ? 1 : 0;
    await db.query(
      `UPDATE ai_knowledge_base SET ${sets} WHERE id = :id`,
      { ...d, id: req.params.id },
    );
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ── DELETE /api/ai/kb/:id ─────────────────────────────────────────────────────
router.delete('/kb/:id', requirePermission('settings.manage'), async (req, res, next) => {
  try {
    await db.query('DELETE FROM ai_knowledge_base WHERE id = :id', { id: req.params.id });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ── GET /api/ai/status ────────────────────────────────────────────────────────
router.get('/status', async (_req, res) => {
  try {
    const s = await getSettings();
    const available = !!(s?.active && s?.api_key) || !!process.env.ANTHROPIC_API_KEY;
    res.json({ available });
  } catch { res.json({ available: false }); }
});

// ── GET /api/ai/settings ──────────────────────────────────────────────────────
router.get('/settings', requirePermission('settings.manage'), async (_req, res, next) => {
  try {
    const s = await getSettings();
    res.json(s ? { ...s, api_key: s.api_key ? '••••••••' : '' } : null);
  } catch (err) { next(err); }
});

const settingsSchema = z.object({
  api_key: z.string().optional(),
  model:   z.string().optional(),
  active:  z.boolean().optional(),
});

// ── PUT /api/ai/settings ──────────────────────────────────────────────────────
router.put('/settings', requirePermission('settings.manage'), async (req, res, next) => {
  try {
    const d = settingsSchema.parse(req.body);
    const existing = await getSettings();

    // Preserve key if the masked placeholder is sent back
    const api_key = (d.api_key && d.api_key !== '••••••••')
      ? d.api_key
      : existing?.api_key ?? null;

    const payload = {
      api_key,
      model:  d.model  ?? existing?.model  ?? 'claude-haiku-4-5-20251001',
      active: (d.active === false || d.active === 0) ? 0 : 1,
    };

    if (existing) {
      await db.query(
        'UPDATE ai_settings SET api_key=:api_key, model=:model, active=:active WHERE id=:id',
        { ...payload, id: existing.id },
      );
    } else {
      await db.query(
        'INSERT INTO ai_settings (api_key, model, active) VALUES (:api_key, :model, :active)',
        payload,
      );
    }
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ── POST /api/ai/test ─────────────────────────────────────────────────────────
router.post('/test', requirePermission('settings.manage'), async (_req, res, next) => {
  try {
    const { streamChat: _s, ...rest } = require('../services/ai');
    const { getSettings: gs } = require('../services/ai');
    const s = await gs();
    const Anthropic = require('@anthropic-ai/sdk');
    const key = (s?.active && s?.api_key) || process.env.ANTHROPIC_API_KEY;
    if (!key) return res.status(400).json({ ok: false, error: 'No API key configured.' });
    const client = new Anthropic({ apiKey: key });
    const msg = await client.messages.create({
      model:      s?.model || 'claude-haiku-4-5-20251001',
      max_tokens: 32,
      messages:   [{ role: 'user', content: 'Reply with just: OK' }],
    });
    res.json({ ok: true, reply: msg.content?.[0]?.text || 'OK' });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

module.exports = router;
