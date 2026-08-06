// =============================================================================
// /api/pledges — Pledge giving
// -----------------------------------------------------------------------------
// A pledge is a `recurring_invoices` row with `fund_id` set — that table
// already has everything a pledge needs (fixed installment count via
// max_occurrences, works with or without a card on file, active/paused/
// completed status, correct end-of-series completion logic in
// billing-cron.js's runRecurringInvoice). This route is a thin, donor-
// friendly layer over the same table: no line-items/tax/memo fields exposed,
// just donor + fund + amount + cadence + installment count. When an
// installment is actually collected (however it's paid — cron auto-charge,
// staff manual payment, donor portal payment, or public pay-link charge),
// services/constituents.js's tagInvoicePaymentAsDonation creates the real
// `donations` row; balance_remaining below is always computed from that
// same source, never a stored/duplicated ledger.
// =============================================================================
const router = require('express').Router();
const { z } = require('zod');
const { db } = require('../db');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { logActivity } = require('../services/activity');
const { resolveOwnerScope, contactOwnerClause } = require('../services/scope');

router.use(requireAuth);

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');

const pledgeSchema = z.object({
  contact_id:         z.number().int().nullable().optional(),
  organization_id:    z.number().int().nullable().optional(),
  owner_id:           z.number().int().nullable().optional(),
  fund_id:            z.number().int(),
  amount_per_installment: z.number().positive(),
  interval_unit:      z.enum(['week','month','year']).default('month'),
  interval_count:     z.number().int().positive().default(1),
  start_date:         isoDate,
  max_occurrences:    z.number().int().positive().optional().nullable(),
  end_date:           isoDate.optional().nullable(),
  gateway:            z.enum(['valor','authnet']).optional().nullable(),
  gateway_profile_id: z.string().optional().nullable(),
});

const PLEDGE_LIST_SELECT = `
  SELECT ri.*, f.name AS fund_name,
         CONCAT_WS(' ', c.first_name, c.last_name) AS contact_name,
         o.name AS organization_name,
         COALESCE(it.subtotal, 0) AS amount_per_installment,
         CASE WHEN ri.max_occurrences IS NOT NULL
              THEN ROUND(ri.max_occurrences * COALESCE(it.subtotal, 0), 2)
              ELSE NULL END AS total_pledged,
         ROUND(COALESCE(don.collected, 0), 2) AS collected,
         CASE WHEN ri.max_occurrences IS NOT NULL
              THEN ROUND(ri.max_occurrences * COALESCE(it.subtotal, 0) - COALESCE(don.collected, 0), 2)
              ELSE NULL END AS balance_remaining
    FROM recurring_invoices ri
    JOIN funds f              ON f.id = ri.fund_id
    LEFT JOIN contacts c      ON c.id = ri.contact_id
    LEFT JOIN organizations o ON o.id = ri.organization_id
    LEFT JOIN (
      SELECT recurring_invoice_id, SUM(quantity * unit_price) AS subtotal
        FROM recurring_invoice_items
       GROUP BY recurring_invoice_id
    ) it ON it.recurring_invoice_id = ri.id
    LEFT JOIN (
      SELECT i.recurring_invoice_id, SUM(p.amount) AS collected
        FROM donations d
        JOIN payments p ON p.id = d.payment_id
        JOIN invoices i ON i.id = d.invoice_id
       WHERE i.recurring_invoice_id IS NOT NULL
       GROUP BY i.recurring_invoice_id
    ) don ON don.recurring_invoice_id = ri.id
`;

// ---------- list ----------

router.get('/', requirePermission('donations.read'), async (req, res, next) => {
  try {
    const { q, status, fund_id, contact_id } = req.query;
    const where = ['ri.fund_id IS NOT NULL']; const params = {};

    const scopeIds = await resolveOwnerScope(req.user);
    const scopeClause = contactOwnerClause(scopeIds, 'ri.contact_id');
    if (scopeClause) where.push(scopeClause);

    if (q)          { where.push('(c.last_name LIKE :q OR c.first_name LIKE :q OR o.name LIKE :q)'); params.q = `%${q}%`; }
    if (status)     { where.push('ri.status = :status'); params.status = status; }
    if (fund_id)    { where.push('ri.fund_id = :fund_id'); params.fund_id = fund_id; }
    if (contact_id) { where.push('ri.contact_id = :contact_id'); params.contact_id = contact_id; }

    const [rows] = await db.query(
      `${PLEDGE_LIST_SELECT} WHERE ${where.join(' AND ')} ORDER BY ri.next_run_date ASC, ri.id DESC`,
      params
    );
    res.json({ rows });
  } catch (err) { next(err); }
});

