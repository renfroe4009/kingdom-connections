// =============================================================================
// H-04 — POST /api/donations/public/finalize/:invoiceId requires proof of
// possession (the invoice's own payment_token, or a staff session holding
// donations.write / admin) before it will tag a payment as a donation,
// return a receipt_token, or trust attacker-chosen fund_id/dedication/
// soft_credit_contact_id.
//
// Uses the real HTTP checkout flow to obtain a genuine payment_token, then
// inserts a "captured" payment row directly (standing in for a completed
// gateway charge, which is out of scope to exercise here) to reach the
// finalize step.
//
// Run:  node server/tests/security/H-04.donation-finalize-tampering.test.js
// =============================================================================
const http = require('http');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });
const mysql = require('mysql2/promise');

const API_BASE = process.env.API_BASE || 'http://localhost:4220';
const ORIGIN_HEADER = { Origin: (process.env.CLIENT_ORIGIN || 'http://localhost:5220').split(',')[0].trim() };
const ADMIN_EMAIL    = process.env.ADMIN_EMAIL    || 'sectest-admin@localcrm.local';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'SecTest123!';

function request(method, path_, { token, body } = {}) {
  return new Promise((resolve, reject) => {
    const data = body !== undefined ? JSON.stringify(body) : null;
    const url = new URL(API_BASE + path_);
    const req = http.request(url, {
      method,
      headers: { ...ORIGIN_HEADER,
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
      },
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function login(email, password) {
  const r = await request('POST', '/api/auth/login', { body: { email, password } });
  if (r.status !== 200) throw new Error(`login failed for ${email}: ${r.status} ${r.body}`);
  return JSON.parse(r.body).token;
}

let db;
async function startCheckoutWithCapturedPayment(email) {
  const r = await request('POST', '/api/donations/public/checkout', {
    body: { amount: 25, donor: { email, first_name: 'Sec', last_name: 'Test' } },
  });
  if (r.status !== 201) throw new Error(`checkout failed: ${r.status} ${r.body}`);
  const co = JSON.parse(r.body);
  await db.query(
    `INSERT INTO payments (invoice_id, gateway, method, amount, currency, status, receipt_token)
     VALUES (:invoice_id, 'manual', 'card', 25.00, 'USD', 'captured', :receipt_token)`,
    { invoice_id: co.invoiceId, receipt_token: require('crypto').randomBytes(32).toString('hex') }
  );
  return co;
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
  db = await mysql.createConnection({
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
    namedPlaceholders: true,
  });

  console.log('== H-04 donation finalize tampering ==');

  await check('finalize with no auth and no token is rejected (403)', async () => {
    const co = await startCheckoutWithCapturedPayment('sectest-donor-1@example.com');
    const r = await request('POST', `/api/donations/public/finalize/${co.invoiceId}`, { body: {} });
    if (r.status !== 403) throw new Error(`expected 403 got ${r.status}: ${r.body}`);
  });

  await check('finalize with the WRONG payment_token is rejected (403)', async () => {
    const co = await startCheckoutWithCapturedPayment('sectest-donor-2@example.com');
    const r = await request('POST', `/api/donations/public/finalize/${co.invoiceId}`, {
      body: { payment_token: 'a'.repeat(64) },
    });
    if (r.status !== 403) throw new Error(`expected 403 got ${r.status}: ${r.body}`);
  });

  await check('finalize with the correct payment_token succeeds (no regression)', async () => {
    const co = await startCheckoutWithCapturedPayment('sectest-donor-3@example.com');
    const r = await request('POST', `/api/donations/public/finalize/${co.invoiceId}`, {
      body: { payment_token: co.payment_token },
    });
    if (r.status !== 201) throw new Error(`expected 201 got ${r.status}: ${r.body}`);
    const json = JSON.parse(r.body);
    if (!json.donation || !json.receipt_token) throw new Error('expected a donation + receipt_token on success');
  });

  await check('finalize via an admin session (no token needed) succeeds (staff path)', async () => {
    const co = await startCheckoutWithCapturedPayment('sectest-donor-4@example.com');
    const adminToken = await login(ADMIN_EMAIL, ADMIN_PASSWORD);
    const r = await request('POST', `/api/donations/public/finalize/${co.invoiceId}`, {
      token: adminToken, body: {},
    });
    if (r.status !== 201) throw new Error(`expected 201 got ${r.status}: ${r.body}`);
  });

  await check('an unknown fund_id is rejected (400), not silently dropped', async () => {
    const co = await startCheckoutWithCapturedPayment('sectest-donor-5@example.com');
    const r = await request('POST', `/api/donations/public/finalize/${co.invoiceId}`, {
      body: { payment_token: co.payment_token, fund_id: 999999 },
    });
    if (r.status !== 400) throw new Error(`expected 400 got ${r.status}: ${r.body}`);
  });

  await check('an unknown soft_credit_contact_id is rejected (400)', async () => {
    const co = await startCheckoutWithCapturedPayment('sectest-donor-6@example.com');
    const r = await request('POST', `/api/donations/public/finalize/${co.invoiceId}`, {
      body: { payment_token: co.payment_token, soft_credit_contact_id: 999999 },
    });
    if (r.status !== 400) throw new Error(`expected 400 got ${r.status}: ${r.body}`);
  });

  await db.end();
  console.log(`\n${pass}/${pass + fail} passed`);
  process.exit(fail ? 1 : 0);
})();
