// =============================================================================
// /api/subscriptions — recurring billing plans
// =============================================================================
const router = require('express').Router();
const { z } = require('zod');
const { db } = require('../db');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { logActivity } = require('../services/activity');
const { resolveOwnerScope, contactOwnerClause } = require('../services/scope');

router.use(requireAuth);

router.get('/', requirePermission('subscriptions.read'), async (req, res, next) => {
  try {
    const scopeIds = await resolveOwnerScope(req.user);
    const scopeClause = contactOwnerClause(scopeIds, 's.contact_id');

    // Pull subscriptions plus a computed per-run total so the list can render
    // an "Amount" column without firing N queries from the client.
    const [rows] = await db.query(
      `SELECT s.*,
              o.name AS organization_name,
              CONCAT_WS(' ', c.first_name, c.last_name) AS contact_name,
              ROUND(COALESCE(it.subtotal, 0), 2) AS subtotal,
              ROUND(
                COALESCE(it.subtotal, 0)
                * (1 - (COALESCE(s.discount_rate,0)/100))
                * (1 + (COALESCE(s.tax_rate,0)/100))
              , 2) AS per_run_total,
              COALESCE(inv.invoice_count, 0) AS invoice_count,
              COALESCE(pay.payment_count, 0) AS payment_count,
              COALESCE(pay.captured_total, 0) AS captured_total
         FROM subscriptions s
         LEFT JOIN organizations o ON o.id = s.organization_id
         LEFT JOIN contacts c      ON c.id = s.contact_id
         LEFT JOIN (
           SELECT subscription_id, SUM(quantity * unit_price) AS subtotal
             FROM subscription_items
            GROUP BY subscription_id
         ) it ON it.subscription_id = s.id
         LEFT JOIN (
           SELECT subscription_id, COUNT(*) AS invoice_count
             FROM invoices
            WHERE subscription_id IS NOT NULL
            GROUP BY subscription_id
         ) inv ON inv.subscription_id = s.id
         LEFT JOIN (
           SELECT i.subscription_id,
                  COUNT(p.id) AS payment_count,
                  SUM(CASE WHEN p.status = 'captured' THEN p.amount ELSE 0 END) AS captured_total
             FROM payments p
             JOIN invoices i ON i.id = p.invoice_id
            WHERE i.subscription_id IS NOT NULL
            GROUP BY i.subscription_id
         ) pay ON pay.subscription_id = s.id
        ${scopeClause ? `WHERE ${scopeClause}` : ''}
        ORDER BY s.next_run_date ASC, s.id DESC`);
    res.json({ rows });
  } catch (err) { next(err); }
});

router.get('/:id', requirePermission('subscriptions.read'), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const scopeIds = await resolveOwnerScope(req.user);
    const scopeClause = contactOwnerClause(scopeIds, 's.contact_id');
    const [[sub]] = await db.query(
      `SELECT s.* FROM subscriptions s WHERE s.id = :id${scopeClause ? ` AND ${scopeClause}` : ''}`,
      { id }
    );
    if (!sub) return res.status(404).json({ error: 'Not found' });
    const [items] = await db.query(
      'SELECT * FROM subscription_items WHERE subscription_id = :id ORDER BY sort_order, id', { id });
    const [invoices] = await db.query(
      'SELECT id, invoice_number, issue_date, total, balance_due, status FROM invoices WHERE subscription_id = :id ORDER BY issue_date DESC', { id });
    // Transactions that have run against this subscription's invoices.
    // Joining via invoices because payments hang off invoice_id, not the
    // subscription directly.
    const [payments] = await db.query(
      `SELECT p.id, p.invoice_id, p.gateway, p.method, p.amount, p.currency,
              p.status, p.external_txn_id, p.external_auth_code,
              p.card_last4, p.card_brand,
              p.received_at, p.refunded_at, p.refund_amount, p.created_at,
              i.invoice_number, i.issue_date AS invoice_issue_date
         FROM payments p
         JOIN invoices i ON i.id = p.invoice_id
        WHERE i.subscription_id = :id
        ORDER BY p.created_at DESC, p.id DESC`,
      { id });
    res.json({ subscription: sub, items, invoices, payments });
  } catch (err) { next(err); }
});

const itemSchema = z.object({
  description: z.string().min(1),
  quantity:    z.number().nonnegative().default(1),
  unit_price:  z.number().nonnegative().default(0),
  sort_order:  z.number().int().optional(),
});
const subSchema = z.object({
  name:            z.string().min(1),
  contact_id:      z.number().int().nullable().optional(),
  organization_id: z.number().int().nullable().optional(),
  currency:        z.string().length(3).optional(),
  interval_unit:   z.enum(['day','week','month','year']).default('month'),
  interval_count:  z.number().int().positive().default(1),
  start_date:      z.string(),
  next_run_date:   z.string().optional(),
  end_date:        z.string().optional().nullable(),
  auto_charge:     z.boolean().optional(),
  gateway:         z.enum(['valor','authnet','none']).optional(),
  gateway_profile_id: z.string().optional().nullable(),
  tax_rate:        z.number().nonnegative().optional(),
  discount_rate:   z.number().nonnegative().optional(),
  owner_id:        z.number().int().nullable().optional(),
  items:           z.array(itemSchema).min(1),
});

