// =============================================================================
// /api/pipelines (includes /:id/stages and /:id/users access control)
// =============================================================================
const router = require('express').Router();
const { z } = require('zod');
const { db } = require('../db');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { resolveOwnerScope } = require('../services/scope');

router.use(requireAuth);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Returns true if the caller is unrestricted (admin / readonly / portal) */
function isUnrestricted(user) {
  const roles = user.roles || [];
  return roles.includes('admin') || roles.includes('readonly') || roles.includes('portal');
}

/** Returns true if the caller is a manager-level role */
function isManager(user) {
  const roles = user.roles || [];
  return roles.includes('manager') || roles.includes('sales_manager');
}

// ---------------------------------------------------------------------------
// GET /pipelines — returns pipelines the caller is allowed to see
//   Admins / managers → all pipelines
//   Agents / others  → only those granted via user_pipeline_access
// ---------------------------------------------------------------------------
router.get('/', async (req, res, next) => {
  try {
    if (isUnrestricted(req.user) || isManager(req.user)) {
      const [rows] = await db.query('SELECT * FROM pipelines ORDER BY id');
      return res.json(rows);
    }
    // Scoped: only pipelines explicitly granted
    const [rows] = await db.query(
      `SELECT p.*
         FROM pipelines p
         JOIN user_pipeline_access a ON a.pipeline_id = p.id AND a.user_id = :uid
        ORDER BY p.id`,
      { uid: req.user.id }
    );
    res.json(rows);
  } catch (err) { next(err); }
});

router.get('/:id', async (req, res, next) => {
  try {
    const [pipelines] = await db.query('SELECT * FROM pipelines WHERE id = :id', { id: req.params.id });
    if (!pipelines[0]) return res.status(404).json({ error: 'Not found' });
    const [stages] = await db.query(
      'SELECT * FROM stages WHERE pipeline_id = :id ORDER BY display_order, id',
      { id: req.params.id }
    );
    res.json({ ...pipelines[0], stages });
  } catch (err) { next(err); }
});

const pipelineSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional().nullable(),
  is_default: z.boolean().optional(),
  is_active:  z.boolean().optional(),
});

router.post('/', requirePermission('pipelines.manage'), async (req, res, next) => {
  try {
    const d = pipelineSchema.parse(req.body);
    const [ins] = await db.query(
      `INSERT INTO pipelines (name, description, is_default, is_active)
       VALUES (:name, :description, :is_default, :is_active)`,
      {
        name: d.name,
        description: d.description ?? null,
        is_default: d.is_default ? 1 : 0,
        is_active:  d.is_active ?? 1,
      }
    );
    res.status(201).json({ id: ins.insertId });
  } catch (err) { next(err); }
});

