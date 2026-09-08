// =============================================================================
// H-06 — trust proxy was never configured, so req.ip resolves to the direct
// peer regardless of X-Forwarded-For, and every place that manually read
// x-forwarded-for did so with zero validation — trusting whichever value
// the DIRECT caller supplied.
//
// A single spoofed XFF value is trusted either way under `trust proxy: 1`
// (there's genuinely one hop to trust), so this test sends a MULTI-value
// header simulating "attacker-injected fake IP, then the real proxy's
// appended real IP" — X-Forwarded-For: 6.6.6.6, 127.0.0.1 — which is
// exactly the shape a real reverse proxy produces. The old code took
// `.split(',')[0]` (the attacker-controlled first entry, unconditionally).
// With `trust proxy: 1` configured, Express's own req.ip walks from the
// right and returns the first entry beyond the trusted hop count — the
// real client IP, not the spoofed one.
//
// Verified via a real POST to the public contact-form endpoint and reading
// back the stored ip_address from form_submissions.
//
// Run:  node server/tests/security/H-06.trust-proxy.test.js
// =============================================================================
const http = require('http');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });
const mysql = require('mysql2/promise');

const API_BASE = process.env.API_BASE || 'http://localhost:4220';
const SPOOFED_IP = '6.6.6.6';

function postForm() {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({ email: `sectest-h06-${Date.now()}@example.com`, message: 'security test' });
    const url = new URL(`${API_BASE}/api/forms/public/contact-form/submit`);
    const req = http.request(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
        // Simulates attacker-injected + real-proxy-appended chain.
        'X-Forwarded-For': `${SPOOFED_IP}, 127.0.0.1`,
      },
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.write(data);
    req.end();
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
  const db = await mysql.createConnection({
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
    namedPlaceholders: true,
  });

  console.log('== H-06 trust proxy ==');

  await check('a spoofed X-Forwarded-For chain is NOT trusted verbatim', async () => {
    const r = await postForm();
    if (r.status !== 201) throw new Error(`expected 201 got ${r.status}: ${r.body}`);
    const [[row]] = await db.query(
      'SELECT ip_address FROM form_submissions ORDER BY id DESC LIMIT 1'
    );
    if (row.ip_address === SPOOFED_IP) {
      throw new Error(`stored ip_address (${row.ip_address}) is the attacker-supplied value — spoofing worked`);
    }
  });

  await db.end();
  console.log(`\n${pass}/${pass + fail} passed`);
  process.exit(fail ? 1 : 0);
})();
