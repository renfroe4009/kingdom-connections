// =============================================================================
// /api/deals — CRUD + stage moves + Kanban + CW push on Won
// =============================================================================
const router = require('express').Router();
const { z } = require('zod');
const { db } = require('../db');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { logActivity } = require('../services/activity');
const { pushDealToManage, getCwSettings } = require('../services/connectwise');
const moduleSettings = require('../services/moduleSettings');
const { resolveOwnerScope, ownerClause } = require('../services/scope');
const { triggerWorkflow } = require('../services/automations');

// Close all open tasks linked to a deal
async function closeTasksForDeal(dealId) {
  await db.query(
    `UPDATE tasks SET status = 'completed', completed_at = NOW()
      WHERE entity_type = 'deal' AND entity_id = :id
        AND status NOT IN ('completed', 'cancelled')`,
    { id: dealId }
  );
}

// Validate create/update payload against module settings
function validateDealPayload(d, cfg, { isCreate = false, goingLost = false } = {}) {
  const errors = [];
  if (isCreate) {
    if (cfg.require_amount && !(d.amount > 0))
      errors.push('Amount is required and must be greater than 0.');
    if (cfg.require_close_date && !d.expected_close_date)
      errors.push('Expected close date is required.');
    if (cfg.require_primary_contact && !d.primary_contact_id)
      errors.push('A primary contact is required.');
  }
  if (goingLost && cfg.lost_reason_required && !d.lost_reason?.trim())
    errors.push('A lost reason is required when marking a deal as lost.');
  return errors;
}

router.use(requireAuth);

// Kanban / board view for a given pipeline
router.get('/kanban', requirePermission('deals.read'), async (req, res, next) => {
  try {
    const pipelineId = Number(req.query.pipeline_id);
    if (!pipelineId) return res.status(400).json({ error: 'pipeline_id required' });

    const [stages] = await db.query(
      'SELECT * FROM stages WHERE pipeline_id = :id ORDER BY display_order, id',
      { id: pipelineId });

    const scopeIds = await resolveOwnerScope(req.user);
    const scopeClause = ownerClause(scopeIds, 'd.owner_id');
    const kanbanWhere = scopeClause
      ? `d.pipeline_id = :id AND ${scopeClause}`
      : `d.pipeline_id = :id`;

    const [deals] = await db.query(
      `SELECT d.*, o.name AS organization_name,
              CONCAT_WS(' ', u.first_name, u.last_name) AS owner_name,
              CONCAT_WS(' ', c.first_name, c.last_name) AS contact_name
         FROM deals d
         LEFT JOIN organizations o ON o.id = d.organization_id
         LEFT JOIN users u         ON u.id = d.owner_id
         LEFT JOIN contacts c      ON c.id = d.primary_contact_id
        WHERE ${kanbanWhere}
        ORDER BY d.updated_at DESC`,
      { id: pipelineId });

    const board = stages.map((s) => ({
      ...s,
      deals: deals.filter((d) => d.stage_id === s.id),
      total: deals.filter((d) => d.stage_id === s.id).reduce((acc, x) => acc + Number(x.amount || 0), 0),
    }));
    res.json({ stages: board });
  } catch (err) { next(err); }
});

router.get('/', requirePermission('deals.read'), async (req, res, next) => {
  try {
    const { q, status, pipeline_id, owner_id, page = 1, pageSize = 25 } = req.query;
    const where = ['1=1']; const params = {};

    const scopeIds = await resolveOwnerScope(req.user);
    const scopeClause = ownerClause(scopeIds, 'd.owner_id');
    if (scopeClause) where.push(scopeClause);

    if (q)           { where.push('d.name LIKE :q'); params.q = `%${q}%`; }
    if (status)      { where.push('d.status = :status'); params.status = status; }
    if (pipeline_id) { where.push('d.pipeline_id = :pid'); params.pid = pipeline_id; }
    if (owner_id)    { where.push('d.owner_id = :oid'); params.oid = owner_id; }
    params.limit = Number(pageSize);
    params.offset = (Number(page) - 1) * Number(pageSize);

    const [rows] = await db.query(
      `SELECT d.*, o.name AS organization_name, s.name AS stage_name, p.name AS pipeline_name,
              CONCAT_WS(' ', u.first_name, u.last_name) AS owner_name
         FROM deals d
         LEFT JOIN organizations o ON o.id = d.organization_id
         LEFT JOIN stages s        ON s.id = d.stage_id
         LEFT JOIN pipelines p     ON p.id = d.pipeline_id
         LEFT JOIN users u         ON u.id = d.owner_id
        WHERE ${where.join(' AND ')}
        ORDER BY d.updated_at DESC
        LIMIT :limit OFFSET :offset`,
      params
    );
    const [[{ total }]] = await db.query(
      `SELECT COUNT(*) AS total FROM deals d WHERE ${where.join(' AND ')}`, params);
    res.json({ rows, total, page: Number(page), pageSize: Number(pageSize) });
  } catch (err) { next(err); }
});

