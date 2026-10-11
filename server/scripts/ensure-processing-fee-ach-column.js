#!/usr/bin/env node
// Adds processing_fee_settings.apply_to_ach (default 0) — the ecommerce
// checkout's processing fee (a separate config from payment_gateway_settings'
// fee_* B2B/surcharge fields; see checkout.js's calcCommerceProcessingFee)
// previously had no way to exclude ACH, and applied uniformly to card and
// ACH alike. Defaulting this to 0 matches the equally-new method-aware gate
// in gateways.js's computeProcessingFee (card/invoice/donation checkouts) —
// ACH is excluded unless explicitly turned on.
//
// Safe to re-run.
//
//   node scripts/ensure-processing-fee-ach-column.js --database my_local_db

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

(async () => {
  console.log(`Target: ${CONFIG.user}@${CONFIG.host}:${CONFIG.port}/${CONFIG.database}`);
  const db = await mysql.createConnection({ ...CONFIG, namedPlaceholders: true });
  try {
    if (await columnExists(db, 'processing_fee_settings', 'apply_to_ach')) {
      console.log('processing_fee_settings.apply_to_ach already exists.');
    } else {
      await db.query(
        `ALTER TABLE processing_fee_settings
           ADD COLUMN apply_to_ach TINYINT(1) NOT NULL DEFAULT 0 AFTER apply_to_ship`
      );
      console.log('Added processing_fee_settings.apply_to_ach.');
    }
  } finally {
    await db.end();
  }
})().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