// ---------- detail ----------

router.get('/:id', requirePermission('donations.read'), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const scopeIds = await resolveOwnerScope(req.user);
    const scopeClause = contactOwnerClause(scopeIds, 'ri.contact_id');
    const [[pledge]] = await db.query(
      `${PLEDGE_LIST_SELECT} WHERE ri.id = :id AND ri.fund_id IS NOT NULL${scopeClause ? ` AND ${scopeClause}` : ''}`,
      { id }
    );
    if (!pledge) return res.status(404).json({ error: 'Not found' });

    const [donations] = await db.query(
      `SELECT d.id, d.created_at, p.amount, p.status AS payment_status, i.invoice_number
         FROM donations d
         JOIN payments p ON p.id = d.payment_id
         JOIN invoices i ON i.id = d.invoice_id
        WHERE i.recurring_invoice_id = :id
        ORDER BY d.created_at DESC`,
      { id }
    );

    res.json({ pledge, donations });
  } catch (err) { next(err); }
});

// ---------- create ----------

router.post('/', requirePermission('donations.write'), async (req, res, next) => {
  try {
    const d = pledgeSchema.parse(req.body);
    if (!d.contact_id && !d.organization_id) {
      return res.status(400).json({ error: 'A pledge needs a donor (contact or organization).' });
    }

    const [[fund]] = await db.query('SELECT name FROM funds WHERE id = :id', { id: d.fund_id });
    if (!fund) return res.status(404).json({ error: 'Fund not found' });

    const [ins] = await db.query(
      `INSERT INTO recurring_invoices
         (name, contact_id, organization_id, owner_id, fund_id, currency,
          interval_unit, interval_count, start_date, next_run_date, end_date,
          max_occurrences, auto_pay, gateway, gateway_profile_id,
          tax_rate, discount_rate, due_days, created_by)
       VALUES
         (:name, :contact_id, :organization_id, :owner_id, :fund_id, 'USD',
          :interval_unit, :interval_count, :start_date, :start_date, :end_date,
          :max_occurrences, :auto_pay, :gateway, :gateway_profile_id,
          0, 0, 14, :created_by)`,
      {
        name: `Pledge — ${fund.name}`,
        contact_id: d.contact_id ?? null,
        organization_id: d.organization_id ?? null,
        owner_id: d.owner_id ?? req.user.id,
        fund_id: d.fund_id,
        interval_unit: d.interval_unit,
        interval_count: d.interval_count,
        start_date: d.start_date,
        end_date: d.end_date ?? null,
        max_occurrences: d.max_occurrences ?? null,
        auto_pay: d.gateway_profile_id ? 1 : 0,
        gateway: d.gateway ?? null,
        gateway_profile_id: d.gateway_profile_id ?? null,
        created_by: req.user.id,
      }
    );
    const pledgeId = ins.insertId;

    await db.query(
      `INSERT INTO recurring_invoice_items (recurring_invoice_id, description, quantity, unit_price, amount, sort_order)
       VALUES (:rid, :desc, 1, :amount, :amount, 0)`,
      { rid: pledgeId, desc: `Pledge installment — ${fund.name}`, amount: d.amount_per_installment }
    );

    await logActivity({
      userId: req.user.id, entityType: 'recurring_invoice', entityId: pledgeId,
      action: 'created', description: `Pledge created — ${fund.name}` });

    res.status(201).json({ id: pledgeId });
  } catch (err) { next(err); }
});

// ---------- status changes ----------

router.post('/:id/pause', requirePermission('donations.write'), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    await db.query("UPDATE recurring_invoices SET status='paused' WHERE id=:id AND fund_id IS NOT NULL AND status='active'", { id });
    await logActivity({ userId: req.user.id, entityType: 'recurring_invoice', entityId: id, action: 'paused', description: 'Pledge paused' });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.post('/:id/resume', requirePermission('donations.write'), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    await db.query("UPDATE recurring_invoices SET status='active' WHERE id=:id AND fund_id IS NOT NULL AND status='paused'", { id });
    await logActivity({ userId: req.user.id, entityType: 'recurring_invoice', entityId: id, action: 'resumed', description: 'Pledge resumed' });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.post('/:id/cancel', requirePermission('donations.write'), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    await db.query("UPDATE recurring_invoices SET status='canceled' WHERE id=:id AND fund_id IS NOT NULL", { id });
    await logActivity({ userId: req.user.id, entityType: 'recurring_invoice', entityId: id, action: 'canceled', description: 'Pledge canceled' });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;
