// =============================================================================
// /api/invoices  —  Invoice CRUD + line items + totals + send
// -----------------------------------------------------------------------------
// Totals are always computed server-side from line items + tax% + discount%.
// Client submits the pieces, server does the math — keeps the books honest.
// =============================================================================
const router  = require('express').Router();
const crypto  = require('crypto');
const { z } = require('zod');
const { db } = require('../db');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { logActivity } = require('../services/activity');
const { sendMail } = require('../services/mailer');
const moduleSettings = require('../services/moduleSettings');
const { resolveOwnerScope, contactOwnerClause } = require('../services/scope');
const { triggerWorkflow } = require('../services/automations');
const { renderBySlug } = require('../services/templates');
const { tagInvoicePaymentAsDonation } = require('../services/constituents');
const { maybeSendReceiptEmail } = require('../services/receipts');

router.use(requireAuth);

// ---------- helpers ----------

function roundMoney(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

function computeTotals({ line_items, tax_rate, discount_rate }) {
  const subtotal = roundMoney(
    (line_items || []).reduce(
      (acc, li) => acc + Number(li.quantity || 0) * Number(li.unit_price || 0),
      0
    )
  );
  const discount_amount = roundMoney(subtotal * (Number(discount_rate || 0) / 100));
  const taxable = Math.max(0, subtotal - discount_amount);
  const tax_amount = roundMoney(taxable * (Number(tax_rate || 0) / 100));
  const total = roundMoney(taxable + tax_amount);
  return { subtotal, discount_amount, tax_amount, total };
}

async function nextInvoiceNumber() {
  const cfg    = await moduleSettings.get('invoices');
  const pfx    = (cfg.invoice_prefix || 'INV').trim().toUpperCase();
  const year   = new Date().getUTCFullYear();
  const prefix = `${pfx}-${year}-`;
  const [rows] = await db.query(
    `SELECT invoice_number FROM invoices
      WHERE invoice_number LIKE :p
      ORDER BY id DESC LIMIT 1`,
    { p: `${prefix}%` }
  );
  const last = rows[0]?.invoice_number;
  const seq  = last ? Number(last.split('-').pop()) + 1 : 1;
  return `${prefix}${String(seq).padStart(6, '0')}`;
}

async function loadInvoice(id, scopeClause) {
  const [[invoice]] = await db.query(
    `SELECT i.*,
            CONCAT_WS(' ', c.first_name, c.last_name) AS contact_name,
            c.email AS contact_email,
            o.name  AS organization_name,
            d.name  AS deal_name,
            CONCAT_WS(' ', u.first_name, u.last_name) AS owner_name
       FROM invoices i
       LEFT JOIN contacts c      ON c.id = i.contact_id
       LEFT JOIN organizations o ON o.id = i.organization_id
       LEFT JOIN deals d         ON d.id = i.deal_id
       LEFT JOIN users u         ON u.id = i.owner_id
      WHERE i.id = :id${scopeClause ? ` AND ${scopeClause}` : ''}`,
    { id }
  );
  if (!invoice) return null;

  const [lines] = await db.query(
    'SELECT * FROM invoice_line_items WHERE invoice_id = :id ORDER BY sort_order, id',
    { id }
  );
  const [payments] = await db.query(
    'SELECT * FROM payments WHERE invoice_id = :id ORDER BY created_at DESC',
    { id }
  );
  const [activities] = await db.query(
    `SELECT a.*, CONCAT_WS(' ', u.first_name, u.last_name) AS user_name
       FROM activities a
       LEFT JOIN users u ON u.id = a.user_id
      WHERE a.entity_type = 'invoice' AND a.entity_id = :id
      ORDER BY a.created_at DESC LIMIT 100`,
    { id }
  );
  return { invoice, line_items: lines, payments, activities };
}

async function refreshInvoiceTotals(invoiceId) {
  const [[inv]] = await db.query(
    'SELECT tax_rate, discount_rate FROM invoices WHERE id = :id', { id: invoiceId });
  if (!inv) return null;
  const [lines] = await db.query(
    'SELECT quantity, unit_price FROM invoice_line_items WHERE invoice_id = :id', { id: invoiceId });
  const totals = computeTotals({
    line_items: lines,
    tax_rate: inv.tax_rate,
    discount_rate: inv.discount_rate,
  });
  const [[agg]] = await db.query(
    `SELECT COALESCE(SUM(amount),0) AS paid
       FROM payments
      WHERE invoice_id = :id AND status IN ('captured','authorized')`,
    { id: invoiceId });
  const amount_paid = roundMoney(Number(agg.paid || 0));
  const balance_due = roundMoney(totals.total - amount_paid);

  await db.query(
    `UPDATE invoices
        SET subtotal = :subtotal,
            tax_amount = :tax_amount,
            discount_amount = :discount_amount,
            total = :total,
            amount_paid = :amount_paid,
            balance_due = :balance_due
      WHERE id = :id`,
    { ...totals, amount_paid, balance_due, id: invoiceId }
  );
  return { ...totals, amount_paid, balance_due };
}

// ---------- schemas ----------

const lineItemSchema = z.object({
  id:          z.number().int().optional(),
  description: z.string().min(1),
  quantity:    z.number().nonnegative().default(1),
  unit_price:  z.number().nonnegative().default(0),
  sort_order:  z.number().int().optional(),
});

// Dates must be ISO YYYY-MM-DD — matches MySQL DATE columns. Keeping this in
// zod avoids the round-trip-to-MySQL-for-a-500 pattern when the client sends junk.
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');

const invoiceSchema = z.object({
  contact_id:      z.number().int().nullable().optional(),
  organization_id: z.number().int().nullable().optional(),
  deal_id:         z.number().int().nullable().optional(),
  owner_id:        z.number().int().nullable().optional(),
  issue_date:      isoDate,
  due_date:        isoDate,
  currency:        z.string().length(3).optional(),
  // Rates are percentages — a sane cap at 100 prevents books with
  // discount_amount > subtotal or astronomical tax. 0 stays allowed.
  tax_rate:        z.number().min(0).max(100).optional(),
  discount_rate:   z.number().min(0).max(100).optional(),
  memo:            z.string().optional().nullable(),
  terms:           z.string().optional().nullable(),
  line_items:      z.array(lineItemSchema).min(1),
});

// ---------- routes ----------

router.get('/', requirePermission('invoices.read'), async (req, res, next) => {
  try {
    const { q, status, contact_id, organization_id, page = 1, pageSize = 25 } = req.query;
    const where = ['1=1']; const params = {};

    const scopeIds = await resolveOwnerScope(req.user);
    const scopeClause = contactOwnerClause(scopeIds, 'i.contact_id');
    if (scopeClause) where.push(scopeClause);

    if (q)               { where.push('(i.invoice_number LIKE :q OR c.last_name LIKE :q OR o.name LIKE :q)'); params.q = `%${q}%`; }
    if (status)          { where.push('i.status = :status'); params.status = status; }
    if (contact_id)      { where.push('i.contact_id = :cid'); params.cid = contact_id; }
    if (organization_id) { where.push('i.organization_id = :oid'); params.oid = organization_id; }
    params.limit = Number(pageSize);
    params.offset = (Number(page) - 1) * Number(pageSize);

    const [rows] = await db.query(
      `SELECT i.*,
              CONCAT_WS(' ', c.first_name, c.last_name) AS contact_name,
              o.name AS organization_name
         FROM invoices i
         LEFT JOIN contacts c      ON c.id = i.contact_id
         LEFT JOIN organizations o ON o.id = i.organization_id
        WHERE ${where.join(' AND ')}
        ORDER BY i.issue_date DESC, i.id DESC
        LIMIT :limit OFFSET :offset`,
      params
    );
    const [[{ total }]] = await db.query(
      `SELECT COUNT(*) AS total
         FROM invoices i
         LEFT JOIN contacts c      ON c.id = i.contact_id
         LEFT JOIN organizations o ON o.id = i.organization_id
        WHERE ${where.join(' AND ')}`, params);

    // Totals must use the SAME scope/filter WHERE so scoped users don't see
    // aggregate figures for invoices they cannot see.
    const sumParams = { ...params };
    delete sumParams.limit;
    delete sumParams.offset;
    const [[sum]] = await db.query(
      `SELECT COALESCE(SUM(i.total),0)       AS total_billed,
              COALESCE(SUM(i.amount_paid),0)  AS total_collected,
              COALESCE(SUM(i.balance_due),0)  AS total_outstanding
         FROM invoices i
         LEFT JOIN contacts c      ON c.id = i.contact_id
         LEFT JOIN organizations o ON o.id = i.organization_id
        WHERE ${where.join(' AND ')}`, sumParams);
    res.json({ rows, total, page: Number(page), pageSize: Number(pageSize), summary: sum });
  } catch (err) { next(err); }
});

router.get('/:id', requirePermission('invoices.read'), async (req, res, next) => {
  try {
    const scopeIds = await resolveOwnerScope(req.user);
    const scopeClause = contactOwnerClause(scopeIds, 'i.contact_id');
    const data = await loadInvoice(Number(req.params.id), scopeClause);
    if (!data) return res.status(404).json({ error: 'Not found' });
    res.json(data);
  } catch (err) { next(err); }
});

router.post('/', requirePermission('invoices.write'), async (req, res, next) => {
  try {
    const d = invoiceSchema.parse(req.body);
    const totals = computeTotals({
      line_items: d.line_items,
      tax_rate: d.tax_rate,
      discount_rate: d.discount_rate,
    });
    const number       = await nextInvoiceNumber();
    const paymentToken = crypto.randomBytes(32).toString('hex'); // 256-bit random token for public pay URL

    const [ins] = await db.query(
      `INSERT INTO invoices
         (payment_token, invoice_number, contact_id, organization_id, deal_id, owner_id,
          issue_date, due_date, currency,
          subtotal, tax_rate, tax_amount, discount_rate, discount_amount, total,
          amount_paid, balance_due, status, memo, terms)
       VALUES
         (:payment_token, :invoice_number, :contact_id, :organization_id, :deal_id, :owner_id,
          :issue_date, :due_date, :currency,
          :subtotal, :tax_rate, :tax_amount, :discount_rate, :discount_amount, :total,
          0, :total, 'draft', :memo, :terms)`,
      {
        payment_token:   paymentToken,
        invoice_number:  number,
        contact_id:      d.contact_id ?? null,
        organization_id: d.organization_id ?? null,
        deal_id:         d.deal_id ?? null,
        owner_id:        d.owner_id ?? req.user.id,
        issue_date:      d.issue_date,
        due_date:        d.due_date,
        currency:        d.currency || 'USD',
        tax_rate:        d.tax_rate || 0,
        discount_rate:   d.discount_rate || 0,
        memo:            d.memo ?? null,
        terms:           d.terms ?? null,
        ...totals,
      }
    );
    const invoiceId = ins.insertId;

    // Insert line items
    for (let idx = 0; idx < d.line_items.length; idx++) {
      const li = d.line_items[idx];
      const amount = roundMoney(Number(li.quantity) * Number(li.unit_price));
      await db.query(
        `INSERT INTO invoice_line_items (invoice_id, description, quantity, unit_price, amount, sort_order)
         VALUES (:iid, :desc, :qty, :price, :amount, :sort)`,
        {
          iid: invoiceId,
          desc: li.description,
          qty: li.quantity || 0,
          price: li.unit_price || 0,
          amount,
          sort: li.sort_order ?? idx,
        }
      );
    }

    await logActivity({
      userId: req.user.id, entityType: 'invoice', entityId: invoiceId,
      action: 'created', description: `Invoice ${number} created ($${totals.total.toFixed(2)})`,
    });
    const [[newInvoice]] = await db.query('SELECT * FROM invoices WHERE id = :id', { id: invoiceId });
    triggerWorkflow('invoice.created', 'invoice', newInvoice).catch(() => {});

    res.status(201).json({ id: invoiceId, invoice_number: number, ...totals });
  } catch (err) { next(err); }
});

router.put('/:id', requirePermission('invoices.write'), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const [[current]] = await db.query('SELECT * FROM invoices WHERE id = :id', { id });
    if (!current) return res.status(404).json({ error: 'Not found' });
    if (current.status === 'paid' || current.status === 'void') {
      return res.status(400).json({ error: `Cannot edit invoice in status "${current.status}"` });
    }

    const d = invoiceSchema.partial().parse(req.body);

    // Update scalar fields
    const scalarKeys = [
      'contact_id','organization_id','deal_id','owner_id',
      'issue_date','due_date','currency','tax_rate','discount_rate','memo','terms',
    ];
    const patch = {};
    for (const k of scalarKeys) if (d[k] !== undefined) patch[k] = d[k];
    if (Object.keys(patch).length) {
      const set = Object.keys(patch).map((k) => `${k} = :${k}`).join(', ');
      await db.query(`UPDATE invoices SET ${set} WHERE id = :id`, { ...patch, id });
    }

    // Replace line items if provided
    if (Array.isArray(d.line_items)) {
      await db.query('DELETE FROM invoice_line_items WHERE invoice_id = :id', { id });
      for (let idx = 0; idx < d.line_items.length; idx++) {
        const li = d.line_items[idx];
        const amount = roundMoney(Number(li.quantity) * Number(li.unit_price));
        await db.query(
          `INSERT INTO invoice_line_items (invoice_id, description, quantity, unit_price, amount, sort_order)
           VALUES (:iid, :desc, :qty, :price, :amount, :sort)`,
          {
            iid: id,
            desc: li.description,
            qty: li.quantity || 0,
            price: li.unit_price || 0,
            amount,
            sort: li.sort_order ?? idx,
          }
        );
      }
    }

    const totals = await refreshInvoiceTotals(id);

    await logActivity({
      userId: req.user.id, entityType: 'invoice', entityId: id,
      action: 'updated', description: `Invoice updated — total $${totals.total.toFixed(2)}`,
    });

    res.json({ ok: true, totals });
  } catch (err) { next(err); }
});

