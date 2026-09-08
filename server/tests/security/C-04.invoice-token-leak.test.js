// =============================================================================
// C-04 — GET /api/payments/public/invoice/:id
//
// Phase 0: stripped receipt_token from this route's response (first fix).
// Phase 1: retired the route entirely — unauthenticated, sequential id, no
// proof of possession, and still leaked invoice financial detail (total,
// balance, memo, org name) even after the Phase 0 fix. Confirmed via the
// mirrored production data that every invoice already has a payment_token,
// so no live pre-token pay-link depends on this route — real receipts now
// require /by-token/:token, which needs the token itself.
//
// Run:  node server/tests/security/C-04.invoice-token-leak.test.js
// =============================================================================
const http = require('http');

const API_BASE = process.env.API_BASE || 'http://localhost:4220';
const INVOICE_ID = process.env.TEST_INVOICE_ID || '2';

function get(path) {
  return new Promise((resolve, reject) => {
    http.get(API_BASE + path, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
    }).on('error', reject);
  });
}

let pass = 0, fail = 0;
async function check(name, fn) {
  try {
    await fn();
    console.log(`  PASS  ${name}`);
    pass++;
  } catch (e) {
    console.log(`  FAIL  ${name}\n        ${e.message}`);
    fail++;
  }
}

(async () => {
  console.log('== C-04 legacy invoice route retired ==');

  await check(`GET /public/invoice/${INVOICE_ID} is retired, leaks nothing to an unauthenticated caller`, async () => {
    const r = await get(`/api/payments/public/invoice/${INVOICE_ID}`);
    // No route matches this path anymore, so it falls through to this
    // router's own requireAuth gate (401) rather than a plain 404 — an
    // equally valid "retired" outcome, and stricter (no data reachable at
    // all without a session, vs. a 404 that could still hint at valid ids).
    if (![401, 404].includes(r.status)) throw new Error(`expected 401 or 404, got ${r.status}: ${r.body}`);
    if (/receipt_token|balance_due|organization_name/.test(r.body)) {
      throw new Error('response body still contains invoice/financial data');
    }
  });

  await check('the token-based receipt route is unaffected (no regression)', async () => {
    const r = await get('/api/payments/public/invoice/by-token/not-a-real-token');
    // The sibling route is a distinct handler untouched by this change — a
    // malformed token correctly 400s from its own format check. What matters
    // here is that it's a controlled 4xx, not a 500 or a leak.
    if (r.status < 400 || r.status >= 500) throw new Error(`expected a 4xx, got ${r.status}: ${r.body}`);
  });

  console.log(`\n${pass}/${pass + fail} passed`);
  process.exit(fail ? 1 : 0);
})();
