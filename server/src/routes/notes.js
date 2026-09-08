// =============================================================================
// /api/notes
// =============================================================================
const router = require('express').Router();
const { z } = require('zod');
const { db } = require('../db');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { logActivity } = require('../services/activity');
const { assertOwnerEntityInScope } = require('../services/scope');

router.use(requireAuth);

const ENTITY_TYPES = ['contact', 'organization', 'deal'];
// All three tables use the same owner_id column.
const ENTITY_TABLE = { contact: 'contacts', organization: 'organizations', deal: 'deals' };

router.get('/', requirePermission('notes.read'), async (req, res, next) => {
  try {
    const entity_type = req.query.entity_type;
    const entity_id = Number(req.query.entity_id);
    if (!ENTITY_TYPES.includes(entity_type) || !Number.isInteger(entity_id)) {
      return res.status(400).json({ error: 'Invalid entity_type or entity_id' });
    }
    // Row-level scope check (security remediation H-02) — a note's own row
    // has no owner of its own, so what matters is whether the caller can
    // see the entity the note is attached to.
    await assertOwnerEntityInScope(req.user, ENTITY_TABLE[entity_type], entity_id);
    const [rows] = await db.query(
      `SELECT n.*, CONCAT_WS(' ', u.first_name, u.last_name) AS user_name
         FROM notes n LEFT JOIN users u ON u.id = n.user_id
        WHERE n.entity_type = :et AND n.entity_id = :eid
        ORDER BY n.created_at DESC`,
      { et: entity_type, eid: entity_id });
    res.json(rows);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

const saveSchema = z.object({
  entity_type: z.enum(['contact','organization','deal']),
  entity_id:   z.number().int(),
  body:        z.string().min(1),
});

router.post('/', requirePermission('notes.write'), async (req, res, next) => {
  try {
    const d = saveSchema.parse(req.body);
    const [ins] = await db.query(
      `INSERT INTO notes (user_id, entity_type, entity_id, body)
       VALUES (:uid, :et, :eid, :body)`,
      { uid: req.user.id, et: d.entity_type, eid: d.entity_id, body: d.body });
    await logActivity({ userId: req.user.id, entityType: d.entity_type, entityId: d.entity_id,
      action: 'note_added', description: 'Note added' });
    res.status(201).json({ id: ins.insertId });
  } catch (err) { next(err); }
});

router.delete('/:id', requirePermission('notes.write'), async (req, res, next) => {
  try {
    await db.query('DELETE FROM notes WHERE id = :id', { id: req.params.id });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;