router.delete('/:id', requirePermission('invoices.delete'), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const [[current]] = await db.query('SELECT status FROM invoices WHERE id = :id', { id });
    if (!current) return res.status(404).json({ error: 'Not found' });

    // Only allow hard delete for drafts; otherwise void it
    if (current.status === 'draft') {
      await db.query('DELETE FROM invoices WHERE id = :id', { id });
      await logActivity({
        userId: req.user.id, entityType: 'invoice', entityId: id,
        action: 'deleted', description: 'Draft invoice deleted' });
      return res.json({ ok: true, deleted: true });
    }
    await db.query("UPDATE invoices SET status='void' WHERE id = :id", { id });
    await logActivity({
      userId: req.user.id, entityType: 'invoice', entityId: id,
      action: 'voided', description: 'Invoice voided' });
    res.json({ ok: true, voided: true });
  } catch (err) { next(err); }
});

// Mark as sent (optionally email the customer with a portal link)
router.post('/:id/send', requirePermission('invoices.send'), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const data = await loadInvoice(id);
    if (!data) return res.status(404).json({ error: 'Not found' });

    const to = req.body?.to || data.invoice.contact_email;
    if (!to) return res.status(400).json({ error: 'No recipient email on contact or in request body' });

    const origin = (process.env.CLIENT_ORIGIN || 'http://localhost:5173').split(',')[0].trim();
    // Use payment_token (non-enumerable) in the pay link.  Fall back to integer id
    // for invoices created before migration 030 added the payment_token column.
    const [[invTokenRow]] = await db.query(
      'SELECT payment_token FROM invoices WHERE id = :id', { id });
    const payLink = invTokenRow?.payment_token
      ? `${origin}/pay/${invTokenRow.payment_token}`
      : `${origin}/pay/${id}`;

    let subject, html;
    try {
      const rendered = await renderBySlug('invoice_sent', {
        contact_id: data.invoice.contact_id,
        invoice_id: id,
      });
      if (rendered) {
        subject = rendered.subject;
        html    = rendered.html;
      }
    } catch (_e) { /* fall through to plain-text fallback */ }

    if (!subject) {
      subject = `Invoice ${data.invoice.invoice_number} — $${Number(data.invoice.balance_due).toFixed(2)} due`;
    }
    if (!html) {
      html = `<p>Hello ${data.invoice.contact_name || ''},</p>
<p>Your invoice ${data.invoice.invoice_number} is ready.<br>
Amount due: $${Number(data.invoice.balance_due).toFixed(2)}<br>
Due date: ${data.invoice.due_date}</p>
<p><a href="${payLink}">View &amp; pay online</a></p>
<p>Thank you!</p>`;
    }

    try {
      await sendMail({
        to, subject, html,
        entityType: 'contact',
        entityId: data.invoice.contact_id,
        userId: req.user.id,
      });
    } catch (e) {
      // Still mark sent (the user asked us to) but warn
      // eslint-disable-next-line no-console
      console.warn('[invoices/send] email delivery failed:', e.message);
    }

    await db.query(
      `UPDATE invoices
          SET status = CASE WHEN status = 'draft' THEN 'sent' ELSE status END,
              sent_at = NOW()
        WHERE id = :id`, { id });
    await logActivity({
      userId: req.user.id, entityType: 'invoice', entityId: id,
      action: 'sent', description: `Invoice sent to ${to}` });

    res.json({ ok: true, to, payLink });
  } catch (err) { next(err); }
});

