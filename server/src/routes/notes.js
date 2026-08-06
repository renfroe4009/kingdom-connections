// =============================================================================
// /api/notes
// =============================================================================
const router = require('express').Router();
const { z } = require('zod');
const { db } = require('../db');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { logActivity } = require('../services/activity');

router.use(requireAuth);

router.get('/', async (req, res, next) => {
  try {
    const { entity_type, entity_id } = req.query;
    const [rows] = await db.query(
      `SELECT n.*, CONCAT_WS(' ', u.first_name, u.last_name) AS user_name
         FROM notes n LEFT JOIN users u ON u.id = n.user_id
        WHERE n.entity_type = :et AND n.entity_id = :eid
        ORDER BY n.created_at DESC`,
      { et: entity_type, eid: entity_id });
    res.json(rows);
  } catch (err) { next(err); }
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
