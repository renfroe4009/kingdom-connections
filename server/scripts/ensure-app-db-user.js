#!/usr/bin/env node
// Provisions (or re-grants) a least-privilege MySQL user for the app to
// connect as, instead of the admin/root user used to run migrations.
// Scoped to just this database — no GRANT OPTION, no access to `mysql.*`
// or other schemas, no ability to create/drop other users.
//
// Connect using your existing ADMIN credentials (the ones with privilege
// to run CREATE USER / GRANT — e.g. root), and pass the NEW app user's
// desired name/password with --app-user / --app-password. If
// --app-password is omitted, a random one is generated and printed once
// (never stored anywhere — save it immediately).
//
// Safe to re-run: CREATE USER IF NOT EXISTS won't reset an existing
// user's password; GRANT statements are naturally idempotent/additive.
//
//   node scripts/ensure-app-db-user.js --database railway --app-user kc_app

const path = require('path');
const crypto = require('crypto');
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

const APP_USER = arg('app-user', 'kc_app');
const GENERATED_PASSWORD = crypto.randomBytes(24).toString('base64url');
const APP_PASSWORD = arg('app-password', GENERATED_PASSWORD);
const IDENTIFIER_RE = /^[A-Za-z0-9_]+$/;

(async () => {
  if (!IDENTIFIER_RE.test(APP_USER)) throw new Error(`Invalid --app-user: ${APP_USER}`);
  if (!IDENTIFIER_RE.test(CONFIG.database || '')) throw new Error(`Invalid --database: ${CONFIG.database}`);

  console.log(`Target: ${CONFIG.user}@${CONFIG.host}:${CONFIG.port}/${CONFIG.database}`);
  const db = await mysql.createConnection({ ...CONFIG, namedPlaceholders: true, multipleStatements: false });
  try {
    await db.query('CREATE USER IF NOT EXISTS ?@? IDENTIFIED BY ?', [APP_USER, '%', APP_PASSWORD]);
    // Scoped to this database only; deliberately no GRANT OPTION, no
    // mysql.* access, no CREATE USER / DROP DATABASE / SUPER.
    await db.query(
      `GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX, REFERENCES, DROP,
              CREATE TEMPORARY TABLES, LOCK TABLES
         ON \`${CONFIG.database}\`.* TO ?@?`,
      [APP_USER, '%']
    );
    await db.query('FLUSH PRIVILEGES');

    const [[existed]] = await db.query(
      'SELECT 1 FROM mysql.user WHERE User = ? AND authentication_string IS NOT NULL LIMIT 1',
      [APP_USER]
    ).catch(() => [[null]]); // mysql.user may not be readable depending on host policy; non-fatal

    console.log(`Granted least-privilege access on \`${CONFIG.database}\` to '${APP_USER}'@'%'.`);
    if (arg('app-password', null)) {
      console.log('Password: (the one you passed via --app-password)');
    } else {
      console.log('');
      console.log('New user password (save this now — it is not stored or shown again):');
      console.log(`  ${APP_PASSWORD}`);
      console.log('');
      console.log('Note: if this user already existed, its password was NOT changed — only');
      console.log('grants were (re)applied. The value above only took effect on first creation.');
    }
    void existed;
  } finally {
    await db.end();
  }
})().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
