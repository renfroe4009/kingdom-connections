#!/usr/bin/env node
// Idempotent schema top-up: users.default_dashboard — lets each staff user
// pick which admin dashboard (nonprofit or sales) shows on login, defaulting
// to nonprofit for everyone until they change it. Safe to run repeatedly.
//
// ⚠️ Reads server/.env by default, which on a deployed box points at the real
// database. Pass --host/--database explicitly when you mean a different one:
//   node scripts/ensure-user-dashboard-preference.js --host 127.0.0.1 --database my_local_db

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
  default_dashboard: "ADD COLUMN default_dashboard ENUM('nonprofit','sales') NOT NULL DEFAULT 'nonprofit' AFTER cw_member_id",
};

(async () => {
  console.log(`Target: ${CONFIG.user}@${CONFIG.host}:${CONFIG.port}/${CONFIG.database}`);
  const db = await mysql.createConnection(CONFIG);
  try {
    const [rows] = await db.query('SHOW COLUMNS FROM users');
    const have = new Set(rows.map((row) => row.Field));
    const missing = Object.entries(NEW_COLUMNS).filter(([name]) => !have.has(name));
    if (missing.length) {
      await db.query(`ALTER TABLE users ${missing.map(([, sql]) => sql).join(', ')}`);
      console.log(`Added: ${missing.map(([name]) => name).join(', ')}`);
    } else {
      console.log('users.default_dashboard already present.');
    }
  } finally {
    await db.end();
  }
})().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
