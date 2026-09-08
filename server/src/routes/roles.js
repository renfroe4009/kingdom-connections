// =============================================================================
// /api/roles
// =============================================================================
const router = require('express').Router();
const { z } = require('zod');
const { db } = require('../db');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { logActivity } = require('../services/activity');

router.use(requireAuth);

router.get('/', requirePermission('roles.manage'), async (_req, res, next) => {
  try {
    const [rows] = await db.query(`
      SELECT r.*, (SELECT COUNT(*) FROM user_roles ur WHERE ur.role_id = r.id) AS user_count
        FROM roles r ORDER BY r.id
    `);
    const ids = rows.map((r) => r.id);
    let permMap = {};
    if (ids.length) {
      const [permRows] = await db.query(
        `SELECT rp.role_id, p.id, p.\`key\`, p.description
           FROM role_permissions rp
           JOIN permissions p ON p.id = rp.permission_id
          WHERE rp.role_id IN (?)
          ORDER BY p.\`key\``,
        [ids]
      );
      permMap = permRows.reduce((acc, p) => {
        (acc[p.role_id] = acc[p.role_id] || []).push({ id: p.id, key: p.key, description: p.description });
        return acc;
      }, {});
    }
    res.json(rows.map((r) => ({ ...r, permissions: permMap[r.id] || [] })));
  } catch (err) { next(err); }
});

router.get('/:id', requirePermission('roles.manage'), async (req, res, next) => {
  try {
    const [roles] = await db.query('SELECT * FROM roles WHERE id = :id', { id: req.params.id });
    if (!roles[0]) return res.status(404).json({ error: 'Not found' });
    const [perms] = await db.query(
      `SELECT p.id, p.\`key\`, p.description
         FROM permissions p JOIN role_permissions rp ON rp.permission_id = p.id
        WHERE rp.role_id = :id`,
      { id: req.params.id }
    );
    res.json({ ...roles[0], permissions: perms });
  } catch (err) { next(err); }
});

router.get('/meta/permissions', requirePermission('roles.manage'), async (_req, res, next) => {
  try {
    const [rows] = await db.query('SELECT * FROM permissions ORDER BY `key`');
    res.json(rows);
  } catch (err) { next(err); }
});

const saveSchema = z.object({
  name: z.string().min(2),
  description: z.string().optional(),
  permission_ids: z.array(z.number().int()).optional(),
});

// Security remediation H-09 — a non-admin roles.manage holder must not be
// able to grant a role permissions they don't already have themselves
// (mirrors C-03's assertGrantableRoles, applied to permission_ids here
// instead of role_ids). Admins bypass, same as everywhere else.
async function assertGrantablePermissions(user, permissionIds) {
  if (!permissionIds?.length || user.roles?.includes('admin')) return;
  const [rows] = await db.query(
    'SELECT `key` FROM permissions WHERE id IN (:ids)', { ids: permissionIds }
  );
  const have = new Set(user.permissions || []);
  const missing = rows.map((r) => r.key).filter((k) => !have.has(k));
  if (missing.length) {
    throw Object.assign(
      new Error(`Cannot grant permissions you do not hold: ${missing.join(', ')}`),
      { status: 403 }
    );
  }
}

router.post('/', requirePermission('roles.manage'), async (req, res, next) => {
  try {
    const data = saveSchema.parse(req.body);
    await assertGrantablePermissions(req.user, data.permission_ids);
    const [ins] = await db.query(
      'INSERT INTO roles (name, description) VALUES (:name, :description)',
      { name: data.name, description: data.description || null }
    );
    if (data.permission_ids?.length) {
      const values = data.permission_ids.map((pid) => [ins.insertId, pid]);
      await db.query('INSERT INTO role_permissions (role_id, permission_id) VALUES ?', [values]);
    }
    // Security remediation M-07 — role changes were never audit-logged at
    // all. required:true so a failed log write fails the request instead
    // of a new role silently existing with no trace of who created it.
    await logActivity({
      userId: req.user.id, entityType: 'role', entityId: ins.insertId, action: 'role_created',
      description: `${req.user.email} created role "${data.name}"`,
      meta: { permission_ids: data.permission_ids || [] },
      required: true,
    });
    res.status(201).json({ id: ins.insertId });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

router.put('/:id', requirePermission('roles.manage'), async (req, res, next) => {
  try {
    const data = saveSchema.parse(req.body);
    const id = Number(req.params.id);

    const [[existing]] = await db.query('SELECT name, is_system FROM roles WHERE id = :id', { id });
    if (!existing) return res.status(404).json({ error: 'Not found' });

    // Security remediation H-09 — four escalation paths closed here:
    // 1. A system role's name is load-bearing (the middleware/auth.js
    //    admin bypass matches on role NAME) — renaming it away could lock
    //    out every administrator or orphan every account holding it.
    if (existing.is_system && data.name !== existing.name) {
      return res.status(400).json({ error: 'Cannot rename a system role' });
    }
    // 2. Conversely, no role — system or custom — may be renamed TO
    //    "admin" except the real admin role itself. Renaming an unrelated
    //    custom role to "admin" grants the requirePermission() bypass to
    //    everyone holding it, without ever touching the real admin role.
    if (data.name.toLowerCase() === 'admin' && existing.name !== 'admin') {
      return res.status(400).json({ error: 'Only the built-in admin role may be named "admin"' });
    }
    // 3. A caller may not modify a role they themselves hold — closes the
    //    self-service permission-grant path (a roles.manage holder editing
    //    their own role's permission_ids to grant themselves more access).
    if (!req.user.roles?.includes('admin') && req.user.roles?.includes(existing.name)) {
      return res.status(403).json({ error: 'You cannot modify a role you hold' });
    }
    // 4. Cannot grant permissions the caller doesn't already have.
    await assertGrantablePermissions(req.user, data.permission_ids);

    await db.query('UPDATE roles SET name = :name, description = :description WHERE id = :id',
      { id, name: data.name, description: data.description || null });
    if (data.permission_ids) {
      await db.query('DELETE FROM role_permissions WHERE role_id = :id', { id });
      if (data.permission_ids.length) {
        const values = data.permission_ids.map((pid) => [id, pid]);
        await db.query('INSERT INTO role_permissions (role_id, permission_id) VALUES ?', [values]);
      }
    }
    // Security remediation M-07 — non-optional, same reasoning as POST above.
    await logActivity({
      userId: req.user.id, entityType: 'role', entityId: id, action: 'role_updated',
      description: `${req.user.email} updated role "${data.name}"`,
      meta: { permission_ids: data.permission_ids },
      required: true,
    });
    res.json({ ok: true });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

router.delete('/:id', requirePermission('roles.manage'), async (req, res, next) => {
  try {
    const [rows] = await db.query('SELECT is_system, name FROM roles WHERE id = :id', { id: req.params.id });
    if (rows[0]?.is_system) return res.status(400).json({ error: 'Cannot delete a system role' });
    await db.query('DELETE FROM roles WHERE id = :id', { id: req.params.id });
    // Security remediation M-07 — non-optional, same reasoning as above.
    await logActivity({
      userId: req.user.id, entityType: 'role', entityId: Number(req.params.id), action: 'role_deleted',
      description: `${req.user.email} deleted role "${rows[0]?.name || req.params.id}"`,
      required: true,
    });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;
