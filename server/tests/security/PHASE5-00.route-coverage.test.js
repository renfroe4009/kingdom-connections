// =============================================================================
// PHASE5-00 — route authorization coverage (the standing test the plan
// calls for: "enumerate the live Express router stack, assert every route
// is either explicitly public or carries requireAuth").
// -----------------------------------------------------------------------------
// Statically enumerates every route registered on the REAL Express router
// objects (each route file's actual exported router, introspected by
// requiring it and walking its .stack — not a live HTTP probe, so this is
// safe to run against a database with real data: nothing is ever invoked,
// only inspected) and classifies each as one of:
//   PROTECTED   - requireAuth/tryAuth is active in the chain by the time
//                 this route is reached (router.use() earlier in the same
//                 file), or requirePermission(...)/requireStaffAccess/
//                 requirePortal/requirePermissionNoMfaGate is used inline.
//   ALLOWLISTED - not gated, but explicitly listed below as intentionally
//                 public (storefront reads, public forms, webhooks, auth
//                 itself, etc.) with a one-line reason for each.
//   UNKNOWN     - not gated and not on the allowlist. Each one is a real
//                 finding: either a public route missing from the
//                 allowlist (add it, with a reason) or a genuine gap.
//
// This exact check is how PHASE5-01 (SSRF in GET /api/ada/check) was
// found — that route was neither gated nor allowlisted, surfaced
// immediately as an UNKNOWN in the very first run of this script.
//
// Run:  node server/tests/security/PHASE5-00.route-coverage.test.js
// =============================================================================
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });

const { requireAuth, tryAuth } = require(path.join(__dirname, '..', '..', 'src', 'middleware', 'auth.js'));

// [mountPath, module path relative to src/routes/]
const MOUNTS = [
  ['/api/users', 'users'], ['/api/invites', 'invites'], ['/api/roles', 'roles'],
  ['/api/contacts', 'contacts'], ['/api/households', 'households'], ['/api/organizations', 'organizations'],
  ['/api/custom-fields', 'customFields'], ['/api/tags', 'tags'], ['/api/activities', 'activities'],
  ['/api/notes', 'notes'], ['/api/attachments', 'attachments'], ['/api/tasks', 'tasks'],
  ['/api/pipelines', 'pipelines'], ['/api/deals', 'deals'], ['/api/import', 'import'],
  ['/api/reports', 'reports'], ['/api/custom-reports', 'customReports'], ['/api/settings', 'settings'],
  ['/api/email', 'email'], ['/api/sms', 'sms'], ['/api/templates', 'templates'], ['/api/comms', 'comms'],
  ['/api/lists', 'lists'], ['/api/connectwise', 'connectwise'], ['/api/google', 'google'],
  ['/api/usps', 'usps'], ['/api/integrations', 'integrations'], ['/api/invoices', 'invoices'],
  ['/api/payments', 'payments'], ['/api/subscriptions', 'subscriptions'],
  ['/api/recurring-invoices', 'recurring-invoices'], ['/api/pledges', 'pledges'], ['/api/vault', 'vault'],
  ['/api/portal', 'portal'], ['/api/maps', 'maps'], ['/api/campaigns', 'campaigns'],
  ['/api/automations', 'automations'], ['/api/ai', 'ai'], ['/api/website', 'website'],
  ['/api/cms', 'cms'], ['/api/cms-data', 'cmsData'], ['/api/forms', 'forms'], ['/api/social', 'social'],
  ['/api/seo', 'seo-settings'], ['/api/dns', 'dns'], ['/api/analytics', 'analytics'],
  ['/api/website/media', 'media'], ['/api/videos', 'videos'], ['/api/ada', 'ada'],
  ['/api/products', 'products'], ['/api/shipping', 'shipping'], ['/api/tax', 'tax'],
  ['/api/orders', 'orders'], ['/api/cart', 'cart'], ['/api/checkout', 'checkout'],
  ['/api/commerce-settings', 'commerce-settings'], ['/api/donations', 'donations'],
  ['/api/membership', 'membership'], ['/api/events', 'events'], ['/api/volunteers', 'volunteers'],
  ['/api/auth', 'auth'],
];

