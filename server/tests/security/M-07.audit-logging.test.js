// =============================================================================
// M-07 — security-relevant audit writes were all best-effort: every login,
// logout, password reset, and impersonation-start insert was wrapped in a
// swallowing catch, so a DB hiccup meant the event (including an
// attacker's) left no trace at all, with the request still succeeding.
// Separately, role changes (both a role's own definition AND which roles a
// user holds) and permission denials were never logged at all, at any
// severity.
//
// Fixed: the shared logActivity() helper gained an opt-in `required` flag
// (default false — the many non-security callers like "note added" stay
// best-effort, unaffected); auth.js's login/logout/password-reset and
// users.js's impersonate now pass required:true and no longer swallow.
// roles.js gained role_created/role_updated/role_deleted logging
// (required:true), users.js gained role_assigned logging (required:true)
// on both POST and PUT, and middleware/auth.js's requirePermission — the
// single choke point for ~500 routes' permission checks — now logs every
// denial (best-effort, high-volume/informational, not required:true).
//
// Run:  node server/tests/security/M-07.audit-logging.test.js
// =============================================================================
const fs = require('fs');
const http = require('http');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });
const mysql = require('mysql2/promise');

const API_BASE = process.env.API_BASE || 'http://localhost:4220';
const ROLES_ADMIN_EMAIL    = process.env.ROLES_ADMIN_EMAIL    || 'sectest-rolesadmin@localcrm.local';
const ROLES_ADMIN_PASSWORD = process.env.ROLES_ADMIN_PASSWORD || 'SecTest123!';
const PORTAL_EMAIL    = process.env.PORTAL_EMAIL    || 'froe4009@gmail.com';
const PORTAL_PASSWORD = process.env.PORTAL_PASSWORD || 'DonorTest123!';
const TARGET_ROLE_ID = Number(process.env.TARGET_ROLE_ID || 9); // 'sectest_target_role', not held by the fixture

function request(method, pathname, { token, body } = {}) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = http.request(new URL(API_BASE + pathname), {
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

let db;
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

  console.log('== M-07 audit logging ==');

  // --- logActivity()'s required flag, directly ---
  const { logActivity } = require(path.join(__dirname, '..', '..', 'src', 'services', 'activity.js'));

  await check('logActivity() with required:true THROWS on a genuine write failure', async () => {
    let threw = false;
    try {
      // entity_type is a strict ENUM — this value isn't in it, and
      // STRICT_TRANS_TABLES is on, so this is a real DB error, not a mock.
      await logActivity({ userId: 1, entityType: 'sectest-not-a-real-enum-value', entityId: 1, action: 'test', required: true });
    } catch (e) { threw = true; }
    if (!threw) throw new Error('expected logActivity to throw with required:true, it did not');
  });

  await check('logActivity() WITHOUT required (default) does NOT throw on the same failure (no regression for the ~24 other callers)', async () => {
    await logActivity({ userId: 1, entityType: 'sectest-not-a-real-enum-value', entityId: 1, action: 'test' });
    // reaching here without throwing is the pass condition
  });

  // --- structural: the swallow is actually gone from the specific sites ---
  await check('auth.js: login/logout/password-reset activity inserts are no longer individually swallowed', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'routes', 'auth.js'), 'utf8');
    const swallows = (src.match(/catch \(_e\) \{ \/\* non-fatal \*\/ \}/g) || []).length;
    if (swallows > 0) throw new Error(`found ${swallows} remaining "non-fatal" swallow(s) in auth.js`);
  });

  await check('users.js: impersonate logging is no longer swallowed with .catch(() => {})', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'routes', 'users.js'), 'utf8');
    if (/impersonate_start[\s\S]{0,50}\)\.catch\(\(\) => \{\}\)/.test(src)) {
      throw new Error('impersonate_start logging is still wrapped in a swallowing .catch');
    }
  });

  // --- functional: role-definition changes are actually logged ---
  await check('PUT /api/roles/:id writes a role_updated activity row for real', async () => {
    const token = await login(ROLES_ADMIN_EMAIL, ROLES_ADMIN_PASSWORD);
    const beforeId = (await db.query(
      `SELECT COALESCE(MAX(id), 0) AS id FROM activities WHERE entity_type='role' AND entity_id=:id AND action='role_updated'`,
      { id: TARGET_ROLE_ID }
    ))[0][0].id;
    const r = await request('PUT', `/api/roles/${TARGET_ROLE_ID}`, {
      token, body: { name: 'sectest_target_role', description: `M-07 test ${Date.now()}` },
    });
    if (r.status !== 200) throw new Error(`PUT failed: ${r.status} ${r.body}`);
    // Require a NEW row (id greater than whatever existed before this
    // call), not just "any role_updated row ever" — otherwise this
    // trivially passes against a stale row from an earlier run.
    const [[row]] = await db.query(
      `SELECT id FROM activities
        WHERE entity_type='role' AND entity_id=:id AND action='role_updated' AND id > :beforeId
        ORDER BY id DESC LIMIT 1`,
      { id: TARGET_ROLE_ID, beforeId }
    );
    if (!row) throw new Error('no NEW role_updated activity row found for this call');
  });

  // --- functional: permission denials are actually logged ---
  await check('a denied request writes a permission_denied activity row for real', async () => {
    const token = await login(PORTAL_EMAIL, PORTAL_PASSWORD);
    const before = Date.now();
    const r = await request('GET', '/api/roles', { token });
    if (r.status !== 403) throw new Error(`expected 403 got ${r.status}: ${r.body}`);
    // Fire-and-forget on the server side — give it a brief moment to land.
    await new Promise((resolve) => setTimeout(resolve, 300));
    const [[row]] = await db.query(
      `SELECT id FROM activities WHERE action='permission_denied' AND created_at >= FROM_UNIXTIME(:ts) ORDER BY id DESC LIMIT 1`,
      { ts: Math.floor(before / 1000) - 1 }
    );
    if (!row) throw new Error('no permission_denied activity row found after a real 403');
  });

  await db.end();
  console.log(`\n${pass}/${pass + fail} passed`);
  process.exit(fail ? 1 : 0);
})();
