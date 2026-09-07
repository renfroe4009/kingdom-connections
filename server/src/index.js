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
const startBillingCron    = require('./jobs/billing-cron');
const startAutomationsCron = require('./jobs/automations-cron');
const startBatchReconCron = require('./jobs/batch-reconciliation-cron');
const startYearEndStatementsCron = require('./jobs/year-end-statements-cron');
const campaignScheduler   = require('./services/scheduler');
const { seedSystemTemplates } = require('./services/templateSeeder');
const { seed: seedKnowledgeBase } = require('./services/kbSeeder');

const app = express();
const PORT = process.env.PORT || 4000;

app.use(helmet({
  // Use 'cross-origin' (explicit header present) rather than false (header
  // absent) — the difference matters for COEP-enforcing contexts.  'cross-origin'
  // allows images/assets to be loaded cross-origin (needed for logo in receipts)
  // while still sending the CORP header so browsers can honour it (Finding 11).
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}));
// Browsers send Origin without a trailing slash, so normalise one away here —
// otherwise a CLIENT_ORIGIN pasted as a full URL silently fails every request.
const allowedOrigins = (process.env.CLIENT_ORIGIN || 'http://localhost:5173')
  .split(',').map((o) => o.trim().replace(/\/+$/, '')).filter(Boolean);
app.use(cors({
  origin: (origin, cb) => {
    // Allow requests with no origin (curl, Postman, server-to-server)
    if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
    const err = new Error(`CORS: origin ${origin} not allowed`);
    err.status = 403;
    cb(err);
  },
  credentials: true,
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
  seedSystemTemplates().catch((e) => console.error('[templates] seed error:', e.message));
  seedKnowledgeBase().catch((e) => console.error('[ai-kb] seed error:', e.message));
});

module.exports = app;
