#!/usr/bin/env node
// Idempotent schema top-up for the Craft.js builder.
//
// This project has no migration runner — its database is created at provision
// time — so anything the builder added after provisioning lives here. Safe to
// run repeatedly.
//
// ⚠️ Reads server/.env by default, which on a deployed box points at the real
// database. Pass --host/--database explicitly when you mean a different one:
//   node scripts/ensure-builder-schema.js --host 127.0.0.1 --database my_local_db

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

// column name → the ALTER fragment that creates it
const NEW_COLUMNS = {
  page_mode: "ADD COLUMN page_mode ENUM('visual','code') NOT NULL DEFAULT 'visual' AFTER puck_data",
  code_html: 'ADD COLUMN code_html MEDIUMTEXT NULL AFTER page_mode',
};

// Columns that hold user-authored CSS/JS. TEXT caps at 64KB, which a real
// site stylesheet blows straight past ("Data too long for column ..."), so
// these are widened to MEDIUMTEXT (16MB).
const WIDEN = [
  { table: 'website_global_settings', column: 'setting_value', type: 'MEDIUMTEXT NULL' },
  { table: 'website_pages', column: 'custom_css', type: 'MEDIUMTEXT NULL' },
  { table: 'website_pages', column: 'custom_js', type: 'MEDIUMTEXT NULL' },
];

