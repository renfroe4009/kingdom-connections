// =============================================================================
// /api/seo — SEO settings stored as JSON file + robots.txt / sitemap-index
// =============================================================================
const path   = require('path');
const fs     = require('fs');
const router = require('express').Router();
const { requireAuth, requirePermission } = require('../middleware/auth');

const DATA_FILE = path.resolve(__dirname, '../../data/seo-settings.json');

const DEFAULTS = {
  site_url: '',
  preferred_domain: 'apex',
  primary_zone_id: '',
  clarity_project_id: '',
  ga4_measurement_id: '',
  google_search_console_verification: '',
  gsc_property: '',
  gsc_service_account_json: '',
  default_og_image: '',
  robots_txt: [
    '# Allow all crawlers including AI bots',
    'User-agent: *',
    'Allow: /',
    '',
    '# AI search crawlers — explicitly welcomed',
    'User-agent: GPTBot',
    'Allow: /',
    '',
    'User-agent: Claude-Web',
    'Allow: /',
    '',
    'User-agent: Google-Extended',
    'Allow: /',
    '',
    'User-agent: PerplexityBot',
    'Allow: /',
    '',
    'User-agent: Diffbot',
    'Allow: /',
    '',
    'User-agent: Bytespider',
    'Allow: /',
    '',
    'Sitemap: https://SITE_URL/sitemap.xml',
  ].join('\n'),
  head_scripts: '',
  body_scripts: '',
  // One-paragraph summary served as the blockquote in /llms.txt — what AI
  // search engines read to learn who this organisation is. Blank falls back
  // to the site's own footer blurb / home page description (see /llms.txt).
  llms_description: '',
};

function readSettings() {
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch (_) {
    return { ...DEFAULTS };
  }
}

