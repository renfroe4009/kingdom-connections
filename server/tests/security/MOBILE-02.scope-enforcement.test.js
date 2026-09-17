// =============================================================================
// MOBILE-02 — a mobile-API token can only do what its scopes grant.
// (server/src/middleware/apiClientAuth.js's requireApiClient())
//
// Covers: a token issued with only `members:read` is rejected (403) by a
// route requiring `members:write` or `members:delete`, and a token for a
// DIFFERENT client can't be used against this one's scope expectations.
//
// Run:  node server/tests/security/MOBILE-02.scope-enforcement.test.js
// =============================================================================
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
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

  console.log('== MOBILE-02 scope enforcement ==');

  const { requireApiClient, hashSecret } = require(
    path.join(__dirname, '..', '..', 'src', 'middleware', 'apiClientAuth.js')
  );

  const clientId = `sectest_mobile02_${crypto.randomBytes(4).toString('hex')}`;
  await db.query(`DELETE FROM api_clients WHERE client_id LIKE 'sectest_mobile02_%'`);
  const [ins] = await db.query(
    `INSERT INTO api_clients (name, client_id, client_secret_hash, scopes, is_active)
     VALUES ('SecTest MOBILE-02', :clientId, :hash, CAST(:scopes AS JSON), 1)`,
    { clientId, hash: hashSecret('irrelevant-for-this-test'), scopes: JSON.stringify(['members:read']) }
  );
  const rowId = ins.insertId;

  // A read-only token, signed exactly the way issueToken() would sign one.
  const readOnlyToken = jwt.sign({ client_id: clientId, scopes: ['members:read'] }, process.env.MOBILE_API_JWT_SECRET, { expiresIn: '1h' });

  await check('a members:read token is accepted for a members:read route', async () => {
    const req = { headers: { authorization: `Bearer ${readOnlyToken}` } };
    const res = mockRes();
    let nextCalled = false;
    await requireApiClient('members:read')(req, res, () => { nextCalled = true; });
    if (!nextCalled) throw new Error(`expected next(), got ${res.statusCode}`);
  });

  await check('a members:read token is REJECTED (403) for a members:write route', async () => {
    const req = { headers: { authorization: `Bearer ${readOnlyToken}` } };
    const res = mockRes();
    await requireApiClient('members:write')(req, res, () => { throw new Error('next() should not have been called'); });
    if (res.statusCode !== 403) throw new Error(`expected 403, got ${res.statusCode}`);
  });

  await check('a members:read token is REJECTED (403) for a members:delete route', async () => {
    const req = { headers: { authorization: `Bearer ${readOnlyToken}` } };
    const res = mockRes();
    await requireApiClient('members:delete')(req, res, () => { throw new Error('next() should not have been called'); });
    if (res.statusCode !== 403) throw new Error(`expected 403, got ${res.statusCode}`);
  });

  await check('a token for a client that no longer exists is rejected even if the JWT itself still verifies', async () => {
    const ghostToken = jwt.sign({ client_id: 'sectest-ghost-client-does-not-exist', scopes: ['members:read'] }, process.env.MOBILE_API_JWT_SECRET, { expiresIn: '1h' });
    const req = { headers: { authorization: `Bearer ${ghostToken}` } };
    const res = mockRes();
    await requireApiClient('members:read')(req, res, () => { throw new Error('next() should not have been called'); });
    if (res.statusCode !== 401) throw new Error(`expected 401, got ${res.statusCode}`);
  });

  await check('a scope claim forged into an otherwise-invalid signature is rejected (signature checked first)', async () => {
    const forged = jwt.sign({ client_id: clientId, scopes: ['members:read', 'members:write', 'members:delete'] }, 'wrong-secret-not-the-real-one', { expiresIn: '1h' });
    const req = { headers: { authorization: `Bearer ${forged}` } };
    const res = mockRes();
    await requireApiClient('members:delete')(req, res, () => { throw new Error('next() should not have been called — forged token must not verify'); });
    if (res.statusCode !== 401) throw new Error(`expected 401, got ${res.statusCode}`);
  });

  await db.query('DELETE FROM api_clients WHERE id = :id', { id: rowId });
  await db.end();
  console.log(`\n${pass}/${pass + fail} passed`);
  process.exit(fail ? 1 : 0);
})();
