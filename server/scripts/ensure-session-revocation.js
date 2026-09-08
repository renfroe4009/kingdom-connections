#!/usr/bin/env node
// Session revocation infrastructure (security remediation H-05) — JWTs were
// fully stateless with no way to invalidate one before its 8h expiry (no
// logout revocation, no forced-logout-after-password-reset). Adds:
//   - users.token_epoch: bumped on password reset; a token's `epoch` claim
//     must match the current value or it's treated as stale.
//   - revoked_tokens: explicit per-token revocation list, keyed by the JWT's
//     `jti` claim, checked on every request. Populated by POST /auth/logout.
//
// Also adds users.password_reset_token / password_reset_expires_at, which
// routes/auth.js has referenced in raw SQL since before this session but
// which were never actually present in schema.sql or any migration — every
// forgot-password/reset-password request currently fails with a real SQL
// error ("Unknown column"). Fixing this alongside H-05 because H-05's
// "bump token_epoch on password reset" requirement touches this exact
// code path, and it was blocking that path outright.
//
// Safe to re-run — checks information_schema before altering.
//
//   node scripts/ensure-session-revocation.js --database my_local_db

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

async function columnExists(db, table, column) {
  const [[row]] = await db.query(
    `SELECT 1 FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :table AND COLUMN_NAME = :column`,
    { table, column }
  );
  return !!row;
}

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
    if (await columnExists(db, 'users', 'token_epoch')) {
      console.log('users.token_epoch already exists.');
    } else {
      await db.query(
        `ALTER TABLE users ADD COLUMN token_epoch INT UNSIGNED NOT NULL DEFAULT 0 AFTER email_verified_at`
      );
      console.log('Added users.token_epoch.');
    }

    if (await columnExists(db, 'users', 'password_reset_token')) {
      console.log('users.password_reset_token already exists.');
    } else {
      await db.query(
        `ALTER TABLE users
           ADD COLUMN password_reset_token char(64) DEFAULT NULL AFTER token_epoch,
           ADD COLUMN password_reset_expires_at datetime DEFAULT NULL AFTER password_reset_token`
      );
      console.log('Added users.password_reset_token / password_reset_expires_at.');
    }

    if (await tableExists(db, 'revoked_tokens')) {
      console.log('revoked_tokens table already exists.');
    } else {
      await db.query(
        `CREATE TABLE revoked_tokens (
           jti varchar(36) NOT NULL,
           expires_at datetime NOT NULL,
           revoked_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
           PRIMARY KEY (jti),
           KEY idx_revoked_tokens_expires (expires_at)
         ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
      );
      console.log('Created revoked_tokens table.');
    }
  } finally {
    await db.end();
  }
})().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