// Manual payment recording (cash/check/wire). Gateway-recorded payments
// come via the webhook route in /api/payments.
const manualPaymentSchema = z.object({
  amount:     z.number().positive(),
  method:     z.enum(['card','ach','check','cash','wire','other']).default('check'),
  external_txn_id: z.string().optional().nullable(),
  note:       z.string().optional().nullable(),
});
router.post('/:id/manual-payment', requirePermission('payments.write'), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const d = manualPaymentSchema.parse(req.body);
    const [[inv]] = await db.query('SELECT currency FROM invoices WHERE id = :id', { id });
    if (!inv) return res.status(404).json({ error: 'Not found' });

    // 256-bit random token for the public receipt URL — same scheme as the
    // gateway-checkout path. Never expose the auto-increment id externally.
    const receiptToken = crypto.randomBytes(32).toString('hex');
    const [pIns] = await db.query(
      `INSERT INTO payments
         (invoice_id, gateway, method, amount, currency, status, external_txn_id,
          processor_response, received_at, recorded_by, receipt_token)
       VALUES
         (:iid, 'manual', :method, :amount, :currency, 'captured', :txn,
          CAST(:meta AS JSON), NOW(), :uid, :rtok)`,
      {
        iid: id,
        method: d.method,
        amount: d.amount,
        currency: inv.currency,
        txn: d.external_txn_id || null,
        meta: JSON.stringify({ note: d.note || null, source: 'manual' }),
        uid: req.user.id,
        rtok: receiptToken,
      }
    );

    const totals = await refreshInvoiceTotals(id);
    if (totals.balance_due <= 0.005) {
      await db.query("UPDATE invoices SET status='paid', paid_at=NOW() WHERE id=:id", { id });
    } else if (totals.amount_paid > 0) {
      await db.query("UPDATE invoices SET status='partial' WHERE id=:id AND status IN ('sent','overdue','draft')", { id });
    }

    // Tags a real `donations` row if this invoice belongs to a fund-linked
    // pledge/recurring donation, and sends the matching receipt — same as
    // every other payment-capture path (checkout, portal, cron auto-charge).
    await tagInvoicePaymentAsDonation(pIns.insertId);
    await maybeSendReceiptEmail(pIns.insertId);

    await logActivity({
      userId: req.user.id, entityType: 'invoice', entityId: id,
      action: 'payment_recorded', description: `Manual ${d.method} payment $${d.amount.toFixed(2)}` });
    const [[paidInvoice]] = await db.query('SELECT * FROM invoices WHERE id = :id', { id });
    triggerWorkflow('payment.received', 'invoice', paidInvoice, { amount: d.amount, method: d.method }).catch(() => {});

    res.json({ ok: true, totals });
  } catch (err) { next(err); }
});

// Exported for use by the billing cron's auto-pay flow.
module.exports = router;
module.exports.refreshInvoiceTotalsById = refreshInvoiceTotals;
