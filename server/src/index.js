// =============================================================================
// localCRM — Server entry
// =============================================================================
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');

const { db, pingDb } = require('./db');
const errorHandler = require('./middleware/errorHandler');

// Refuse to boot with NODE_ENV misconfigured on a real deployment (security
// remediation M-01) — the error handler only hides stack traces and returns
// a generic message for 5xx when NODE_ENV === 'production'. RAILWAY_ENVIRONMENT
// is set automatically by Railway on every deployment, so its presence is a
// reliable "this isn't someone's laptop" signal without touching local dev,
// which has neither this var nor a committed NODE_ENV=production.
if (process.env.RAILWAY_ENVIRONMENT && process.env.NODE_ENV !== 'production') {
  throw new Error(
    `Refusing to start: running on Railway (RAILWAY_ENVIRONMENT=${process.env.RAILWAY_ENVIRONMENT}) ` +
    `with NODE_ENV=${process.env.NODE_ENV || '(unset)'}. Set NODE_ENV=production in this environment's ` +
    `variables before deploying — otherwise error responses leak stack traces to clients.`
  );
}

// Routers
const authRoutes          = require('./routes/auth');
const usersRoutes         = require('./routes/users');
const invitesRoutes       = require('./routes/invites');
const rolesRoutes         = require('./routes/roles');
const contactsRoutes      = require('./routes/contacts');
const householdsRoutes    = require('./routes/households');
const organizationsRoutes = require('./routes/organizations');
const customFieldsRoutes  = require('./routes/customFields');
const tagsRoutes          = require('./routes/tags');
const activitiesRoutes    = require('./routes/activities');
const notesRoutes         = require('./routes/notes');
const attachmentsRoutes   = require('./routes/attachments');
const tasksRoutes         = require('./routes/tasks');
const pipelinesRoutes     = require('./routes/pipelines');
const dealsRoutes         = require('./routes/deals');
const importRoutes        = require('./routes/import');
const reportsRoutes       = require('./routes/reports');
const customReportsRoutes = require('./routes/customReports');
const settingsRoutes      = require('./routes/settings');
const emailRoutes         = require('./routes/email');
const smsRoutes           = require('./routes/sms');
const templatesRoutes     = require('./routes/templates');
const commsRoutes         = require('./routes/comms');
const listsRoutes         = require('./routes/lists');
const cwRoutes            = require('./routes/connectwise');
const googleRoutes        = require('./routes/google');
const uspsRoutes          = require('./routes/usps');
const integrationsRoutes  = require('./routes/integrations');
const invoicesRoutes           = require('./routes/invoices');
const paymentsRoutes           = require('./routes/payments');
const subscriptionsRoutes      = require('./routes/subscriptions');
const recurringInvoicesRoutes  = require('./routes/recurring-invoices');
const pledgesRoutes            = require('./routes/pledges');
const vaultRoutes              = require('./routes/vault');
const portalRoutes        = require('./routes/portal');
const mapsRoutes          = require('./routes/maps');
const campaignsRoutes     = require('./routes/campaigns');
const automationsRoutes   = require('./routes/automations');
const aiRoutes            = require('./routes/ai');
const websiteRoutes       = require('./routes/website');
const pageImportRoutes    = require('./routes/pageImport');
const cmsRoutes           = require('./routes/cms');
const cmsDataRoutes       = require('./routes/cmsData');
const formsRoutes         = require('./routes/forms');
const socialRoutes        = require('./routes/social');
const seoSettingsRoutes   = require('./routes/seo-settings');
const dnsRoutes           = require('./routes/dns');
const analyticsRoutes     = require('./routes/analytics');
const mediaRoutes         = require('./routes/media');
const videosRoutes        = require('./routes/videos');
const adaRoutes           = require('./routes/ada');
const productsRoutes      = require('./routes/products');
const shippingRoutes      = require('./routes/shipping');
const taxRoutes           = require('./routes/tax');
const ordersRoutes        = require('./routes/orders');
const cartRoutes          = require('./routes/cart');
const checkoutRoutes      = require('./routes/checkout');
const commerceSettingsRoutes = require('./routes/commerce-settings');
const donationsRoutes     = require('./routes/donations');
const membershipRoutes    = require('./routes/membership');
const eventsRoutes        = require('./routes/events');
const volunteersRoutes    = require('./routes/volunteers');
const mobileApi                = require('./routes/mobileApi');
const mobileApiAdminRoutes     = require('./routes/mobileApiAdmin');
const startPpWebhookRetryCron  = require('./jobs/pp-webhook-retry-cron');
const startBillingCron    = require('./jobs/billing-cron');
const startAutomationsCron = require('./jobs/automations-cron');
const startBatchReconCron = require('./jobs/batch-reconciliation-cron');
const startYearEndStatementsCron = require('./jobs/year-end-statements-cron');
const campaignScheduler   = require('./services/scheduler');
const { seedSystemTemplates } = require('./services/templateSeeder');
const { seed: seedKnowledgeBase } = require('./services/kbSeeder');

