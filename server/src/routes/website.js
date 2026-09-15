const express = require('express');
const { rateLimit } = require('express-rate-limit');
const { db } = require('../db');
const { requireAuth, requirePermission } = require('../middleware/auth');

const router = express.Router();

// Security remediation H-07 — 5 parallel LIKE-scan queries per request,
// unauthenticated, no limit at all before this — a cheap DoS lever.
const searchLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many search requests. Please slow down.' },
});

// ── Pages ──────────────────────────────────────────────────────────────────────

// GET /api/website/pages  (list)
router.get('/pages', requireAuth, async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT wp.id, wp.title, wp.slug, wp.status, wp.meta_title, wp.updated_at,
              u.first_name, u.last_name
       FROM website_pages wp
       LEFT JOIN users u ON u.id = wp.updated_by
       WHERE wp.status != 'archived'
       ORDER BY wp.title ASC`
    );
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/website/pages/by-slug/:slug  (public, no auth) — MUST come before /:id
router.get('/pages/by-slug/:slug', async (req, res) => {
  try {
    const { slug } = req.params;
    const [[page]] = await db.query(
      "SELECT id, title, slug, puck_data, meta_title, meta_desc, meta_keywords, og_image, custom_css FROM website_pages WHERE slug = :slug AND status = 'published'",
      { slug }
    );
    if (!page) return res.status(404).json({ error: 'Page not found' });
    if (page.puck_data && typeof page.puck_data === 'string') {
      try { page.puck_data = JSON.parse(page.puck_data); } catch {}
    }
    res.json(page);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/website/pages/:id  (single, for editor)
router.get('/pages/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const [[page]] = await db.query('SELECT * FROM website_pages WHERE id = :id', { id });
    if (!page) return res.status(404).json({ error: 'Not found' });
    // parse puck_data JSON if stored as string
    if (page.puck_data && typeof page.puck_data === 'string') {
      try { page.puck_data = JSON.parse(page.puck_data); } catch {}
    }
    res.json(page);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/website/pages  (create)
router.post('/pages', requireAuth, requirePermission('settings.manage'), async (req, res) => {
  try {
    const { title, slug, status = 'draft', puck_data = null, meta_title = '', meta_desc = '', meta_keywords = '', og_image = '', custom_css = '', custom_js = '' } = req.body;
    if (!title || !slug) return res.status(400).json({ error: 'title and slug required' });
    const [result] = await db.query(
      'INSERT INTO website_pages (title, slug, status, puck_data, meta_title, meta_desc, meta_keywords, og_image, custom_css, custom_js, created_by) VALUES (:title, :slug, :status, :puck_data, :meta_title, :meta_desc, :meta_keywords, :og_image, :custom_css, :custom_js, :created_by)',
      { title, slug, status, puck_data: puck_data ? JSON.stringify(puck_data) : null, meta_title, meta_desc, meta_keywords, og_image, custom_css, custom_js, created_by: req.user?.id || null }
    );
    res.status(201).json({ id: result.insertId });
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Slug already exists' });
    res.status(500).json({ error: e.message });
  }
});

// PUT /api/website/pages/:id  (update — also saves a version)
router.put('/pages/:id', requireAuth, requirePermission('settings.manage'), async (req, res) => {
  try {
    const { id } = req.params;
    const { title, slug, status, puck_data, meta_title, meta_desc, meta_keywords, og_image, custom_css, custom_js, snapshot_label } = req.body;

    const userId = req.user?.id || null;
    const userName = req.user ? `${req.user.first_name || ''} ${req.user.last_name || ''}`.trim() || req.user.email : null;

    // Snapshot current content as a version before overwriting
    if (puck_data) {
      const [[existing]] = await db.query('SELECT puck_data FROM website_pages WHERE id = :id', { id });
      if (existing?.puck_data) {
        await db.query(
          'INSERT INTO website_versions (page_id, puck_data, snapshot_label, created_by, user_name) VALUES (:page_id, :puck_data, :snapshot_label, :created_by, :user_name)',
          { page_id: id, puck_data: typeof existing.puck_data === 'string' ? existing.puck_data : JSON.stringify(existing.puck_data), snapshot_label: snapshot_label || null, created_by: userId, user_name: userName }
        );
      }
    }

    const fields = ['updated_by = :updated_by'];
    const params = { id, updated_by: userId };
    if (title !== undefined)      { fields.push('title = :title');           params.title = title; }
    if (slug !== undefined)       { fields.push('slug = :slug');             params.slug = slug; }
    if (status !== undefined)     { fields.push('status = :status');         params.status = status; }
    if (puck_data !== undefined)  { fields.push('puck_data = :puck_data');   params.puck_data = JSON.stringify(puck_data); }
    if (meta_title    !== undefined) { fields.push('meta_title = :meta_title');       params.meta_title    = meta_title; }
    if (meta_desc     !== undefined) { fields.push('meta_desc = :meta_desc');         params.meta_desc     = meta_desc; }
    if (meta_keywords !== undefined) { fields.push('meta_keywords = :meta_keywords'); params.meta_keywords = meta_keywords; }
    if (og_image      !== undefined) { fields.push('og_image = :og_image');           params.og_image      = og_image; }
    if (custom_css !== undefined) { fields.push('custom_css = :custom_css'); params.custom_css = custom_css; }
    if (custom_js !== undefined)  { fields.push('custom_js = :custom_js');   params.custom_js = custom_js; }

    await db.query(`UPDATE website_pages SET ${fields.join(', ')} WHERE id = :id`, params);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/website/pages/:id/clone
router.post('/pages/:id/clone', requireAuth, requirePermission('settings.manage'), async (req, res) => {
  try {
    const { id } = req.params;
    const [[src]] = await db.query('SELECT * FROM website_pages WHERE id = :id', { id });
    if (!src) return res.status(404).json({ error: 'Page not found' });

    let slug = `${src.slug}-copy`;
    const [[dup]] = await db.query('SELECT id FROM website_pages WHERE slug = :slug', { slug });
    if (dup) slug = `${src.slug}-copy-${Date.now().toString().slice(-5)}`;

    const [result] = await db.query(
      'INSERT INTO website_pages (title, slug, status, puck_data, meta_title, meta_desc, og_image, custom_css, custom_js, created_by) VALUES (:title, :slug, :status, :puck_data, :meta_title, :meta_desc, :og_image, :custom_css, :custom_js, :created_by)',
      { title: `${src.title} (Copy)`, slug, status: 'draft', puck_data: src.puck_data,
        meta_title: src.meta_title || '', meta_desc: src.meta_desc || '',
        og_image: src.og_image || '', custom_css: src.custom_css || '',
        custom_js: src.custom_js || '', created_by: req.user?.id || null }
    );
    res.status(201).json({ id: result.insertId, slug });
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Slug already exists' });
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/website/pages/:id
router.delete('/pages/:id', requireAuth, requirePermission('settings.manage'), async (req, res) => {
  try {
    const { id } = req.params;
    await db.query('DELETE FROM website_pages WHERE id = :id', { id });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Versions ───────────────────────────────────────────────────────────────────

// GET /api/website/pages/:id/versions
router.get('/pages/:id/versions', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const [rows] = await db.query(
      'SELECT id, page_id, snapshot_label, created_by, user_name, created_at FROM website_versions WHERE page_id = :id ORDER BY created_at DESC LIMIT 30',
      { id }
    );
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/website/versions/:vid  (get one version's full data for restore)
router.get('/versions/:vid', requireAuth, async (req, res) => {
  try {
    const { vid } = req.params;
    const [[ver]] = await db.query('SELECT * FROM website_versions WHERE id = :vid', { vid });
    if (!ver) return res.status(404).json({ error: 'Version not found' });
    if (ver.puck_data && typeof ver.puck_data === 'string') {
      try { ver.puck_data = JSON.parse(ver.puck_data); } catch {}
    }
    res.json(ver);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/website/versions/:vid/restore  (restore a version)
router.post('/versions/:vid/restore', requireAuth, requirePermission('settings.manage'), async (req, res) => {
  try {
    const { vid } = req.params;
    const [[ver]] = await db.query('SELECT * FROM website_versions WHERE id = :vid', { vid });
    if (!ver) return res.status(404).json({ error: 'Version not found' });

    // Snapshot the current content first, so a restore can itself be undone.
    const [[current]] = await db.query('SELECT puck_data FROM website_pages WHERE id = :id', { id: ver.page_id });
    if (current?.puck_data) {
      const userName = req.user ? `${req.user.first_name || ''} ${req.user.last_name || ''}`.trim() || req.user.email : null;
      const restoredLabel = ver.snapshot_label || `version #${ver.id}`;
      await db.query(
        'INSERT INTO website_versions (page_id, puck_data, snapshot_label, created_by, user_name) VALUES (:page_id, :puck_data, :snapshot_label, :created_by, :user_name)',
        {
          page_id: ver.page_id,
          puck_data: typeof current.puck_data === 'string' ? current.puck_data : JSON.stringify(current.puck_data),
          snapshot_label: `Before restoring "${restoredLabel}"`.slice(0, 255),
          created_by: req.user?.id || null,
          user_name: userName,
        }
      );
    }

    await db.query(
      'UPDATE website_pages SET puck_data = :puck_data WHERE id = :id',
      { puck_data: typeof ver.puck_data === 'string' ? ver.puck_data : JSON.stringify(ver.puck_data), id: ver.page_id }
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Global Settings ────────────────────────────────────────────────────────────

// GET /api/website/public-settings — unauthenticated, for the live public site.
// Merges business_settings (company identity, already configured) with any
// website_global_settings overrides an admin has made via the site editor.
// Every row in website_global_settings is passed through verbatim, so a key
// the frontend theme layer adds later needs no change here. The explicit
// entries below only supply fallbacks for identity fields that can come from
// business_settings. Fallbacks are deliberately neutral — a hardcoded brand
// here silently becomes another client's site.
router.get('/public-settings', async (req, res) => {
  try {
    const [[biz]] = await db.query(
      `SELECT business_name, address, city, state, zip, phone, email, website,
              primary_color, secondary_color, logo_web_url
         FROM business_settings WHERE id = 1`
    );
    const [rows] = await db.query('SELECT setting_key, setting_value FROM website_global_settings');
    const JSON_FIELDS = new Set([
      'header_nav_links', 'header_cta_buttons',
      'footer_col2_links', 'footer_col3_links', 'footer_col4_links',
      'footer_cta_buttons', 'footer_legal_links',
    ]);
    const overrides = {};
    rows.forEach((r) => {
      if (JSON_FIELDS.has(r.setting_key)) {
        try { overrides[r.setting_key] = JSON.parse(r.setting_value); } catch { /* skip invalid JSON */ }
      } else {
        overrides[r.setting_key] = r.setting_value;
      }
    });

    const bizAddress = [biz?.address, [biz?.city, biz?.state, biz?.zip].filter(Boolean).join(', ')]
      .filter(Boolean).join('\n');

    // An unset setting is stored as '' rather than removed, so spreading the
    // raw rows would blank out the business_settings fallbacks below. Drop
    // empties instead — clearing a field in the admin falls back, as before.
    const set = Object.fromEntries(
      Object.entries(overrides).filter(([, v]) => v !== '' && v != null)
    );

    res.json({
      // Identity — business_settings is the fallback source for these.
      site_name:       biz?.business_name ?? '',
      header_logo_url: biz?.logo_web_url  ?? '',
      header_address:  bizAddress,
      header_phone:    biz?.phone ?? '',
      header_email:    biz?.email ?? '',
      header_website:  biz?.website ? `https://${biz.website.replace(/^https?:\/\//, '')}` : '',
      primary_color:   biz?.primary_color   ?? '',
      secondary_color: biz?.secondary_color ?? '',

      // Collections default to empty so the layout renders nothing rather than
      // placeholder links that 404.
      header_nav_links: [],
      header_cta_buttons: [],
      footer_col2_links: [],
      footer_col3_links: [],
      footer_col4_links: [],
      footer_cta_buttons: [],

      // Admin-configured values win over every default above. This spread is
      // what carries site_custom_css / site_custom_js — without it the
      // imported design's stylesheet never reaches the public page.
      ...set,
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/website/settings
router.get('/settings', requireAuth, async (req, res) => {
  try {
    const [rows] = await db.query('SELECT setting_key, setting_value FROM website_global_settings');
    const settings = {};
    rows.forEach(r => { settings[r.setting_key] = r.setting_value; });
    res.json(settings);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PUT /api/website/settings  (body: { key: value, ... })
router.put('/settings', requireAuth, requirePermission('settings.manage'), async (req, res) => {
  try {
    const entries = Object.entries(req.body);
    for (const [key, value] of entries) {
      await db.query(
        'INSERT INTO website_global_settings (setting_key, setting_value) VALUES (:key, :value) ON DUPLICATE KEY UPDATE setting_value = :value',
        { key, value }
      );
    }
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/website/search?q=term  — searches all public content types
router.get('/search', searchLimiter, async (req, res) => {
  try {
    const { q = '' } = req.query;
    if (!q.trim()) return res.json([]);
    const term = `%${q.trim()}%`;

    // Some sources below belong to verticals a given install may not have
    // (the Panther builders' manual, for one). Under Promise.all a single
    // missing table rejects the whole batch and search returns 500 site-wide —
    // so an absent optional table degrades to "no results from that source"
    // instead. Only ER_NO_SUCH_TABLE is swallowed; real SQL errors still throw.
    const optional = (promise) => promise.catch((err) => {
      if (err?.code === 'ER_NO_SUCH_TABLE') return [];
      throw err;
    });

    const [pages, products, completions, kbArticles, blogPosts] = await Promise.all([
      // CMS pages
      db.query(
        `SELECT id, title, slug, meta_desc, 'page' AS result_type
         FROM website_pages
         WHERE status = 'published'
           AND (title LIKE :term OR meta_desc LIKE :term OR meta_title LIKE :term)
         LIMIT 10`,
        { term }
      ).then(([r]) => r),

      // Shop products
      db.query(
        `SELECT id, name AS title, CONCAT('shop/', slug) AS slug,
                short_desc AS meta_desc, 'product' AS result_type
         FROM products
         WHERE is_active = 1
           AND (name LIKE :term OR short_desc LIKE :term OR description LIKE :term)
         LIMIT 10`,
        { term }
      ).then(([r]) => r),

      // Panther builder completions
      optional(db.query(
        `SELECT id, CONCAT(builder_name, ' — ', COALESCE(title, aircraft)) AS title,
                'panther/completions' AS slug,
                CONCAT(COALESCE(aircraft,''), IF(home_base IS NOT NULL, CONCAT(' · ', home_base), '')) AS meta_desc,
                'builder' AS result_type
         FROM panther_completions
         WHERE builder_name LIKE :term OR title LIKE :term OR aircraft LIKE :term OR home_base LIKE :term
         LIMIT 5`,
        { term }
      ).then(([r]) => r)),

      // KB / Builders Manual articles
      optional(db.query(
        `SELECT id, title, CONCAT('builders-manual?article=', id) AS slug,
                LEFT(body_text, 160) AS meta_desc, 'kb' AS result_type
         FROM kb_articles
         WHERE is_published = 1
           AND (title LIKE :term OR body_text LIKE :term)
         LIMIT 10`,
        { term }
      ).then(([r]) => r)),

      // Blog posts
      db.query(
        `SELECT id, title, CONCAT('blog/', slug) AS slug,
                COALESCE(excerpt, meta_desc) AS meta_desc, 'blog' AS result_type
         FROM blog_posts
         WHERE status = 'published'
           AND (title LIKE :term OR excerpt LIKE :term OR meta_desc LIKE :term)
         LIMIT 5`,
        { term }
      ).then(([r]) => r),
    ]);

    res.json([...pages, ...products, ...completions, ...kbArticles, ...blogPosts]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Saved components (user-created presets) ──────────────────────────────────

router.get('/saved-components', requireAuth, async (req, res, next) => {
  try {
    const [rows] = await db.query(
      `SELECT sc.id, sc.label, sc.component_type, sc.props_json, sc.created_by, sc.created_at,
              CONCAT(u.first_name, ' ', u.last_name) AS created_by_name
       FROM saved_components sc
       LEFT JOIN users u ON u.id = sc.created_by
       WHERE sc.is_shared = 1
       ORDER BY sc.created_at DESC`
    );
    res.json(rows);
  } catch (e) { next(e); }
});

router.post('/saved-components', requireAuth, async (req, res, next) => {
  try {
    const { label, component_type, props_json } = req.body;
    if (!label?.trim() || !component_type) return res.status(400).json({ error: 'label and component_type required' });
    const [r] = await db.query(
      'INSERT INTO saved_components (label, component_type, props_json, created_by) VALUES (?, ?, ?, ?)',
      [label.trim(), component_type, JSON.stringify(props_json || {}), req.user.id]
    );
    res.status(201).json({ id: r.insertId });
  } catch (e) { next(e); }
});

router.delete('/saved-components/:id', requireAuth, async (req, res, next) => {
  try {
    await db.query('DELETE FROM saved_components WHERE id = ?', [Number(req.params.id)]);
    res.json({ deleted: 1 });
  } catch (e) { next(e); }
});

module.exports = router;
