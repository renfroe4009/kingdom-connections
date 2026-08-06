// =============================================================================
// /api/tags
// =============================================================================
const router = require('express').Router();
const { z } = require('zod');
const { db } = require('../db');
const { requireAuth, requirePermission } = require('../middleware/auth');

router.use(requireAuth);

router.get('/', async (_req, res, next) => {
  try {
    const [rows] = await db.query(
      `SELECT t.*,
              (SELECT COUNT(*) FROM contact_tags ct WHERE ct.tag_id = t.id) AS contact_usage_count,
              (SELECT COUNT(*) FROM organization_tags ot WHERE ot.tag_id = t.id) AS organization_usage_count,
              (SELECT COUNT(*) FROM contact_tags ct WHERE ct.tag_id = t.id)
                + (SELECT COUNT(*) FROM organization_tags ot WHERE ot.tag_id = t.id) AS usage_count
         FROM tags t ORDER BY t.name`
    );
    res.json(rows);
  } catch (err) { next(err); }
});

const saveSchema = z.object({
  name: z.string().min(1),
  color: z.string().optional(),
  description: z.string().max(255).optional().nullable(),
});

router.post('/', requirePermission('contacts.write'), async (req, res, next) => {
  try {
    const d = saveSchema.parse(req.body);
    const [ins] = await db.query(
      'INSERT INTO tags (name, color, description) VALUES (:name, :color, :description)',
      { name: d.name, color: d.color || '#F05523', description: d.description || null }
    );
    res.status(201).json({ id: ins.insertId });
  } catch (err) { next(err); }
});

router.put('/:id', requirePermission('contacts.write'), async (req, res, next) => {
  try {
    const d = saveSchema.parse(req.body);
    await db.query('UPDATE tags SET name = :name, color = :color, description = :description WHERE id = :id',
      { id: req.params.id, name: d.name, color: d.color || '#F05523', description: d.description || null });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.delete('/:id', requirePermission('contacts.write'), async (req, res, next) => {
  try {
    await db.query('DELETE FROM tags WHERE id = :id', { id: req.params.id });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;
