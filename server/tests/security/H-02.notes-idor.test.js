// =============================================================================
// H-02 — GET /api/notes had no permission gate and no row-level scope check:
// any authenticated user (including a portal customer) could pass any
// entity_id and read every internal note in the system.
//
// Fixtures: contact id 15 (owner_id=6, the 'sales'-role sectest-staff fixture)
// and contact id 16 (owner_id=11, someone else) — sectest-staff's scope per
// resolveOwnerScope is [6] (own records only), so contact 16 must be
// unreachable while contact 15 must still work.
//
// Run:  node server/tests/security/H-02.notes-idor.test.js
// =============================================================================
const http = require('http');

const API_BASE = process.env.API_BASE || 'http://localhost:4220';
const ORIGIN_HEADER = { Origin: (process.env.CLIENT_ORIGIN || 'http://localhost:5220').split(',')[0].trim() };
const STAFF_EMAIL  = process.env.STAFF_EMAIL  || 'sectest-staff@localcrm.local';
const STAFF_PASSWORD = process.env.STAFF_PASSWORD || 'SecTest123!';
const PORTAL_EMAIL    = process.env.PORTAL_EMAIL    || 'froe4009@gmail.com';
const PORTAL_PASSWORD = process.env.PORTAL_PASSWORD || 'DonorTest123!';
const OWNED_CONTACT_ID   = Number(process.env.OWNED_CONTACT_ID   || 15); // owner_id = staff fixture
const UNOWNED_CONTACT_ID = Number(process.env.UNOWNED_CONTACT_ID || 16); // owner_id = someone else

function request(method, path_, { token, qs } = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(API_BASE + path_ + (qs ? `?${qs}` : ''));
    const req = http.request(url, {
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
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({ email, password });
    const url = new URL(API_BASE + '/api/auth/login');
    const req = http.request(url, {
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
  console.log('== H-02 notes IDOR ==');

  const staffToken = await login(STAFF_EMAIL, STAFF_PASSWORD);
  const portalToken = await login(PORTAL_EMAIL, PORTAL_PASSWORD);

  await check('portal account cannot read notes at all (no notes.read permission)', async () => {
    const r = await request('GET', '/api/notes', {
      token: portalToken, qs: `entity_type=contact&entity_id=${OWNED_CONTACT_ID}`,
    });
    if (r.status !== 403) throw new Error(`expected 403 got ${r.status}: ${r.body}`);
  });

  await check('staff cannot read notes on a contact outside their scope', async () => {
    const r = await request('GET', '/api/notes', {
      token: staffToken, qs: `entity_type=contact&entity_id=${UNOWNED_CONTACT_ID}`,
    });
    if (r.status !== 403) throw new Error(`expected 403 got ${r.status}: ${r.body}`);
  });

  await check('staff CAN still read notes on their own contact (no regression)', async () => {
    const r = await request('GET', '/api/notes', {
      token: staffToken, qs: `entity_type=contact&entity_id=${OWNED_CONTACT_ID}`,
    });
    if (r.status !== 200) throw new Error(`expected 200 got ${r.status}: ${r.body}`);
    if (!Array.isArray(JSON.parse(r.body))) throw new Error('expected an array of notes');
  });

  await check('an invalid entity_type is rejected (400)', async () => {
    const r = await request('GET', '/api/notes', {
      token: staffToken, qs: `entity_type=task&entity_id=${OWNED_CONTACT_ID}`,
    });
    if (r.status !== 400) throw new Error(`expected 400 got ${r.status}: ${r.body}`);
  });

  console.log(`\n${pass}/${pass + fail} passed`);
  process.exit(fail ? 1 : 0);
})();
