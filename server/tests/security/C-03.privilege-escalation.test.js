// =============================================================================
// C-03 — self-role-escalation via PUT /api/users/:id, and assigning a role
// carrying permissions the caller doesn't hold, via either POST or PUT.
//
// Fixtures (created alongside this test, see the remediation log for the
// exact shell commands): a custom, non-admin role ("sectest_user_admin")
// holding ONLY the users.manage permission — matching the audit's actual
// threat model exactly ("Requires any account with users.manage", which
// need not be the admin role) — assigned to a manager test user (id 7),
// plus a 'sales'-role report of that manager (id 8, manager_id=7) as the
// escalation target. User 7 ALSO holds the real 'manager' role (added
// alongside sectest_user_admin after H-10 shipped) purely so
// resolveOwnerScope's dedicated manager branch gives it real scope over
// its report — H-10 correctly removed the old fail-open fallback that
// used to give sectest_user_admin (an uncategorised custom role) blanket
// unrestricted scope, which this test's "no regression" case had been
// incidentally relying on.
//
// Run:  node server/tests/security/C-03.privilege-escalation.test.js
// =============================================================================
const http = require('http');

const API_BASE = process.env.API_BASE || 'http://localhost:4220';
const ORIGIN_HEADER = { Origin: (process.env.CLIENT_ORIGIN || 'http://localhost:5220').split(',')[0].trim() };
const MANAGER_EMAIL = process.env.MANAGER_EMAIL || 'sectest-manager@localcrm.local';
const REPORT_EMAIL  = process.env.REPORT_EMAIL  || 'sectest-report@localcrm.local';
const TEST_PASSWORD = process.env.TEST_PASSWORD || 'SecTest123!';
const ADMIN_ROLE_ID       = Number(process.env.ADMIN_ROLE_ID || 1);
// The custom "sectest_user_admin" role (users.manage only) the manager
// fixture actually holds — used to prove a same-privilege grant still works.
const MANAGER_OWN_ROLE_ID = Number(process.env.MANAGER_OWN_ROLE_ID || 6);

function request(method, path, { token, body } = {}) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const url = new URL(API_BASE + path);
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
  return JSON.parse(r.body);
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
  console.log('== C-03 privilege escalation ==');

  const manager = await login(MANAGER_EMAIL, TEST_PASSWORD);
  const report  = await login(REPORT_EMAIL, TEST_PASSWORD);
  const managerId = manager.user.id;
  const reportId  = report.user.id;

  await check('manager cannot self-promote via PUT /:id {role_ids:[admin]}', async () => {
    const r = await request('PUT', `/api/users/${managerId}`, {
      token: manager.token,
      body: { role_ids: [ADMIN_ROLE_ID] },
    });
    if (r.status !== 403) throw new Error(`expected 403 got ${r.status}: ${r.body}`);
  });

  await check('manager cannot grant a report the admin role (permission-subset check)', async () => {
    const r = await request('PUT', `/api/users/${reportId}`, {
      token: manager.token,
      body: { role_ids: [ADMIN_ROLE_ID] },
    });
    if (r.status !== 403) throw new Error(`expected 403 got ${r.status}: ${r.body}`);
  });

  await check('manager CAN still grant a report a role they themselves hold (no regression)', async () => {
    const r = await request('PUT', `/api/users/${reportId}`, {
      token: manager.token,
      body: { role_ids: [MANAGER_OWN_ROLE_ID] },
    });
    if (r.status !== 200) throw new Error(`expected 200 got ${r.status}: ${r.body}`);
    // revert so re-running this test starts from a known state
    await request('PUT', `/api/users/${reportId}`, {
      token: manager.token,
      body: { role_ids: [] },
    });
  });

  await check('manager cannot create a new user with the admin role via POST /', async () => {
    const r = await request('POST', '/api/users', {
      token: manager.token,
      body: {
        email: `sectest-escalation-attempt-${Date.now()}@localcrm.local`,
        password: 'ThrowawayPass123',
        role_ids: [ADMIN_ROLE_ID],
      },
    });
    if (r.status !== 403) throw new Error(`expected 403 got ${r.status}: ${r.body}`);
  });

  console.log(`\n${pass}/${pass + fail} passed`);
  process.exit(fail ? 1 : 0);
})();
