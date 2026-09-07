// =============================================================================
// C-02 (Phase 0 interim gate) — POST /api/ai/chat must reject portal accounts
// and any account with no real CRM permission, while still allowing staff
// through. The full per-tool TOOL_POLICY (permission + row-scope on every
// one of the ~24 tools) is Phase 1 — this only closes the worst path: a
// portal customer using the assistant to read organisation-wide financials.
//
// Requires: PORTAL_EMAIL/PORTAL_PASSWORD and STAFF_EMAIL/STAFF_PASSWORD env
// vars pointing at real accounts (see this test's companion setup — a
// throwaway 'sales'-role user and the existing portal-role test user).
//
// Run:  node server/tests/security/C-02.ai-chat-interim-gate.test.js
// =============================================================================
const http = require('http');

const API_BASE = process.env.API_BASE || 'http://localhost:4220';
const PORTAL_EMAIL    = process.env.PORTAL_EMAIL    || 'froe4009@gmail.com';
const PORTAL_PASSWORD = process.env.PORTAL_PASSWORD || 'DonorTest123!';
const STAFF_EMAIL     = process.env.STAFF_EMAIL     || 'sectest-staff@localcrm.local';
const STAFF_PASSWORD  = process.env.STAFF_PASSWORD  || 'SecTest123!';

function request(method, path, { token, body } = {}) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const url = new URL(API_BASE + path);
    const req = http.request(url, {
      method,
      headers: {
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
  console.log('== C-02 interim AI-chat gate ==');

  await check('portal account is rejected with 403, no chat stream started', async () => {
    const token = await login(PORTAL_EMAIL, PORTAL_PASSWORD);
    const r = await request('POST', '/api/ai/chat', {
      token,
      body: { messages: [{ role: 'user', content: 'what is our total revenue this year?' }] },
    });
    if (r.status !== 403) throw new Error(`expected 403 got ${r.status}: ${r.body}`);
  });

  await check('staff account (sales role, contacts.read) is NOT blocked by the gate', async () => {
    const token = await login(STAFF_EMAIL, STAFF_PASSWORD);
    const r = await request('POST', '/api/ai/chat', {
      token,
      body: { messages: [{ role: 'user', content: 'hello' }] },
    });
    // The gate itself must pass (no 403). The endpoint may still fail
    // downstream (e.g. no Anthropic API key configured locally) — that's a
    // different concern, not what this test checks.
    if (r.status === 403) throw new Error(`staff account was blocked by the interim gate: ${r.body}`);
  });

  console.log(`\n${pass}/${pass + fail} passed`);
  process.exit(fail ? 1 : 0);
})();
