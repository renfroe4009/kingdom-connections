// =============================================================================
// /api/orders — admin order management (list, view, update status/tracking).
// Each paid order links to a synthetic invoice (orders.invoice_id) created by
// /api/checkout — GET /:id surfaces that invoice's payments so the admin UI
// can show real transaction history; refunds go through the existing
// /api/payments/:id/refund endpoint against that same payments row.
// =============================================================================
const router = require('express').Router();
const { z } = require('zod');
const { db } = require('../db');
const { requireAuth, requirePermission } = require('../middleware/auth');

router.use(requireAuth);

router.get('/', requirePermission('orders.read'), async (req, res, next) => {
  try {
    const { status = '', search = '' } = req.query;
    let sql = `SELECT o.*, c.first_name, c.last_name, c.email AS contact_email
               FROM orders o
               LEFT JOIN contacts c ON c.id = o.contact_id
               WHERE 1=1`;
    const params = {};
    if (status) { sql += ' AND o.status = :status'; params.status = status; }
    if (search) {
      sql += ' AND (o.order_number LIKE :search OR c.first_name LIKE :search OR c.last_name LIKE :search OR c.email LIKE :search)';
      params.search = `%${search}%`;
    }
    sql += ' ORDER BY o.created_at DESC';
    const [rows] = await db.query(sql, params);
    res.json(rows);
  } catch (err) { next(err); }
});

router.get('/:id', requirePermission('orders.read'), async (req, res, next) => {
  try {
    const [[order]] = await db.query(
      `SELECT o.*, c.first_name, c.last_name, c.email AS contact_email, c.phone AS contact_phone
       FROM orders o LEFT JOIN contacts c ON c.id = o.contact_id WHERE o.id = :id`,
      { id: req.params.id }
    );
    if (!order) return res.status(404).json({ error: 'Not found' });
    const [items] = await db.query('SELECT * FROM order_items WHERE order_id = :id', { id: req.params.id });
    const payments = order.invoice_id
      ? (await db.query('SELECT * FROM payments WHERE invoice_id = :invoice_id ORDER BY created_at DESC', { invoice_id: order.invoice_id }))[0]
      : [];
    res.json({ ...order, items, payments });
  } catch (err) { next(err); }
});

const statusSchema = z.object({
  status: z.enum(['pending', 'processing', 'shipped', 'delivered', 'cancelled', 'refunded']).optional(),
  tracking_number: z.string().optional().nullable(),
  shipping_method: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

router.put('/:id/status', requirePermission('orders.write'), async (req, res, next) => {
  try {
    const d = statusSchema.parse(req.body);
    const sets = []; const params = { id: req.params.id };
    if (d.status !== undefined) {
      sets.push('status = :status'); params.status = d.status;
      if (d.status === 'shipped') sets.push('shipped_at = NOW()');
    }
    if (d.tracking_number !== undefined) { sets.push('tracking_number = :tracking_number'); params.tracking_number = d.tracking_number; }
    if (d.shipping_method !== undefined) { sets.push('shipping_method = :shipping_method'); params.shipping_method = d.shipping_method; }
    if (d.notes !== undefined) { sets.push('notes = :notes'); params.notes = d.notes; }
    if (!sets.length) return res.status(400).json({ error: 'No fields to update' });
    await db.query(`UPDATE orders SET ${sets.join(', ')} WHERE id = :id`, params);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;
