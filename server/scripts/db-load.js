#!/usr/bin/env node
// Loads a raw .sql file (db/schema.sql or db/seed.sql) against the DB in
// server/.env, so first-time setup doesn't depend on the `mysql` CLI being
// on PATH or on the shell having DB_* exported. Multi-statement dumps (LOCK
// TABLES, multiple INSERTs) run fine via mysql2's multipleStatements mode.
//
//   node scripts/db-load.js ../../db/schema.sql
//   node scripts/db-load.js ../../db/seed.sql

const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const target = process.argv[2];
if (!target) {
  console.error('Usage: node scripts/db-load.js <path-to-sql-file>');
  process.exit(1);
}

const filePath = path.resolve(__dirname, target);

(async () => {
  const sql = fs.readFileSync(filePath, 'utf8');
  const db = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    multipleStatements: true,
  });
  try {
    console.log(`Loading ${path.basename(filePath)} into ${process.env.DB_NAME}@${process.env.DB_HOST}...`);
    await db.query(sql);
    console.log('Done.');
  } finally {
    await db.end();
  }
})().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
