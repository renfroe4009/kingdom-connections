// =============================================================================
// CMS routes — pages, blog posts, sitemap
// Public read; write requires settings.manage permission
// =============================================================================
const express = require('express');
const { z } = require('zod');
const { db } = require('../db');
const { requireAuth, requirePermission } = require('../middleware/auth');

const router = express.Router();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function toSlug(str) {
  return str
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/[\s]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 490);
}

const pageSchema = z.object({
  title:      z.string().min(1),
  slug:       z.string().optional(),
  status:     z.enum(['draft', 'published']).optional(),
  body_json:  z.string().optional().nullable(),
  body_html:  z.string().optional().nullable(),
  meta_title: z.string().optional().nullable(),
  meta_desc:  z.string().optional().nullable(),
  og_image:   z.string().optional().nullable(),
});

const blogSchema = z.object({
  title:        z.string().min(1),
  slug:         z.string().optional(),
  status:       z.enum(['draft', 'published']).optional(),
  excerpt:      z.string().optional().nullable(),
  body_json:    z.string().optional().nullable(),
  body_html:    z.string().optional().nullable(),
  og_image:     z.string().optional().nullable(),
  meta_title:   z.string().optional().nullable(),
  meta_desc:    z.string().optional().nullable(),
  author_id:    z.number().int().positive().optional().nullable(),
  published_at: z.string().optional().nullable(),
});

// ---------------------------------------------------------------------------
// CMS Pages — public read, admin write
// IMPORTANT: specific sub-paths before /:id
// ---------------------------------------------------------------------------

// GET /api/cms/pages/by-slug/:slug
router.get('/pages/by-slug/:slug', async (req, res, next) => {
  try {
    const slug = req.params.slug;
    const [[page]] = await db.query(
      'SELECT * FROM cms_pages WHERE slug = :slug',
      { slug }
    );
    if (!page) return res.status(404).json({ error: 'Page not found' });
    res.json(page);
  } catch (err) { next(err); }
});

// GET /api/cms/pages
router.get('/pages', async (req, res, next) => {
  try {
    const [rows] = await db.query(
      'SELECT id, title, slug, status, updated_at FROM cms_pages ORDER BY updated_at DESC'
    );
    res.json(rows);
  } catch (err) { next(err); }
});

// GET /api/cms/pages/:id
router.get('/pages/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const [[page]] = await db.query('SELECT * FROM cms_pages WHERE id = :id', { id });
    if (!page) return res.status(404).json({ error: 'Page not found' });
    res.json(page);
  } catch (err) { next(err); }
});

// POST /api/cms/pages
router.post('/pages', requireAuth, requirePermission('settings.manage'), async (req, res, next) => {
  try {
    const body = pageSchema.parse(req.body);
    if (!body.slug) body.slug = toSlug(body.title);
    const [r] = await db.query(
      `INSERT INTO cms_pages (title, slug, status, body_json, body_html, meta_title, meta_desc, og_image)
       VALUES (:title, :slug, :status, :body_json, :body_html, :meta_title, :meta_desc, :og_image)`,
      {
        title:      body.title,
        slug:       body.slug,
        status:     body.status || 'draft',
        body_json:  body.body_json  ?? null,
        body_html:  body.body_html  ?? null,
        meta_title: body.meta_title ?? null,
        meta_desc:  body.meta_desc  ?? null,
        og_image:   body.og_image   ?? null,
      }
    );
    res.status(201).json({ id: r.insertId });
  } catch (err) { next(err); }
});

// PUT /api/cms/pages/:id
router.put('/pages/:id', requireAuth, requirePermission('settings.manage'), async (req, res, next) => {
  try {
    const id   = Number(req.params.id);
    const body = pageSchema.partial().parse(req.body);
    if (body.title && !body.slug) body.slug = toSlug(body.title);
    const fields = [];
    const params = { id };
    for (const [k, v] of Object.entries(body)) {
      fields.push(`${k} = :${k}`);
      params[k] = v ?? null;
    }
    if (!fields.length) return res.json({ updated: 0 });
    await db.query(`UPDATE cms_pages SET ${fields.join(', ')} WHERE id = :id`, params);
    res.json({ updated: 1 });
  } catch (err) { next(err); }
});

