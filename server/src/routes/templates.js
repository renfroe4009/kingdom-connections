// =============================================================================
// /api/templates — message templates (email + SMS)
// -----------------------------------------------------------------------------
// CRUD + a /preview endpoint that renders a template against a CRM context so
// the admin can sanity-check merge fields before saving.
// =============================================================================
const router = require('express').Router();
const { z } = require('zod');
const { db } = require('../db');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { render, buildContext, renderBySlug, MERGE_FIELDS } = require('../services/templates');

router.use(requireAuth);

router.get('/merge-fields', (_req, res) => {
  // Used by the template editor's picker so we don't hardcode the list in JS.
  res.json(MERGE_FIELDS);
});

/**
 * Distinct categories already in use — fed to the editor's datalist so the
 * "Category" field auto-suggests existing buckets while still allowing the
 * user to type a new one. Cheap (indexed scan, ~30 rows max in practice).
 *
 * Declared before /:id so "categories" isn't caught as a numeric-id route.
 */
router.get('/categories', async (_req, res, next) => {
  try {
    const [rows] = await db.query(
      `SELECT DISTINCT category
         FROM message_templates
        WHERE category IS NOT NULL AND category <> ''
        ORDER BY category`
    );
    res.json(rows.map((r) => r.category));
  } catch (err) { next(err); }
});

router.get('/', async (req, res, next) => {
  try {
    const where = []; const params = {};
    if (req.query.channel)  { where.push('channel = :channel'); params.channel = req.query.channel; }
    if (req.query.active === '1') where.push('is_active = 1');
    const [rows] = await db.query(
      `SELECT id, channel, name, slug, category, subject, body, merge_fields,
              is_active, is_system, created_by, created_at, updated_at
         FROM message_templates
        ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
        ORDER BY channel, category, name`,
      params,
    );
    res.json(rows);
  } catch (err) { next(err); }
});

// GET by slug — used by server-side rendering; also handy for the UI
router.get('/by-slug/:slug', async (req, res, next) => {
  try {
    const [[row]] = await db.query(
      `SELECT * FROM message_templates WHERE slug = :slug`,
      { slug: req.params.slug },
    );
    if (!row) return res.status(404).json({ error: 'Template not found' });
    res.json(row);
  } catch (err) { next(err); }
});

router.get('/:id', async (req, res, next) => {
  try {
    // Guard against slug-style paths being caught here
    if (isNaN(Number(req.params.id))) return res.status(400).json({ error: 'Invalid id' });
    const [[row]] = await db.query(
      `SELECT * FROM message_templates WHERE id = :id`,
      { id: req.params.id },
    );
    if (!row) return res.status(404).json({ error: 'Template not found' });
    res.json(row);
  } catch (err) { next(err); }
});

const saveSchema = z.object({
  channel:      z.enum(['email', 'sms']),
  name:         z.string().min(1).max(150),
  slug:         z.string().max(100).optional().nullable(),
  category:     z.string().max(80).optional().nullable(),
  // Subject only meaningful for email; we accept it for SMS but store NULL.
  subject:      z.string().max(500).optional().nullable(),
  body:         z.string().min(1),
  merge_fields: z.string().max(1000).optional().nullable(),
  is_active:    z.boolean().optional(),
});

router.post('/', requirePermission('comms.templates.manage'), async (req, res, next) => {
  try {
    const d = saveSchema.parse(req.body);
    const [ins] = await db.query(
      `INSERT INTO message_templates
        (channel, name, slug, category, subject, body, merge_fields, is_active, created_by)
       VALUES
        (:channel, :name, :slug, :category, :subject, :body, :merge_fields, :is_active, :created_by)`,
      {
        channel:  d.channel,
        name:     d.name,
        slug:     d.slug || null,
        category: d.category || null,
        subject:  d.channel === 'email' ? (d.subject || null) : null,
        body:     d.body,
        merge_fields: d.merge_fields || null,
        is_active: d.is_active === false ? 0 : 1,
        created_by: req.user.id,
      },
    );
    res.status(201).json({ id: ins.insertId });
  } catch (err) { next(err); }
});

router.put('/:id', requirePermission('comms.templates.manage'), async (req, res, next) => {
  try {
    const [[existing]] = await db.query(
      'SELECT is_system FROM message_templates WHERE id = :id', { id: req.params.id });
    if (!existing) return res.status(404).json({ error: 'Template not found' });

    const d = saveSchema.parse(req.body);

    if (existing.is_system) {
      // System templates: only subject, body, and is_active are editable
      await db.query(
        `UPDATE message_templates SET
           subject   = :subject,
           body      = :body,
           is_active = :is_active
         WHERE id = :id`,
        {
          id:        req.params.id,
          subject:   d.subject || null,
          body:      d.body,
          is_active: d.is_active === false ? 0 : 1,
        },
      );
    } else {
      await db.query(
        `UPDATE message_templates SET
           channel      = :channel,
           name         = :name,
           slug         = :slug,
           category     = :category,
           subject      = :subject,
           body         = :body,
           merge_fields = :merge_fields,
           is_active    = :is_active
         WHERE id = :id`,
        {
          id:        req.params.id,
          channel:   d.channel,
          name:      d.name,
          slug:      d.slug || null,
          category:  d.category || null,
          subject:   d.channel === 'email' ? (d.subject || null) : null,
          body:      d.body,
          merge_fields: d.merge_fields || null,
          is_active: d.is_active === false ? 0 : 1,
        },
      );
    }
    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.delete('/:id', requirePermission('comms.templates.manage'), async (req, res, next) => {
  try {
    const [[existing]] = await db.query(
      'SELECT is_system FROM message_templates WHERE id = :id', { id: req.params.id });
    if (!existing) return res.status(404).json({ error: 'Template not found' });
    if (existing.is_system) {
      return res.status(422).json({ error: 'System templates cannot be deleted. You may disable them instead.' });
    }
    await db.query('DELETE FROM message_templates WHERE id = :id', { id: req.params.id });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

const previewSchema = z.object({
  // Pass either an existing template id OR raw subject/body — the modal uses
  // raw (so users can preview unsaved drafts) and the inbox quick-reply uses id.
  template_id:     z.number().int().optional(),
  subject:         z.string().optional(),
  body:            z.string().optional(),
  contact_id:      z.number().int().optional(),
  organization_id: z.number().int().optional(),
  deal_id:         z.number().int().optional(),
});

router.post('/preview', async (req, res, next) => {
  try {
    const d = previewSchema.parse(req.body);
    let subject = d.subject || '';
    let body    = d.body    || '';
    if (d.template_id) {
      const [[t]] = await db.query(
        'SELECT subject, body FROM message_templates WHERE id = :id',
        { id: d.template_id },
      );
      if (!t) return res.status(404).json({ error: 'Template not found' });
      subject = t.subject || '';
      body    = t.body    || '';
    }
    const ctx = await buildContext({
      contact_id:      d.contact_id,
      organization_id: d.organization_id,
      deal_id:         d.deal_id,
      user_id:         req.user.id,
    });
    res.json({
      subject: render(subject, ctx),
      body:    render(body, ctx),
      context_keys: Object.keys(ctx),
    });
  } catch (err) { next(err); }
});

module.exports = router;