const app = express();
const PORT = process.env.PORT || 4000;

// Trust exactly one proxy hop (security remediation H-06) — this app is
// deployed behind Railway's own edge proxy. Without this, req.ip resolves
// to the proxy's address for every client, which:
//   - collapses the forgot-password/portal-register rate limiters (keyed on
//     IP alone) into one shared global bucket instead of per-client ones;
//   - makes every place that reads x-forwarded-for manually (payments.js,
//     forms.js — now switched to req.ip) trust an attacker-controllable
//     header instead of Express's own validated chain.
// A specific hop count, never `true` (which lets a client spoof
// x-forwarded-for freely by claiming to be behind more proxies than it is).
// HUMAN ACTION: verify this matches the real deployed topology — if a CDN/
// WAF sits in front of Railway's own edge, this needs to be 2, not 1.
app.set('trust proxy', Number(process.env.TRUST_PROXY_HOPS || 1));

app.use(helmet({
  // Use 'cross-origin' (explicit header present) rather than false (header
  // absent) — the difference matters for COEP-enforcing contexts.  'cross-origin'
  // allows images/assets to be loaded cross-origin (needed for logo in receipts)
  // while still sending the CORP header so browsers can honour it (Finding 11).
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  // CORP above governs whether OTHER origins may embed resources FROM this
  // server — it does nothing for the opposite direction: this server's OWN
  // HTML (e.g. the public receipt page) loading an image FROM another host.
  // That's governed by CSP's img-src, which Helmet defaults to 'self' data:
  // only. resolveBusinessLogoUrl() (services/templates.js) can legitimately
  // return a cross-origin URL (an S3/R2-hosted logo, or a signed S3 URL for
  // email) as one of its three valid shapes — same-origin path, data: URI,
  // or a real external URL — so locking img-src to 'self' data: silently
  // broke logo rendering for any business whose logo isn't stored as a
  // same-origin file. Widened to allow https: images generally, matching
  // the same allowance already given to font-src/style-src below.
  contentSecurityPolicy: {
    directives: {
      ...helmet.contentSecurityPolicy.getDefaultDirectives(),
      'img-src': ["'self'", 'data:', 'https:'],
    },
  },
}));
// Browsers send Origin without a trailing slash, so normalise one away here —
// otherwise a CLIENT_ORIGIN pasted as a full URL silently fails every request.
const allowedOrigins = (process.env.CLIENT_ORIGIN || 'http://localhost:5173')
  .split(',').map((o) => o.trim().replace(/\/+$/, '')).filter(Boolean);
