#!/usr/bin/env node
// Adds TOTP-based MFA tables (security remediation H-01 / Phase 3):
//   - user_mfa_totp: one row per enrolled user, secret encrypted at rest
//     (AES-256-GCM via services/secretsCrypto.js, same pattern as
//     payment_gateway_settings). confirmed_at is NULL until the user
//     verifies their first code — an unconfirmed row is a pending
//     enrollment, never treated as "MFA is on" anywhere in the app.
//   - user_mfa_recovery_codes: 10 single-use codes issued at confirmation,
//     stored as SHA-256 hashes only (never the raw code).
//
// The org-wide on/off toggle lives in the existing settings KV system
// (moduleSettings.js's new "security" module, default mfa_enabled: false)
// — no schema change needed for that part.
//
// Safe to re-run.
//
//   node scripts/ensure-mfa-tables.js --database my_local_db

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
};

async function tableExists(db, table) {
  const [[row]] = await db.query(
    `SELECT 1 FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :table`,
    { table }
  );
  return !!row;
}

(async () => {
  console.log(`Target: ${CONFIG.user}@${CONFIG.host}:${CONFIG.port}/${CONFIG.database}`);
  const db = await mysql.createConnection({ ...CONFIG, namedPlaceholders: true });
  try {
    if (await tableExists(db, 'user_mfa_totp')) {
      console.log('user_mfa_totp already exists.');
    } else {
      await db.query(
        `CREATE TABLE user_mfa_totp (
           user_id int unsigned NOT NULL,
           secret_enc varchar(255) NOT NULL,
           confirmed_at datetime DEFAULT NULL,
           created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
           PRIMARY KEY (user_id),
           CONSTRAINT fk_mfa_totp_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
         ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
      );
      console.log('Created user_mfa_totp.');
    }

    if (await tableExists(db, 'user_mfa_recovery_codes')) {
      console.log('user_mfa_recovery_codes already exists.');
    } else {
      await db.query(
        `CREATE TABLE user_mfa_recovery_codes (
           id int unsigned NOT NULL AUTO_INCREMENT,
           user_id int unsigned NOT NULL,
           code_hash char(64) NOT NULL,
           used_at datetime DEFAULT NULL,
           created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
           PRIMARY KEY (id),
           KEY idx_mfa_recovery_user (user_id),
           CONSTRAINT fk_mfa_recovery_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
         ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
      );
      console.log('Created user_mfa_recovery_codes.');
    }
  } finally {
    await db.end();
  }
})().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
