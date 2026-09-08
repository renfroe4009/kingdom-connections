// =============================================================================
// H-05 — JWTs were fully stateless: no way to invalidate a token before its
// 8h expiry. Logout did nothing but log an event; a password reset changed
// password_hash but left every already-issued token valid; and the
// impersonation token was signed with `sub: target.id` instead of the real
// actor's id, making impersonated actions indistinguishable from the
// target's own in any downstream check that trusts `sub`.
//
// Fixed:
//   - signToken() adds a `jti` claim; loadUserFromRequest() rejects any
//     token whose jti is in revoked_tokens.
//   - POST /auth/logout inserts the current token's jti into revoked_tokens.
//   - users.token_epoch, bumped on self-service reset (auth.js) and
//     admin-initiated password change (users.js PUT /:id); a token's
//     `epoch` claim must match the current value or it's rejected, even if
//     neither expired nor individually revoked.
//   - users.js's impersonate route now signs `sub: req.user.id` (the real
//     actor) with `impersonating_as: targetId` — loadUserFromRequest still
//     resolves *whose data to load* from impersonating_as, but `sub` now
//     correctly identifies who is actually acting.
//
// Run:  node server/tests/security/H-05.session-revocation.test.js
// =============================================================================
const crypto = require('crypto');
const http = require('http');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });
const mysql = require('mysql2/promise');
const jwt = require('jsonwebtoken');

