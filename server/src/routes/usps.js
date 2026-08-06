// =============================================================================
// /api/usps  —  settings + address verification
// =============================================================================
const router = require('express').Router();
const { z } = require('zod');
const { db } = require('../db');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { verifyAddress, testConnection, cityStateLookup } = require('../services/usps');

router.use(requireAuth);

// -------- Settings --------
router.get('/settings', requirePermission('settings.manage'), async (_req, res, next) => {
  try {
    const [rows] = await db.query('SELECT * FROM usps_settings ORDER BY id DESC LIMIT 1');
    const r = rows[0] ? {
      ...rows[0],
      is_active:       !!rows[0].is_active,            // TINYINT -> bool for form/zod
      consumer_secret: rows[0].consumer_secret ? '********' : '',
    } : null;
    res.json(r);
  } catch (err) { next(err); }
});

const settingsSchema = z.object({
  base_url:        z.string().url().optional(),
  consumer_key:    z.string().min(1),
  consumer_secret: z.string().min(1),
  is_active:       z.boolean().optional(),
});

router.put('/settings', requirePermission('settings.manage'), async (req, res, next) => {
  try {
    const d = settingsSchema.parse(req.body);
    const [rows] = await db.query('SELECT id, consumer_secret FROM usps_settings ORDER BY id DESC LIMIT 1');
    const existing = rows[0];
    const consumer_secret = d.consumer_secret === '********' ? existing?.consumer_secret : d.consumer_secret;

    const payload = {
      base_url:        d.base_url || 'https://apis.usps.com',
      consumer_key:    d.consumer_key,
      consumer_secret,
      is_active:       d.is_active === false ? 0 : 1,
    };

    if (existing) {
      payload.id = existing.id;
      await db.query(
        `UPDATE usps_settings SET
            base_url=:base_url, consumer_key=:consumer_key,
            consumer_secret=:consumer_secret, is_active=:is_active
          WHERE id=:id`, payload);
    } else {
      await db.query(
        `INSERT INTO usps_settings (base_url, consumer_key, consumer_secret, is_active)
         VALUES (:base_url, :consumer_key, :consumer_secret, :is_active)`, payload);
    }
    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.post('/test', requirePermission('settings.manage'), async (_req, res) => {
  try {
    const info = await testConnection();
    res.json({ ok: true, info });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

// -------- Address verification --------
// Any authenticated user can verify — creating contacts/orgs needs this.
const verifySchema = z.object({
  address_line1: z.string().optional(),
  address_line2: z.string().optional(),
  city:          z.string().optional(),
  state:         z.string().optional(),
  postal_code:   z.string().optional(),
}).refine(
  (d) => (d.address_line1 && (d.postal_code || (d.city && d.state))),
  { message: 'Provide street + (ZIP, or city+state)' }
);

router.post('/verify-address', async (req, res) => {
  try {
    const d = verifySchema.parse(req.body);
    const result = await verifyAddress(d);
    res.json(result);
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message, response: err.response });
  }
});

router.get('/city-state/:zip', async (req, res) => {
  try {
    res.json(await cityStateLookup(req.params.zip));
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

module.exports = router;
