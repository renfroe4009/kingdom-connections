// =============================================================================
// MOBILE-03 — outbound webhook delivery (server/src/services/ppWebhooks.js)
//
// Covers:
//   - signPayload() is a verifiable HMAC-SHA256 over "timestamp.body" — a
//     tampered body or a wrong secret both fail verification.
//   - deliverToEndpoint() refuses to call fetch() at all against a private/
//     loopback target URL (SSRF guard, same helper as
//     PHASE5-02.ssrf-webhook-and-return-url's automations.js coverage) and
//     logs the attempt as failed rather than silently dropping it.
//
// Run:  node server/tests/security/MOBILE-03.webhook-signature-and-ssrf.test.js
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

(async () => {
  db = await mysql.createConnection({
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
    namedPlaceholders: true,
  });

  console.log('== MOBILE-03 webhook signature + SSRF guard ==');

  const { signPayload, deliverToEndpoint } = require(path.join(__dirname, '..', '..', 'src', 'services', 'ppWebhooks.js'));
  const { encrypt } = require(path.join(__dirname, '..', '..', 'src', 'services', 'secretsCrypto.js'));

  await check('signPayload() output verifies against the same secret+timestamp+body', () => {
    const secret = 'sectest-signing-secret';
    const body = JSON.stringify({ event: 'member.updated', data: { id: 1 } });
    const ts = Math.floor(Date.now() / 1000);
    const sig = signPayload(secret, ts, body);
    const expected = crypto.createHmac('sha256', secret).update(`${ts}.${body}`).digest('hex');
    if (sig !== expected) throw new Error('signature does not match the expected HMAC');
  });

  await check('a tampered body produces a different signature (tamper-evident)', () => {
    const secret = 'sectest-signing-secret';
    const ts = Math.floor(Date.now() / 1000);
    const sigA = signPayload(secret, ts, JSON.stringify({ event: 'member.updated', data: { id: 1 } }));
    const sigB = signPayload(secret, ts, JSON.stringify({ event: 'member.updated', data: { id: 2 } }));
    if (sigA === sigB) throw new Error('two different payloads produced the same signature');
  });

  await check('a wrong secret produces a different signature', () => {
    const ts = Math.floor(Date.now() / 1000);
    const body = JSON.stringify({ event: 'member.updated', data: { id: 1 } });
    const sigA = signPayload('secret-a', ts, body);
    const sigB = signPayload('secret-b', ts, body);
    if (sigA === sigB) throw new Error('two different secrets produced the same signature');
  });

  // ---- SSRF guard on the actual delivery path ----
  const [insClient] = await db.query(
    `INSERT INTO api_clients (name, client_id, client_secret_hash, scopes, is_active)
     VALUES ('SecTest MOBILE-03', :clientId, 'unused', CAST('[]' AS JSON), 1)`,
    { clientId: `sectest_mobile03_${crypto.randomBytes(4).toString('hex')}` }
  );
  const apiClientId = insClient.insertId;

  const PRIVATE_TARGETS = [
    'http://127.0.0.1:9999/webhook',
    'http://169.254.169.254/latest/meta-data/', // cloud metadata endpoint
    'http://10.0.0.5/webhook',
  ];

  for (const target of PRIVATE_TARGETS) {
    await check(`deliverToEndpoint() refuses a private-IP target (${target})`, async () => {
      const endpoint = {
        id: 999999, api_client_id: apiClientId,
        target_url: target,
        signing_secret: encrypt('sectest-secret'),
      };
      const result = await deliverToEndpoint(endpoint, 'member.updated', { entity_type: 'contact', id: 1 }, 1);
      if (result.ok) throw new Error('expected delivery to be refused, but it reported ok: true');
    });
  }

  await check('the refused delivery is logged to pp_sync_log as failed (not silently dropped)', async () => {
    const [[row]] = await db.query(
      `SELECT status, error FROM pp_sync_log
        WHERE api_client_id = :id AND direction = 'out'
        ORDER BY id DESC LIMIT 1`,
      { id: apiClientId }
    );
    if (!row) throw new Error('no pp_sync_log row was written for the refused delivery');
    if (row.status !== 'failed') throw new Error(`expected status 'failed', got '${row.status}'`);
  });

  await db.query('DELETE FROM pp_sync_log WHERE api_client_id = :id', { id: apiClientId });
  await db.query('DELETE FROM api_clients WHERE id = :id', { id: apiClientId });
  await db.end();
  console.log(`\n${pass}/${pass + fail} passed`);
  process.exit(fail ? 1 : 0);
})();
