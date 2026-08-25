#!/usr/bin/env node
// Idempotent schema top-up for the forms table's HTML/CSS hooks
// (html_id, css_class, submit_class) — added after the table itself was
// provisioned, so it lives here rather than in the initial schema. Safe to
// run repeatedly.
//
// ⚠️ Reads server/.env by default, which on a deployed box points at the real
// database. Pass --host/--database explicitly when you mean a different one:
//   node scripts/ensure-forms-html-columns.js --host 127.0.0.1 --database my_local_db

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

const NEW_COLUMNS = {
  html_id:      "ADD COLUMN html_id VARCHAR(190) NULL AFTER redirect_url",
  css_class:    'ADD COLUMN css_class VARCHAR(255) NULL AFTER html_id',
  submit_class: 'ADD COLUMN submit_class VARCHAR(255) NULL AFTER css_class',
};

(async () => {
  console.log(`Target: ${CONFIG.user}@${CONFIG.host}:${CONFIG.port}/${CONFIG.database}`);
  const db = await mysql.createConnection(CONFIG);
  try {
    const [rows] = await db.query('SHOW COLUMNS FROM forms');
    const have = new Set(rows.map((row) => row.Field));
    const missing = Object.entries(NEW_COLUMNS).filter(([name]) => !have.has(name));
    if (missing.length) {
      await db.query(`ALTER TABLE forms ${missing.map(([, sql]) => sql).join(', ')}`);
      console.log(`Added: ${missing.map(([name]) => name).join(', ')}`);
    } else {
      console.log('forms columns already present.');
    }
  } finally {
    await db.end();
  }
})().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
