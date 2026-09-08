// =============================================================================
// M-04 — password rules were inconsistent across 6 call sites (6-8 char
// minimums, bcrypt cost 10-12, one path requiring character classes the
// others didn't). M-05 — POST /auth/login returned in a few ms for a
// non-existent email (no bcrypt.compare at all) vs. ~100-300ms for an
// existing one, a stable, remotely-measurable gap useful for account
// enumeration.
//
// Fixed: a single shared server/src/services/passwordPolicy.js — 12-char
// minimum (no composition rules, per NIST SP 800-63B), bcrypt cost 12
// everywhere, rehash-on-login when a stored hash predates the current cost,
// and a best-effort (fail-open) Have I Been Pwned k-anonymity check. auth.js
// now always runs a bcrypt.compare — against a fixed dummy hash when no
// user matched — so both paths cost the same regardless of account
// existence.
//
// Run:  node server/tests/security/M-04-M-05.password-policy-timing.test.js
// =============================================================================
const path = require('path');
const http = require('http');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');

const API_BASE = process.env.API_BASE || 'http://localhost:4220';
const ORIGIN_HEADER = { Origin: (process.env.CLIENT_ORIGIN || 'http://localhost:5220').split(',')[0].trim() };
const ADMIN_EMAIL    = process.env.ADMIN_EMAIL    || 'sectest-admin@localcrm.local';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'SecTest123!';

function request(method, pathname, { token, body } = {}) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const start = process.hrtime.bigint();
    const req = http.request(new URL(API_BASE + pathname), {
      method,
      headers: { ...ORIGIN_HEADER,
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
      },
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const ms = Number(process.hrtime.bigint() - start) / 1e6;
        resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8'), ms });
      });
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