router.post('/', requirePermission('subscriptions.write'), async (req, res, next) => {
  try {
    const d = subSchema.parse(req.body);
    const next_run = d.next_run_date || d.start_date;
    const [ins] = await db.query(
      `INSERT INTO subscriptions
         (name, contact_id, organization_id, currency, interval_unit, interval_count,
          start_date, next_run_date, end_date, auto_charge, gateway, gateway_profile_id,
          tax_rate, discount_rate, owner_id)
       VALUES
         (:name, :contact_id, :organization_id, :currency, :interval_unit, :interval_count,
          :start_date, :next_run_date, :end_date, :auto_charge, :gateway, :gateway_profile_id,
          :tax_rate, :discount_rate, :owner_id)`,
      {
        name: d.name,
        contact_id: d.contact_id ?? null,
        organization_id: d.organization_id ?? null,
        currency: d.currency || 'USD',
        interval_unit: d.interval_unit,
        interval_count: d.interval_count,
        start_date: d.start_date,
        next_run_date: next_run,
        end_date: d.end_date ?? null,
        auto_charge: d.auto_charge ? 1 : 0,
        gateway: d.gateway || 'none',
        gateway_profile_id: d.gateway_profile_id ?? null,
        tax_rate: d.tax_rate ?? 0,
        discount_rate: d.discount_rate ?? 0,
        owner_id: d.owner_id ?? req.user.id,
      }
    );
    const subId = ins.insertId;
    for (let i = 0; i < d.items.length; i++) {
      const li = d.items[i];
      await db.query(
        `INSERT INTO subscription_items (subscription_id, description, quantity, unit_price, sort_order)
         VALUES (:sid, :d, :q, :p, :s)`,
        { sid: subId, d: li.description, q: li.quantity, p: li.unit_price, s: li.sort_order ?? i }
      );
    }
    await logActivity({
      userId: req.user.id, entityType: 'subscription', entityId: subId,
      action: 'created', description: `Subscription "${d.name}" created` });
    res.status(201).json({ id: subId });
  } catch (err) { next(err); }
});

router.put('/:id', requirePermission('subscriptions.write'), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const [[sub]] = await db.query('SELECT * FROM subscriptions WHERE id = :id', { id });
    if (!sub) return res.status(404).json({ error: 'Not found' });
    if (['canceled', 'completed'].includes(sub.status)) {
      return res.status(400).json({ error: `Cannot edit a ${sub.status} subscription` });
    }

    const d = subSchema.partial().parse(req.body);

    const scalarKeys = [
      'name', 'interval_unit', 'interval_count', 'next_run_date', 'end_date',
      'auto_charge', 'gateway', 'gateway_profile_id', 'tax_rate', 'discount_rate',
    ];
    const patch = {};
    for (const k of scalarKeys) {
      if (d[k] !== undefined) patch[k] = k === 'auto_charge' ? (d[k] ? 1 : 0) : d[k];
    }
    if (Object.keys(patch).length) {
      const set = Object.keys(patch).map((k) => `${k} = :${k}`).join(', ');
      await db.query(`UPDATE subscriptions SET ${set} WHERE id = :id`, { ...patch, id });
    }

    if (Array.isArray(d.items)) {
      await db.query('DELETE FROM subscription_items WHERE subscription_id = :id', { id });
      for (let i = 0; i < d.items.length; i++) {
        const li = d.items[i];
        await db.query(
          `INSERT INTO subscription_items (subscription_id, description, quantity, unit_price, sort_order)
           VALUES (:sid, :d, :q, :p, :s)`,
          { sid: id, d: li.description, q: li.quantity, p: li.unit_price, s: li.sort_order ?? i }
        );
      }
    }

    await logActivity({
      userId: req.user.id, entityType: 'subscription', entityId: id,
      action: 'updated', description: `Subscription "${d.name || sub.name}" updated` });

    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.put('/:id/status', requirePermission('subscriptions.write'), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const status = z.enum(['active','paused','canceled','completed']).parse(req.body?.status);
    await db.query('UPDATE subscriptions SET status = :s WHERE id = :id', { s: status, id });
    await logActivity({
      userId: req.user.id, entityType: 'subscription', entityId: id,
      action: 'status_changed', description: `Status → ${status}` });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.delete('/:id', requirePermission('subscriptions.write'), async (req, res, next) => {
  try {
    await db.query('DELETE FROM subscriptions WHERE id = :id', { id: req.params.id });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// Manual "run now" — create an invoice for this subscription on the spot.
router.post('/:id/run-now', requirePermission('subscriptions.write'), async (req, res, next) => {
  try {
    const { runSubscription } = require('../jobs/billing-cron');
    const result = await runSubscription(Number(req.params.id));
    res.json(result);
  } catch (err) { next(err); }
});

module.exports = router;
