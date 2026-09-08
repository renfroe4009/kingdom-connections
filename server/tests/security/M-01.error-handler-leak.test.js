// =============================================================================
// M-01 — 5xx responses must never leak err.message or a stack trace,
// regardless of NODE_ENV. 4xx responses (Zod validation, intentional
// "Forbidden"/"Not found" errors) must keep their existing shape.
//
// Trigger: GET /api/payments/public/status/abc — Number('abc') is NaN,
// which mysql2 rejects as an invalid bound value ("Unknown column 'NaN' in
// 'where clause'"), producing a genuine uncaught DB exception — not a mock.
// (The original trigger route, /public/invoice/:id, was retired by the
// C-04 fix; this route hits the identical NaN-binding failure mode.)
//
// Run:  node server/tests/security/M-01.error-handler-leak.test.js
// =============================================================================
const http = require('http');

const API_BASE = process.env.API_BASE || 'http://localhost:4220';
const ORIGIN_HEADER = { Origin: (process.env.CLIENT_ORIGIN || 'http://localhost:5220').split(',')[0].trim() };

function get(path) {
  return new Promise((resolve, reject) => {
    http.get(API_BASE + path, { headers: ORIGIN_HEADER }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
    }).on('error', reject);
  });
}

function postJson(path, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const url = new URL(API_BASE + path);
    const req = http.request(url, {
      method: 'POST',
      headers: { ...ORIGIN_HEADER, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
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
  console.log('== M-01 error handler leak ==');

  await check('a genuine 500 leaks no err.message, no stack, no SQL/column names', async () => {
    const r = await get('/api/payments/public/status/abc');
    if (r.status !== 500) throw new Error(`expected 500 got ${r.status} (route behavior changed?)`);
    const json = JSON.parse(r.body);
    if (json.error !== 'Internal server error') throw new Error(`expected generic error, got: ${json.error}`);
    if (json.stack) throw new Error('response included a stack trace');
    if (!json.correlation_id) throw new Error('response is missing a correlation_id');
    if (/Unknown column|mysql|at \//.test(r.body)) throw new Error('response body contains raw internals');
  });

  await check('a real 400 (Zod validation) keeps its existing shape (no regression)', async () => {
    const r = await postJson('/api/auth/login', { email: 'not-an-email' }); // missing password too
    if (r.status !== 400) throw new Error(`expected 400 got ${r.status}: ${r.body}`);
    const json = JSON.parse(r.body);
    if (json.error !== 'Validation failed' || !Array.isArray(json.issues)) {
      throw new Error(`expected the existing Zod shape, got: ${r.body}`);
    }
  });

  await check('a real 401 (bad credentials) keeps its message (no regression)', async () => {
    const r = await postJson('/api/auth/login', { email: 'nobody@example.com', password: 'wrong' });
    if (r.status !== 401) throw new Error(`expected 401 got ${r.status}: ${r.body}`);
    const json = JSON.parse(r.body);
    if (json.error !== 'Invalid credentials') throw new Error(`expected "Invalid credentials", got: ${r.body}`);
  });

  console.log(`\n${pass}/${pass + fail} passed`);
  process.exit(fail ? 1 : 0);
})();
