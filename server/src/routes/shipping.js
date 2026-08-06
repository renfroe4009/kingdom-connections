// =============================================================================
// /api/shipping — zones, rates (admin) + rate estimate (public checkout)
// =============================================================================
const router = require('express').Router();
const { z } = require('zod');
const { db } = require('../db');
const { requireAuth, requirePermission } = require('../middleware/auth');

router.get('/zones', requireAuth, requirePermission('shipping.manage'), async (_req, res, next) => {
  try {
    const [zones] = await db.query('SELECT * FROM shipping_zones ORDER BY name');
    const [rates] = await db.query('SELECT * FROM shipping_rates ORDER BY zone_id, rate');
    const byZone = {};
    for (const r of rates) (byZone[r.zone_id] ||= []).push(r);
    res.json(zones.map(z => ({ ...z, rates: byZone[z.id] || [] })));
  } catch (err) { next(err); }
});

const zoneSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional().nullable(),
  is_active: z.boolean().optional(),
});

router.post('/zones', requireAuth, requirePermission('shipping.manage'), async (req, res, next) => {
  try {
    const d = zoneSchema.parse(req.body);
    const [ins] = await db.query(
      'INSERT INTO shipping_zones (name, description, is_active) VALUES (:name, :description, :is_active)',
      { name: d.name, description: d.description || null, is_active: d.is_active === false ? 0 : 1 }
    );
    res.status(201).json({ id: ins.insertId });
  } catch (err) { next(err); }
});

router.put('/zones/:id', requireAuth, requirePermission('shipping.manage'), async (req, res, next) => {
  try {
    const d = zoneSchema.parse(req.body);
    await db.query(
      'UPDATE shipping_zones SET name=:name, description=:description, is_active=:is_active WHERE id=:id',
      { id: req.params.id, name: d.name, description: d.description || null, is_active: d.is_active === false ? 0 : 1 }
    );
    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.delete('/zones/:id', requireAuth, requirePermission('shipping.manage'), async (req, res, next) => {
  try {
    await db.query('DELETE FROM shipping_zones WHERE id = :id', { id: req.params.id });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

const rateSchema = z.object({
  zone_id: z.number(),
  name: z.string().min(1),
  method: z.enum(['flat', 'free', 'weight', 'order_total']).optional(),
  rate: z.number().optional(),
  min_order_total: z.union([z.number(), z.null()]).optional(),
  max_order_total: z.union([z.number(), z.null()]).optional(),
  min_weight_oz: z.union([z.number(), z.null()]).optional(),
  max_weight_oz: z.union([z.number(), z.null()]).optional(),
  is_active: z.boolean().optional(),
});

router.post('/rates', requireAuth, requirePermission('shipping.manage'), async (req, res, next) => {
  try {
    const d = rateSchema.parse(req.body);
    const [ins] = await db.query(
      `INSERT INTO shipping_rates (zone_id, name, method, rate, min_order_total, max_order_total, min_weight_oz, max_weight_oz, is_active)
       VALUES (:zone_id, :name, :method, :rate, :min_order_total, :max_order_total, :min_weight_oz, :max_weight_oz, :is_active)`,
      { zone_id: d.zone_id, name: d.name, method: d.method || 'flat', rate: d.rate || 0,
        min_order_total: d.min_order_total ?? null, max_order_total: d.max_order_total ?? null,
        min_weight_oz: d.min_weight_oz ?? null, max_weight_oz: d.max_weight_oz ?? null,
        is_active: d.is_active === false ? 0 : 1 }
    );
    res.status(201).json({ id: ins.insertId });
  } catch (err) { next(err); }
});

router.put('/rates/:id', requireAuth, requirePermission('shipping.manage'), async (req, res, next) => {
  try {
    const d = rateSchema.parse(req.body);
    await db.query(
      `UPDATE shipping_rates SET zone_id=:zone_id, name=:name, method=:method, rate=:rate,
        min_order_total=:min_order_total, max_order_total=:max_order_total,
        min_weight_oz=:min_weight_oz, max_weight_oz=:max_weight_oz, is_active=:is_active WHERE id=:id`,
      { id: req.params.id, zone_id: d.zone_id, name: d.name, method: d.method || 'flat', rate: d.rate || 0,
        min_order_total: d.min_order_total ?? null, max_order_total: d.max_order_total ?? null,
        min_weight_oz: d.min_weight_oz ?? null, max_weight_oz: d.max_weight_oz ?? null,
        is_active: d.is_active === false ? 0 : 1 }
    );
    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.delete('/rates/:id', requireAuth, requirePermission('shipping.manage'), async (req, res, next) => {
  try {
    await db.query('DELETE FROM shipping_rates WHERE id = :id', { id: req.params.id });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ── Public: estimate available rates for a cart total/weight ────────────────
router.post('/estimate', async (req, res, next) => {
  try {
    const { order_total = 0, weight_oz = 0 } = req.body;
    const [rates] = await db.query(
      `SELECT sr.*, sz.name AS zone_name FROM shipping_rates sr
       JOIN shipping_zones sz ON sz.id = sr.zone_id
       WHERE sr.is_active = 1 AND sz.is_active = 1
         AND (sr.min_order_total IS NULL OR :order_total >= sr.min_order_total)
         AND (sr.max_order_total IS NULL OR :order_total <= sr.max_order_total)
         AND (sr.min_weight_oz IS NULL OR :weight_oz >= sr.min_weight_oz)
         AND (sr.max_weight_oz IS NULL OR :weight_oz <= sr.max_weight_oz)
       ORDER BY sr.rate`,
      { order_total, weight_oz }
    );
    const options = rates.map(r => ({
      id: r.id, name: r.name, zone_name: r.zone_name,
      cost: r.method === 'free' ? 0 : Number(r.rate),
    }));
    res.json(options);
  } catch (err) { next(err); }
});

module.exports = router;
