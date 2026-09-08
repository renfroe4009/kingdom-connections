#!/usr/bin/env node
// One-time migration: encrypts any still-plaintext credential columns in
// payment_gateway_settings (security remediation H-13). Safe to re-run —
// skips any row/column already in "iv:authTag:ciphertext" form.
//
// Requires SECRETS_ENCRYPTION_KEY to be set in server/.env (or passed via
// --key) BEFORE running — every server process that reads these settings
// (the API server, the batch-reconciliation cron) must use the SAME key,
// or gateway API calls will start failing with a decrypt error.
//
// ⚠️ Reads server/.env by default, which on a deployed box points at the
// real database. Pass --host/--database explicitly when you mean a
// different one:
//   node scripts/encrypt-gateway-secrets.js --host 127.0.0.1 --database my_local_db

const path = require('path');
const mysql = require('mysql2/promise');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index > -1 ? process.argv[index + 1] : fallback;
}

const CONFIG = {
  host: arg('host', process.env.DB_HOST),
  port: Number(arg('port', process.env.DB_PORT || 3306)),
  user: arg('user', process.env.DB_USER),
  password: arg('password', process.env.DB_PASSWORD),
  database: arg('database', process.env.DB_NAME),
  namedPlaceholders: true,
};

const KEY_OVERRIDE = arg('key', null);
if (KEY_OVERRIDE) process.env.SECRETS_ENCRYPTION_KEY = KEY_OVERRIDE;
if (!process.env.SECRETS_ENCRYPTION_KEY) {
  console.error('SECRETS_ENCRYPTION_KEY is not set. Set it in server/.env or pass --key before running this.');
  process.exit(1);
}

const { encrypt, looksEncrypted } = require('../src/services/secretsCrypto');

const ENCRYPTED_COLUMNS = ['transaction_key', 'signature_key', 'api_key', 'app_key', 'webhook_secret'];

(async () => {
  console.log(`Target: ${CONFIG.user}@${CONFIG.host}:${CONFIG.port}/${CONFIG.database}`);
  const db = await mysql.createConnection(CONFIG);
  try {
    const [rows] = await db.query('SELECT id, gateway, mode, ' + ENCRYPTED_COLUMNS.join(', ') + ' FROM payment_gateway_settings');
    let touched = 0;
    for (const row of rows) {
      const sets = [];
      const params = { id: row.id };
      for (const col of ENCRYPTED_COLUMNS) {
        const value = row[col];
        if (value && !looksEncrypted(value)) {
          sets.push(`${col} = :${col}`);
          params[col] = encrypt(value);
        }
      }
      if (sets.length) {
        await db.query(`UPDATE payment_gateway_settings SET ${sets.join(', ')} WHERE id = :id`, params);
        console.log(`  ${row.gateway}/${row.mode} (id=${row.id}): encrypted ${sets.length} column(s)`);
        touched++;
      }
    }
    if (touched === 0) {
      console.log('All rows already encrypted (or empty) — nothing to do.');
    } else {
      console.log(`Done — ${touched} row(s) updated.`);
    }
  } finally {
    await db.end();
  }
})().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
