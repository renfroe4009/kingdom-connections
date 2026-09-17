#!/usr/bin/env node
// Adds the tables/columns backing the secured Mobile API + webhook system
// (Praying Planet integration — KC is source of truth for orgs/members):
//   - api_clients: one row per machine client authorized to call
//     /api/mobile/v1/*. client_secret_hash is a SHA-256 hash, verified with
//     a constant-time compare (see middleware/apiClientAuth.js) — not
//     bcrypt, since this is a per-request machine credential, not a human
//     password.
//   - webhook_endpoints: where KC delivers outbound events for a client.
//     signing_secret is encrypted at rest (AES-256-GCM via
//     services/secretsCrypto.js, same pattern as payment_gateway_settings
//     and user_mfa_totp).
//   - pp_sync_log: audit trail for every inbound mobile-API call and every
//     outbound webhook delivery attempt. Mirrors cw_sync_log's shape.
//   - contact_app_profiles: the ONLY table a "delete my data" request
//     erases. Deliberately separate from `contacts` — a contact's donation/
//     membership history must be retained for nonprofit recordkeeping even
//     after the app-specific profile (avatar, bio, push token, consent) is
//     deleted.
//   - organizations.app_enabled: least-privilege gate. Only orgs a staff
//     admin explicitly flags are ever visible to the mobile API.
//
// Safe to re-run.
//
//   node scripts/ensure-praying-planet-tables.js --database my_local_db

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

async function columnExists(db, table, column) {
  const [[row]] = await db.query(
    `SELECT 1 FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :table AND COLUMN_NAME = :column`,
    { table, column }
  );
  return !!row;
}

(async () => {
  console.log(`Target: ${CONFIG.user}@${CONFIG.host}:${CONFIG.port}/${CONFIG.database}`);
  const db = await mysql.createConnection({ ...CONFIG, namedPlaceholders: true });
  try {
    if (await tableExists(db, 'api_clients')) {
      console.log('api_clients already exists.');
    } else {
      await db.query(
        `CREATE TABLE api_clients (
           id int unsigned NOT NULL AUTO_INCREMENT,
           name varchar(150) NOT NULL,
           client_id varchar(64) NOT NULL,
           client_secret_hash char(64) NOT NULL,
           scopes json NOT NULL,
           is_active tinyint(1) NOT NULL DEFAULT 1,
           created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
           last_used_at datetime DEFAULT NULL,
           PRIMARY KEY (id),
           UNIQUE KEY uq_api_clients_client_id (client_id)
         ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
      );
      console.log('Created api_clients.');
    }

    if (await tableExists(db, 'webhook_endpoints')) {
      console.log('webhook_endpoints already exists.');
    } else {
      await db.query(
        `CREATE TABLE webhook_endpoints (
           id int unsigned NOT NULL AUTO_INCREMENT,
           api_client_id int unsigned NOT NULL,
           target_url varchar(500) NOT NULL,
           signing_secret varchar(255) NOT NULL,
           subscribed_events json NOT NULL,
           is_active tinyint(1) NOT NULL DEFAULT 1,
           created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
           PRIMARY KEY (id),
           KEY idx_webhook_endpoints_client (api_client_id),
           CONSTRAINT fk_webhook_endpoints_client FOREIGN KEY (api_client_id) REFERENCES api_clients (id) ON DELETE CASCADE
         ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
      );
      console.log('Created webhook_endpoints.');
    }

    if (await tableExists(db, 'pp_sync_log')) {
      console.log('pp_sync_log already exists.');
    } else {
      await db.query(
        `CREATE TABLE pp_sync_log (
           id int unsigned NOT NULL AUTO_INCREMENT,
           api_client_id int unsigned DEFAULT NULL,
           direction enum('in','out') NOT NULL,
           event_type varchar(100) NOT NULL,
           entity_type varchar(50) DEFAULT NULL,
           entity_id int unsigned DEFAULT NULL,
           request_json json DEFAULT NULL,
           response_json json DEFAULT NULL,
           status varchar(20) NOT NULL,
           error text,
           created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
           PRIMARY KEY (id),
           KEY idx_pp_sync_log_client (api_client_id),
           KEY idx_pp_sync_log_entity (entity_type, entity_id),
           KEY idx_pp_sync_log_created (created_at),
           CONSTRAINT fk_pp_sync_log_client FOREIGN KEY (api_client_id) REFERENCES api_clients (id) ON DELETE SET NULL
         ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
      );
      console.log('Created pp_sync_log.');
    }

    if (await tableExists(db, 'contact_app_profiles')) {
      console.log('contact_app_profiles already exists.');
    } else {
      await db.query(
        `CREATE TABLE contact_app_profiles (
           id int unsigned NOT NULL AUTO_INCREMENT,
           contact_id int unsigned NOT NULL,
           avatar_url varchar(500) DEFAULT NULL,
           bio text,
           display_name_override varchar(150) DEFAULT NULL,
           push_token varchar(255) DEFAULT NULL,
           notification_consent tinyint(1) NOT NULL DEFAULT 0,
           app_account_status enum('active','deleted') NOT NULL DEFAULT 'active',
           deleted_at datetime DEFAULT NULL,
           created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
           updated_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
           PRIMARY KEY (id),
           UNIQUE KEY uq_contact_app_profiles_contact (contact_id),
           CONSTRAINT fk_contact_app_profiles_contact FOREIGN KEY (contact_id) REFERENCES contacts (id) ON DELETE CASCADE
         ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
      );
      console.log('Created contact_app_profiles.');
    }

    if (await columnExists(db, 'organizations', 'app_enabled')) {
      console.log('organizations.app_enabled already exists.');
    } else {
      await db.query(
        `ALTER TABLE organizations ADD COLUMN app_enabled tinyint(1) NOT NULL DEFAULT 0
           COMMENT 'Whether this org is visible to the Praying Planet mobile API'`
      );
      console.log('Added organizations.app_enabled.');
    }
  } finally {
    await db.end();
  }
})().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