// Intentionally public — every entry needs a real reason. Match on
// `${METHOD} ${mountPath}${routePath}` with Express param syntax kept
// verbatim (e.g. ':id'). A trailing '*' on the path matches by prefix.
const ALLOWLIST = [
  // Auth itself
  'POST /api/auth/login', 'POST /api/auth/forgot-password', 'POST /api/auth/reset-password', 'POST /api/auth/mfa/verify',
  'POST /api/invites/:token/accept', 'GET /api/invites/:token',
  'POST /api/portal/register', 'GET /api/portal/verify-email/:token', 'POST /api/portal/verify-email/resend',
  // Health / meta
  'GET /api/health',
  // Public storefront + CMS content (read-only by nature)
  'GET /api/website/*', 'GET /api/cms/*', 'GET /api/cms-data/*', 'GET /api/products/*',
  'GET /api/shipping/*', 'GET /api/tax/*', 'GET /api/seo/*', 'GET /api/sitemap.xml',
  'GET /api/settings/public/theme', 'GET /api/settings/business/logo/:slot',
  // Public cart/checkout (session-token based, not user auth)
  'GET /api/cart', 'GET /api/cart/', 'POST /api/cart/items', 'PUT /api/cart/items/:id', 'DELETE /api/cart/items/:id', 'DELETE /api/cart/',
  'GET /api/checkout/client-token', 'POST /api/checkout/estimate', 'POST /api/checkout/complete',
  'POST /api/checkout/public/intent', 'POST /api/checkout/public/ach-complete/:intentId',
  'GET /api/checkout/public/order/:order_number', 'GET /api/checkout/public/order/:order_number/tickets',
  'GET /api/orders/public/*',
  // Public donation/membership/event flows
  'POST /api/donations/public/checkout', 'POST /api/donations/public/finalize/:invoiceId',
  'GET /api/donations/public/*', 'POST /api/membership/public/*', 'GET /api/membership/public/*',
  'POST /api/events/public/*', 'GET /api/events/public/*', 'POST /api/volunteers/public/*', 'GET /api/volunteers/public/*',
  // Public forms
  'GET /api/forms/public/:slug', 'POST /api/forms/public/:slug/submit',
  // Public payments (token-scoped, not session auth — by design, see C-04's remediation)
  'GET /api/payments/public/*', 'POST /api/payments/public/*',
  // Webhooks — authenticated by HMAC signature, not a session
  'POST /api/payments/webhook/authnet', 'POST /api/payments/webhook/valor',
  'POST /api/connectwise/webhook', 'POST /api/sms/webhook/twilio', 'POST /api/sms/webhook/twilio/status',
  // Google OAuth callback (state-token verified, not session auth)
  'GET /api/google/oauth/callback', 'GET /api/google/auth',
  // Public invoice-by-token receipt (capability-token URL, see Section 6)
  'GET /api/invoices/public/*',
  // Retired legacy routes — always return 410 Gone, touch no data (see C-04, Phase 1)
  '_ALL /api/payments/public/receipt/:legacy', '_ALL /api/payments/public/receipt/:legacy/email',
  // Email verification confirmation — same hashed-single-use-token pattern as password reset
  'POST /api/portal/verify-email',
  // Public marketing video listing — router.use(requireAuth) is registered
  // AFTER this route in videos.js, same "public routes first" convention
  // used throughout this codebase.
  'GET /api/videos/public',
  // Public storefront checkout helpers — needed before/during an
  // unauthenticated shopper's checkout, same trust level as /api/checkout/estimate
  'POST /api/shipping/estimate', 'POST /api/tax/calculate',
  // Public donation flows (card-save / recurring setup) — same /public/
  // prefix and trust model as the checkout flow above
  'POST /api/donations/public/*',
];

function normalizeMethods(methods) {
  return Object.keys(methods).filter((m) => methods[m]).map((m) => m.toUpperCase());
}

function isAllowlisted(key) {
  return ALLOWLIST.some((entry) => {
    if (entry.endsWith('*')) return key.startsWith(entry.slice(0, -1));
    return entry === key;
  });
}

function layerUsesAuth(layer) {
  return layer.handle === requireAuth || layer.handle === tryAuth || layer.name === 'requireAuth' || layer.name === 'tryAuth';
}

function routeStackHasProtection(routeStack) {
  return routeStack.some((l) => layerUsesAuth(l) || /requirePermission|requireStaffAccess|requirePortal|requirePermissionNoMfaGate/.test(l.name || l.handle?.name || ''));
}

function auditRouter(mountPath, router) {
  const findings = [];
  let authActive = false;
  for (const layer of router.stack) {
    if (!layer.route) {
      if (layerUsesAuth(layer)) authActive = true;
      continue;
    }
    const methods = normalizeMethods(layer.route.methods);
    const protectedInline = routeStackHasProtection(layer.route.stack);
    for (const method of methods) {
      const key = `${method} ${mountPath}${layer.route.path}`;
      const protected_ = authActive || protectedInline;
      findings.push({ key, protected: protected_, allowlisted: !protected_ && isAllowlisted(key) });
    }
  }
  return findings;
}

console.log('== PHASE5-00 route authorization coverage ==');

const all = [];
let loadErrors = 0;
for (const [mountPath, file] of MOUNTS) {
  let router;
  try {
    router = require(path.join(__dirname, '..', '..', 'src', 'routes', file));
  } catch (err) {
    console.log(`  FAIL  load routes/${file}.js\n        ${err.message}`);
    loadErrors++;
    continue;
  }
  all.push(...auditRouter(mountPath, router));
}

const unknown = all.filter((f) => !f.protected && !f.allowlisted);
const allowlisted = all.filter((f) => !f.protected && f.allowlisted);
const protectedCount = all.filter((f) => f.protected).length;

console.log(`  Total routes inspected: ${all.length}`);
console.log(`  Protected: ${protectedCount}  |  Explicitly public: ${allowlisted.length}  |  UNKNOWN: ${unknown.length}`);

let pass = loadErrors === 0 ? 1 : 0;
let fail = loadErrors;
if (unknown.length) {
  console.log('  FAIL  every route is either protected or explicitly, deliberately public');
  for (const f of unknown) console.log(`        UNKNOWN: ${f.key}`);
  fail++;
} else {
  console.log('  PASS  every route is either protected or explicitly, deliberately public');
  pass++;
}

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
