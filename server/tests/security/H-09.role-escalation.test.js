// =============================================================================
// H-09 — PUT /api/roles/:id had no is_system guard (unlike its sibling
// DELETE) and no protection against the name-based admin bypass in
// middleware/auth.js: any roles.manage holder could rename the real admin
// role away, rename an unrelated role TO "admin" to grant themselves the
// bypass, or edit a role's permission_ids to grant themselves (or anyone)
// permissions they don't hold.
//
// Fixtures: a custom role 'sectest_roles_admin' (id 8, holds ONLY
// roles.manage — matches the audit's exact threat model, not admin) held
// by test user sectest-rolesadmin@localcrm.local; a second custom role
// 'sectest_target_role' (id 9) NOT held by that user, as an edit target;
// the real system 'admin' role is id 1.
//
// Run:  node server/tests/security/H-09.role-escalation.test.js
// =============================================================================
const http = require('http');

const API_BASE = process.env.API_BASE || 'http://localhost:4220';
const ORIGIN_HEADER = { Origin: (process.env.CLIENT_ORIGIN || 'http://localhost:5220').split(',')[0].trim() };
const EMAIL    = process.env.ROLES_ADMIN_EMAIL    || 'sectest-rolesadmin@localcrm.local';
const PASSWORD = process.env.ROLES_ADMIN_PASSWORD || 'SecTest123!';
const ADMIN_ROLE_ID  = Number(process.env.ADMIN_ROLE_ID  || 1);
const OWN_ROLE_ID    = Number(process.env.OWN_ROLE_ID    || 8);
const TARGET_ROLE_ID = Number(process.env.TARGET_ROLE_ID || 9);

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
  console.log('== H-09 role escalation ==');

  const token = await login(EMAIL, PASSWORD);

  await check('cannot rename the real admin (system) role away', async () => {
    const r = await request('PUT', `/api/roles/${ADMIN_ROLE_ID}`, {
      token, body: { name: 'not-admin-anymore', description: 'x' },
    });
    if (r.status !== 400) throw new Error(`expected 400 got ${r.status}: ${r.body}`);
  });

  await check('cannot rename an unrelated role TO "admin"', async () => {
    const r = await request('PUT', `/api/roles/${TARGET_ROLE_ID}`, {
      token, body: { name: 'admin', description: 'x' },
    });
    if (r.status !== 400) throw new Error(`expected 400 got ${r.status}: ${r.body}`);
  });

  await check('cannot modify a role the caller themselves holds', async () => {
    const r = await request('PUT', `/api/roles/${OWN_ROLE_ID}`, {
      token, body: { name: 'sectest_roles_admin', description: 'trying to self-edit' },
    });
    if (r.status !== 403) throw new Error(`expected 403 got ${r.status}: ${r.body}`);
  });

  await check('cannot grant permissions the caller does not hold, on a role they do not hold', async () => {
    const USERS_MANAGE_PERMISSION_ID = Number(process.env.USERS_MANAGE_PERMISSION_ID || 16);
    const r = await request('PUT', `/api/roles/${TARGET_ROLE_ID}`, {
      token, body: { name: 'sectest_target_role', description: 'x', permission_ids: [USERS_MANAGE_PERMISSION_ID] },
    });
    if (r.status !== 403) throw new Error(`expected 403 got ${r.status}: ${r.body}`);
  });

  await check('CAN still rename an unrelated non-system role with no permission changes (no regression)', async () => {
    const r = await request('PUT', `/api/roles/${TARGET_ROLE_ID}`, {
      token, body: { name: 'sectest_target_role', description: 'updated by test' },
    });
    if (r.status !== 200) throw new Error(`expected 200 got ${r.status}: ${r.body}`);
  });

  console.log(`\n${pass}/${pass + fail} passed`);
  process.exit(fail ? 1 : 0);
})();
