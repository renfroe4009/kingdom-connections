#!/usr/bin/env node
// Adds the notes.read permission (security remediation H-02) and grants it
// to the same roles that already hold contacts.read (admin/manager/sales/
// readonly) — notes.write already exists and is held by admin/manager/sales;
// this mirrors the read-side pattern, including readonly, which reads
// everything else. Without this, requirePermission('notes.read') on
// GET /api/notes would be unsatisfiable by any non-admin role, since the
// permission row itself never existed. Safe to re-run.
//
//   node scripts/ensure-notes-read-permission.js --database my_local_db

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
  namedPlaceholders: true,
};

(async () => {
  console.log(`Target: ${CONFIG.user}@${CONFIG.host}:${CONFIG.port}/${CONFIG.database}`);
  const db = await mysql.createConnection(CONFIG);
  try {
    const [[existing]] = await db.query(`SELECT id FROM permissions WHERE \`key\` = 'notes.read'`);
    let permId = existing?.id;
    if (!permId) {
      const [ins] = await db.query(
        `INSERT INTO permissions (\`key\`, description, module_key) VALUES ('notes.read', 'View notes', NULL)`
      );
      permId = ins.insertId;
      console.log(`Added permission notes.read (id=${permId})`);
    } else {
      console.log(`Permission notes.read already exists (id=${permId})`);
    }

    const [roles] = await db.query(
      `SELECT r.id, r.name FROM roles r WHERE r.name IN ('admin','manager','sales','readonly')`
    );
    for (const role of roles) {
      const [[grant]] = await db.query(
        `SELECT 1 AS x FROM role_permissions WHERE role_id = :rid AND permission_id = :pid`,
        { rid: role.id, pid: permId }
      );
      if (grant) {
        console.log(`  ${role.name}: already granted`);
        continue;
      }
      await db.query(
        `INSERT INTO role_permissions (role_id, permission_id) VALUES (:rid, :pid)`,
        { rid: role.id, pid: permId }
      );
      console.log(`  ${role.name}: granted`);
    }
  } finally {
    await db.end();
  }
})().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