router.get('/:id', requirePermission('deals.read'), async (req, res, next) => {
  try {
    const scopeIds = await resolveOwnerScope(req.user);
    const [rows] = await db.query(
      `SELECT d.*, o.name AS organization_name, s.name AS stage_name, s.stage_type,
              p.name AS pipeline_name,
              CONCAT_WS(' ', u.first_name, u.last_name) AS owner_name,
              CONCAT_WS(' ', c.first_name, c.last_name) AS contact_name,
              c.email AS contact_email,
              c.mobile AS contact_mobile,
              c.phone  AS contact_phone
         FROM deals d
         LEFT JOIN organizations o ON o.id = d.organization_id
         LEFT JOIN stages s        ON s.id = d.stage_id
         LEFT JOIN pipelines p     ON p.id = d.pipeline_id
         LEFT JOIN users u         ON u.id = d.owner_id
         LEFT JOIN contacts c      ON c.id = d.primary_contact_id
        WHERE d.id = :id`,
      { id: req.params.id }
    );
    if (!rows[0]) return res.status(404).json({ error: 'Not found' });
    if (scopeIds !== null && !scopeIds.includes(rows[0].owner_id)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const [history] = await db.query(
      `SELECT h.*, sf.name AS from_stage_name, st.name AS to_stage_name,
              CONCAT_WS(' ', u.first_name, u.last_name) AS changed_by_name
         FROM deal_stage_history h
         LEFT JOIN stages sf ON sf.id = h.from_stage_id
         LEFT JOIN stages st ON st.id = h.to_stage_id
         LEFT JOIN users u   ON u.id  = h.changed_by
        WHERE h.deal_id = :id
        ORDER BY h.changed_at DESC`,
      { id: req.params.id });

    const [notes] = await db.query(
      `SELECT n.*, CONCAT_WS(' ', u.first_name, u.last_name) AS user_name
         FROM notes n LEFT JOIN users u ON u.id = n.user_id
        WHERE n.entity_type='deal' AND n.entity_id = :id
        ORDER BY n.created_at DESC`, { id: req.params.id });

    const [tasks] = await db.query(
      `SELECT t.*, CONCAT_WS(' ', u.first_name, u.last_name) AS assignee_name
         FROM tasks t LEFT JOIN users u ON u.id = t.assigned_to
        WHERE t.entity_type='deal' AND t.entity_id = :id
        ORDER BY t.due_date ASC`, { id: req.params.id });

    const [activities] = await db.query(
      `SELECT a.*, CONCAT_WS(' ', u.first_name, u.last_name) AS user_name
         FROM activities a LEFT JOIN users u ON u.id = a.user_id
        WHERE a.entity_type='deal' AND a.entity_id = :id
        ORDER BY a.created_at DESC LIMIT 100`, { id: req.params.id });

    res.json({ deal: rows[0], history, notes, tasks, activities });
  } catch (err) { next(err); }
});

const dealSchema = z.object({
  name: z.string().min(1),
  pipeline_id: z.number().int(),
  stage_id:    z.number().int(),
  organization_id:    z.number().int().nullable().optional(),
  primary_contact_id: z.number().int().nullable().optional(),
  owner_id:     z.number().int().nullable().optional(),
  amount:       z.number().optional(),
  currency:     z.string().length(3).optional(),
  expected_close_date: z.string().optional().nullable(),
  probability:  z.number().optional().nullable(),
  status:       z.enum(['open','won','lost']).optional(),
  lost_reason:  z.string().optional().nullable(),
  description:  z.string().optional().nullable(),
});

router.post('/', requirePermission('deals.write'), async (req, res, next) => {
  try {
    const d = dealSchema.parse(req.body);

    const cfg = await moduleSettings.get('deals');
    const errors = validateDealPayload(d, cfg, { isCreate: true });
    if (errors.length) return res.status(422).json({ error: errors[0], errors });

    const [ins] = await db.query(
      `INSERT INTO deals (name, pipeline_id, stage_id, organization_id, primary_contact_id, owner_id,
                          amount, currency, expected_close_date, probability, status, description)
       VALUES (:name, :pipeline_id, :stage_id, :organization_id, :primary_contact_id, :owner_id,
               :amount, :currency, :expected_close_date, :probability, :status, :description)`,
      {
        name: d.name,
        pipeline_id: d.pipeline_id,
        stage_id: d.stage_id,
        organization_id: d.organization_id ?? null,
        primary_contact_id: d.primary_contact_id ?? null,
        owner_id: d.owner_id ?? req.user.id,
        amount: d.amount ?? 0,
        currency: d.currency ?? 'USD',
        expected_close_date: d.expected_close_date ?? null,
        probability: d.probability ?? null,
        status: d.status ?? 'open',
        description: d.description ?? null,
      }
    );
    await db.query(
      `INSERT INTO deal_stage_history (deal_id, from_stage_id, to_stage_id, changed_by)
       VALUES (:id, NULL, :stage, :uid)`,
      { id: ins.insertId, stage: d.stage_id, uid: req.user.id }
    );
    await logActivity({ userId: req.user.id, entityType: 'deal', entityId: ins.insertId,
      action: 'created', description: 'Deal created' });
    const [[newDeal]] = await db.query('SELECT * FROM deals WHERE id = :id', { id: ins.insertId });
    triggerWorkflow('deal.created', 'deal', newDeal).catch(() => {});
    res.status(201).json({ id: ins.insertId });
  } catch (err) { next(err); }
});

router.put('/:id', requirePermission('deals.write'), async (req, res, next) => {
  try {
    const d = dealSchema.partial().parse(req.body);
    const id = Number(req.params.id);

    const [currentRows] = await db.query(
      'SELECT stage_id, status, owner_id FROM deals WHERE id = :id', { id });
    const current = currentRows[0];
    if (!current) return res.status(404).json({ error: 'Not found' });

    const scopeIds = await resolveOwnerScope(req.user);
    if (scopeIds !== null && !scopeIds.includes(current.owner_id)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    // Determine if this update is transitioning to lost (for lost_reason check)
    let goingLost = false;
    if (d.stage_id && d.stage_id !== current.stage_id) {
      const [[stg]] = await db.query('SELECT stage_type FROM stages WHERE id = :id', { id: d.stage_id });
      goingLost = stg?.stage_type === 'lost' && current.status !== 'lost';
    }
    if (d.status === 'lost' && current.status !== 'lost') goingLost = true;

    const cfg = await moduleSettings.get('deals');
    const errors = validateDealPayload(d, cfg, { goingLost });
    if (errors.length) return res.status(422).json({ error: errors[0], errors });

    const cols = Object.keys(d);
    if (cols.length) {
      const set = cols.map((k) => `${k} = :${k}`).join(', ');
      await db.query(`UPDATE deals SET ${set} WHERE id = :id`, { ...d, id });
    }

    // Stage move log
    if (d.stage_id && d.stage_id !== current.stage_id) {
      await db.query(
        `INSERT INTO deal_stage_history (deal_id, from_stage_id, to_stage_id, changed_by)
         VALUES (:id, :from, :to, :uid)`,
        { id, from: current.stage_id, to: d.stage_id, uid: req.user.id }
      );
      await logActivity({ userId: req.user.id, entityType: 'deal', entityId: id,
        action: 'stage_changed', description: `Stage moved`, meta: { from: current.stage_id, to: d.stage_id } });
      const [[movedDeal]] = await db.query('SELECT * FROM deals WHERE id = :id', { id });
      triggerWorkflow('deal.stage_changed', 'deal', movedDeal, { from_stage_id: current.stage_id, to_stage_id: d.stage_id }).catch(() => {});
    }

    // If stage type is 'won' -> mark won + push to CW
    const [stageRows] = await db.query(
      `SELECT s.stage_type FROM deals d JOIN stages s ON s.id = d.stage_id WHERE d.id = :id`,
      { id }
    );
    const stageType = stageRows[0]?.stage_type;
    let cwResult = null;
    if (stageType === 'won' && current.status !== 'won') {
      await db.query('UPDATE deals SET status = "won", won_at = NOW() WHERE id = :id', { id });
      await logActivity({ userId: req.user.id, entityType: 'deal', entityId: id,
        action: 'won', description: 'Deal marked Won' });
      const [[wonDeal]] = await db.query('SELECT * FROM deals WHERE id = :id', { id });
      triggerWorkflow('deal.won', 'deal', wonDeal).catch(() => {});

      if (cfg.auto_close_won_tasks) await closeTasksForDeal(id);

      const cwCfg = await getCwSettings();
      if (cwCfg && cwCfg.push_on_won) {
        try {
          cwResult = await pushDealToManage(id);
        } catch (e) {
          cwResult = { error: e.message };
        }
      }
    } else if (stageType === 'lost' && current.status !== 'lost') {
      await db.query('UPDATE deals SET status = "lost" WHERE id = :id', { id });
      await logActivity({ userId: req.user.id, entityType: 'deal', entityId: id,
        action: 'lost', description: 'Deal marked Lost' });
      const [[lostDeal]] = await db.query('SELECT * FROM deals WHERE id = :id', { id });
      triggerWorkflow('deal.lost', 'deal', lostDeal).catch(() => {});

      if (cfg.auto_close_lost_tasks) await closeTasksForDeal(id);
    }

    res.json({ ok: true, cw: cwResult });
  } catch (err) { next(err); }
});

// Dedicated endpoint for Kanban drag/drop stage moves
router.put('/:id/stage', requirePermission('deals.write'), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const stage_id = Number(req.body.stage_id);
    if (!stage_id) return res.status(400).json({ error: 'stage_id required' });

    const [[current]] = await db.query('SELECT stage_id, status, owner_id FROM deals WHERE id = :id', { id });
    if (!current) return res.status(404).json({ error: 'Not found' });

    const scopeIds = await resolveOwnerScope(req.user);
    if (scopeIds !== null && !scopeIds.includes(current.owner_id)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    await db.query('UPDATE deals SET stage_id = :stage_id WHERE id = :id', { stage_id, id });

    if (stage_id !== current.stage_id) {
      await db.query(
        `INSERT INTO deal_stage_history (deal_id, from_stage_id, to_stage_id, changed_by)
         VALUES (:id, :from, :to, :uid)`,
        { id, from: current.stage_id, to: stage_id, uid: req.user.id }
      );
      await logActivity({ userId: req.user.id, entityType: 'deal', entityId: id,
        action: 'stage_changed', description: 'Stage moved', meta: { from: current.stage_id, to: stage_id } });
      const [[movedDeal]] = await db.query('SELECT * FROM deals WHERE id = :id', { id });
      triggerWorkflow('deal.stage_changed', 'deal', movedDeal, { from_stage_id: current.stage_id, to_stage_id: stage_id }).catch(() => {});
    }

    const [[stg]] = await db.query('SELECT stage_type FROM stages WHERE id = :id', { id: stage_id });
    let cwResult = null;
    if (stg?.stage_type === 'won' && current.status !== 'won') {
      await db.query('UPDATE deals SET status = "won", won_at = NOW() WHERE id = :id', { id });
      await logActivity({ userId: req.user.id, entityType: 'deal', entityId: id, action: 'won', description: 'Deal marked Won' });
      const [[wonDeal]] = await db.query('SELECT * FROM deals WHERE id = :id', { id });
      triggerWorkflow('deal.won', 'deal', wonDeal).catch(() => {});
      const cfg = await moduleSettings.get('deals');
      if (cfg.auto_close_won_tasks) await closeTasksForDeal(id);
      const cwCfg = await getCwSettings();
      if (cwCfg?.push_on_won) {
        try { cwResult = await pushDealToManage(id); } catch (e) { cwResult = { error: e.message }; }
      }
    } else if (stg?.stage_type === 'lost' && current.status !== 'lost') {
      await db.query('UPDATE deals SET status = "lost" WHERE id = :id', { id });
      await logActivity({ userId: req.user.id, entityType: 'deal', entityId: id, action: 'lost', description: 'Deal marked Lost' });
      const [[lostDeal]] = await db.query('SELECT * FROM deals WHERE id = :id', { id });
      triggerWorkflow('deal.lost', 'deal', lostDeal).catch(() => {});
      const cfg = await moduleSettings.get('deals');
      if (cfg.auto_close_lost_tasks) await closeTasksForDeal(id);
    }

    res.json({ ok: true, cw: cwResult });
  } catch (err) { next(err); }
});

router.delete('/:id', requirePermission('deals.delete'), async (req, res, next) => {
  try {
    await db.query('DELETE FROM deals WHERE id = :id', { id: req.params.id });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// Manual re-push to ConnectWise
router.post('/:id/push-to-cw', requirePermission('cw.push'), async (req, res, next) => {
  try {
    const result = await pushDealToManage(Number(req.params.id));
    res.json({ ok: true, ...result });
  } catch (err) { next(err); }
});

module.exports = router;
