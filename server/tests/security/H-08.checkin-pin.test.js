// =============================================================================
// H-08 — event check-in PIN: was a 6-digit numeric PIN (900k space) with no
// rate limit and a non-constant-time compare, reachable by two
// unauthenticated routes (events.js's ticket scan, volunteers.js's badge
// scan) that both check the same events.checkin_pin.
//
// Fixed: 8-character PIN from a 32-symbol alphabet, constant-time compare,
// auto-expiry via the event's end_at, and a rate limiter SHARED across
// both routes (an attacker splitting attempts between the two endpoints
// must not get double the budget).
//
// Fixtures: this test creates its own throwaway events per run (rather
// than reusing fixed ids) so repeated runs don't collide with each other's
// accumulated rate-limit state in the same 15-minute window.
//
// Run:  node server/tests/security/H-08.checkin-pin.test.js
// =============================================================================
const http = require('http');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });
const mysql = require('mysql2/promise');

const API_BASE = process.env.API_BASE || 'http://localhost:4220';
const ORIGIN_HEADER = { Origin: (process.env.CLIENT_ORIGIN || 'http://localhost:5220').split(',')[0].trim() };

function post(pathname, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const url = new URL(API_BASE + pathname);
    const req = http.request(url, {
      method: 'POST',
      headers: { ...ORIGIN_HEADER, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

let db;
async function makeEvent({ pin, endAt }) {
  const slug = `sectest-h08-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const [ins] = await db.query(
    `INSERT INTO events (name, slug, start_at, end_at, checkin_pin, is_active)
     VALUES ('SecTest H-08', :slug, '2026-01-01 10:00:00', :end_at, :pin, 1)`,
    { slug, end_at: endAt, pin }
  );
  return ins.insertId;
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
  db = await mysql.createConnection({
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
    namedPlaceholders: true,
  });

  console.log('== H-08 event check-in PIN ==');

  const { generatePin } = require(path.join(__dirname, '..', '..', 'src', 'services', 'checkinPin.js'));

  await check('generatePin() produces an 8-character PIN (not 6-digit)', () => {
    const pin = generatePin();
    if (pin.length !== 8) throw new Error(`expected length 8, got ${pin.length}: ${pin}`);
    if (/^\d{6}$/.test(pin)) throw new Error('PIN still looks like the old 6-digit numeric format');
  });

  await check('wrong PIN on a live event is rejected (403), no ticket lookup attempted', async () => {
    const eventId = await makeEvent({ pin: 'ABCD2345', endAt: '2099-01-01 10:00:00' });
    const r = await post(`/api/events/public/checkin/${eventId}/scan`, { pin: 'WRONGPIN', qr_token: 'bogus' });
    if (r.status !== 403) throw new Error(`expected 403 got ${r.status}: ${r.body}`);
  });

  await check('correct PIN on an EXPIRED event (end_at in the past) is rejected', async () => {
    const eventId = await makeEvent({ pin: 'ZYXW9876', endAt: '2020-01-01 12:00:00' });
    const r = await post(`/api/events/public/checkin/${eventId}/scan`, { pin: 'ZYXW9876', qr_token: 'bogus' });
    if (r.status !== 403) throw new Error(`expected 403 got ${r.status}: ${r.body}`);
  });

  await check('correct PIN on a live event passes the PIN check (no regression — fails later on bogus qr_token instead)', async () => {
    const eventId = await makeEvent({ pin: 'LIVE1234', endAt: '2099-01-01 10:00:00' });
    const r = await post(`/api/events/public/checkin/${eventId}/scan`, { pin: 'LIVE1234', qr_token: 'bogus-token-not-a-real-ticket' });
    // A correct PIN must NOT produce "Invalid or expired check-in PIN" —
    // it should get past that check and fail on the (unrelated) bogus
    // qr_token instead, proving the PIN gate itself passed.
    if (/Invalid or expired check-in PIN/.test(r.body)) {
      throw new Error(`correct PIN was rejected: ${r.status} ${r.body}`);
    }
  });

  await check('rate limit trips after 10 attempts, SHARED across events.js and volunteers.js routes', async () => {
    const eventId = await makeEvent({ pin: 'SHARE567', endAt: '2099-01-01 10:00:00' });
    let last;
    // 10 wrong attempts via events.js's route
    for (let i = 0; i < 10; i++) {
      last = await post(`/api/events/public/checkin/${eventId}/scan`, { pin: 'WRONG', qr_token: 'x' });
    }
    if (last.status === 429) throw new Error('limit tripped before the 11th attempt — too strict');
    // The 11th attempt, via the OTHER route (volunteers.js), must already
    // be blocked — proving the two routes share one counter, not two.
    const eleventh = await post(`/api/volunteers/public/checkin/${eventId}/scan`, { pin: 'WRONG', qr_token: 'x' });
    if (eleventh.status !== 429) {
      throw new Error(`expected 429 on the 11th attempt (cross-route) got ${eleventh.status}: ${eleventh.body}`);
    }
  });

  await db.end();
  console.log(`\n${pass}/${pass + fail} passed`);
  process.exit(fail ? 1 : 0);
})();
