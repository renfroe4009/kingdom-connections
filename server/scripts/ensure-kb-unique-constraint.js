#!/usr/bin/env node
// Fixes a pre-existing bug (unrelated to the security remediation work):
// services/kbSeeder.js's seed() has always relied on `INSERT ... ON
// DUPLICATE KEY UPDATE` keyed on (module, title) to stay idempotent across
// repeated server starts — but `ai_knowledge_base` never actually had a
// UNIQUE constraint covering those columns, so every single server start
// (index.js calls seedKnowledgeBase() unconditionally on boot) did a plain
// INSERT of the entire ~110-article seed set again, forever. Discovered
// locally with 43,499 rows (each of ~110 real articles duplicated ~400x)
// after this session's many nodemon restarts.
//
// This migration: (1) deduplicates existing rows, keeping the earliest
// `id` per (module, title) — preserving created_at — and re-pointing
// nothing else, since no other table references ai_knowledge_base.id;
// (2) adds the missing UNIQUE KEY so the seeder's ON DUPLICATE KEY UPDATE
// finally does what its own comment always claimed it did.
//
// Safe to re-run.
//
//   node scripts/ensure-kb-unique-constraint.js --database my_local_db

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
  const db = await mysql.createConnection({ ...CONFIG, namedPlaceholders: true });
  try {
    const [[{ rowCountBefore }]] = await db.query('SELECT COUNT(*) AS rowCountBefore FROM ai_knowledge_base');
    console.log(`Rows before: ${rowCountBefore}`);

    // Delete every row except the lowest id in each (module, title) group.
    const [delResult] = await db.query(`
      DELETE k1 FROM ai_knowledge_base k1
      INNER JOIN ai_knowledge_base k2
        ON k1.module = k2.module AND k1.title = k2.title AND k1.id > k2.id
    `);
    console.log(`Deleted ${delResult.affectedRows} duplicate row(s).`);

    const [[col]] = await db.query(`
      SELECT 1 FROM information_schema.STATISTICS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ai_knowledge_base'
         AND INDEX_NAME = 'uq_kb_module_title'
    `);
    if (col) {
      console.log('uq_kb_module_title already exists.');
    } else {
      await db.query(
        'ALTER TABLE ai_knowledge_base ADD UNIQUE KEY uq_kb_module_title (module, title)'
      );
      console.log('Added UNIQUE KEY uq_kb_module_title (module, title).');
    }

    const [[{ rowCountAfter }]] = await db.query('SELECT COUNT(*) AS rowCountAfter FROM ai_knowledge_base');
    console.log(`Rows after: ${rowCountAfter}`);
  } finally {
    await db.end();
  }
})().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