// Security remediation M-06 — a missing Origin header was allowed on every
// route, not just the handful that actually need it. That's not browser-
// exploitable today (this app is bearer-token, not cookie, auth — nothing
// for a browser to attach automatically to a no-Origin request), but it's
// unnecessary defense-in-depth loss, and the audit specifically flags it as
// something that becomes exploitable if a future refresh-token/cookie
// change is ever made. Webhook routes (Authorize.net, Valor, Twilio,
// ConnectWise) are genuinely server-to-server — they authenticate by HMAC
// signature, never send an Origin, and must keep working — everything else
// now requires a real, allowlisted Origin.
// /api/health is exempt alongside webhooks — Railway's own uptime probe (and
// any external monitor) is a plain HTTP health check, not a browser
// request, and never sends an Origin header. Rejecting it here would look
// identical to the service actually being down.
//
// Regression fix, caught immediately after this shipped: in LOCAL DEV, the
// client's Vite dev server proxies `/api` to this server same-origin
// (vite.config.js, `changeOrigin: true`) — the browser's own request to
// `/api/...` is same-origin relative to the client's own port, so it never
// carries an Origin header at all, and http-proxy's changeOrigin only
// rewrites the outbound Host header, never synthesizes one. Enforcing
// "Origin required" against that traffic breaks every API call the client
// makes locally. Outside production the client and API are typically two
// origins for real (e.g. a Vercel-served SPA calling a separate API host),
// so a real cross-origin browser request there still carries a real
// Origin — this exemption only ever matters for the same-machine dev-proxy
// case. Matches the existing NODE_ENV !== 'production' convention already
// used elsewhere in this file (e.g. publicPaymentLimiter's `skip`).
const NO_ORIGIN_OK_PATH = /\/webhook(\/|$)|^\/api\/health$/;
app.use(cors((req, cb) => {
  const origin = req.headers.origin;
  const noOriginOk = !origin && (NO_ORIGIN_OK_PATH.test(req.path) || process.env.NODE_ENV !== 'production');
  const allowed = (origin && allowedOrigins.includes(origin)) || noOriginOk;
  if (allowed) return cb(null, { origin: true, credentials: true });
  const err = new Error(origin ? `CORS: origin ${origin} not allowed` : 'CORS: Origin header required');
  err.status = 403;
  cb(err);
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

app.get('/api/health', async (_req, res) => {
  const dbOk = await pingDb().catch(() => false);
  const uptimeSec = Math.floor(process.uptime());
  res.json({
    status:  'ok',
    db:      dbOk ? 'up' : 'down',
    uptime:  `${Math.floor(uptimeSec / 3600)}h ${Math.floor((uptimeSec % 3600) / 60)}m`,
    jobs:    global._jobStatus || {},
    ts:      new Date().toISOString(),
    version: process.env.npm_package_version || '—',
  });
});

// Global baseline rate limit (security remediation H-07) — a backstop for
// the majority of the ~500 endpoints that have no dedicated limiter of
// their own. Deliberately generous (this is a safety net, not the primary
// control) — routes with a real abuse profile get their own tighter
// limiter layered on top, keyed more specifically than raw IP where it
// matters (e.g. the event check-in PIN limiter in services/checkinPin.js
// is keyed per-event, not per-IP). Mounted after /api/health so uptime
// monitoring never trips it.
const { rateLimit: globalRateLimit } = require('express-rate-limit');
app.use('/api', globalRateLimit({
  windowMs: 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please slow down and try again shortly.' },
}));

// Routes
app.use('/api/auth',          authRoutes);
app.use('/api/users',         usersRoutes);
app.use('/api/invites',       invitesRoutes);
app.use('/api/roles',         rolesRoutes);
app.use('/api/contacts',      contactsRoutes);
app.use('/api/households',    householdsRoutes);
app.use('/api/organizations', organizationsRoutes);
app.use('/api/custom-fields', customFieldsRoutes);
app.use('/api/tags',          tagsRoutes);
app.use('/api/activities',    activitiesRoutes);
app.use('/api/notes',         notesRoutes);
app.use('/api/attachments',   attachmentsRoutes);
app.use('/api/tasks',         tasksRoutes);
app.use('/api/pipelines',     pipelinesRoutes);
app.use('/api/deals',         dealsRoutes);
app.use('/api/import',        importRoutes);
app.use('/api/reports',       reportsRoutes);
app.use('/api/custom-reports', customReportsRoutes);
app.use('/api/settings',      settingsRoutes);
app.use('/api/email',         emailRoutes);
app.use('/api/sms',           smsRoutes);
app.use('/api/templates',     templatesRoutes);
app.use('/api/comms',         commsRoutes);
app.use('/api/lists',         listsRoutes);
app.use('/api/connectwise',   cwRoutes);
app.use('/api/google',        googleRoutes);
app.use('/api/usps',          uspsRoutes);
app.use('/api/integrations',  integrationsRoutes);
app.use('/api/invoices',            invoicesRoutes);
app.use('/api/payments',            paymentsRoutes);
app.use('/api/subscriptions',       subscriptionsRoutes);
app.use('/api/recurring-invoices',  recurringInvoicesRoutes);
app.use('/api/pledges',             pledgesRoutes);
app.use('/api/vault',               vaultRoutes);
app.use('/api/portal',        portalRoutes);
app.use('/api/maps',          mapsRoutes);
app.use('/api/campaigns',     campaignsRoutes);
app.use('/api/automations',   automationsRoutes);
app.use('/api/ai',            aiRoutes);
// Mounted before websiteRoutes (both share the /api/website prefix) so it can
// never be shadowed by a future generic route in website.js — see
// routes/pageImport.js's header comment.
app.use('/api/website/import', pageImportRoutes);
app.use('/api/website',       websiteRoutes);
app.use('/api/cms',           cmsRoutes);
app.use('/api/cms-data',      cmsDataRoutes);
app.use('/api/forms',         formsRoutes);
app.use('/api/social',        socialRoutes);
app.use('/api/seo',           seoSettingsRoutes);
app.use('/api/dns',           dnsRoutes);
app.use('/api/analytics',     analyticsRoutes);
app.use('/api/website/media',  mediaRoutes);
app.use('/api/videos',        videosRoutes);
app.use('/api/ada',           adaRoutes);
app.use('/api/products',      productsRoutes);
app.use('/api/shipping',      shippingRoutes);
app.use('/api/tax',           taxRoutes);
app.use('/api/orders',        ordersRoutes);
app.use('/api/cart',          cartRoutes);
app.use('/api/checkout',      checkoutRoutes);
app.use('/api/commerce-settings', commerceSettingsRoutes);
app.use('/api/donations',     donationsRoutes);
app.use('/api/membership',    membershipRoutes);
app.use('/api/events',        eventsRoutes);
app.use('/api/volunteers',    volunteersRoutes);

// Praying Planet mobile API — server-to-server client-credentials auth,
// deliberately separate from staff session auth (see middleware/apiClientAuth.js).
app.post('/api/mobile/oauth/token', mobileApi.tokenLimiter, mobileApi.issueToken);
app.use('/api/mobile/v1', mobileApi.router);
// Staff-facing (session-authenticated) read-only status for the Integrations
// settings page — a different auth model entirely from the two routes above.
app.use('/api/mobile-api-admin', mobileApiAdminRoutes);

// Public sitemap at the conventional root path (search engines expect it here)
app.get('/sitemap.xml', (req, res, next) => { req.url = '/sitemap'; cmsRoutes(req, res, next); });

// 404
app.use((req, res) => res.status(404).json({ error: 'Not found', path: req.path }));

// Error handler (last)
app.use(errorHandler);

app.listen(PORT, async () => {
  // eslint-disable-next-line no-console
  console.log(`localCRM API listening on :${PORT}`);
  try {
    await pingDb();
    console.log('MySQL connection: OK');
  } catch (err) {
    console.warn('MySQL connection failed:', err.message);
  }
  if (process.env.BILLING_CRON !== 'off') {
    startBillingCron();
  }
  if (process.env.BATCH_RECON_CRON !== 'off') {
    startBatchReconCron();
  }
  if (process.env.YEAR_END_STATEMENTS_CRON !== 'off') {
    startYearEndStatementsCron();
  }
  if (process.env.CAMPAIGNS_CRON !== 'off') {
    campaignScheduler.start();
  }
  if (process.env.AUTOMATIONS_CRON !== 'off') {
    startAutomationsCron();
  }
  if (process.env.PP_WEBHOOK_RETRY_CRON !== 'off') {
    startPpWebhookRetryCron();
  }
  seedSystemTemplates().catch((e) => console.error('[templates] seed error:', e.message));
  seedKnowledgeBase().catch((e) => console.error('[ai-kb] seed error:', e.message));
});

module.exports = app;
