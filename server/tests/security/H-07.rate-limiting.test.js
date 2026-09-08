// =============================================================================
// H-07 — no global rate limit and no dedicated limiter on any of the
// high-risk endpoints the audit named (AI chat, form submission, donation
// checkout, website search, cart items, password reset — event check-in
// PIN was already fixed under H-08).
//
// Most limiters here have a small enough `max` to trip for real within a
// few seconds, so this floods each route to the real 429 rather than just
// checking config. The one exception is donations.js's checkoutLimiter,
// which — matching this codebase's pre-existing payments.js convention —
// is deliberately inactive outside NODE_ENV=production (`skip: () =>
// process.env.NODE_ENV !== 'production'`), so it can't trip against a
// local dev server without restarting it into production mode; that one
// gets a structural check instead (confirms the limiter is wired into the
// route), not a live 429.
//
// Run:  node server/tests/security/H-07.rate-limiting.test.js
// =============================================================================
const http = require('http');
const fs = require('fs');
const path = require('path');

const API_BASE = process.env.API_BASE || 'http://localhost:4220';
const STAFF_EMAIL    = process.env.STAFF_EMAIL    || 'sectest-staff@localcrm.local';
const STAFF_PASSWORD = process.env.STAFF_PASSWORD || 'SecTest123!';

function request(method, pathname, { token, body } = {}) {
  return new Promise((resolve, reject) => {
    const data = body !== undefined ? JSON.stringify(body) : null;
    const url = new URL(API_BASE + pathname);
    const req = http.request(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
      },
    }, (res) => {
      res.resume(); // discard body — we only need status for this test
      res.on('end', () => resolve({ status: res.statusCode }));
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function login(email, password) {
  const r = await new Promise((resolve, reject) => {
    const data = JSON.stringify({ email, password });
    const req = http.request(new URL(API_BASE + '/api/auth/login'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))));
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
  return r.token;
}

// Floods `count` requests, returns how many got 429.
async function floodCount(method, pathname, count, opts = {}) {
  let hit429 = 0;
  for (let i = 0; i < count; i++) {
    const r = await request(method, pathname, opts);
    if (r.status === 429) hit429++;
  }
  return hit429;
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
  console.log('== H-07 rate limiting ==');

  await check('POST /api/auth/reset-password trips 429 after 10 attempts', async () => {
    const hits = await floodCount('POST', '/api/auth/reset-password', 12, { body: { token: 'x'.repeat(64), password: 'irrelevant123' } });
    if (hits === 0) throw new Error('no 429 seen across 12 requests — limiter not active');
  });

  await check('GET /api/website/search trips 429 after 30 requests', async () => {
    const hits = await floodCount('GET', '/api/website/search?q=test', 32);
    if (hits === 0) throw new Error('no 429 seen across 32 requests — limiter not active');
  });

  await check('POST /api/cart/items trips 429 after 60 requests', async () => {
    const hits = await floodCount('POST', '/api/cart/items', 62, { body: { product_id: 999999, qty: 1 } });
    if (hits === 0) throw new Error('no 429 seen across 62 requests — limiter not active');
  });

  await check('POST /api/forms/public/nonexistent-slug/submit trips 429 after 20 requests/hour', async () => {
    const hits = await floodCount('POST', '/api/forms/public/sectest-h07-nonexistent-slug/submit', 22, { body: { email: 'x@example.com' } });
    if (hits === 0) throw new Error('no 429 seen across 22 requests — limiter not active');
  });

  await check('POST /api/ai/chat trips 429 after 20 requests/5min (staff session)', async () => {
    const token = await login(STAFF_EMAIL, STAFF_PASSWORD);
    const hits = await floodCount('POST', '/api/ai/chat', 22, { token, body: { messages: [{ role: 'user', content: 'hi' }] } });
    if (hits === 0) throw new Error('no 429 seen across 22 requests — limiter not active');
  });

  await check('donations.js checkoutLimiter is wired into POST /public/checkout (structural — skip:true outside production)', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'routes', 'donations.js'), 'utf8');
    if (!/router\.post\(\s*'\/public\/checkout',\s*checkoutLimiter/.test(src)) {
      throw new Error('checkoutLimiter is not wired into POST /public/checkout');
    }
  });

  await check('a global baseline limiter is mounted on /api (structural — 300/min is slow to flood safely)', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'index.js'), 'utf8');
    if (!/app\.use\('\/api',\s*globalRateLimit/.test(src)) {
      throw new Error('no global rate limiter mounted on /api in index.js');
    }
  });

  console.log(`\n${pass}/${pass + fail} passed`);
  process.exit(fail ? 1 : 0);
})();
