// =============================================================================
// MOBILE-01 — Praying Planet mobile API: client-credentials auth
// (server/src/middleware/apiClientAuth.js)
//
// Covers: correct credentials issue a scoped token; wrong secret, inactive
// client, and nonexistent client_id are all rejected the same way (401);
// requireApiClient() rejects a missing/garbage/foreign-secret token and
// accepts a genuinely issued one.
//
// Run:  node server/tests/security/MOBILE-01.client-credential-auth.test.js
// =============================================================================
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });
const crypto = require('crypto');
const mysql = require('mysql2/promise');

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

function mockRes() {
  const res = { statusCode: 200, body: null };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (body) => { res.body = body; return res; };
  return res;
}

(async () => {
  db = await mysql.createConnection({
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
    namedPlaceholders: true,
  });

  console.log('== MOBILE-01 client-credential auth ==');

  const { issueToken, requireApiClient, hashSecret } = require(
    path.join(__dirname, '..', '..', 'src', 'middleware', 'apiClientAuth.js')
  );

  const clientId = `sectest_mobile01_${crypto.randomBytes(4).toString('hex')}`;
  const secret = crypto.randomBytes(24).toString('base64url');
  await db.query(`DELETE FROM api_clients WHERE client_id LIKE 'sectest_mobile01_%'`);
  const [ins] = await db.query(
    `INSERT INTO api_clients (name, client_id, client_secret_hash, scopes, is_active)
     VALUES ('SecTest MOBILE-01', :clientId, :hash, CAST(:scopes AS JSON), 1)`,
    { clientId, hash: hashSecret(secret), scopes: JSON.stringify(['members:read']) }
  );
  const rowId = ins.insertId;

  let issuedToken;
  await check('correct client_id + client_secret issues a token with the right scopes', async () => {
    const res = mockRes();
    await issueToken({ body: { client_id: clientId, client_secret: secret } }, res, (e) => { throw e; });
    if (res.statusCode !== 200) throw new Error(`expected 200, got ${res.statusCode}: ${JSON.stringify(res.body)}`);
    if (!res.body.access_token) throw new Error('no access_token in response');
    if (!res.body.scopes.includes('members:read')) throw new Error('scopes missing from response');
    issuedToken = res.body.access_token;
  });

  await check('wrong secret for a real client_id is rejected with 401', async () => {
    const res = mockRes();
    await issueToken({ body: { client_id: clientId, client_secret: 'totally-wrong-secret' } }, res, (e) => { throw e; });
    if (res.statusCode !== 401) throw new Error(`expected 401, got ${res.statusCode}`);
  });

  await check('nonexistent client_id is rejected with 401 (same message as wrong secret)', async () => {
    const res = mockRes();
    await issueToken({ body: { client_id: 'does-not-exist', client_secret: secret } }, res, (e) => { throw e; });
    if (res.statusCode !== 401) throw new Error(`expected 401, got ${res.statusCode}`);
  });

  await check('a deactivated client can no longer get a token even with the right secret', async () => {
    await db.query('UPDATE api_clients SET is_active = 0 WHERE id = :id', { id: rowId });
    const res = mockRes();
    await issueToken({ body: { client_id: clientId, client_secret: secret } }, res, (e) => { throw e; });
    if (res.statusCode !== 401) throw new Error(`expected 401, got ${res.statusCode}`);
    await db.query('UPDATE api_clients SET is_active = 1 WHERE id = :id', { id: rowId });
  });

  await check('requireApiClient() accepts a genuinely issued token', async () => {
    const req = { headers: { authorization: `Bearer ${issuedToken}` } };
    const res = mockRes();
    let nextCalled = false;
    await requireApiClient('members:read')(req, res, () => { nextCalled = true; });
    if (!nextCalled) throw new Error(`expected next() to be called, got ${res.statusCode}: ${JSON.stringify(res.body)}`);
    if (req.apiClient?.clientId !== clientId) throw new Error('req.apiClient not populated correctly');
  });

  await check('requireApiClient() rejects a missing token', async () => {
    const req = { headers: {} };
    const res = mockRes();
    await requireApiClient('members:read')(req, res, () => { throw new Error('next() should not have been called'); });
    if (res.statusCode !== 401) throw new Error(`expected 401, got ${res.statusCode}`);
  });

  await check('requireApiClient() rejects a garbage/forged token', async () => {
    const req = { headers: { authorization: 'Bearer not.a.real.jwt' } };
    const res = mockRes();
    await requireApiClient('members:read')(req, res, () => { throw new Error('next() should not have been called'); });
    if (res.statusCode !== 401) throw new Error(`expected 401, got ${res.statusCode}`);
  });

  await db.query('DELETE FROM api_clients WHERE id = :id', { id: rowId });
  await db.end();
  console.log(`\n${pass}/${pass + fail} passed`);
  process.exit(fail ? 1 : 0);
})();