function median(arr) {
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
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

  console.log('== M-04 password policy / M-05 login timing ==');

  // --- M-05: login timing parity ---
  // Uses a dedicated, disposable fixture account for the "existing user,
  // wrong password" leg — NOT the shared admin fixture other tests in this
  // suite depend on. loginLimiter (H-07) counts failed attempts per
  // email+IP; deliberately generating repeated wrong-password failures
  // against a shared account across many test runs would eventually lock
  // that account out for every other test relying on it. A fresh, unique
  // email each run means this test's own rate-limit footprint never
  // accumulates across runs either.
  let timingUserId;
  await check('login timing: a non-existent email costs roughly the same as an existing one (within 80ms median)', async () => {
    const timingEmail = `sectest-m05-timing-${Date.now()}@localcrm.local`;
    const [ins] = await db.query(
      `INSERT INTO users (email, password_hash, first_name, last_name, is_active)
       VALUES (:email, :hash, 'Timing', 'Fixture', 1)`,
      { email: timingEmail, hash: await bcrypt.hash('sectest-timing-fixture-pw12', 12) }
    );
    timingUserId = ins.insertId;

    const RUNS = 5;
    const nonexistent = [];
    const existingWrong = [];
    for (let i = 0; i < RUNS; i++) {
      nonexistent.push((await request('POST', '/api/auth/login', { body: { email: `sectest-m05-nosuchuser-${Date.now()}-${i}@localcrm.local`, password: 'whatever12345' } })).ms);
      existingWrong.push((await request('POST', '/api/auth/login', { body: { email: timingEmail, password: 'definitely-wrong-password-12345' } })).ms);
    }
    const gap = Math.abs(median(existingWrong) - median(nonexistent));
    if (gap > 80) {
      throw new Error(`median timing gap ${gap.toFixed(1)}ms exceeds 80ms — nonexistent=${median(nonexistent).toFixed(1)}ms existing=${median(existingWrong).toFixed(1)}ms`);
    }
  });

  // --- M-04: shared minimum length ---
  let targetUserId;
  await check('setup: locate a low-privilege test user to exercise PUT /api/users/:id on', async () => {
    const [[row]] = await db.query(`SELECT id FROM users WHERE email = 'sectest-report@localcrm.local'`);
    if (!row) throw new Error('expected fixture user sectest-report@localcrm.local to exist');
    targetUserId = row.id;
  });

  await check('PUT /api/users/:id: an 8-char password is rejected (400) — the old admin-set minimum was 6', async () => {
    const token = await login(ADMIN_EMAIL, ADMIN_PASSWORD);
    const r = await request('PUT', `/api/users/${targetUserId}`, { token, body: { password: 'short123' } });
    if (r.status !== 400) throw new Error(`expected 400, got ${r.status}: ${r.body}`);
  });

  await check('PUT /api/users/:id: a 12-char password is accepted, hashed at bcrypt cost 12', async () => {
    const token = await login(ADMIN_EMAIL, ADMIN_PASSWORD);
    const r = await request('PUT', `/api/users/${targetUserId}`, { token, body: { password: 'sectestpw12chars' } });
    if (r.status !== 200) throw new Error(`expected 200, got ${r.status}: ${r.body}`);
    const [[row]] = await db.query('SELECT password_hash FROM users WHERE id = :id', { id: targetUserId });
    if (bcrypt.getRounds(row.password_hash) !== 12) throw new Error(`expected bcrypt cost 12, got ${bcrypt.getRounds(row.password_hash)}`);
  });

  // --- M-04: rehash-on-login ---
  let rehashUserId;
  await check('rehash-on-login: a cost-10 hash is upgraded to cost 12 after a successful login', async () => {
    const oldHash = await bcrypt.hash('sectest-rehash-pw-12chars', 10);
    const [ins] = await db.query(
      `INSERT INTO users (email, password_hash, first_name, last_name, is_active)
       VALUES ('sectest-m04-rehash@localcrm.local', :hash, 'Rehash', 'Test', 1)`,
      { hash: oldHash }
    );
    rehashUserId = ins.insertId;
    if (bcrypt.getRounds(oldHash) !== 10) throw new Error('fixture setup itself is wrong — expected a cost-10 hash');

    await login('sectest-m04-rehash@localcrm.local', 'sectest-rehash-pw-12chars');
    // Rehashing is fire-and-forget (non-blocking) — give it a brief moment to land.
    await new Promise((resolve) => setTimeout(resolve, 300));
    const [[row]] = await db.query('SELECT password_hash FROM users WHERE id = :id', { id: rehashUserId });
    if (bcrypt.getRounds(row.password_hash) !== 12) throw new Error(`expected the hash to be upgraded to cost 12, got cost ${bcrypt.getRounds(row.password_hash)}`);
    // The new hash must still validate the SAME password.
    const stillWorks = await bcrypt.compare('sectest-rehash-pw-12chars', row.password_hash);
    if (!stillWorks) throw new Error('rehashed hash no longer matches the original password');
  });

  // --- M-04: breach check (live network call to the HIBP API) ---
  await check('a known-breached password is rejected on user creation (live HIBP k-anonymity check)', async () => {
    const token = await login(ADMIN_EMAIL, ADMIN_PASSWORD);
    // "password123456" is a well-documented top-of-list breached password —
    // 14 chars, passes the length check, so a 400 here can only be the
    // breach check (not the length rule).
    const r = await request('POST', '/api/users', {
      token, body: { email: `sectest-m04-breach-${Date.now()}@localcrm.local`, password: 'password123456' },
    });
    if (r.status !== 400 || !/breach/i.test(r.body)) {
      console.log(`        (note: this check requires live internet access to api.pwnedpasswords.com — got ${r.status}: ${r.body})`);
      throw new Error(`expected 400 mentioning "breach", got ${r.status}: ${r.body}`);
    }
  });

  await check('cleanup: remove fixtures', async () => {
    if (timingUserId) await db.query('DELETE FROM users WHERE id = :id', { id: timingUserId });
    if (rehashUserId) await db.query('DELETE FROM users WHERE id = :id', { id: rehashUserId });
    // Restore the report fixture's password to what other tests expect.
    const restored = await bcrypt.hash('SecTest123!', 12);
    await db.query('UPDATE users SET password_hash = :hash WHERE id = :id', { hash: restored, id: targetUserId });
  });

  await db.end();
  console.log(`\n${pass}/${pass + fail} passed`);
  process.exit(fail ? 1 : 0);
})();