function writeSettings(data) {
  const dir = path.dirname(DATA_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
}

// ---------------------------------------------------------------------------
// Public — no auth required
// ---------------------------------------------------------------------------

// GET /api/seo/robots.txt
router.get('/robots.txt', (_req, res) => {
  const s       = readSettings();
  const siteUrl = s.site_url ? `https://${s.preferred_domain === 'www' ? 'www.' : ''}${s.site_url}` : '';
  let   txt     = s.robots_txt || 'User-agent: *\nAllow: /\n';
  if (siteUrl) txt = txt.replace('https://SITE_URL', siteUrl);
  res.setHeader('Content-Type', 'text/plain');
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.send(txt);
});

// GET /api/seo/sitemap-index.xml
router.get('/sitemap-index.xml', (req, res) => {
  const s    = readSettings();
  const base = s.site_url
    ? `https://${s.preferred_domain === 'www' ? 'www.' : ''}${s.site_url}`
    : `${req.protocol}://${req.get('host')}`;
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <sitemap>
    <loc>${base}/sitemap.xml</loc>
    <lastmod>${new Date().toISOString().slice(0, 10)}</lastmod>
  </sitemap>
</sitemapindex>`;
  res.setHeader('Content-Type', 'application/xml');
  res.send(xml);
});

// GET /api/seo/llms.txt — machine-readable site description for AI crawlers
// See: https://llmstxt.org
//
// Every line is derived from this install's own data. It must never carry a
// hardcoded organisation name or description: this file is how AI search
// engines learn who the site belongs to, and a hardcoded fallback previously
// served a former client's name, mission and federal tax ID here on a
// different client's domain. If nothing is configured, say less, not
// something borrowed.
router.get('/llms.txt', async (_req, res) => {
  const s = readSettings();
  const { db } = require('../db');

  // Identity comes from Business Settings; the description from the SEO
  // setting, then the site's own footer blurb, then the home page's meta
  // description — the first one an admin has actually filled in.
  let orgName = '';
  let description = String(s.llms_description || '').trim();
  let fallbackSiteUrl = '';
  try {
    const [[biz]] = await db.query('SELECT business_name, website FROM business_settings WHERE id = 1');
    orgName = String(biz?.business_name || '').trim();
    fallbackSiteUrl = String(biz?.website || '').trim().replace(/\/+$/, '');
    if (fallbackSiteUrl && !/^https?:\/\//i.test(fallbackSiteUrl)) fallbackSiteUrl = `https://${fallbackSiteUrl}`;
    if (!description) {
      const [[blurb]] = await db.query(
        "SELECT setting_value FROM website_global_settings WHERE setting_key = 'footer_blurb'"
      );
      description = String(blurb?.setting_value || '').trim();
    }
    if (!description) {
      const [[home]] = await db.query(
        "SELECT meta_desc FROM website_pages WHERE slug = 'home' AND status = 'published' LIMIT 1"
      );
      description = String(home?.meta_desc || '').trim();
    }
  } catch (_) { /* serve whatever resolved — never a hardcoded identity */ }

  const siteUrl = s.site_url
    ? `https://${s.preferred_domain === 'www' ? 'www.' : ''}${s.site_url}`
    : fallbackSiteUrl;

  // Dynamically pull published pages from DB for the links section
  let pageLinks = '';
  try {
    const [pages] = await db.query(
      "SELECT title, slug, meta_desc FROM website_pages WHERE status = 'published' ORDER BY title ASC LIMIT 30"
    );
    const [posts] = await db.query(
      "SELECT title, slug, meta_desc FROM blog_posts WHERE status = 'published' ORDER BY published_at DESC LIMIT 10"
    );
    if (siteUrl) {
      if (pages.length) {
        pageLinks += '\n## Pages\n';
        pageLinks += pages.map((p) =>
          `- [${p.title}](${siteUrl}/${p.slug})${p.meta_desc ? ': ' + p.meta_desc : ''}`
        ).join('\n');
      }
      if (posts.length) {
        pageLinks += '\n\n## Blog\n';
        pageLinks += posts.map((p) =>
          `- [${p.title}](${siteUrl}/blog/${p.slug})${p.meta_desc ? ': ' + p.meta_desc : ''}`
        ).join('\n');
      }
    }
  } catch (_) {}

  // The llmstxt.org format requires an H1; with no configured name, the site's
  // own host is the only truthful identity available.
  const heading = orgName || siteUrl.replace(/^https?:\/\//i, '') || 'Website';

  const txt = [
    `# ${heading}`,
    description ? `\n> ${description.replace(/\s*\n\s*/g, ' ')}` : '',
    siteUrl ? `\n## Website\n${siteUrl}` : '',
    siteUrl ? `\n## Sitemap\n${siteUrl}/sitemap.xml` : '',
    pageLinks,
  ].filter(Boolean).join('\n');

  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.send(txt);
});

// GET /api/seo/public — public injection endpoint (no auth)
// Returns only the fields needed by PublicLayout to inject tags/scripts.
router.get('/public', (_req, res) => {
  const s = readSettings();
  res.json({
    site_url:                           s.site_url                           || '',
    preferred_domain:                   s.preferred_domain                   || 'apex',
    google_search_console_verification: s.google_search_console_verification || '',
    ga4_measurement_id:                 s.ga4_measurement_id                 || '',
    clarity_project_id:                 s.clarity_project_id                 || '',
    head_scripts:                       s.head_scripts                       || '',
    body_scripts:                       s.body_scripts                       || '',
  });
});

// ---------------------------------------------------------------------------
// Authenticated routes
// ---------------------------------------------------------------------------
router.use(requireAuth);

// GET /api/seo/settings — also used by the Clarity injector (no permission gate
// so the frontend loader can call it even for non-admin sessions)
router.get('/settings', (_req, res) => {
  res.json(readSettings());
});

// PUT /api/seo/settings
router.put('/settings', requirePermission('settings.manage'), (req, res) => {
  const current = readSettings();
  const allowed = [
    'site_url',
    'preferred_domain',
    'primary_zone_id',
    'clarity_project_id',
    'ga4_measurement_id',
    'google_search_console_verification',
    'gsc_property',
    'gsc_service_account_json',
    'default_og_image',
    'robots_txt',
    'head_scripts',
    'body_scripts',
    'llms_description',
  ];
  const next = { ...current };
  allowed.forEach((k) => {
    if (req.body[k] !== undefined) next[k] = req.body[k];
  });
  writeSettings(next);
  res.json({ ok: true, settings: next });
});

module.exports = router;
module.exports.readSettings = readSettings;
