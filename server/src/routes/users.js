// =============================================================================
// /api/users
// =============================================================================
const router = require('express').Router();
const bcrypt = require('bcryptjs');
const { z } = require('zod');
const { db } = require('../db');
const { requireAuth, requirePermission, signToken } = require('../middleware/auth');
const { resolveOwnerScope } = require('../services/scope');

router.use(requireAuth);

// Grantable-role allowlist (security remediation C-03) — a caller may only
// assign a role whose permissions are a strict subset of permissions they
// already hold. Admins bypass this (they hold everything by definition via
// the name-based check in middleware/auth.js). Without this, any
// `users.manage` holder could assign themselves — or a new account — a role
// carrying permissions they don't have, e.g. the admin role itself.
async function assertGrantableRoles(user, roleIds) {
  if (!roleIds || !roleIds.length) return;
  if (user.roles?.includes('admin')) return;
  const [rows] = await db.query(
    `SELECT DISTINCT p.\`key\`
       FROM role_permissions rp
       JOIN permissions p ON p.id = rp.permission_id
      WHERE rp.role_id IN (:roleIds)`,
    { roleIds }
  );
  const have = new Set(user.permissions || []);
  const missing = rows.map((r) => r.key).filter((k) => !have.has(k));
  if (missing.length) {
    throw Object.assign(
      new Error(`Cannot assign a role granting permissions you do not hold: ${missing.join(', ')}`),
      { status: 403 }
    );
  }
  // Also refuse assigning the admin role itself (its bypass in
  // requirePermission() means "holds every permission", which the
  // subset check above can't fully capture since new permissions can be
  // added later without a matching role_permissions row for admin).
  const [adminRoles] = await db.query(
    `SELECT id FROM roles WHERE id IN (:roleIds) AND name = 'admin'`,
    { roleIds }
  );
  if (adminRoles.length) {
    throw Object.assign(new Error('Only an administrator can grant the admin role'), { status: 403 });
  }
}

router.get('/', requirePermission('users.manage'), async (req, res, next) => {
  try {
    // Admins see all users. Managers see only themselves + their direct/indirect reports.
    const scopeIds = await resolveOwnerScope(req.user);
    let scopeWhere = '';
    if (scopeIds !== null) {
      if (scopeIds.length === 0) return res.json([]);
      const ids = scopeIds.map((n) => parseInt(n, 10)).join(', ');
      scopeWhere = `WHERE u.id IN (${ids})`;
    }
    const [rows] = await db.query(
      `SELECT u.id, u.email, u.first_name, u.last_name, u.phone, u.is_active, u.last_login_at,
              u.cw_member_id, u.manager_id,
              CONCAT_WS(' ', m.first_name, m.last_name) AS manager_name,
              GROUP_CONCAT(r.name) AS roles
         FROM users u
         LEFT JOIN users m         ON m.id = u.manager_id
         LEFT JOIN user_roles ur   ON ur.user_id = u.id
         LEFT JOIN roles r         ON r.id = ur.role_id
        ${scopeWhere}
        GROUP BY u.id
        ORDER BY u.id`
    );
    res.json(rows.map((r) => ({ ...r, roles: r.roles ? r.roles.split(',') : [] })));
  } catch (err) { next(err); }
});

// GET /assignable — returns the users that the current user can assign records to.
// Admins get everyone; managers get themselves + all recursive reports;
// everyone else gets just themselves. No users.manage permission required.
router.get('/assignable', async (req, res, next) => {
  try {
    const roles = req.user.roles || [];
    if (roles.includes('admin')) {
      const [rows] = await db.query(
        `SELECT id, email, first_name, last_name FROM users WHERE is_active = 1 ORDER BY first_name, last_name`
      );
      return res.json(rows);
    }
    if (roles.includes('manager') || roles.includes('sales_manager')) {
      const [rows] = await db.query(
        `WITH RECURSIVE reports AS (
           SELECT id, email, first_name, last_name FROM users WHERE id = :me AND is_active = 1
           UNION ALL
           SELECT u.id, u.email, u.first_name, u.last_name
             FROM users u JOIN reports r ON u.manager_id = r.id WHERE u.is_active = 1
         ) SELECT * FROM reports ORDER BY first_name, last_name`,
        { me: req.user.id }
      );
      return res.json(rows);
    }
    // Everyone else: just themselves
    const [rows] = await db.query(
      `SELECT id, email, first_name, last_name FROM users WHERE id = :me AND is_active = 1`,
      { me: req.user.id }
    );
    res.json(rows);
  } catch (err) { next(err); }
});

// GET /me/reports — returns all direct + indirect reports for the current user
router.get('/me/reports', async (req, res, next) => {
  try {
    const [rows] = await db.query(
      `WITH RECURSIVE reports AS (
         SELECT id, email, first_name, last_name, manager_id, is_active
           FROM users WHERE manager_id = :me AND is_active = 1
         UNION ALL
         SELECT u.id, u.email, u.first_name, u.last_name, u.manager_id, u.is_active
           FROM users u JOIN reports r ON u.manager_id = r.id
          WHERE u.is_active = 1
       )
       SELECT * FROM reports`,
      { me: req.user.id }
    );
    res.json(rows);
  } catch (err) { next(err); }
});

const createSchema = z.object({
  email: z.string().email(),
  password: z.string()
    .min(12, 'Password must be at least 12 characters')
    .max(128, 'Password must be at most 128 characters')
    .regex(/[a-z]/, 'Password must contain at least one lowercase letter')
    .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
    .regex(/[0-9]/, 'Password must contain at least one number'),
  first_name: z.string().optional(),
  last_name: z.string().optional(),
  phone: z.string().optional(),
  manager_id: z.number().int().nullable().optional(),
  role_ids: z.array(z.number().int()).optional(),
});