// Tables the app queries that older provisioning schemas never created.
//
// None of these fail at startup — each one only surfaces when a user reaches
// the feature, as "Table '<db>.x' doesn't exist" long after setup looked
// finished. Derived by extracting every table named in server/src SQL and
// diffing against information_schema; see the audit note in SKILL.md Phase 3.
//
// ORDER MATTERS — a table must come after anything its foreign keys reference
// (media_folders → media_files, social_accounts → social_posts → social_queue).
// CREATE TABLE IF NOT EXISTS keeps this safe to re-run and never alters an
// existing table, so a project that already has one is left untouched.
const TABLES = [
  {
    name: 'media_folders',
    sql: `CREATE TABLE IF NOT EXISTS media_folders (
      id         INT UNSIGNED NOT NULL AUTO_INCREMENT,
      name       VARCHAR(255) NOT NULL,
      parent_id  INT UNSIGNED NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_media_folders_parent (parent_id),
      CONSTRAINT fk_media_folders_parent FOREIGN KEY (parent_id)
        REFERENCES media_folders (id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  },
  {
    name: 'social_accounts',
    sql: `CREATE TABLE IF NOT EXISTS social_accounts (
      id           INT UNSIGNED NOT NULL AUTO_INCREMENT,
      platform     VARCHAR(40) NOT NULL,
      account_name VARCHAR(255) NOT NULL,
      account_id   VARCHAR(255) NULL,
      access_token TEXT NULL,
      token_expiry DATETIME NULL,
      page_id      VARCHAR(255) NULL,
      page_name    VARCHAR(255) NULL,
      created_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_social_accounts_platform (platform)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  },
  {
    name: 'social_posts',
    sql: `CREATE TABLE IF NOT EXISTS social_posts (
      id           INT UNSIGNED NOT NULL AUTO_INCREMENT,
      account_id   INT UNSIGNED NULL,
      platform     VARCHAR(40) NOT NULL,
      content      TEXT NULL,
      media_urls   TEXT NULL,
      status       VARCHAR(20) NOT NULL DEFAULT 'draft',
      scheduled_at DATETIME NULL,
      published_at DATETIME NULL,
      created_by   INT UNSIGNED NULL,
      created_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_social_posts_status (status),
      KEY idx_social_posts_scheduled (scheduled_at),
      CONSTRAINT fk_social_posts_account FOREIGN KEY (account_id)
        REFERENCES social_accounts (id) ON DELETE CASCADE,
      CONSTRAINT fk_social_posts_user FOREIGN KEY (created_by)
        REFERENCES users (id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  },
  {
    name: 'social_queue',
    sql: `CREATE TABLE IF NOT EXISTS social_queue (
      id           INT UNSIGNED NOT NULL AUTO_INCREMENT,
      post_id      INT UNSIGNED NOT NULL,
      attempt      INT NOT NULL DEFAULT 0,
      next_attempt DATETIME NULL,
      created_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_social_queue_next (next_attempt),
      CONSTRAINT fk_social_queue_post FOREIGN KEY (post_id)
        REFERENCES social_posts (id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  },
  {
    name: 'custom_reports',
    sql: `CREATE TABLE IF NOT EXISTS custom_reports (
      id           INT UNSIGNED NOT NULL AUTO_INCREMENT,
      name         VARCHAR(255) NOT NULL,
      module       VARCHAR(64) NOT NULL,
      columns_json TEXT NULL,
      filters_json TEXT NULL,
      sort_json    TEXT NULL,
      visibility   VARCHAR(20) NOT NULL DEFAULT 'private',
      created_by   INT UNSIGNED NULL,
      created_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_custom_reports_module (module),
      CONSTRAINT fk_custom_reports_user FOREIGN KEY (created_by)
        REFERENCES users (id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  },
  {
    name: 'videos',
    // tags is a comma-separated string, not JSON — routes/videos.js parses it
    // with parseTags() and filters with FIND_IN_SET-style LIKE matching.
    sql: `CREATE TABLE IF NOT EXISTS videos (
      id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
      title         VARCHAR(255) NOT NULL,
      description   TEXT NULL,
      platform      VARCHAR(40) NOT NULL DEFAULT 'youtube',
      video_id      VARCHAR(255) NOT NULL,
      thumbnail_url VARCHAR(1024) NULL,
      tags          VARCHAR(512) NULL,
      is_active     TINYINT(1) NOT NULL DEFAULT 1,
      sort_order    INT NOT NULL DEFAULT 0,
      created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_videos_active_sort (is_active, sort_order)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  },
  {
    name: 'media_files',
    // uploaded_by is INT UNSIGNED to match users.id — a signed INT here makes
    // the foreign key fail with errno 3780 (incompatible column types).
    // ON DELETE SET NULL, not CASCADE: removing a staff account must not delete
    // the images they happened to upload, which are still on live pages.
    sql: `CREATE TABLE IF NOT EXISTS media_files (
      id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
      filename      VARCHAR(255) NOT NULL,
      original_name VARCHAR(255) NOT NULL,
      file_url      VARCHAR(1024) NOT NULL,
      mime_type     VARCHAR(127) NULL,
      file_size     BIGINT UNSIGNED NULL,
      width         INT NULL,
      height        INT NULL,
      alt_text      VARCHAR(512) NOT NULL DEFAULT '',
      folder_id     INT UNSIGNED NULL,
      uploaded_by   INT UNSIGNED NULL,
      created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_media_files_folder (folder_id),
      KEY idx_media_files_created (created_at),
      CONSTRAINT fk_media_files_folder FOREIGN KEY (folder_id)
        REFERENCES media_folders (id) ON DELETE SET NULL,
      CONSTRAINT fk_media_files_user FOREIGN KEY (uploaded_by)
        REFERENCES users (id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  },
];

(async () => {
  console.log(`Target: ${CONFIG.user}@${CONFIG.host}:${CONFIG.port}/${CONFIG.database}`);
  const db = await mysql.createConnection(CONFIG);
  try {
    const columnsOf = async (table) => {
      const [rows] = await db.query(`SHOW COLUMNS FROM \`${table}\``);
      return new Map(rows.map((row) => [row.Field, row.Type.toLowerCase()]));
    };

    // 0. Create any table the builder needs that provisioning didn't make.
    for (const { name, sql } of TABLES) {
      const [[found]] = await db.query(
        'SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?',
        [name]
      );
      if (found.n) { console.log(`ok   ${name} exists`); continue; }
      await db.query(sql);
      console.log(`created ${name}`);
    }

    // 1. Add anything missing on website_pages.
    const pageCols = await columnsOf('website_pages');
    const missing = Object.entries(NEW_COLUMNS).filter(([name]) => !pageCols.has(name));
    if (missing.length) {
      await db.query(`ALTER TABLE website_pages ${missing.map(([, sql]) => sql).join(', ')}`);
      console.log(`Added: ${missing.map(([name]) => name).join(', ')}`);
    } else {
      console.log('website_pages columns already present.');
    }

    // 2. Widen the CSS/JS columns that are still TEXT.
    for (const { table, column, type } of WIDEN) {
      const cols = await columnsOf(table);
      const current = cols.get(column);
      if (!current) {
        console.log(`skip ${table}.${column} — column not found`);
        continue;
      }
      if (current.startsWith('mediumtext') || current.startsWith('longtext')) {
        console.log(`ok   ${table}.${column} (${current})`);
        continue;
      }
      await db.query(`ALTER TABLE \`${table}\` MODIFY COLUMN \`${column}\` ${type}`);
      console.log(`widened ${table}.${column}: ${current} → mediumtext`);
    }
  } finally {
    await db.end();
  }
})().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
