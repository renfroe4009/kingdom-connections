#!/usr/bin/env node
// Fixes a pre-existing gap (unrelated to the security remediation work):
// several feature routes reference tables that were never included in
// db/schema.sql at all — social.js (social_accounts/social_posts/
// social_queue), customReports.js (custom_reports), and videos.js
// (videos). Every request to any of these features 500s outright on a
// fresh clone (or, apparently, this local DB), since the table simply
// doesn't exist. Discovered while investigating a user-reported 500 on
// /admin/reports/social.
//
// Column shapes below are reverse-engineered directly from every query
// each route file actually issues (server/src/routes/social.js,
// customReports.js, videos.js) — not guessed.
//
// Safe to re-run.
//
//   node scripts/ensure-missing-feature-tables.js --database my_local_db

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

async function ensureTable(db, name, createSql) {
  if (await tableExists(db, name)) {
    console.log(`${name} already exists.`);
    return;
  }
  await db.query(createSql);
  console.log(`Created ${name}.`);
}

(async () => {
  console.log(`Target: ${CONFIG.user}@${CONFIG.host}:${CONFIG.port}/${CONFIG.database}`);
  const db = await mysql.createConnection({ ...CONFIG, namedPlaceholders: true });
  try {
    await ensureTable(db, 'social_accounts', `
      CREATE TABLE social_accounts (
        id int unsigned NOT NULL AUTO_INCREMENT,
        platform enum('facebook','instagram','linkedin') NOT NULL,
        account_name varchar(150) NOT NULL,
        account_id varchar(255) NOT NULL,
        access_token text DEFAULT NULL,
        page_id varchar(255) DEFAULT NULL,
        page_name varchar(255) DEFAULT NULL,
        token_expiry datetime DEFAULT NULL,
        is_active tinyint(1) NOT NULL DEFAULT '1',
        connected_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uq_social_accounts_platform_account (platform, account_id),
        KEY idx_social_accounts_platform (platform)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await ensureTable(db, 'social_posts', `
      CREATE TABLE social_posts (
        id int unsigned NOT NULL AUTO_INCREMENT,
        account_id int unsigned DEFAULT NULL,
        platform enum('facebook','instagram','linkedin') NOT NULL,
        content text NOT NULL,
        media_urls json DEFAULT NULL,
        status enum('draft','scheduled','published','failed') NOT NULL DEFAULT 'draft',
        scheduled_at datetime DEFAULT NULL,
        published_at datetime DEFAULT NULL,
        platform_post_id varchar(255) DEFAULT NULL,
        error_msg text,
        created_by int unsigned DEFAULT NULL,
        created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        KEY idx_social_posts_status (status),
        KEY idx_social_posts_platform (platform),
        KEY fk_social_posts_account (account_id),
        KEY fk_social_posts_created_by (created_by),
        CONSTRAINT fk_social_posts_account FOREIGN KEY (account_id) REFERENCES social_accounts (id) ON DELETE SET NULL,
        CONSTRAINT fk_social_posts_created_by FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await ensureTable(db, 'social_queue', `
      CREATE TABLE social_queue (
        id int unsigned NOT NULL AUTO_INCREMENT,
        post_id int unsigned NOT NULL,
        attempt int NOT NULL DEFAULT '0',
        next_attempt datetime DEFAULT NULL,
        created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uq_social_queue_post (post_id),
        CONSTRAINT fk_social_queue_post FOREIGN KEY (post_id) REFERENCES social_posts (id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await ensureTable(db, 'custom_reports', `
      CREATE TABLE custom_reports (
        id int unsigned NOT NULL AUTO_INCREMENT,
        name varchar(150) NOT NULL,
        module varchar(100) NOT NULL,
        columns_json json NOT NULL,
        filters_json json DEFAULT NULL,
        sort_json json DEFAULT NULL,
        visibility enum('private','shared') NOT NULL DEFAULT 'private',
        created_by int unsigned DEFAULT NULL,
        created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        KEY idx_custom_reports_module (module),
        KEY fk_custom_reports_created_by (created_by),
        CONSTRAINT fk_custom_reports_created_by FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await ensureTable(db, 'videos', `
      CREATE TABLE videos (
        id int unsigned NOT NULL AUTO_INCREMENT,
        title varchar(255) NOT NULL,
        description text,
        platform enum('youtube','vimeo') NOT NULL,
        video_id varchar(64) NOT NULL,
        thumbnail_url varchar(500) DEFAULT NULL,
        tags json DEFAULT NULL,
        is_active tinyint(1) NOT NULL DEFAULT '1',
        sort_order int NOT NULL DEFAULT '0',
        created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        KEY idx_videos_active (is_active)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
  } finally {
    await db.end();
  }
})().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
