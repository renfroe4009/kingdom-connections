// =============================================================================
// /api/analytics — live analytics routes
// Traffic: Cloudflare Zone Analytics (GraphQL)
// SEO:     Google Search Console (service account JWT)
// Revenue: live from orders table
// =============================================================================
const router  = require('express').Router();
const jwt     = require('jsonwebtoken');
const { db }  = require('../db');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { readSettings } = require('./seo-settings');

router.use(requireAuth);
router.use(requirePermission('reports.view'));

// ---------------------------------------------------------------------------
// Cloudflare token — DB-first (cloudflare.account), env fallback
// ---------------------------------------------------------------------------
async function getCfToken() {
  try {
    const [[row]] = await db.query(
      "SELECT value_json FROM settings WHERE `key` = 'cloudflare.account' LIMIT 1",
    );
    if (row) {
      const val = JSON.parse(row.value_json);
      if (val?.api_token) return val.api_token;
    }
  } catch (_) {}
  return process.env.CF_API_TOKEN || null;
}

// ---------------------------------------------------------------------------
// GET /api/analytics/traffic — live Cloudflare Zone Analytics
// Zone ID priority: CF_ZONE_ID env → seo-settings.primary_zone_id → auto-discover
// ---------------------------------------------------------------------------
router.get('/traffic', async (req, res, next) => {
  try {
    const token  = await getCfToken();
    let   zoneId = process.env.CF_ZONE_ID;

    if (!token) {
      return res.json({ source: 'none', configured: false, message: 'No Cloudflare API token configured.' });
    }

    // Fall back to primary zone saved from DNS Manager
    if (!zoneId) {
      const settings = readSettings();
      zoneId = settings.primary_zone_id || '';
    }

    // Auto-discover zone ID from first active zone
    if (!zoneId) {
      const zonesRes  = await fetch('https://api.cloudflare.com/client/v4/zones?per_page=1&status=active', {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      const zonesBody = await zonesRes.json().catch(() => null);
      if (!zonesRes.ok || !zonesBody?.success) {
        const cfMsg = zonesBody?.errors?.[0]?.message || 'unknown error';
        return res.json({
          source: 'none', configured: false,
          message: `Cloudflare rejected the token: "${cfMsg}". Token needs Zone → Zone: Read AND Zone → Analytics: Read permissions. Or set CF_ZONE_ID in Railway.`,
        });
      }
      if (!zonesBody.result?.length) {
        return res.json({ source: 'none', configured: false, message: 'Token valid but no active zones found. Set CF_ZONE_ID in Railway.' });
      }
      zoneId = zonesBody.result[0].id;
    }

    const end   = new Date();
    const start = new Date();
    start.setDate(start.getDate() - 29);
    const fmt = (d) => d.toISOString().slice(0, 10);

    const query = `{
      viewer {
        zones(filter: { zoneTag: "${zoneId}" }) {
          httpRequests1dGroups(
            orderBy: [date_ASC]
            limit: 30
            filter: { date_geq: "${fmt(start)}", date_leq: "${fmt(end)}" }
          ) {
            dimensions { date }
            sum { requests pageViews bytes }
            uniq { uniques }
          }
        }
      }
    }`;

    const cfRes  = await fetch('https://api.cloudflare.com/client/v4/graphql', {
      method:  'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body:    JSON.stringify({ query }),
    });

    if (!cfRes.ok) {
      return res.status(502).json({ source: 'cloudflare', configured: false, error: 'Cloudflare GraphQL request failed — confirm token has Zone → Analytics: Read.' });
    }

    const body = await cfRes.json();
    if (body.errors?.length) {
      return res.status(502).json({ source: 'cloudflare', configured: false, error: body.errors[0].message });
    }

    const groups = body?.data?.viewer?.zones?.[0]?.httpRequests1dGroups || [];
    const days   = groups.map((g) => ({
      date:      g.dimensions.date,
      requests:  g.sum.requests,
      pageviews: g.sum.pageViews,
      uniques:   g.uniq.uniques,
      bytes:     g.sum.bytes,
    }));
    const totals = days.reduce(
      (acc, d) => ({ requests: acc.requests + d.requests, pageviews: acc.pageviews + d.pageviews, uniques: acc.uniques + d.uniques, bytes: acc.bytes + d.bytes }),
      { requests: 0, pageviews: 0, uniques: 0, bytes: 0 }
    );

    res.json({ source: 'cloudflare', configured: true, zoneId, days, totals });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// GET /api/analytics/search-console — live Google Search Console data
// Requires gsc_property + gsc_service_account_json in seo-settings
// ---------------------------------------------------------------------------
async function getGscToken(sa) {
  const now = Math.floor(Date.now() / 1000);
  const assertion = jwt.sign(
    {
      iss:   sa.client_email,
      sub:   sa.client_email,
      scope: 'https://www.googleapis.com/auth/webmasters.readonly',
      aud:   'https://oauth2.googleapis.com/token',
      iat:   now,
      exp:   now + 3600,
    },
    sa.private_key,
    { algorithm: 'RS256' }
  );
  const r    = await fetch('https://oauth2.googleapis.com/token', {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
  });
  const body = await r.json();
  if (!r.ok || !body.access_token) throw new Error(body.error_description || body.error || 'GSC token exchange failed');
  return body.access_token;
}

router.get('/search-console', async (req, res, next) => {
  try {
    const settings = readSettings();
    const saRaw    = settings.gsc_service_account_json;
    const property = settings.gsc_property;

    if (!saRaw || !property) {
      return res.json({ source: 'none', configured: false, message: 'Add GSC Property and Service Account JSON in SEO Settings.' });
    }

    let sa;
    try { sa = typeof saRaw === 'string' ? JSON.parse(saRaw) : saRaw; }
    catch (_) { return res.json({ source: 'none', configured: false, message: 'Invalid service account JSON — paste the full JSON file contents.' }); }

    let accessToken;
    try { accessToken = await getGscToken(sa); }
    catch (e) { return res.json({ source: 'none', configured: false, message: `GSC auth failed: ${e.message}` }); }

    const end   = new Date();
    const start = new Date();
    start.setDate(start.getDate() - 28); // GSC has ~3-day data lag
    const fmt = (d) => d.toISOString().slice(0, 10);

    const gscFetch = (body) => fetch(
      `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(property)}/searchAnalytics/query`,
      {
        method:  'POST',
        headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body:    JSON.stringify({ startDate: fmt(start), endDate: fmt(end), ...body }),
      }
    ).then((r) => r.json());

    const [summaryBody, queriesBody, dailyBody] = await Promise.all([
      gscFetch({ dimensions: [] }),
      gscFetch({ dimensions: ['query'],  rowLimit: 10 }),
      gscFetch({ dimensions: ['date'],   rowLimit: 28 }),
    ]);

    if (summaryBody.error) {
      return res.json({ source: 'none', configured: false, message: summaryBody.error.message || 'GSC API error' });
    }

    const summary = summaryBody.rows?.[0] || {};
    const queries = (queriesBody.rows || []).map((r) => ({
      query: r.keys[0], clicks: r.clicks, impressions: r.impressions,
      ctr: Number((r.ctr * 100).toFixed(1)), position: Number(r.position.toFixed(1)),
    }));
    const daily = (dailyBody.rows || []).map((r) => ({
      date: r.keys[0].slice(5), clicks: r.clicks, impressions: r.impressions,
    }));

    res.json({
      source:      'google-search-console',
      configured:  true,
      clicks:      summary.clicks      || 0,
      impressions: summary.impressions || 0,
      ctr:         Number(((summary.ctr || 0) * 100).toFixed(1)),
      position:    Number((summary.position || 0).toFixed(1)),
      queries,
      daily,
    });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// GET /api/analytics/revenue — live from orders table, last 12 months
// ---------------------------------------------------------------------------
router.get('/revenue', async (_req, res, next) => {
  try {
    const [rows] = await db.query(
      `SELECT
          DATE_FORMAT(created_at, '%b %Y') AS month_label,
          DATE_FORMAT(created_at, '%Y-%m') AS month_key,
          COALESCE(SUM(total), 0)          AS revenue,
          COUNT(*)                          AS orders
         FROM orders
        WHERE created_at >= DATE_SUB(NOW(), INTERVAL 12 MONTH)
          AND status NOT IN ('cancelled', 'refunded')
        GROUP BY month_key, month_label
        ORDER BY month_key ASC`
    );

    const monthMap = {};
    rows.forEach((r) => { monthMap[r.month_key] = r; });

    const result = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date();
      d.setDate(1);
      d.setMonth(d.getMonth() - i);
      const key   = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const label = d.toLocaleString('en-US', { month: 'short' });
      const row   = monthMap[key];
      result.push({ month: label, revenue: row ? Number(row.revenue) : 0, orders: row ? Number(row.orders) : 0 });
    }

    res.json({
      months:        result,
      total_revenue: result.reduce((s, r) => s + r.revenue, 0),
      total_orders:  result.reduce((s, r) => s + r.orders, 0),
    });
  } catch (err) { next(err); }
});

module.exports = router;
