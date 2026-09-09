// =============================================================================
// PHASE5-01 — new finding, discovered during Phase 5's adversarial retest
// (the route-authorization-coverage audit in scripts/audit-route-coverage.js
// flagged GET /api/ada/check as neither protected nor allowlisted).
//
// GET /api/ada/check fetched any caller-supplied `url` query param
// server-side with NO authentication and NO restriction on target — a full
// unauthenticated SSRF (server-side request forgery) primitive: any
// unauthenticated caller could make this server issue outbound requests to
// internal-network addresses (other services on the same private network),
// loopback (127.0.0.1 — the server's own other ports), and link-local
// addresses (169.254.0.0/16, where cloud metadata endpoints like AWS's
// 169.254.169.254 live). Derived content from the fetched page (title,
// headings, link text, presence/absence of elements) was reflected back to
// the caller, giving enough signal to fingerprint internal services and
// confirm what's reachable — not a blind SSRF.
//
// Fixed: requireAuth + requirePermission('settings.manage') closes the
// "anyone on the internet" exposure. Defense-in-depth against a legitimate-
// but-compromised staff session (or a staff member pasting a malicious
// link): isSafeTargetUrl() resolves the hostname via DNS and rejects
// private/loopback/link-local IP ranges — checking the resolved IP, not
// just the URL string, so DNS rebinding can't trivially bypass it. Redirects
// are not followed (redirect: 'manual') so a URL that passes the check
// can't hop to an internal address via a 3xx response. A dedicated rate
// limiter (20/5min) closes the "use this server as an anonymizing request
// proxy" abuse angle.
//
// Run:  node server/tests/security/PHASE5-01.ssrf-ada-check.test.js
// =============================================================================
const path = require('path');
const http = require('http');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });

const API_BASE = process.env.API_BASE || 'http://localhost:4220';
const ORIGIN_HEADER = { Origin: (process.env.CLIENT_ORIGIN || 'http://localhost:5220').split(',')[0].trim() };
const ADMIN_EMAIL    = process.env.ADMIN_EMAIL    || 'sectest-admin@localcrm.local';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'SecTest123!';

function request(method, pathname, { token } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(new URL(API_BASE + pathname), {
      method,
      headers: { ...ORIGIN_HEADER, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.end();
  });
}

async function login(email, password) {
  // login needs a JSON body — use a dedicated helper rather than reusing
  // the GET-only `request` above.
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({ email, password });
    const req = http.request(new URL(API_BASE + '/api/auth/login'), {
      method: 'POST',
      headers: { ...ORIGIN_HEADER, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        if (res.statusCode !== 200) return reject(new Error(`login failed: ${res.statusCode}`));
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')).token);
      });
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
  console.log('== PHASE5-01 SSRF in GET /api/ada/check ==');

  await check('an UNAUTHENTICATED caller cannot reach the endpoint at all', async () => {
    const r = await request('GET', '/api/ada/check?url=http://example.com');
    if (r.status !== 401) throw new Error(`expected 401, got ${r.status}: ${r.body}`);
  });

  const token = await login(ADMIN_EMAIL, ADMIN_PASSWORD);

  await check('an authenticated staff caller targeting a LOOPBACK address is refused', async () => {
    const r = await request('GET', '/api/ada/check?url=http://127.0.0.1:4220/api/health', { token });
    if (r.status !== 400) throw new Error(`expected 400, got ${r.status}: ${r.body}`);
  });

  await check('an authenticated staff caller targeting the cloud-metadata link-local address is refused', async () => {
    const r = await request('GET', '/api/ada/check?url=http://169.254.169.254/latest/meta-data/', { token });
    if (r.status !== 400) throw new Error(`expected 400, got ${r.status}: ${r.body}`);
  });

  await check('an authenticated staff caller targeting a private RFC1918 address is refused', async () => {
    const r = await request('GET', '/api/ada/check?url=http://192.168.1.1/', { token });
    if (r.status !== 400) throw new Error(`expected 400, got ${r.status}: ${r.body}`);
  });

  await check('a real public URL still works for an authenticated, permitted caller (no regression)', async () => {
    const r = await request('GET', '/api/ada/check?url=http://example.com', { token });
    if (r.status !== 200) throw new Error(`expected 200, got ${r.status}: ${r.body}`);
    const body = JSON.parse(r.body);
    if (body.pageTitle !== 'Example Domain') throw new Error(`unexpected body: ${r.body}`);
  });

  console.log(`\n${pass}/${pass + fail} passed`);
  process.exit(fail ? 1 : 0);
})();
