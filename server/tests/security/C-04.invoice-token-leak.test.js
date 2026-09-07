// =============================================================================
// C-04 — GET /api/payments/public/invoice/:id must never leak receipt_token
//
// receipt_token is a capability that unlocks the full receipt payload (PII +
// card last4) at /public/receipt/by-token/:token. This route is unauthenticated
// with a sequential integer id, so any receipt_token in its response can be
// harvested by enumeration — verified live against this server: id=INVOICE_ID
// below has a real captured payment with a real receipt_token.
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
  console.log('== C-04 invoice receipt_token leak ==');

  await check(`GET /public/invoice/${INVOICE_ID} response has no receipt_token`, async () => {
    const r = await get(`/api/payments/public/invoice/${INVOICE_ID}`);
    if (r.status !== 200) throw new Error(`expected 200 got ${r.status} (adjust TEST_INVOICE_ID?)`);
    const json = JSON.parse(r.body);
    if (json.latest_payment && Object.prototype.hasOwnProperty.call(json.latest_payment, 'receipt_token')) {
      throw new Error('latest_payment.receipt_token is present in the response');
    }
    if (/receipt_token/.test(r.body)) throw new Error('the string "receipt_token" appears anywhere in the response');
  });

  await check('response still includes non-sensitive invoice fields (no regression)', async () => {
    const r = await get(`/api/payments/public/invoice/${INVOICE_ID}`);
    const json = JSON.parse(r.body);
    if (!json.invoice || typeof json.invoice.total === 'undefined') {
      throw new Error('expected invoice.total to still be present');
    }
    if (!json.latest_payment || typeof json.latest_payment.amount === 'undefined') {
      throw new Error('expected latest_payment.amount to still be present');
    }
  });

  console.log(`\n${pass}/${pass + fail} passed`);
  process.exit(fail ? 1 : 0);
})();
