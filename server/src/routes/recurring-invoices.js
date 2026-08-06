// =============================================================================
// /api/recurring-invoices — Recurring invoice series management
// -----------------------------------------------------------------------------
// Distinct from subscriptions: invoice-centric, supports a max_occurrences
// cap for payment plans, and tracks a gateway vault profile for auto-pay via
// Valor or Authorize.Net.  The billing cron calls runRecurringInvoice() for
// each active series whose next_run_date <= today.
// =============================================================================
const router = require('express').Router();
const { z } = require('zod');
const { db } = require('../db');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { logActivity } = require('../services/activity');
const { resolveOwnerScope, contactOwnerClause } = require('../services/scope');

router.use(requireAuth);

// ---------- helpers ----------

function fmtMoney(n) { return Number(n || 0).toFixed(2); }

// ---------- schemas ----------

const itemSchema = z.object({
  description: z.string().min(1),
  quantity:    z.number().nonnegative().default(1),
  unit_price:  z.number().nonnegative().default(0),
  sort_order:  z.number().int().optional(),
});

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');

const riSchema = z.object({
  name:               z.string().min(1),
  contact_id:         z.number().int().nullable().optional(),
  organization_id:    z.number().int().nullable().optional(),
  deal_id:            z.number().int().nullable().optional(),
  owner_id:           z.number().int().nullable().optional(),
  currency:           z.string().length(3).optional(),
  interval_unit:      z.enum(['week','month','year']).default('month'),
  interval_count:     z.number().int().positive().default(1),
  start_date:         isoDate,
  next_run_date:      isoDate.optional(),
  end_date:           isoDate.optional().nullable(),
  max_occurrences:    z.number().int().positive().optional().nullable(),
  auto_pay:           z.boolean().optional(),
  gateway:            z.enum(['valor','authnet']).optional().nullable(),
  gateway_profile_id: z.string().optional().nullable(),
  tax_rate:           z.number().min(0).max(100).optional(),
  discount_rate:      z.number().min(0).max(100).optional(),
  memo:               z.string().optional().nullable(),
  terms:              z.string().optional().nullable(),
  due_days:           z.number().int().min(0).optional(),
  items:              z.array(itemSchema).min(1),
});

// ---------- list ----------

router.get('/', requirePermission('invoices.read'), async (req, res, next) => {
  try {
    const { q, status } = req.query;
    const where = ['1=1']; const params = {};

    const scopeIds = await resolveOwnerScope(req.user);
    const scopeClause = contactOwnerClause(scopeIds, 'ri.contact_id');
    if (scopeClause) where.push(scopeClause);

    if (q)      { where.push('(ri.name LIKE :q OR c.last_name LIKE :q OR o.name LIKE :q)'); params.q = `%${q}%`; }
    if (status) { where.push('ri.status = :status'); params.status = status; }

    const [rows] = await db.query(
      `SELECT ri.*,
              CONCAT_WS(' ', c.first_name, c.last_name) AS contact_name,
              o.name AS organization_name,
              ROUND(COALESCE(it.subtotal, 0), 2) AS item_subtotal,
              ROUND(
                COALESCE(it.subtotal, 0)
                * (1 - COALESCE(ri.discount_rate,0)/100)
                * (1 + COALESCE(ri.tax_rate,0)/100)
              , 2) AS per_run_total,
              COALESCE(inv.invoice_count, 0) AS invoice_count
         FROM recurring_invoices ri
         LEFT JOIN contacts c      ON c.id = ri.contact_id
         LEFT JOIN organizations o ON o.id = ri.organization_id
         LEFT JOIN (
           SELECT recurring_invoice_id, SUM(quantity * unit_price) AS subtotal
             FROM recurring_invoice_items
            GROUP BY recurring_invoice_id
         ) it ON it.recurring_invoice_id = ri.id
         LEFT JOIN (
           SELECT recurring_invoice_id, COUNT(*) AS invoice_count
             FROM invoices
            WHERE recurring_invoice_id IS NOT NULL
            GROUP BY recurring_invoice_id
         ) inv ON inv.recurring_invoice_id = ri.id
        WHERE ${where.join(' AND ')}
        ORDER BY ri.next_run_date ASC, ri.id DESC`,
      params
    );
    res.json({ rows });
  } catch (err) { next(err); }
});