router.put('/:id', requirePermission('pipelines.manage'), async (req, res, next) => {
  try {
    const d = pipelineSchema.partial().parse(req.body);
    const id = Number(req.params.id);
    const cols = Object.keys(d);
    if (!cols.length) return res.json({ ok: true });
    const params = { id };
    const set = cols.map((k) => {
      params[k] = typeof d[k] === 'boolean' ? (d[k] ? 1 : 0) : d[k];
      return `${k} = :${k}`;
    }).join(', ');
    await db.query(`UPDATE pipelines SET ${set} WHERE id = :id`, params);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.delete('/:id', requirePermission('pipelines.manage'), async (req, res, next) => {
  try {
    await db.query('DELETE FROM pipelines WHERE id = :id', { id: req.params.id });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// Pipeline user-access endpoints
// ---------------------------------------------------------------------------

/**
 * GET /pipelines/:id/users
 * Returns users who have been granted access to this pipeline.
 * Requires pipelines.manage OR manager/admin role.
 * Managers only see users within their reporting scope.
 */
router.get('/:id/users', async (req, res, next) => {
  try {
    if (!isUnrestricted(req.user) && !isManager(req.user)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const pid = Number(req.params.id);

    // Determine the pool of users this manager can assign
    let userFilter = '';
    if (!isUnrestricted(req.user)) {
      // Manager: restrict to their scope
      const scopeIds = await resolveOwnerScope(req.user);
      if (scopeIds !== null && scopeIds.length === 0) {
        return res.json([]);
      }
      if (scopeIds !== null) {
        const ids = scopeIds.map((n) => parseInt(n, 10)).join(', ');
        userFilter = `AND u.id IN (${ids})`;
      }
    }

    // Only return users who need explicit grants (agents/sales roles).
    // Admins, managers, readonly, and portal users always have full or separate access
    // and should not appear in the toggle list.
    const [rows] = await db.query(
      `SELECT u.id, u.first_name, u.last_name, u.email,
              IF(a.user_id IS NOT NULL, 1, 0) AS has_access
         FROM users u
         LEFT JOIN user_pipeline_access a ON a.user_id = u.id AND a.pipeline_id = ${parseInt(pid, 10)}
        WHERE u.is_active = 1 ${userFilter}
          AND NOT EXISTS (
            SELECT 1 FROM user_roles ur
            JOIN roles r ON r.id = ur.role_id
            WHERE ur.user_id = u.id
              AND r.name IN ('admin', 'manager', 'sales_manager', 'readonly', 'portal')
          )
        ORDER BY u.first_name, u.last_name`
    );
    res.json(rows);
  } catch (err) { next(err); }
});

/**
 * PUT /pipelines/:id/users
 * Body: { user_ids: number[] }
 * Replaces the full access list for this pipeline (within the manager's scope).
 * Requires pipelines.manage OR manager role.
 */
router.put('/:id/users', async (req, res, next) => {
  try {
    if (!isUnrestricted(req.user) && !isManager(req.user)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const pid = Number(req.params.id);
    const { user_ids: rawIds } = z.object({ user_ids: z.array(z.number().int()) }).parse(req.body);

    // Strip any admin/manager-tier users from the incoming list — they never need explicit grants
    const [privilegedRows] = await db.query(
      `SELECT DISTINCT ur.user_id FROM user_roles ur
       JOIN roles r ON r.id = ur.role_id
       WHERE r.name IN ('admin', 'manager', 'sales_manager', 'readonly', 'portal')`
    );
    const privilegedIds = new Set(privilegedRows.map((r) => r.user_id));
    const user_ids = rawIds.filter((id) => !privilegedIds.has(id));

    // Determine which users the caller is allowed to manage
    const scopeIds = await resolveOwnerScope(req.user);

    if (scopeIds !== null) {
      // Manager: only touch rows within their scope
      // Remove access for scoped users not in new list
      if (scopeIds.length > 0) {
        const scopeStr = scopeIds.map((n) => parseInt(n, 10)).join(', ');
        await db.query(
          `DELETE FROM user_pipeline_access
            WHERE pipeline_id = ${parseInt(pid, 10)}
              AND user_id IN (${scopeStr})`
        );
        // Grant access to the intersection of user_ids and scope
        const toGrant = user_ids.filter((id) => scopeIds.includes(id));
        if (toGrant.length) {
          const values = toGrant.map((uid) => [uid, pid, req.user.id]);
          await db.query(
            'INSERT IGNORE INTO user_pipeline_access (user_id, pipeline_id, granted_by) VALUES ?',
            [values]
          );
        }
      }
    } else {
      // Unrestricted (admin): replace entire list for this pipeline
      await db.query(
        'DELETE FROM user_pipeline_access WHERE pipeline_id = :pid',
        { pid }
      );
      if (user_ids.length) {
        const values = user_ids.map((uid) => [uid, pid, req.user.id]);
        await db.query(
          'INSERT IGNORE INTO user_pipeline_access (user_id, pipeline_id, granted_by) VALUES ?',
          [values]
        );
      }
    }

    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ---- stages ----
const stageSchema = z.object({
  name: z.string().min(1),
  display_order: z.number().int().optional(),
  win_probability: z.number().optional(),
  stage_type: z.enum(['open','won','lost']).optional(),
  color: z.string().optional(),
});

router.get('/:id/stages', async (req, res, next) => {
  try {
    const [rows] = await db.query(
      'SELECT * FROM stages WHERE pipeline_id = :id ORDER BY display_order, id',
      { id: req.params.id });
    res.json(rows);
  } catch (err) { next(err); }
});

router.post('/:id/stages', requirePermission('pipelines.manage'), async (req, res, next) => {
  try {
    const d = stageSchema.parse(req.body);
    const [ins] = await db.query(
      `INSERT INTO stages (pipeline_id, name, display_order, win_probability, stage_type, color)
       VALUES (:pid, :name, :order, :prob, :stype, :color)`,
      {
        pid: req.params.id,
        name: d.name,
        order: d.display_order ?? 0,
        prob:  d.win_probability ?? 0,
        stype: d.stage_type ?? 'open',
        color: d.color ?? '#0E9488',
      }
    );
    res.status(201).json({ id: ins.insertId });
  } catch (err) { next(err); }
});

router.put('/:pipelineId/stages/:stageId', requirePermission('pipelines.manage'), async (req, res, next) => {
  try {
    const d = stageSchema.partial().parse(req.body);
    const id = Number(req.params.stageId);
    const cols = Object.keys(d);
    if (!cols.length) return res.json({ ok: true });
    const map = { display_order: 'display_order', win_probability: 'win_probability', stage_type: 'stage_type', color: 'color', name: 'name' };
    const set = cols.map((k) => `${map[k]} = :${k}`).join(', ');
    await db.query(`UPDATE stages SET ${set} WHERE id = :id`, { ...d, id });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.delete('/:pipelineId/stages/:stageId', requirePermission('pipelines.manage'), async (req, res, next) => {
  try {
    await db.query('DELETE FROM stages WHERE id = :id', { id: req.params.stageId });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;
