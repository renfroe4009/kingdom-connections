// =============================================================================
// /api/automations
// =============================================================================
const router = require('express').Router();
const { z }  = require('zod');
const { db } = require('../db');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { logActivity }  = require('../services/activity');
const { resolveOwnerScope, ownerClause } = require('../services/scope');
const { triggerWorkflow } = require('../services/automations');

router.use(requireAuth);

// Fetch an automation and enforce row-level scope (created_by).
// Returns the row or sends 403/404 and returns null.
async function requireAutomationAccess(req, res, id) {
  const [[row]] = await db.query(
    'SELECT id, name, status, flow_definition, created_by FROM automation_workflows WHERE id = :id', { id }
  );
  if (!row) { res.status(404).json({ error: 'Not found' }); return null; }
  const scopeIds = await resolveOwnerScope(req.user);
  if (scopeIds !== null && (row.created_by == null || !scopeIds.includes(row.created_by))) {
    res.status(403).json({ error: 'Forbidden' }); return null;
  }
  return row;
}

// ---------------------------------------------------------------------------
// GET / — list all workflows (scoped by creator)
// ---------------------------------------------------------------------------
router.get('/', requirePermission('automations.read'), async (req, res, next) => {
  try {
    const { q, status } = req.query;
    const where = ['1=1']; const params = {};

    const scopeIds = await resolveOwnerScope(req.user);
    const clause   = ownerClause(scopeIds, 'aw.created_by');
    if (clause) where.push(clause);

    if (q)      { where.push('aw.name LIKE :q'); params.q = `%${q}%`; }
    if (status) { where.push('aw.status = :status'); params.status = status; }

    const [rows] = await db.query(
      `SELECT aw.id, aw.name, aw.description, aw.status, aw.trigger_type,
              aw.run_count, aw.last_triggered_at, aw.created_at, aw.updated_at,
              CONCAT_WS(' ', u.first_name, u.last_name) AS created_by_name,
              (SELECT COUNT(*) FROM automation_enrollments ae
                WHERE ae.workflow_id = aw.id AND ae.status = 'active') AS active_enrollments
         FROM automation_workflows aw
         LEFT JOIN users u ON u.id = aw.created_by
        WHERE ${where.join(' AND ')}
          AND aw.status != 'archived'
        ORDER BY aw.updated_at DESC`,
      params
    );
    res.json(rows);
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// GET /:id — single workflow with flow_definition
// ---------------------------------------------------------------------------
router.get('/:id', requirePermission('automations.read'), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!await requireAutomationAccess(req, res, id)) return;
    const [[row]] = await db.query(
      `SELECT aw.*, CONCAT_WS(' ', u.first_name, u.last_name) AS created_by_name
         FROM automation_workflows aw
         LEFT JOIN users u ON u.id = aw.created_by
        WHERE aw.id = :id`,
      { id }
    );
    res.json(row);
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// GET /:id/history — execution log for a workflow
// ---------------------------------------------------------------------------
router.get('/:id/history', requirePermission('automations.read'), async (req, res, next) => {
  try {
    const wfId = Number(req.params.id);
    const [enrollments] = await db.query(
      `SELECT ae.id, ae.entity_type, ae.entity_id, ae.status, ae.enrolled_at, ae.completed_at,
              -- best-effort display name
              CASE ae.entity_type
                WHEN 'contact' THEN CONCAT_WS(' ', c.first_name, c.last_name)
                WHEN 'deal'    THEN d.name
                WHEN 'invoice' THEN i.invoice_number
                ELSE CONCAT(ae.entity_type, '#', ae.entity_id)
              END AS entity_label
         FROM automation_enrollments ae
         LEFT JOIN contacts c  ON ae.entity_type = 'contact' AND c.id  = ae.entity_id
         LEFT JOIN deals d     ON ae.entity_type = 'deal'    AND d.id  = ae.entity_id
         LEFT JOIN invoices i  ON ae.entity_type = 'invoice' AND i.id  = ae.entity_id
        WHERE ae.workflow_id = :id
        ORDER BY ae.enrolled_at DESC
        LIMIT 100`,
      { id: wfId }
    );
    res.json(enrollments);
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// GET /:id/history/:enrollmentId — step log for one enrollment
// ---------------------------------------------------------------------------
router.get('/:id/history/:eid', requirePermission('automations.read'), async (req, res, next) => {
  try {
    const [logs] = await db.query(
      `SELECT * FROM automation_execution_log
        WHERE enrollment_id = :eid
        ORDER BY executed_at ASC`,
      { eid: Number(req.params.eid) }
    );
    res.json(logs);
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// POST / — create workflow
// ---------------------------------------------------------------------------
const wfSchema = z.object({
  name:           z.string().min(1).max(255),
  description:    z.string().optional().nullable(),
  trigger_type:   z.string().min(1),
  trigger_config: z.record(z.unknown()).optional().nullable(),
  flow_definition: z.object({
    nodes: z.array(z.unknown()),
    edges: z.array(z.unknown()),
  }).optional(),
});

router.post('/', requirePermission('automations.write'), async (req, res, next) => {
  try {
    const data = wfSchema.parse(req.body);
    const [ins] = await db.query(
      `INSERT INTO automation_workflows
         (name, description, status, trigger_type, trigger_config, flow_definition, created_by)
       VALUES (:name, :desc, 'draft', :tt, CAST(:tc AS JSON), CAST(:fd AS JSON), :uid)`,
      {
        name: data.name,
        desc: data.description ?? null,
        tt:   data.trigger_type,
        tc:   JSON.stringify(data.trigger_config ?? {}),
        fd:   JSON.stringify(data.flow_definition ?? { nodes: [], edges: [] }),
        uid:  req.user.id,
      }
    );
    await logActivity({ userId: req.user.id, entityType: 'automation', entityId: ins.insertId,
      action: 'created', description: `Automation "${data.name}" created` });
    res.status(201).json({ id: ins.insertId });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// PUT /:id — save workflow (name, description, trigger, canvas)
// ---------------------------------------------------------------------------
router.put('/:id', requirePermission('automations.write'), async (req, res, next) => {
  try {
    const id   = Number(req.params.id);
    if (!await requireAutomationAccess(req, res, id)) return;
    const data = wfSchema.partial().parse(req.body);
    const fields = []; const params = { id };

    if (data.name           !== undefined) { fields.push('name = :name');                     params.name = data.name; }
    if (data.description    !== undefined) { fields.push('description = :desc');               params.desc = data.description; }
    if (data.trigger_type   !== undefined) { fields.push('trigger_type = :tt');                params.tt = data.trigger_type; }
    if (data.trigger_config !== undefined) { fields.push('trigger_config = CAST(:tc AS JSON)'); params.tc = JSON.stringify(data.trigger_config ?? {}); }
    if (data.flow_definition !== undefined) { fields.push('flow_definition = CAST(:fd AS JSON)'); params.fd = JSON.stringify(data.flow_definition); }

    if (!fields.length) return res.json({ ok: true });
    await db.query(`UPDATE automation_workflows SET ${fields.join(', ')} WHERE id = :id`, params);
    await logActivity({ userId: req.user.id, entityType: 'automation', entityId: id,
      action: 'updated', description: `Automation updated` });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// POST /:id/activate — go live
// ---------------------------------------------------------------------------
router.post('/:id/activate', requirePermission('automations.write'), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const wf = await requireAutomationAccess(req, res, id);
    if (!wf) return;

    // Validate: must have at least a trigger node + one action node
    const fd = typeof wf.flow_definition === 'string' ? JSON.parse(wf.flow_definition) : wf.flow_definition;
    const hasTrigger = fd.nodes?.some((n) => n.type === 'triggerNode');
    const hasAction  = fd.nodes?.some((n) => n.type === 'actionNode');
    if (!hasTrigger || !hasAction) {
      return res.status(422).json({ error: 'Workflow must have at least one trigger and one action node.' });
    }

    await db.query(`UPDATE automation_workflows SET status = 'active' WHERE id = :id`, { id });
    await logActivity({ userId: req.user.id, entityType: 'automation', entityId: id,
      action: 'activated', description: `Automation "${wf.name}" activated` });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// POST /:id/pause
// ---------------------------------------------------------------------------
router.post('/:id/pause', requirePermission('automations.write'), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!await requireAutomationAccess(req, res, id)) return;
    await db.query(`UPDATE automation_workflows SET status = 'paused' WHERE id = :id`, { id });
    await logActivity({ userId: req.user.id, entityType: 'automation', entityId: id,
      action: 'paused', description: 'Automation paused' });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// POST /:id/test — manually fire the trigger for a test entity
// ---------------------------------------------------------------------------
router.post('/:id/test', requirePermission('automations.write'), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const wfBase = await requireAutomationAccess(req, res, id);
    if (!wfBase) return;
    const [[wf]] = await db.query(`SELECT * FROM automation_workflows WHERE id = :id`, { id });

    const { entity_type, entity_id } = req.body;
    if (!entity_type || !entity_id) {
      return res.status(400).json({ error: 'entity_type and entity_id required' });
    }

    const tableMap = { contact: 'contacts', deal: 'deals', invoice: 'invoices', organization: 'organizations' };
    const table = tableMap[entity_type];
    if (!table) return res.status(400).json({ error: 'Invalid entity_type' });

    const [[entity]] = await db.query(`SELECT * FROM ${table} WHERE id = :id`, { id: entity_id });
    if (!entity) return res.status(404).json({ error: `${entity_type} not found` });

    // Force a paused/draft workflow to run once for the test entity
    const { triggerWorkflow: fire } = require('../services/automations');
    const origStatus = wf.status;

    // Temporarily activate to bypass the status check
    await db.query(`UPDATE automation_workflows SET status = 'active' WHERE id = :id`, { id });
    try {
      await fire(wf.trigger_type, entity_type, entity, { _test: true });
    } finally {
      if (origStatus !== 'active') {
        await db.query(`UPDATE automation_workflows SET status = :s WHERE id = :id`, { s: origStatus, id });
      }
    }
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// DELETE /:id — archive (soft delete)
// ---------------------------------------------------------------------------
router.delete('/:id', requirePermission('automations.write'), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!await requireAutomationAccess(req, res, id)) return;
    await db.query(`UPDATE automation_workflows SET status = 'archived' WHERE id = :id`, { id });
    await logActivity({ userId: req.user.id, entityType: 'automation', entityId: id,
      action: 'deleted', description: 'Automation archived' });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;