const API_BASE = process.env.API_BASE || 'http://localhost:4220';
const ADMIN_EMAIL    = process.env.ADMIN_EMAIL    || 'sectest-admin@localcrm.local';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'SecTest123!';
const ROLES_ADMIN_EMAIL    = process.env.ROLES_ADMIN_EMAIL    || 'sectest-rolesadmin@localcrm.local';
const ROLES_ADMIN_PASSWORD = process.env.ROLES_ADMIN_PASSWORD || 'SecTest123!';
const REPORT_EMAIL = process.env.REPORT_EMAIL || 'sectest-report@localcrm.local'; // id 8, impersonation target
const REPORT_ID    = Number(process.env.REPORT_ID || 8);

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

  console.log('== H-05 session revocation ==');

  // --- 1. Logout actually revokes the token ---
  await check('a token still works right after login', async () => {
    const token = await login(ROLES_ADMIN_EMAIL, ROLES_ADMIN_PASSWORD);
    const r = await request('GET', '/api/auth/me', { token });
    if (r.status !== 200) throw new Error(`expected 200, got ${r.status}: ${r.body}`);
  });

  await check('the SAME token is rejected (401) after logout', async () => {
    const token = await login(ROLES_ADMIN_EMAIL, ROLES_ADMIN_PASSWORD);
    const out = await request('POST', '/api/auth/logout', { token });
    if (out.status !== 200) throw new Error(`logout itself failed: ${out.status} ${out.body}`);
    const r = await request('GET', '/api/auth/me', { token });
    if (r.status !== 401) throw new Error(`expected 401 after logout, got ${r.status}: ${r.body}`);
  });

  await check('logout writes a real row into revoked_tokens keyed by the token\'s jti', async () => {
    const token = await login(ROLES_ADMIN_EMAIL, ROLES_ADMIN_PASSWORD);
    const decoded = jwt.decode(token);
    if (!decoded?.jti) throw new Error('token has no jti claim — signToken() regressed');
    await request('POST', '/api/auth/logout', { token });
    const [[row]] = await db.query('SELECT jti FROM revoked_tokens WHERE jti = :jti', { jti: decoded.jti });
    if (!row) throw new Error('no revoked_tokens row found for this token\'s jti');
  });

  // --- 2. Password reset invalidates every prior session (epoch bump) ---
  await check('resetting a password via the emailed-link flow invalidates a token issued before the reset', async () => {
    // Fixture: sectest-rolesadmin, id 12 (also used by M-07/H-09 tests).
    const USER_ID = 12;
    const [[before]] = await db.query('SELECT token_epoch, password_hash FROM users WHERE id = :id', { id: USER_ID });

    const oldToken = await login(ROLES_ADMIN_EMAIL, ROLES_ADMIN_PASSWORD);
    const pre = await request('GET', '/api/auth/me', { token: oldToken });
    if (pre.status !== 200) throw new Error(`fixture token didn't even work before reset: ${pre.status}`);

    // Simulate "user clicked the emailed reset link": store a known raw
    // token's hash directly (exactly what POST /forgot-password does),
    // bypassing the email step itself since we're testing reset-password,
    // not mail delivery.
    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const expires = new Date(Date.now() + 60 * 60 * 1000).toISOString().slice(0, 19).replace('T', ' ');
    await db.query(
      'UPDATE users SET password_reset_token = :hash, password_reset_expires_at = :exp WHERE id = :id',
      { hash: tokenHash, exp: expires, id: USER_ID }
    );

    try {
      const resetRes = await request('POST', '/api/auth/reset-password', {
        body: { token: rawToken, password: ROLES_ADMIN_PASSWORD }, // reset to the SAME password so later tests keep working
      });
      if (resetRes.status !== 200) throw new Error(`reset-password failed: ${resetRes.status} ${resetRes.body}`);

      const [[after]] = await db.query('SELECT token_epoch FROM users WHERE id = :id', { id: USER_ID });
      if (after.token_epoch !== before.token_epoch + 1) {
        throw new Error(`expected token_epoch to increment from ${before.token_epoch}, got ${after.token_epoch}`);
      }

      const post = await request('GET', '/api/auth/me', { token: oldToken });
      if (post.status !== 401) throw new Error(`expected the PRE-reset token to be rejected (401), got ${post.status}`);
    } finally {
      // Restore the exact original hash so we haven't perturbed unrelated state.
      await db.query('UPDATE users SET password_hash = :hash WHERE id = :id', { hash: before.password_hash, id: USER_ID });
    }
  });

  // --- 3. Impersonation: sub is the real actor, not the target ---
  await check('an impersonation token\'s `sub` claim identifies the real actor, not the impersonated target', async () => {
    const adminToken = await login(ADMIN_EMAIL, ADMIN_PASSWORD);
    const [[admin]] = await db.query('SELECT id FROM users WHERE email = :email', { email: ADMIN_EMAIL });

    const r = await request('POST', `/api/users/${REPORT_ID}/impersonate`, { token: adminToken });
    if (r.status !== 200) throw new Error(`impersonate call failed: ${r.status} ${r.body}`);
    const { token: impToken } = JSON.parse(r.body);
    const decoded = jwt.decode(impToken);

    if (decoded.sub !== admin.id) {
      throw new Error(`expected sub to be the real actor (${admin.id}), got ${decoded.sub} (the target's id — the original bug)`);
    }
    if (decoded.impersonating_as !== REPORT_ID) {
      throw new Error(`expected impersonating_as to be ${REPORT_ID}, got ${decoded.impersonating_as}`);
    }

    // And the token still correctly loads the TARGET's data for the request.
    const who = await request('GET', '/api/auth/me', { token: impToken });
    if (who.status !== 200) throw new Error(`impersonation token didn't authenticate: ${who.status} ${who.body}`);
    const whoBody = JSON.parse(who.body);
    if (whoBody.user.id !== REPORT_ID) {
      throw new Error(`expected /me to resolve the impersonated target (${REPORT_ID}), got ${whoBody.user.id}`);
    }
    if (whoBody.user.impersonated_by !== admin.id) {
      throw new Error(`expected impersonated_by to be the real actor (${admin.id}), got ${whoBody.user.impersonated_by}`);
    }
  });

  await check('an impersonation token is invalidated if the TARGET\'s token_epoch changes (not the actor\'s)', async () => {
    const adminToken = await login(ADMIN_EMAIL, ADMIN_PASSWORD);
    const r = await request('POST', `/api/users/${REPORT_ID}/impersonate`, { token: adminToken });
    if (r.status !== 200) throw new Error(`impersonate call failed: ${r.status} ${r.body}`);
    const { token: impToken } = JSON.parse(r.body);

    const pre = await request('GET', '/api/auth/me', { token: impToken });
    if (pre.status !== 200) throw new Error(`impersonation token didn't work before the bump: ${pre.status}`);

    const [[before]] = await db.query('SELECT token_epoch FROM users WHERE id = :id', { id: REPORT_ID });
    await db.query('UPDATE users SET token_epoch = token_epoch + 1 WHERE id = :id', { id: REPORT_ID });
    try {
      const post = await request('GET', '/api/auth/me', { token: impToken });
      if (post.status !== 401) throw new Error(`expected 401 after target's epoch bumped, got ${post.status}`);
    } finally {
      await db.query('UPDATE users SET token_epoch = :epoch WHERE id = :id', { epoch: before.token_epoch, id: REPORT_ID });
    }
  });

  // --- 4. Admin-initiated password change also bumps token_epoch ---
  await check('PUT /api/users/:id with a new password bumps the TARGET\'s token_epoch', async () => {
    const [[before]] = await db.query('SELECT token_epoch FROM users WHERE id = :id', { id: REPORT_ID });
    const adminToken = await login(ADMIN_EMAIL, ADMIN_PASSWORD);
    const r = await request('PUT', `/api/users/${REPORT_ID}`, {
      token: adminToken, body: { password: 'SecTest123!' }, // reset to its own known password
    });
    if (r.status !== 200) throw new Error(`PUT failed: ${r.status} ${r.body}`);
    const [[after]] = await db.query('SELECT token_epoch FROM users WHERE id = :id', { id: REPORT_ID });
    if (after.token_epoch !== before.token_epoch + 1) {
      throw new Error(`expected token_epoch to increment from ${before.token_epoch}, got ${after.token_epoch}`);
    }
  });

  await db.end();
  console.log(`\n${pass}/${pass + fail} passed`);
  process.exit(fail ? 1 : 0);
})();