router.post('/', requirePermission('users.manage'), async (req, res, next) => {
  try {
    const data = createSchema.parse(req.body);
    // If a sales_manager creates a user and doesn't set a manager, default to themselves
    const roles = req.user.roles || [];
    if (!data.manager_id && (roles.includes('sales_manager') || roles.includes('manager'))) {
      data.manager_id = req.user.id;
    }
    await assertGrantableRoles(req.user, data.role_ids);
    const password_hash = await bcrypt.hash(data.password, 10);
    const [ins] = await db.query(
      `INSERT INTO users (email, password_hash, first_name, last_name, phone, manager_id)
       VALUES (:email, :password_hash, :first_name, :last_name, :phone, :manager_id)`,
      { ...data, password_hash, manager_id: data.manager_id ?? null }
    );
    const userId = ins.insertId;
    if (data.role_ids?.length) {
      const values = data.role_ids.map((rid) => [userId, rid]);
      await db.query('INSERT INTO user_roles (user_id, role_id) VALUES ?', [values]);
    }
    res.status(201).json({ id: userId });
  } catch (err) { next(err); }
});

const updateSchema = z.object({
  first_name:    z.string().optional(),
  last_name:     z.string().optional(),
  phone:         z.string().optional(),
  is_active:     z.boolean().optional(),
  password:      z.string().min(6).optional(),
  manager_id:    z.number().int().nullable().optional(),
  role_ids:      z.array(z.number().int()).optional(),
  cw_member_id:  z.string().optional().nullable(),
});

router.put('/:id', requirePermission('users.manage'), async (req, res, next) => {
  try {
    const data = updateSchema.parse(req.body);
    const id = Number(req.params.id);
    // Managers can only edit users within their reporting scope
    const scopeIds = await resolveOwnerScope(req.user);
    if (scopeIds !== null && !scopeIds.includes(id)) {
      return res.status(403).json({ error: 'Outside your management scope' });
    }
    // No self-role-modification, ever (security remediation C-03) — scope
    // checks above always include the caller's own id, so without this a
    // manager could grant themselves any role in one request.
    if (data.role_ids && id === req.user.id) {
      return res.status(403).json({ error: 'You cannot change your own roles.' });
    }
    await assertGrantableRoles(req.user, data.role_ids);
    const fields = [];
    const params = { id };
    for (const k of ['first_name', 'last_name', 'phone', 'is_active', 'manager_id', 'cw_member_id']) {
      if (data[k] !== undefined) {
        fields.push(`${k} = :${k}`);
        params[k] = data[k];
      }
    }
    if (data.password) {
      fields.push('password_hash = :password_hash');
      params.password_hash = await bcrypt.hash(data.password, 10);
    }
    if (fields.length) {
      await db.query(`UPDATE users SET ${fields.join(', ')} WHERE id = :id`, params);
    }
    if (data.role_ids) {
      await db.query('DELETE FROM user_roles WHERE user_id = :id', { id });
      if (data.role_ids.length) {
        const values = data.role_ids.map((rid) => [id, rid]);
        await db.query('INSERT INTO user_roles (user_id, role_id) VALUES ?', [values]);
      }
    }
    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.delete('/:id', requirePermission('users.manage'), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const scopeIds = await resolveOwnerScope(req.user);
    if (scopeIds !== null && !scopeIds.includes(id)) {
      return res.status(403).json({ error: 'Outside your management scope' });
    }
    await db.query('UPDATE users SET is_active = 0 WHERE id = :id', { id });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// POST /:id/impersonate
// Manager acts on behalf of a direct/indirect report.
// Returns a short-lived JWT with impersonating_as claim.
// The frontend should store it separately and show a "Viewing as [name]" banner.
router.post('/:id/impersonate', requirePermission('users.impersonate'), async (req, res, next) => {
  try {
    const targetId = Number(req.params.id);
    if (targetId === req.user.id) {
      return res.status(400).json({ error: 'Cannot impersonate yourself' });
    }

    // Load the target user
    const [[target]] = await db.query(
      `SELECT id, email, first_name, last_name, is_active FROM users WHERE id = :id`,
      { id: targetId }
    );
    if (!target || !target.is_active) {
      return res.status(404).json({ error: 'User not found or inactive' });
    }

    // Verify target is within the manager's scope (direct or indirect report)
    const scopeIds = await resolveOwnerScope(req.user);
    if (scopeIds !== null && !scopeIds.includes(targetId)) {
      return res.status(403).json({ error: 'User is not within your reporting scope' });
    }

    // Issue a short-lived impersonation token (2 hours)
    const token = signToken(
      { ...target, impersonating_as: targetId },
      { impersonating_as: targetId, expiresIn: '2h' }
    );

    // Log the impersonation
    const { db: dbConn } = require('../db');
    await dbConn.query(
      `INSERT INTO activities (user_id, entity_type, entity_id, action, description)
       VALUES (:uid, 'user', :tid, 'impersonate_start',
               :desc)`,
      {
        uid: req.user.id,
        tid: targetId,
        desc: `Manager ${req.user.email} started impersonating ${target.email}`,
      }
    ).catch(() => {}); // non-fatal

    res.json({
      token,
      impersonating: {
        id: target.id,
        email: target.email,
        first_name: target.first_name,
        last_name: target.last_name,
      },
    });
  } catch (err) { next(err); }
});

module.exports = router;