// DELETE /api/cms/pages/:id
router.delete('/pages/:id', requireAuth, requirePermission('settings.manage'), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    await db.query('DELETE FROM cms_pages WHERE id = :id', { id });
    res.json({ deleted: 1 });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// Blog Posts — public read, admin write
// IMPORTANT: specific sub-paths before /:id
// ---------------------------------------------------------------------------

// GET /api/cms/blog/by-slug/:slug
router.get('/blog/by-slug/:slug', async (req, res, next) => {
  try {
    const slug = req.params.slug;
    const [[post]] = await db.query(
      `SELECT b.*, TRIM(CONCAT(COALESCE(u.first_name,''), ' ', COALESCE(u.last_name,''))) AS author_name
       FROM blog_posts b
       LEFT JOIN users u ON u.id = b.author_id
       WHERE b.slug = :slug`,
      { slug }
    );
    if (!post) return res.status(404).json({ error: 'Post not found' });
    res.json(post);
  } catch (err) { next(err); }
});

// GET /api/cms/blog
router.get('/blog', async (req, res, next) => {
  try {
    const [rows] = await db.query(
      `SELECT b.id, b.title, b.slug, b.status, b.excerpt, b.og_image,
              b.published_at, b.created_at, b.updated_at,
              TRIM(CONCAT(COALESCE(u.first_name,''), ' ', COALESCE(u.last_name,''))) AS author_name
       FROM blog_posts b
       LEFT JOIN users u ON u.id = b.author_id
       ORDER BY b.updated_at DESC`
    );
    res.json(rows);
  } catch (err) { next(err); }
});

// GET /api/cms/blog/:id
router.get('/blog/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const [[post]] = await db.query(
      `SELECT b.*, TRIM(CONCAT(COALESCE(u.first_name,''), ' ', COALESCE(u.last_name,''))) AS author_name
       FROM blog_posts b
       LEFT JOIN users u ON u.id = b.author_id
       WHERE b.id = :id`,
      { id }
    );
    if (!post) return res.status(404).json({ error: 'Post not found' });
    res.json(post);
  } catch (err) { next(err); }
});

// POST /api/cms/blog
router.post('/blog', requireAuth, requirePermission('settings.manage'), async (req, res, next) => {
  try {
    const body = blogSchema.parse(req.body);
    if (!body.slug) body.slug = toSlug(body.title);
    const isPublished = body.status === 'published';
    const [r] = await db.query(
      `INSERT INTO blog_posts
         (title, slug, status, excerpt, body_json, body_html, og_image,
          meta_title, meta_desc, author_id, published_at)
       VALUES
         (:title, :slug, :status, :excerpt, :body_json, :body_html, :og_image,
          :meta_title, :meta_desc, :author_id, :published_at)`,
      {
        title:        body.title,
        slug:         body.slug,
        status:       body.status       || 'draft',
        excerpt:      body.excerpt      ?? null,
        body_json:    body.body_json    ?? null,
        body_html:    body.body_html    ?? null,
        og_image:     body.og_image     ?? null,
        meta_title:   body.meta_title   ?? null,
        meta_desc:    body.meta_desc    ?? null,
        author_id:    body.author_id    ?? null,
        published_at: body.published_at ?? (isPublished ? new Date().toISOString().slice(0, 19).replace('T', ' ') : null),
      }
    );
    res.status(201).json({ id: r.insertId });
  } catch (err) { next(err); }
});

// PUT /api/cms/blog/:id
router.put('/blog/:id', requireAuth, requirePermission('settings.manage'), async (req, res, next) => {
  try {
    const id   = Number(req.params.id);
    const body = blogSchema.partial().parse(req.body);
    if (body.title && !body.slug) body.slug = toSlug(body.title);

    // Auto-set published_at when status flips to published
    if (body.status === 'published') {
      const [[existing]] = await db.query(
        'SELECT published_at FROM blog_posts WHERE id = :id', { id }
      );
      if (existing && !existing.published_at) {
        body.published_at = new Date().toISOString().slice(0, 19).replace('T', ' ');
      }
    }

    const fields = [];
    const params = { id };
    for (const [k, v] of Object.entries(body)) {
      fields.push(`${k} = :${k}`);
      params[k] = v ?? null;
    }
    if (!fields.length) return res.json({ updated: 0 });
    await db.query(`UPDATE blog_posts SET ${fields.join(', ')} WHERE id = :id`, params);
    res.json({ updated: 1 });
  } catch (err) { next(err); }
});

// DELETE /api/cms/blog/:id
router.delete('/blog/:id', requireAuth, requirePermission('settings.manage'), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    await db.query('DELETE FROM blog_posts WHERE id = :id', { id });
    res.json({ deleted: 1 });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// Sitemap — GET /sitemap (mounted at /sitemap.xml via index.js)
// ---------------------------------------------------------------------------
router.get('/sitemap', async (req, res, next) => {
  try {
    const { readSettings } = require('./seo-settings');
    const s    = readSettings();
    const base = s.site_url
      ? `https://${s.preferred_domain === 'www' ? 'www.' : ''}${s.site_url}`
      : (process.env.SITE_URL || '');

    const [pages] = await db.query(
      "SELECT slug, updated_at FROM website_pages WHERE status = 'published' ORDER BY updated_at DESC"
    );
    const [posts] = await db.query(
      "SELECT slug, updated_at FROM blog_posts WHERE status = 'published' ORDER BY updated_at DESC"
    );

    const fmt = (d) => new Date(d).toISOString().split('T')[0];

    const urlEntries = [
      ...pages.map((p) => `  <url>\n    <loc>${base}/${p.slug === 'home' ? '' : p.slug}</loc>\n    <lastmod>${fmt(p.updated_at)}</lastmod>\n  </url>`),
      ...posts.map((p) => `  <url>\n    <loc>${base}/blog/${p.slug}</loc>\n    <lastmod>${fmt(p.updated_at)}</lastmod>\n  </url>`),
    ].join('\n');

    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urlEntries}\n</urlset>`;

    res.set('Content-Type', 'text/xml');
    res.send(xml);
  } catch (err) { next(err); }
});

module.exports = router;
