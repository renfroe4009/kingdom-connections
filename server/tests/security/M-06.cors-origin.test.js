// =============================================================================
// M-06 — CORS allowed a missing Origin header on every route, not just
// server-to-server ones. Not currently browser-exploitable (bearer-token
// auth, nothing for a browser to attach automatically to a no-Origin
// request) but unnecessary defense-in-depth loss, and the audit flags it as
// something that becomes exploitable if a future cookie/refresh-token
// change is made.
//
// Fixed: server/src/index.js's CORS origin-delegate now requires a real,
// allowlisted Origin for every route EXCEPT webhook paths (Authorize.net,
// Valor, Twilio, ConnectWise — genuine server-to-server callers that
// authenticate by HMAC signature and never send Origin) and /api/health
// (Railway's own uptime probe is a plain HTTP check, not a browser request
// — rejecting it would look identical to the service being down).
//
// Run:  node server/tests/security/M-06.cors-origin.test.js
// =============================================================================
const http = require('http');

const API_BASE = process.env.API_BASE || 'http://localhost:4220';
const ALLOWED_ORIGIN = (process.env.CLIENT_ORIGIN || 'http://localhost:5220').split(',')[0].trim();

function request(method, pathname, { headers } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(new URL(API_BASE + pathname), { method, headers: headers || {} }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
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
  console.log('== M-06 CORS Origin enforcement ==');

  await check('a normal API route with NO Origin header is rejected (403)', async () => {
    const r = await request('GET', '/api/roles', {});
    if (r.status !== 403) throw new Error(`expected 403, got ${r.status}: ${r.body}`);
  });

  await check('a normal API route with a DISALLOWED Origin is rejected (403)', async () => {
    const r = await request('GET', '/api/roles', { headers: { Origin: 'https://evil.example.com' } });
    if (r.status !== 403) throw new Error(`expected 403, got ${r.status}: ${r.body}`);
  });

  await check('a normal API route with the real allowlisted Origin is NOT rejected by CORS (no regression)', async () => {
    const r = await request('GET', '/api/roles', { headers: { Origin: ALLOWED_ORIGIN } });
    // Expect a 401 (no auth token) — the point is it's not a CORS 403.
    if (r.status === 403 && /CORS/.test(r.body)) throw new Error(`legitimate origin was rejected by CORS: ${r.body}`);
  });

  await check('/api/health works with NO Origin header (Railway\'s uptime probe never sends one)', async () => {
    const r = await request('GET', '/api/health', {});
    if (r.status !== 200) throw new Error(`expected 200, got ${r.status}: ${r.body}`);
  });

  await check('a webhook route with NO Origin header passes CORS (fails downstream on signature, not here)', async () => {
    const r = await request('POST', '/api/payments/webhook/authnet', {});
    if (r.status === 403 && /CORS/.test(r.body)) throw new Error(`webhook route was rejected by CORS: ${r.body}`);
  });

  console.log(`\n${pass}/${pass + fail} passed`);
  process.exit(fail ? 1 : 0);
})();
