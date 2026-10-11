// =============================================================================
// /api/commerce-settings — processing fee configuration (single active row)
// =============================================================================
const router = require('express').Router();
const { z } = require('zod');
const { db } = require('../db');
const { requireAuth, requirePermission } = require('../middleware/auth');

router.use(requireAuth, requirePermission('commerce.settings'));

router.get('/processing-fee', async (_req, res, next) => {
  try {
    const [[row]] = await db.query('SELECT * FROM processing_fee_settings ORDER BY id LIMIT 1');
    res.json(row || null);
  } catch (err) { next(err); }
});

const schema = z.object({
  gateway: z.string().optional(),
  fee_type: z.enum(['percent', 'flat', 'percent_plus_flat']).optional(),
  fee_percent: z.union([z.number(), z.null()]).optional(),
  fee_flat: z.union([z.number(), z.null()]).optional(),
  apply_to_tax: z.boolean().optional(),
  apply_to_ship: z.boolean().optional(),
  // Off by default — card-network surcharge rules exist because of
  // interchange cost on cards, not bank transfers; see the matching gate
  // in gateways.js's computeProcessingFee (the separate B2B/donation/invoice
  // fee config) for the full reasoning.
  apply_to_ach: z.boolean().optional(),
  label: z.string().optional(),
  is_active: z.boolean().optional(),
});

router.put('/processing-fee', async (req, res, next) => {
  try {
    const d = schema.parse(req.body);
    const [[existing]] = await db.query('SELECT id FROM processing_fee_settings ORDER BY id LIMIT 1');
    const params = {
      gateway: d.gateway || 'valor', fee_type: d.fee_type || 'percent',
      fee_percent: d.fee_percent ?? null, fee_flat: d.fee_flat ?? null,
      apply_to_tax: d.apply_to_tax ? 1 : 0, apply_to_ship: d.apply_to_ship ? 1 : 0,
      apply_to_ach: d.apply_to_ach ? 1 : 0,
      label: d.label || 'Processing Fee', is_active: d.is_active === false ? 0 : 1,
    };
    if (existing) {
      await db.query(
        `UPDATE processing_fee_settings SET gateway=:gateway, fee_type=:fee_type, fee_percent=:fee_percent,
          fee_flat=:fee_flat, apply_to_tax=:apply_to_tax, apply_to_ship=:apply_to_ship, apply_to_ach=:apply_to_ach,
          label=:label, is_active=:is_active
         WHERE id=:id`,
        { ...params, id: existing.id }
      );
    } else {
      await db.query(
        `INSERT INTO processing_fee_settings (gateway, fee_type, fee_percent, fee_flat, apply_to_tax, apply_to_ship, apply_to_ach, label, is_active)
         VALUES (:gateway, :fee_type, :fee_percent, :fee_flat, :apply_to_tax, :apply_to_ship, :apply_to_ach, :label, :is_active)`,
        params
      );
    }
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;
