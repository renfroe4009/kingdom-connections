#!/usr/bin/env node
// Adds 'role' to activities.entity_type's ENUM (security remediation M-07)
// — role_created/role_updated/role_deleted activity logging (new in
// routes/roles.js) needs it; without this every one of those inserts
// fails with "Data truncated for column 'entity_type'" under
// STRICT_TRANS_TABLES, and since that logging is required:true, every
// role create/update/delete request would fail outright. Safe to re-run
// (checks the current enum values before altering).
//
//   node scripts/ensure-activities-role-entity-type.js --database my_local_db

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

(async () => {
  console.log(`Target: ${CONFIG.user}@${CONFIG.host}:${CONFIG.port}/${CONFIG.database}`);
  const db = await mysql.createConnection(CONFIG);
  try {
    const [[col]] = await db.query(
      `SELECT COLUMN_TYPE FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'activities' AND COLUMN_NAME = 'entity_type'`
    );
    if (!col) throw new Error('activities.entity_type column not found');
    if (col.COLUMN_TYPE.includes("'role'")) {
      console.log("activities.entity_type already includes 'role'.");
      return;
    }
    await db.query(
      `ALTER TABLE activities MODIFY COLUMN entity_type
        ENUM('contact','organization','deal','task','user','invoice','payment',
             'subscription','recurring_invoice','volunteer_compliance_item','role')
        NOT NULL`
    );
    console.log("Added 'role' to activities.entity_type.");
  } finally {
    await db.end();
  }
})().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
