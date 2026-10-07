#!/usr/bin/env node
// Adds the lms.read / lms.write permissions for the Learning module admin
// console (routes/lms.js) and grants them to the same roles that already
// hold membership.read / membership.write (admin/manager read+write,
// sales/readonly read-only) — mirrors that module's grant pattern since
// they're both fundraising/congregation-facing admin features. Safe to
// re-run.
//
//   node scripts/ensure-lms-permissions.js --database my_local_db

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

const PERMISSIONS = [
  { key: 'lms.read', description: 'View courses and cohorts', roles: ['admin', 'manager', 'sales', 'readonly'] },
  { key: 'lms.write', description: 'Create and manage courses and cohorts', roles: ['admin', 'manager'] },
];

(async () => {
  console.log(`Target: ${CONFIG.user}@${CONFIG.host}:${CONFIG.port}/${CONFIG.database}`);
  const db = await mysql.createConnection(CONFIG);
  try {
    for (const perm of PERMISSIONS) {
      const [[existing]] = await db.query('SELECT id FROM permissions WHERE `key` = :key', { key: perm.key });
      let permId = existing?.id;
      if (!permId) {
        const [ins] = await db.query(
          'INSERT INTO permissions (`key`, description, module_key) VALUES (:key, :description, :moduleKey)',
          { key: perm.key, description: perm.description, moduleKey: 'lms' }
        );
        permId = ins.insertId;
        console.log(`Added permission ${perm.key} (id=${permId})`);
      } else {
        console.log(`Permission ${perm.key} already exists (id=${permId})`);
      }

      const [roles] = await db.query(
        `SELECT id, name FROM roles WHERE name IN (${perm.roles.map(() => '?').join(',')})`,
        perm.roles
      );
      for (const role of roles) {
        const [[grant]] = await db.query(
          'SELECT 1 AS x FROM role_permissions WHERE role_id = :rid AND permission_id = :pid',
          { rid: role.id, pid: permId }
        );
        if (grant) {
          console.log(`  ${role.name}: already granted`);
          continue;
        }
        await db.query(
          'INSERT INTO role_permissions (role_id, permission_id) VALUES (:rid, :pid)',
          { rid: role.id, pid: permId }
        );
        console.log(`  ${role.name}: granted`);
      }
    }
  } finally {
    await db.end();
  }
})().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