// ---------- detail ----------

router.get('/:id', requirePermission('invoices.read'), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const scopeIds = await resolveOwnerScope(req.user);
    const scopeClause = contactOwnerClause(scopeIds, 'ri.contact_id');
    const [[ri]] = await db.query(
      `SELECT ri.*,
              CONCAT_WS(' ', c.first_name, c.last_name) AS contact_name,
              c.email AS contact_email,
              o.name AS organization_name
         FROM recurring_invoices ri
         LEFT JOIN contacts c      ON c.id = ri.contact_id
         LEFT JOIN organizations o ON o.id = ri.organization_id
        WHERE ri.id = :id${scopeClause ? ` AND ${scopeClause}` : ''}`,
      { id }
    );
    if (!ri) return res.status(404).json({ error: 'Not found' });

    const [items] = await db.query(
      'SELECT * FROM recurring_invoice_items WHERE recurring_invoice_id = :id ORDER BY sort_order, id',
      { id }
    );
    const [invoices] = await db.query(
      `SELECT id, invoice_number, issue_date, due_date, total, balance_due, status
         FROM invoices
        WHERE recurring_invoice_id = :id
        ORDER BY issue_date DESC`,
      { id }
    );
    const [payments] = await db.query(
      `SELECT p.id, p.invoice_id, p.gateway, p.method, p.amount, p.currency,
              p.status, p.external_txn_id, p.card_last4, p.card_brand,
              p.received_at, p.created_at, i.invoice_number
         FROM payments p
         JOIN invoices i ON i.id = p.invoice_id
        WHERE i.recurring_invoice_id = :id
        ORDER BY p.created_at DESC`,
      { id }
    );

    res.json({ recurring_invoice: ri, items, invoices, payments });
  } catch (err) { next(err); }
});

// ---------- create ----------

router.post('/', requirePermission('invoices.write'), async (req, res, next) => {
  try {
    const d = riSchema.parse(req.body);
    const next_run = d.next_run_date || d.start_date;

    const [ins] = await db.query(
      `INSERT INTO recurring_invoices
         (name, contact_id, organization_id, deal_id, owner_id, currency,
          interval_unit, interval_count, start_date, next_run_date, end_date,
          max_occurrences, auto_pay, gateway, gateway_profile_id,
          tax_rate, discount_rate, memo, terms, due_days, created_by)
       VALUES
         (:name, :contact_id, :organization_id, :deal_id, :owner_id, :currency,
          :interval_unit, :interval_count, :start_date, :next_run_date, :end_date,
          :max_occurrences, :auto_pay, :gateway, :gateway_profile_id,
          :tax_rate, :discount_rate, :memo, :terms, :due_days, :created_by)`,
      {
        name:               d.name,
        contact_id:         d.contact_id ?? null,
        organization_id:    d.organization_id ?? null,
        deal_id:            d.deal_id ?? null,
        owner_id:           d.owner_id ?? req.user.id,
        currency:           d.currency || 'USD',
        interval_unit:      d.interval_unit,
        interval_count:     d.interval_count,
        start_date:         d.start_date,
        next_run_date:      next_run,
        end_date:           d.end_date ?? null,
        max_occurrences:    d.max_occurrences ?? null,
        auto_pay:           d.auto_pay ? 1 : 0,
        gateway:            d.gateway ?? null,
        gateway_profile_id: d.gateway_profile_id ?? null,
        tax_rate:           d.tax_rate ?? 0,
        discount_rate:      d.discount_rate ?? 0,
        memo:               d.memo ?? null,
        terms:              d.terms ?? null,
        due_days:           d.due_days ?? 14,
        created_by:         req.user.id,
      }
    );
    const riId = ins.insertId;

    for (let i = 0; i < d.items.length; i++) {
      const li = d.items[i];
      const amount = Number(li.quantity) * Number(li.unit_price);
      await db.query(
        `INSERT INTO recurring_invoice_items
           (recurring_invoice_id, description, quantity, unit_price, amount, sort_order)
         VALUES (:rid, :desc, :qty, :price, :amount, :sort)`,
        { rid: riId, desc: li.description, qty: li.quantity, price: li.unit_price, amount, sort: li.sort_order ?? i }
      );
    }

    await logActivity({
      userId: req.user.id, entityType: 'recurring_invoice', entityId: riId,
      action: 'created', description: `Recurring invoice "${d.name}" created` });

    res.status(201).json({ id: riId });
  } catch (err) { next(err); }
});

