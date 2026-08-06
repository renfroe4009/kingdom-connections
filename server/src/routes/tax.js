// =============================================================================
// /api/tax — tax rates (admin) + calculate (public checkout)
// =============================================================================
const router = require('express').Router();
const { z } = require('zod');
const { db } = require('../db');
const { requireAuth, requirePermission } = require('../middleware/auth');

router.get('/rates', requireAuth, requirePermission('tax.manage'), async (_req, res, next) => {
  try {
    const [rows] = await db.query('SELECT * FROM tax_rates ORDER BY country, state, name');
    res.json(rows);
  } catch (err) { next(err); }
});

const rateSchema = z.object({
  name: z.string().min(1),
  country: z.string().length(2).optional(),
  state: z.string().max(2).optional().nullable(),
  rate_pct: z.number().min(0),
  is_active: z.boolean().optional(),
});

router.post('/rates', requireAuth, requirePermission('tax.manage'), async (req, res, next) => {
  try {
    const d = rateSchema.parse(req.body);
    const [ins] = await db.query(
      'INSERT INTO tax_rates (name, country, state, rate_pct, is_active) VALUES (:name, :country, :state, :rate_pct, :is_active)',
      { name: d.name, country: d.country || 'US', state: d.state || null, rate_pct: d.rate_pct, is_active: d.is_active === false ? 0 : 1 }
    );
    res.status(201).json({ id: ins.insertId });
  } catch (err) { next(err); }
});

router.put('/rates/:id', requireAuth, requirePermission('tax.manage'), async (req, res, next) => {
  try {
    const d = rateSchema.parse(req.body);
    await db.query(
      'UPDATE tax_rates SET name=:name, country=:country, state=:state, rate_pct=:rate_pct, is_active=:is_active WHERE id=:id',
      { id: req.params.id, name: d.name, country: d.country || 'US', state: d.state || null,
        rate_pct: d.rate_pct, is_active: d.is_active === false ? 0 : 1 }
    );
    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.delete('/rates/:id', requireAuth, requirePermission('tax.manage'), async (req, res, next) => {
  try {
    await db.query('DELETE FROM tax_rates WHERE id = :id', { id: req.params.id });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ── Public: calculate tax for a given state/subtotal ─────────────────────────
router.post('/calculate', async (req, res, next) => {
  try {
    const { state = '', country = 'US', subtotal = 0, tax_exempt = false } = req.body;
    if (tax_exempt) return res.json({ rate_pct: 0, tax_amount: 0 });
    const [[rate]] = await db.query(
      `SELECT rate_pct FROM tax_rates WHERE is_active = 1 AND country = :country
         AND (state = :state OR state IS NULL) ORDER BY (state IS NOT NULL) DESC LIMIT 1`,
      { country, state }
    );
    const rate_pct = rate ? Number(rate.rate_pct) : 0;
    res.json({ rate_pct, tax_amount: Math.round(subtotal * rate_pct) / 100 });
  } catch (err) { next(err); }
});

module.exports = router;
