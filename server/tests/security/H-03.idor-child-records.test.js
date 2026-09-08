// =============================================================================
// H-03 — attachments.js (list/download/delete), households.js, and lists.js
// had only a coarse permission check (does the caller hold contacts.read at
// all?) with no row-level scope check against the parent entity/creator —
// a scoped sales agent could enumerate ids to reach records outside their
// scope. customReports.js was also named by the audit but was found, on
// inspection, to already enforce its own (different but sound) creator/
// shared-visibility check — not touched, no test needed there.
//
// Fixtures (see the remediation log for exact setup): contact 15 (owner=6,
// the 'sales'-role sectest-staff fixture) and contact 16 (owner=11,
// someone else) — attachments 1/2, households 1/2, and contact_lists 1/2
// are each seeded one per contact/creator to match.
//
// lists.js is checked via a direct function-level test rather than full
// HTTP, because lists.read/lists.write permission rows don't exist in this
// DB at all (a separate, pre-existing gap — only admin can reach these
// routes today regardless of this fix), so the scope check itself is
// currently unreachable by a non-admin HTTP request. The fix is still
// correct and load-bearing the moment that permission gap is fixed.
//
// Run:  node server/tests/security/H-03.idor-child-records.test.js
// =============================================================================
const http = require('http');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });

const API_BASE = process.env.API_BASE || 'http://localhost:4220';
const STAFF_EMAIL    = process.env.STAFF_EMAIL    || 'sectest-staff@localcrm.local';
const STAFF_PASSWORD = process.env.STAFF_PASSWORD || 'SecTest123!';

const OWNED_ATTACHMENT_ID = Number(process.env.OWNED_ATTACHMENT_ID || 1);
const OTHER_ATTACHMENT_ID = Number(process.env.OTHER_ATTACHMENT_ID || 2);
const OWNED_HOUSEHOLD_ID  = Number(process.env.OWNED_HOUSEHOLD_ID  || 1);
const OTHER_HOUSEHOLD_ID  = Number(process.env.OTHER_HOUSEHOLD_ID  || 2);

function request(method, path_, { token, qs } = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(API_BASE + path_ + (qs ? `?${qs}` : ''));
    const req = http.request(url, {
      method,
      headers: token ? { Authorization: `Bearer ${token}` } : {},
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
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({ email, password });
    const url = new URL(API_BASE + '/api/auth/login');
    const req = http.request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
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
  console.log('== H-03 IDOR on child records ==');
  const staffToken = await login(STAFF_EMAIL, STAFF_PASSWORD);

  // --- attachments.js ---
  await check('attachment download: out-of-scope contact is rejected (403)', async () => {
    const r = await request('GET', `/api/attachments/${OTHER_ATTACHMENT_ID}/download`, { token: staffToken });
    if (r.status !== 403) throw new Error(`expected 403 got ${r.status}: ${r.body}`);
  });
  await check('attachment download: own-scope contact still works (no regression)', async () => {
    const r = await request('GET', `/api/attachments/${OWNED_ATTACHMENT_ID}/download`, { token: staffToken });
    if (r.status !== 200) throw new Error(`expected 200 got ${r.status}: ${r.body}`);
  });
  await check('attachment list: out-of-scope entity_id is rejected (403)', async () => {
    const r = await request('GET', '/api/attachments', {
      token: staffToken, qs: 'entity_type=contact&entity_id=16',
    });
    if (r.status !== 403) throw new Error(`expected 403 got ${r.status}: ${r.body}`);
  });
  await check('attachment list: own-scope entity_id still works (no regression)', async () => {
    const r = await request('GET', '/api/attachments', {
      token: staffToken, qs: 'entity_type=contact&entity_id=15',
    });
    if (r.status !== 200) throw new Error(`expected 200 got ${r.status}: ${r.body}`);
  });

  // --- households.js ---
  await check('household GET: out-of-scope household is rejected (403)', async () => {
    const r = await request('GET', `/api/households/${OTHER_HOUSEHOLD_ID}`, { token: staffToken });
    if (r.status !== 403) throw new Error(`expected 403 got ${r.status}: ${r.body}`);
  });
  await check('household GET: own-scope household still works (no regression)', async () => {
    const r = await request('GET', `/api/households/${OWNED_HOUSEHOLD_ID}`, { token: staffToken });
    if (r.status !== 200) throw new Error(`expected 200 got ${r.status}: ${r.body}`);
  });

  // --- lists.js (function-level — see file header for why) ---
  await check('lists.js: assertOwnerEntityInScope blocks a created_by outside scope', async () => {
    const scopeMod = require(path.join(__dirname, '..', '..', 'src', 'services', 'scope.js'));
    const fakeSalesUser = { id: 6, roles: ['sales'] };
    let threw = false;
    try {
      await scopeMod.assertOwnerEntityInScope(fakeSalesUser, 'contact_lists', 2, 'created_by'); // created_by=11
    } catch (e) {
      threw = e.status === 403;
    }
    if (!threw) throw new Error('expected a 403 for a list created by a different user');
  });
  await check('lists.js: assertOwnerEntityInScope allows a created_by within scope (no regression)', async () => {
    const scopeMod = require(path.join(__dirname, '..', '..', 'src', 'services', 'scope.js'));
    const fakeSalesUser = { id: 6, roles: ['sales'] };
    await scopeMod.assertOwnerEntityInScope(fakeSalesUser, 'contact_lists', 1, 'created_by'); // created_by=6, must not throw
  });

  console.log(`\n${pass}/${pass + fail} passed`);
  process.exit(fail ? 1 : 0);
})();
