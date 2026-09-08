// =============================================================================
// H-13 (CSP half) — root vercel.json must ship a Content-Security-Policy
// (report-only for now — see the remediation log for why enforcement is
// deferred) plus HSTS/nosniff/Referrer-Policy/Permissions-Policy, applied
// to every path.
//
// The policy's actual CONTENT was validated empirically, not just read: a
// local static-file server replaying these exact headers (parsed from this
// same vercel.json) was driven with Playwright through /, /donate, /shop,
// /blog, /admin/login, /portal/login, capturing real
// securitypolicyviolation events. That run is not committed here (it needs
// Playwright, which isn't a project dependency) — see the remediation log
// for the full transcript and the two known, documented violations left
// unresolved (site_custom_js's live cookie-consent script, and per-page
// JSON-LD schema markup) — both first-party, not the C-05 attacker vector,
// but real gaps that must be closed before flipping this from
// Content-Security-Policy-Report-Only to an enforcing Content-Security-Policy.
//
// This test only checks the static shape: valid JSON, headers present,
// applied broadly, and the specific domains this app is actually known to
// need (Passage.js, iconify CDN, Google Fonts) are allowlisted.
//
// Run:  node server/tests/security/H-13.security-headers.test.js
// =============================================================================
const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
function check(name, fn) {
  try {
    fn();
    console.log(`  PASS  ${name}`);
    pass++;
  } catch (e) {
    console.log(`  FAIL  ${name}\n        ${e.message}`);
    fail++;
  }
}

(async () => {
  console.log('== H-13 security headers (vercel.json) ==');

  const vercelPath = path.join(__dirname, '..', '..', '..', 'vercel.json');
  const raw = fs.readFileSync(vercelPath, 'utf8');
  let config;

  check('vercel.json is valid JSON', () => { config = JSON.parse(raw); });

  const headerRules = (config?.headers || [])[0]?.headers || [];
  const byKey = Object.fromEntries(headerRules.map((h) => [h.key, h.value]));

  check('headers block applies to every path (source: "/(.*)")', () => {
    if (config.headers?.[0]?.source !== '/(.*)') throw new Error('headers rule is not applied broadly');
  });

  check('ships a Content-Security-Policy (report-only)', () => {
    if (!byKey['Content-Security-Policy-Report-Only']) throw new Error('missing CSP-Report-Only header');
  });

  check('CSP allows the known-needed script domains', () => {
    const csp = byKey['Content-Security-Policy-Report-Only'] || '';
    for (const domain of ['https://cdn.jsdelivr.net', 'https://js.valorpaytech.com']) {
      if (!csp.includes(domain)) throw new Error(`script-src missing ${domain}`);
    }
  });

  check('CSP allows Google Fonts (style + font)', () => {
    const csp = byKey['Content-Security-Policy-Report-Only'] || '';
    if (!csp.includes('https://fonts.googleapis.com')) throw new Error('style-src missing fonts.googleapis.com');
    if (!csp.includes('https://fonts.gstatic.com')) throw new Error('font-src missing fonts.gstatic.com');
  });

  check('CSP sets the recommended lockdown directives', () => {
    const csp = byKey['Content-Security-Policy-Report-Only'] || '';
    for (const directive of ["object-src 'none'", "base-uri 'none'", "frame-ancestors 'none'"]) {
      if (!csp.includes(directive)) throw new Error(`missing directive: ${directive}`);
    }
  });

  check('ships HSTS, nosniff, Referrer-Policy, Permissions-Policy', () => {
    if (!byKey['Strict-Transport-Security']) throw new Error('missing HSTS');
    if (byKey['X-Content-Type-Options'] !== 'nosniff') throw new Error('missing/wrong X-Content-Type-Options');
    if (!byKey['Referrer-Policy']) throw new Error('missing Referrer-Policy');
    if (!byKey['Permissions-Policy']) throw new Error('missing Permissions-Policy');
  });

  console.log(`\n${pass}/${pass + fail} passed`);
  process.exit(fail ? 1 : 0);
})();
