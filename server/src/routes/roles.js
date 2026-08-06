// =============================================================================
// /api/roles
// =============================================================================
const router = require('express').Router();
const { z } = require('zod');
const { db } = require('../db');
const { requireAuth, requirePermission } = require('../middleware/auth');

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

router.post('/', requirePermission('roles.manage'), async (req, res, next) => {
  try {
    const data = saveSchema.parse(req.body);
    const [ins] = await db.query(
      'INSERT INTO roles (name, description) VALUES (:name, :description)',
      { name: data.name, description: data.description || null }
    );
    if (data.permission_ids?.length) {
      const values = data.permission_ids.map((pid) => [ins.insertId, pid]);
      await db.query('INSERT INTO role_permissions (role_id, permission_id) VALUES ?', [values]);
    }
    res.status(201).json({ id: ins.insertId });
  } catch (err) { next(err); }
});

router.put('/:id', requirePermission('roles.manage'), async (req, res, next) => {
  try {
    const data = saveSchema.parse(req.body);
    const id = Number(req.params.id);
    await db.query('UPDATE roles SET name = :name, description = :description WHERE id = :id',
      { id, name: data.name, description: data.description || null });
    if (data.permission_ids) {
      await db.query('DELETE FROM role_permissions WHERE role_id = :id', { id });
      if (data.permission_ids.length) {
        const values = data.permission_ids.map((pid) => [id, pid]);
        await db.query('INSERT INTO role_permissions (role_id, permission_id) VALUES ?', [values]);
      }
    }
    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.delete('/:id', requirePermission('roles.manage'), async (req, res, next) => {
  try {
    const [rows] = await db.query('SELECT is_system FROM roles WHERE id = :id', { id: req.params.id });
    if (rows[0]?.is_system) return res.status(400).json({ error: 'Cannot delete a system role' });
    await db.query('DELETE FROM roles WHERE id = :id', { id: req.params.id });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;
