// =============================================================================
// /api/custom-fields
// =============================================================================
const router = require('express').Router();
const { z } = require('zod');
const { db } = require('../db');
const { requireAuth, requirePermission } = require('../middleware/auth');

router.use(requireAuth);

router.get('/', async (req, res, next) => {
  try {
    const { entity_type } = req.query;
    const where = []; const params = {};
    if (entity_type) { where.push('entity_type = :entity_type'); params.entity_type = entity_type; }
    const [rows] = await db.query(
      `SELECT * FROM custom_fields ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
       ORDER BY entity_type, display_order, id`, params);
    res.json(rows);
  } catch (err) { next(err); }
});

const saveSchema = z.object({
  entity_type: z.enum(['contact','organization','deal']),
  field_key: z.string().min(1),
  label: z.string().min(1),
  field_type: z.enum(['text','number','date','boolean','select','multi_select','url','email','phone']),
  options_json: z.any().optional().nullable(),
  is_required: z.boolean().optional(),
  display_order: z.number().int().optional(),
});

router.post('/', requirePermission('settings.manage'), async (req, res, next) => {
  try {
    const d = saveSchema.parse(req.body);
    const [ins] = await db.query(
      `INSERT INTO custom_fields (entity_type, field_key, label, field_type, options_json, is_required, display_order)
       VALUES (:entity_type, :field_key, :label, :field_type, CAST(:options_json AS JSON), :is_required, :display_order)`,
      {
        entity_type: d.entity_type,
        field_key: d.field_key,
        label: d.label,
        field_type: d.field_type,
        options_json: d.options_json ? JSON.stringify(d.options_json) : null,
        is_required: d.is_required ? 1 : 0,
        display_order: d.display_order || 0,
      }
    );
    res.status(201).json({ id: ins.insertId });
  } catch (err) { next(err); }
});

router.put('/:id', requirePermission('settings.manage'), async (req, res, next) => {
  try {
    const d = saveSchema.partial().parse(req.body);
    const id = Number(req.params.id);
    const sets = []; const params = { id };
    for (const k of ['entity_type','field_key','label','field_type','is_required','display_order']) {
      if (d[k] !== undefined) {
        sets.push(`${k} = :${k}`);
        params[k] = typeof d[k] === 'boolean' ? (d[k] ? 1 : 0) : d[k];
      }
    }
    if (d.options_json !== undefined) {
      sets.push('options_json = CAST(:options_json AS JSON)');
      params.options_json = d.options_json ? JSON.stringify(d.options_json) : null;
    }
    if (sets.length) await db.query(`UPDATE custom_fields SET ${sets.join(', ')} WHERE id = :id`, params);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.delete('/:id', requirePermission('settings.manage'), async (req, res, next) => {
  try {
    await db.query('DELETE FROM custom_fields WHERE id = :id', { id: req.params.id });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;
