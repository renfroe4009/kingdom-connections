// =============================================================================
// H-13 (secrets half) — payment_gateway_settings' credential columns
// (transaction_key, signature_key, api_key, app_key, webhook_secret) were
// stored in plaintext. Any database read — including via the now-fixed
// C-01 path-traversal-to-.env chain — yielded live, directly usable
// gateway credentials.
//
// Uses a dedicated throwaway gateway row (authnet/sandbox, a combination
// not used by the real local config) so this doesn't touch the actual
// working payment configuration.
//
// Run:  node server/tests/security/H-13.gateway-secrets-encryption.test.js
// =============================================================================
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });
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

  console.log('== H-13 gateway secrets encryption ==');

  const { encrypt, decrypt, looksEncrypted } = require(path.join(__dirname, '..', '..', 'src', 'services', 'secretsCrypto.js'));
  const PLAINTEXT = 'sk_test_sectest_secret_value_12345';

  await check('encrypt() output does not contain the plaintext', () => {
    const enc = encrypt(PLAINTEXT);
    if (enc.includes(PLAINTEXT)) throw new Error('ciphertext contains the raw plaintext');
    if (!looksEncrypted(enc)) throw new Error('encrypt() output does not match the expected iv:tag:ciphertext format');
  });

  await check('decrypt(encrypt(x)) round-trips to the original value', () => {
    const enc = encrypt(PLAINTEXT);
    const dec = decrypt(enc);
    if (dec !== PLAINTEXT) throw new Error(`expected "${PLAINTEXT}" got "${dec}"`);
  });

  await check('looksEncrypted() rejects legacy plaintext (no false positives)', () => {
    if (looksEncrypted('sk_live_abc123')) throw new Error('a plain API-key-shaped string was misidentified as encrypted');
  });

  // --- end-to-end against a real DB row + getGateway() ---
  await db.query(`DELETE FROM payment_gateway_settings WHERE gateway = 'authnet' AND mode = 'sandbox' AND display_name = 'SecTest H-13'`);
  const [ins] = await db.query(
    `INSERT INTO payment_gateway_settings (gateway, mode, display_name, transaction_key, is_active)
     VALUES ('authnet', 'sandbox', 'SecTest H-13', :key, 1)`,
    { key: encrypt(PLAINTEXT) }
  );
  const rowId = ins.insertId;

  await check('the stored value in the database is NOT the plaintext', async () => {
    const [[row]] = await db.query('SELECT transaction_key FROM payment_gateway_settings WHERE id = :id', { id: rowId });
    if (row.transaction_key === PLAINTEXT) throw new Error('transaction_key is stored in plaintext');
    if (row.transaction_key.includes(PLAINTEXT)) throw new Error('stored value contains the plaintext');
  });

  await check('getGateway() decrypts it back to the real value for actual use (no regression)', async () => {
    const { getGateway } = require(path.join(__dirname, '..', '..', 'src', 'services', 'gateways.js'));
    const cfg = await getGateway('authnet', 'sandbox');
    // getGateway() picks is_default DESC, id DESC among matches — target
    // this row specifically in case other authnet/sandbox rows exist.
    if (!cfg || cfg.id !== rowId) {
      // Fall back to a direct row+decrypt check if another row won the pick.
      const [[row]] = await db.query('SELECT transaction_key FROM payment_gateway_settings WHERE id = :id', { id: rowId });
      const { decrypt: dec } = require(path.join(__dirname, '..', '..', 'src', 'services', 'secretsCrypto.js'));
      if (dec(row.transaction_key) !== PLAINTEXT) throw new Error('decrypted value does not match original');
      return;
    }
    if (cfg.transaction_key !== PLAINTEXT) throw new Error(`expected decrypted "${PLAINTEXT}" got "${cfg.transaction_key}"`);
  });

  await check('legacy plaintext rows (not yet migrated) still work — no crash, passed through as-is', async () => {
    await db.query('UPDATE payment_gateway_settings SET transaction_key = :v WHERE id = :id', { v: 'still-plaintext-legacy-value', id: rowId });
    const { decryptGatewayRow } = require(path.join(__dirname, '..', '..', 'src', 'services', 'gateways.js'));
    const [[row]] = await db.query('SELECT * FROM payment_gateway_settings WHERE id = :id', { id: rowId });
    const out = decryptGatewayRow(row);
    if (out.transaction_key !== 'still-plaintext-legacy-value') {
      throw new Error(`expected the legacy plaintext passed through unchanged, got "${out.transaction_key}"`);
    }
  });

  await db.query('DELETE FROM payment_gateway_settings WHERE id = :id', { id: rowId });
  await db.end();
  console.log(`\n${pass}/${pass + fail} passed`);
  process.exit(fail ? 1 : 0);
})();