// ---------- update ----------

router.put('/:id', requirePermission('invoices.write'), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const [[ri]] = await db.query('SELECT * FROM recurring_invoices WHERE id = :id', { id });
    if (!ri) return res.status(404).json({ error: 'Not found' });
    if (ri.status === 'canceled') return res.status(400).json({ error: 'Cannot edit a canceled recurring invoice' });

    const d = riSchema.partial().parse(req.body);

    const scalarKeys = [
      'name','contact_id','organization_id','deal_id','owner_id','currency',
      'interval_unit','interval_count','start_date','next_run_date','end_date',
      'max_occurrences','auto_pay','gateway','gateway_profile_id',
      'tax_rate','discount_rate','memo','terms','due_days',
    ];
    const patch = {};
    for (const k of scalarKeys) {
      if (d[k] !== undefined) patch[k] = k === 'auto_pay' ? (d[k] ? 1 : 0) : d[k];
    }
    if (Object.keys(patch).length) {
      const set = Object.keys(patch).map((k) => `${k} = :${k}`).join(', ');
      await db.query(`UPDATE recurring_invoices SET ${set} WHERE id = :id`, { ...patch, id });
    }

    if (Array.isArray(d.items)) {
      await db.query('DELETE FROM recurring_invoice_items WHERE recurring_invoice_id = :id', { id });
      for (let i = 0; i < d.items.length; i++) {
        const li = d.items[i];
        const amount = Number(li.quantity) * Number(li.unit_price);
        await db.query(
          `INSERT INTO recurring_invoice_items
             (recurring_invoice_id, description, quantity, unit_price, amount, sort_order)
           VALUES (:rid, :desc, :qty, :price, :amount, :sort)`,
          { rid: id, desc: li.description, qty: li.quantity, price: li.unit_price, amount, sort: li.sort_order ?? i }
        );
      }
    }

    await logActivity({
      userId: req.user.id, entityType: 'recurring_invoice', entityId: id,
      action: 'updated', description: `Recurring invoice "${d.name || ri.name}" updated` });

    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ---------- status changes ----------

router.post('/:id/pause', requirePermission('invoices.write'), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    await db.query("UPDATE recurring_invoices SET status='paused' WHERE id=:id AND status='active'", { id });
    await logActivity({ userId: req.user.id, entityType: 'recurring_invoice', entityId: id, action: 'paused', description: 'Paused' });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.post('/:id/resume', requirePermission('invoices.write'), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    await db.query("UPDATE recurring_invoices SET status='active' WHERE id=:id AND status='paused'", { id });
    await logActivity({ userId: req.user.id, entityType: 'recurring_invoice', entityId: id, action: 'resumed', description: 'Resumed' });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.post('/:id/cancel', requirePermission('invoices.write'), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    await db.query("UPDATE recurring_invoices SET status='canceled' WHERE id=:id", { id });
    await logActivity({ userId: req.user.id, entityType: 'recurring_invoice', entityId: id, action: 'canceled', description: 'Canceled' });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ---------- run now (admin) ----------

router.post('/:id/run-now', requirePermission('invoices.write'), async (req, res, next) => {
  try {
    const { runRecurringInvoice } = require('../jobs/billing-cron');
    const result = await runRecurringInvoice(Number(req.params.id));
    if (!result.ok) return res.status(400).json(result);
    res.json(result);
  } catch (err) { next(err); }
});

// ---------- delete ----------

router.delete('/:id', requirePermission('invoices.delete'), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const [[ri]] = await db.query(
      'SELECT id FROM recurring_invoices WHERE id = :id', { id });
    if (!ri) return res.status(404).json({ error: 'Not found' });
    await db.query('DELETE FROM recurring_invoices WHERE id = :id', { id });
    await logActivity({
      userId: req.user.id, entityType: 'recurring_invoice', entityId: id,
      action: 'deleted', description: 'Recurring invoice deleted' });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;
