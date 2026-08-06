// =============================================================================
// /api/reports — basic Phase 1 reports
// =============================================================================
const router = require('express').Router();
const { db } = require('../db');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { resolveOwnerScope, contactOwnerClause, ownerClause } = require('../services/scope');

router.use(requireAuth);
router.use(requirePermission('reports.view'));

// Dashboard summary KPIs
router.get('/dashboard', async (req, res, next) => {
  try {
    const scopeIds = await resolveOwnerScope(req.user);
    const contactScope = ownerClause(scopeIds, 'owner_id');
    const dealScope    = ownerClause(scopeIds, 'owner_id');
    const taskIds      = scopeIds === null ? null : scopeIds.map((n) => parseInt(n, 10)).join(', ');

    const contactWhere = contactScope ? `WHERE ${contactScope}` : '';
    const dealWhere    = dealScope    ? `WHERE status = "open" AND ${dealScope}` : `WHERE status = "open"`;
    const dealWonWhere = dealScope    ? `WHERE status = "won" AND won_at >= DATE_SUB(NOW(), INTERVAL 30 DAY) AND ${dealScope}` : `WHERE status = "won" AND won_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)`;
    const taskWhere    = taskIds !== null
      ? `WHERE status IN ("open","in_progress") AND (assigned_to IN (${taskIds || '0'}) OR created_by IN (${taskIds || '0'}))`
      : `WHERE status IN ("open","in_progress")`;
    const overdueWhere = taskIds !== null
      ? `WHERE due_date < NOW() AND status != "completed" AND (assigned_to IN (${taskIds || '0'}) OR created_by IN (${taskIds || '0'}))`
      : `WHERE due_date < NOW() AND status != "completed"`;

    const [[contacts]]      = await db.query(`SELECT COUNT(*) AS c FROM contacts ${contactWhere}`);
    const [[organizations]] = await db.query('SELECT COUNT(*) AS c FROM organizations');
    const [[openDeals]]     = await db.query(`SELECT COUNT(*) AS c, COALESCE(SUM(amount),0) AS v FROM deals ${dealWhere}`);
    const [[wonDeals]]      = await db.query(`SELECT COUNT(*) AS c, COALESCE(SUM(amount),0) AS v FROM deals ${dealWonWhere}`);
    const [[openTasks]]     = await db.query(`SELECT COUNT(*) AS c FROM tasks ${taskWhere}`);
    const [[overdue]]       = await db.query(`SELECT COUNT(*) AS c FROM tasks ${overdueWhere}`);

    res.json({
      contacts:      Number(contacts.c),
      organizations: Number(organizations.c),
      open_deals:    { count: Number(openDeals.c), value: Number(openDeals.v) },
      won_30d:       { count: Number(wonDeals.c), value: Number(wonDeals.v) },
      open_tasks:    Number(openTasks.c),
      overdue_tasks: Number(overdue.c),
    });
  } catch (err) { next(err); }
});

// Overview dashboard — all-module KPIs in one parallel call (used by the
// Reports module's dashboard; distinct from the lighter /dashboard above
// which backs the main app Dashboard page).
router.get('/overview', async (req, res, next) => {
  try {
    const scopeIds = await resolveOwnerScope(req.user);
    const dealScope    = ownerClause(scopeIds, 'owner_id');
    const contactWhere = scopeIds !== null ? `WHERE ${ownerClause(scopeIds, 'owner_id')}` : '';
    const dealWhere    = dealScope ? `WHERE status = 'open' AND ${dealScope}` : `WHERE status = 'open'`;
    const dealWonWhere = dealScope
      ? `WHERE status = 'won' AND won_at >= DATE_SUB(NOW(), INTERVAL 30 DAY) AND ${dealScope}`
      : `WHERE status = 'won' AND won_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)`;
    const taskIds = scopeIds === null ? null : scopeIds.map((n) => parseInt(n, 10)).join(', ');
    const taskWhere = taskIds !== null
      ? `WHERE status IN ('open','in_progress') AND (assigned_to IN (${taskIds || '0'}) OR created_by IN (${taskIds || '0'}))`
      : `WHERE status IN ('open','in_progress')`;
    const overdueWhere = taskIds !== null
      ? `WHERE due_date < NOW() AND status != 'completed' AND (assigned_to IN (${taskIds || '0'}) OR created_by IN (${taskIds || '0'}))`
      : `WHERE due_date < NOW() AND status != 'completed'`;

    const [contacts, orgs, openDeals, wonDeals, openTasks, overdueTasks,
           openInvoices, paidMtd, formSubs, campaigns, pages, posts] = await Promise.all([
      db.query(`SELECT COUNT(*) AS c FROM contacts ${contactWhere}`).then(([[r]]) => r),
      db.query('SELECT COUNT(*) AS c FROM organizations').then(([[r]]) => r),
      db.query(`SELECT COUNT(*) AS c, COALESCE(SUM(amount),0) AS v FROM deals ${dealWhere}`).then(([[r]]) => r),
      db.query(`SELECT COUNT(*) AS c, COALESCE(SUM(amount),0) AS v FROM deals ${dealWonWhere}`).then(([[r]]) => r),
      db.query(`SELECT COUNT(*) AS c FROM tasks ${taskWhere}`).then(([[r]]) => r),
      db.query(`SELECT COUNT(*) AS c FROM tasks ${overdueWhere}`).then(([[r]]) => r),
      db.query(`SELECT COUNT(*) AS c, COALESCE(SUM(total),0) AS v FROM invoices WHERE status IN ('sent','partial')`).then(([[r]]) => r),
      db.query(`SELECT COUNT(*) AS c, COALESCE(SUM(amount_paid),0) AS v FROM invoices WHERE status IN ('paid','partial') AND MONTH(updated_at)=MONTH(NOW()) AND YEAR(updated_at)=YEAR(NOW())`).then(([[r]]) => r),
      db.query(`SELECT COUNT(*) AS c FROM form_submissions WHERE created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)`).then(([[r]]) => r),
      db.query(`SELECT COUNT(*) AS c FROM email_campaigns WHERE status = 'active'`).then(([[r]]) => r),
      db.query(`SELECT COUNT(*) AS c FROM website_pages WHERE status = 'published'`).then(([[r]]) => r),
      db.query(`SELECT COUNT(*) AS c FROM blog_posts WHERE status = 'published'`).then(([[r]]) => r),
    ]);

    res.json({
      crm:     { contacts: Number(contacts.c), organizations: Number(orgs.c),
                 open_deals: { count: Number(openDeals.c), value: Number(openDeals.v) },
                 won_30d:    { count: Number(wonDeals.c),  value: Number(wonDeals.v)  } },
      tasks:   { open: Number(openTasks.c), overdue: Number(overdueTasks.c) },
      billing: { open_invoices: { count: Number(openInvoices.c), value: Number(openInvoices.v) },
                 revenue_mtd:   { count: Number(paidMtd.c),      value: Number(paidMtd.v)      } },
      content: { published_pages: Number(pages.c), published_posts: Number(posts.c),
                 form_submissions_7d: Number(formSubs.c), active_campaigns: Number(campaigns.c) },
    });
  } catch (err) { next(err); }
});

// Charts data — deals trend (6mo), invoice status, task status
router.get('/charts', async (req, res, next) => {
  try {
    const scopeIds = await resolveOwnerScope(req.user);
    const dealScope = ownerClause(scopeIds, 'owner_id');
    const wonWhere = dealScope ? `AND ${dealScope}` : '';

    const [dealRows, invoiceRows, taskRows] = await Promise.all([
      db.query(
        `SELECT DATE_FORMAT(won_at,'%b') AS month, DATE_FORMAT(won_at,'%Y-%m') AS mk,
                COUNT(*) AS count, COALESCE(SUM(amount),0) AS value
           FROM deals
          WHERE status='won' AND won_at >= DATE_SUB(NOW(), INTERVAL 6 MONTH) ${wonWhere}
          GROUP BY mk, month ORDER BY mk ASC`
      ).then(([r]) => r),
      db.query(
        `SELECT status, COUNT(*) AS count, COALESCE(SUM(total),0) AS value FROM invoices GROUP BY status`
      ).then(([r]) => r),
      db.query(
        `SELECT status, COUNT(*) AS count FROM tasks GROUP BY status`
      ).then(([r]) => r),
    ]);

    // Fill in any months with 0 deals
    const dealMap = {};
    dealRows.forEach(r => { dealMap[r.mk] = r; });
    const deals_trend = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - i);
      const mk = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const r  = dealMap[mk] || {};
      deals_trend.push({ month: d.toLocaleString('en-US', { month: 'short' }), count: Number(r.count || 0), value: Number(r.value || 0) });
    }

    res.json({
      deals_trend,
      invoice_status: invoiceRows.map(r => ({ status: r.status, count: Number(r.count), value: Number(r.value) })),
      task_status:    taskRows.map(r => ({ status: r.status, count: Number(r.count) })),
    });
  } catch (err) { next(err); }
});

// Pipeline health — count & value per stage
router.get('/pipeline', async (req, res, next) => {
  try {
    const pid = req.query.pipeline_id;
    const where = pid ? 'AND d.pipeline_id = :pid' : '';
    const [rows] = await db.query(
      `SELECT s.id AS stage_id, s.name AS stage_name, s.stage_type,
              COUNT(d.id) AS deal_count,
              COALESCE(SUM(d.amount),0) AS total_value,
              COALESCE(SUM(d.amount * s.win_probability / 100),0) AS weighted_value
         FROM stages s
         LEFT JOIN deals d ON d.stage_id = s.id AND d.status != 'lost' ${where}
        ${pid ? 'WHERE s.pipeline_id = :pid' : ''}
        GROUP BY s.id
        ORDER BY s.display_order, s.id`,
      { pid });
    res.json(rows);
  } catch (err) { next(err); }
});

// Leaderboard — deals won per owner (last 90d)
// Admins see all; managers see their scope; agents see only themselves.
router.get('/leaderboard', async (req, res, next) => {
  try {
    const scopeIds = await resolveOwnerScope(req.user);
    let userWhere = '';
    if (scopeIds !== null) {
      if (scopeIds.length === 0) return res.json([]);
      const ids = scopeIds.map((n) => parseInt(n, 10)).join(', ');
      userWhere = `WHERE u.id IN (${ids})`;
    }
    const [rows] = await db.query(
      `SELECT u.id, CONCAT_WS(' ', u.first_name, u.last_name) AS name,
              COUNT(d.id) AS wins,
              COALESCE(SUM(d.amount),0) AS total_won
         FROM users u
         LEFT JOIN deals d ON d.owner_id = u.id AND d.status = 'won'
                          AND d.won_at >= DATE_SUB(NOW(), INTERVAL 90 DAY)
        ${userWhere}
        GROUP BY u.id
        ORDER BY total_won DESC, wins DESC
        LIMIT 10`);
    res.json(rows);
  } catch (err) { next(err); }
});

// Activity per day (30d)
router.get('/activity', async (_req, res, next) => {
  try {
    const [rows] = await db.query(
      `SELECT DATE(created_at) AS day, COUNT(*) AS count
         FROM activities
        WHERE created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
        GROUP BY DATE(created_at)
        ORDER BY day`);
    res.json(rows);
  } catch (err) { next(err); }
});

// =============================================================================
// Billing Reports
// =============================================================================

// ── Sales Tax Report ──────────────────────────────────────────────────────────
// GET /api/reports/billing/tax?from=YYYY-MM-DD&to=YYYY-MM-DD&owner_id=&org_id=&format=csv
router.get('/billing/tax', async (req, res, next) => {
  try {
    const { from, to, owner_id, org_id, format } = req.query;
    const dateFrom = from || new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10);
    const dateTo   = to   || new Date().toISOString().slice(0, 10);

    // Row-level scope — sales agents only see tax data for their contacts' invoices.
    const scopeIds = await resolveOwnerScope(req.user);
    const scopeFilter = contactOwnerClause(scopeIds, 'i.contact_id');

    const conditions = [
      `i.tax_amount > 0`,
      `i.status IN ('paid','partial')`,
      `DATE(COALESCE(i.paid_at, i.updated_at)) BETWEEN :dateFrom AND :dateTo`,
    ];
    if (scopeFilter) conditions.push(scopeFilter);
    const params = { dateFrom, dateTo };

    if (owner_id) { conditions.push('i.owner_id = :owner_id'); params.owner_id = Number(owner_id); }
    if (org_id)   { conditions.push('i.organization_id = :org_id'); params.org_id = Number(org_id); }

    const [rows] = await db.query(
      `SELECT
          i.id,
          i.invoice_number,
          DATE(COALESCE(i.paid_at, i.updated_at)) AS paid_date,
          COALESCE(CONCAT_WS(' ', c.first_name, c.last_name), '') AS contact_name,
          COALESCE(o.name, '')                                      AS org_name,
          COALESCE(CONCAT_WS(' ', u.first_name, u.last_name), '')  AS owner_name,
          i.subtotal,
          i.tax_rate,
          i.tax_amount,
          i.total,
          i.amount_paid,
          i.tax_exempt,
          ROUND(
            i.tax_amount * LEAST(i.amount_paid, i.total) / NULLIF(i.total, 0),
            2
          ) AS tax_collected
       FROM invoices i
       LEFT JOIN contacts      c ON c.id = i.contact_id
       LEFT JOIN organizations o ON o.id = i.organization_id
       LEFT JOIN users         u ON u.id = i.owner_id
       WHERE ${conditions.join(' AND ')}
       ORDER BY paid_date DESC, i.id DESC`,
      params
    );

    if (format === 'csv') {
      const headers = ['Invoice #','Paid Date','Contact','Organization','Owner','Subtotal','Tax Rate %','Tax Billed','Total','Amount Paid','Tax Collected'];
      const lines = [
        headers.join(','),
        ...rows.map((r) => [
          r.invoice_number,
          r.paid_date,
          `"${(r.contact_name || '').replace(/"/g, '""')}"`,
          `"${(r.org_name     || '').replace(/"/g, '""')}"`,
          `"${(r.owner_name   || '').replace(/"/g, '""')}"`,
          Number(r.subtotal).toFixed(2),
          Number(r.tax_rate).toFixed(3),
          Number(r.tax_amount).toFixed(2),
          Number(r.total).toFixed(2),
          Number(r.amount_paid).toFixed(2),
          Number(r.tax_collected || 0).toFixed(2),
        ].join(',')),
      ];
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="sales-tax-${dateFrom}-${dateTo}.csv"`);
      return res.send(lines.join('\r\n'));
    }

    const totals = rows.reduce((acc, r) => {
      acc.tax_billed    += Number(r.tax_amount     || 0);
      acc.tax_collected += Number(r.tax_collected  || 0);
      acc.amount_paid   += Number(r.amount_paid    || 0);
      return acc;
    }, { tax_billed: 0, tax_collected: 0, amount_paid: 0 });

    res.json({ rows, totals, date_from: dateFrom, date_to: dateTo });
  } catch (err) { next(err); }
});

// ── Batch Reconciliation Report ───────────────────────────────────────────────
// GET /api/reports/billing/reconciliation?limit=50
router.get('/billing/reconciliation', async (req, res, next) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 25, 100);

    const [runs] = await db.query(
      `SELECT r.id, r.gateway, r.mode, r.trigger_kind,
              CONCAT_WS(' ', u.first_name, u.last_name) AS triggered_by_name,
              r.window_start, r.window_end, r.status,
              r.batches_seen, r.txns_seen, r.txns_matched, r.txns_unmatched,
              r.error_message, r.started_at, r.finished_at
         FROM payment_batch_runs r
         LEFT JOIN users u ON u.id = r.triggered_by
         ORDER BY r.started_at DESC
         LIMIT :limit`,
      { limit }
    );

    const [mismatches] = await db.query(
      `SELECT m.id, m.batch_date, m.gateway, m.gateway_txn_id, m.gateway_amount,
              m.local_payment_id, m.local_amount, m.mismatch_type,
              m.notes, m.resolved, m.resolved_at, m.created_at,
              p.invoice_id, i.invoice_number
         FROM payment_batch_mismatches m
         LEFT JOIN payments p ON p.id = m.local_payment_id
         LEFT JOIN invoices i ON i.id = p.invoice_id
         ORDER BY m.batch_date DESC, m.id DESC
         LIMIT 200`
    );

    res.json({ runs, mismatches });
  } catch (err) { next(err); }
});

// GET /api/reports/billing/reconciliation/runs/:id/transactions
router.get('/billing/reconciliation/runs/:id/transactions', async (req, res, next) => {
  try {
    const runId = Number(req.params.id);
    const [[run]] = await db.query(
      `SELECT gateway, mode, window_start, window_end FROM payment_batch_runs WHERE id = :runId`,
      { runId }
    );
    if (!run) return res.status(404).json({ error: 'Run not found' });

    // Scope — sales agents only see transactions for their contacts.
    const scopeIds = await resolveOwnerScope(req.user);
    const scopeFilter = contactOwnerClause(scopeIds, 'i.contact_id');

    const extraWhere = scopeFilter ? `AND ${scopeFilter}` : '';

    const [rows] = await db.query(
      `SELECT
          p.id,
          p.invoice_id,
          i.invoice_number,
          p.amount,
          p.fee_amount,
          p.method,
          COALESCE(p.card_brand, '') AS card_brand,
          p.card_last4,
          p.card_holder_name,
          p.card_funding,
          p.status,
          p.external_txn_id,
          p.external_auth_code,
          p.batch_id,
          p.settled_at,
          p.received_at,
          p.created_at,
          COALESCE(CONCAT_WS(' ', c.first_name, c.last_name), '') AS contact_name,
          COALESCE(o.name, '')                                      AS org_name
       FROM payments p
       LEFT JOIN invoices      i ON i.id = p.invoice_id
       LEFT JOIN contacts      c ON c.id = i.contact_id
       LEFT JOIN organizations o ON o.id = i.organization_id
       WHERE p.gateway = :gateway
         AND p.status IN ('captured', 'authorized')
         AND COALESCE(p.settled_at, p.received_at, p.created_at)
             BETWEEN :window_start AND :window_end
         ${extraWhere}
       ORDER BY COALESCE(p.settled_at, p.received_at, p.created_at) DESC`,
      { gateway: run.gateway, window_start: run.window_start, window_end: run.window_end }
    );

    res.json({ run, rows });
  } catch (err) { next(err); }
});

// PATCH /api/reports/billing/reconciliation/mismatches/:id/resolve
router.patch('/billing/reconciliation/mismatches/:id/resolve', requirePermission('payments.write'), async (req, res, next) => {
  try {
    const { id } = req.params;
    const { resolved, notes } = req.body;
    await db.query(
      `UPDATE payment_batch_mismatches
          SET resolved = :resolved, resolved_at = IF(:resolved, NOW(), NULL), notes = COALESCE(:notes, notes)
        WHERE id = :id`,
      { resolved: resolved ? 1 : 0, notes: notes || null, id: Number(id) }
    );
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// =============================================================================
// Donor Reports
// =============================================================================

// ── Donor Retention Report ────────────────────────────────────────────────────
// GET /api/reports/donors/retention?year=YYYY&format=csv&list=lybunt|sybunt
//
// A "gift" here is either a fund-linked donation (the `donations` table) or a
// membership-dues payment that never produced a `donations` row (recurring
// fund subscriptions already tag one per cycle — see billing-cron.js's
// tagInvoicePaymentAsDonation — so excluding those here avoids double
// counting). Gift date follows the app-wide convention: `donations.created_at`
// for donation rows (matches reportRegistry.js/receipts.js), and the payment's
// own captured date for membership-only rows.
router.get('/donors/retention', async (req, res, next) => {
  try {
    const year = Number(req.query.year) || new Date().getFullYear();
    const priorYear = year - 1;
    const { format, list } = req.query;

    const [giftRows] = await db.query(
      `SELECT donor_type, donor_id, YEAR(gift_date) AS gift_year,
              SUM(amount) AS total, COUNT(*) AS cnt, MAX(gift_date) AS last_gift_date
         FROM (
           SELECT 'contact' AS donor_type, d.contact_id AS donor_id, d.created_at AS gift_date, p.amount AS amount
             FROM donations d JOIN payments p ON p.id = d.payment_id
            WHERE p.status = 'captured' AND d.contact_id IS NOT NULL
           UNION ALL
           SELECT 'organization', d.organization_id, d.created_at, p.amount
             FROM donations d JOIN payments p ON p.id = d.payment_id
            WHERE p.status = 'captured' AND d.organization_id IS NOT NULL
           UNION ALL
           SELECT 'contact', i.contact_id, COALESCE(p.received_at, p.created_at), p.amount
             FROM payments p
             JOIN invoices i ON i.id = p.invoice_id
             JOIN subscriptions s ON s.id = i.subscription_id
            WHERE p.status = 'captured' AND s.membership_tier_id IS NOT NULL
              AND i.contact_id IS NOT NULL
              AND NOT EXISTS (SELECT 1 FROM donations d2 WHERE d2.payment_id = p.id)
           UNION ALL
           SELECT 'organization', i.organization_id, COALESCE(p.received_at, p.created_at), p.amount
             FROM payments p
             JOIN invoices i ON i.id = p.invoice_id
             JOIN subscriptions s ON s.id = i.subscription_id
            WHERE p.status = 'captured' AND s.membership_tier_id IS NOT NULL
              AND i.organization_id IS NOT NULL
              AND NOT EXISTS (SELECT 1 FROM donations d2 WHERE d2.payment_id = p.id)
         ) gifts
        GROUP BY donor_type, donor_id, gift_year`
    );

    // donor_key -> { donor_type, donor_id, firstYear, years: Map<year, {total, cnt, lastDate}> }
    const donors = new Map();
    for (const r of giftRows) {
      const key = `${r.donor_type}:${r.donor_id}`;
      if (!donors.has(key)) {
        donors.set(key, { donor_type: r.donor_type, donor_id: r.donor_id, firstYear: r.gift_year, years: new Map() });
      }
      const donor = donors.get(key);
      if (r.gift_year < donor.firstYear) donor.firstYear = r.gift_year;
      donor.years.set(r.gift_year, { total: Number(r.total), cnt: Number(r.cnt), lastDate: r.last_gift_date });
    }

    const currentYearKeys = new Set();
    const priorYearKeys = new Set();
    const sybuntKeys = new Set();
    for (const [key, donor] of donors) {
      if (donor.years.has(year)) currentYearKeys.add(key);
      if (donor.years.has(priorYear)) priorYearKeys.add(key);
    }
    for (const [key, donor] of donors) {
      if (currentYearKeys.has(key) || priorYearKeys.has(key)) continue;
      const gaveEarlier = [...donor.years.keys()].some((y) => y <= priorYear - 1);
      if (gaveEarlier) sybuntKeys.add(key);
    }
    const lybuntKeys = new Set([...priorYearKeys].filter((k) => !currentYearKeys.has(k)));

    let newDonorCount = 0;
    let returningDonorCount = 0;
    for (const key of currentYearKeys) {
      const donor = donors.get(key);
      if (donor.firstYear === year) newDonorCount++;
      else returningDonorCount++;
    }

    const retentionRate = priorYearKeys.size
      ? ([...priorYearKeys].filter((k) => currentYearKeys.has(k)).length / priorYearKeys.size) * 100
      : 0;

    const trend = [];
    for (let y = year - 4; y <= year; y++) {
      let total = 0, cnt = 0, donorCount = 0;
      for (const donor of donors.values()) {
        const yr = donor.years.get(y);
        if (yr) { total += yr.total; cnt += yr.cnt; donorCount++; }
      }
      trend.push({ year: y, total_amount: total, gift_count: cnt, donor_count: donorCount, avg_gift: cnt ? total / cnt : 0 });
    }

    async function resolveDonorList(keys) {
      const contactIds = [];
      const orgIds = [];
      for (const key of keys) {
        const donor = donors.get(key);
        if (donor.donor_type === 'contact') contactIds.push(donor.donor_id);
        else orgIds.push(donor.donor_id);
      }
      const [contactRows, orgRows] = await Promise.all([
        contactIds.length
          ? db.query(`SELECT id, CONCAT_WS(' ', first_name, last_name) AS name FROM contacts WHERE id IN (:ids)`, { ids: contactIds }).then(([r]) => r)
          : [],
        orgIds.length
          ? db.query(`SELECT id, name FROM organizations WHERE id IN (:ids)`, { ids: orgIds }).then(([r]) => r)
          : [],
      ]);
      const contactNames = new Map(contactRows.map((r) => [r.id, r.name]));
      const orgNames = new Map(orgRows.map((r) => [r.id, r.name]));

      return [...keys].map((key) => {
        const donor = donors.get(key);
        const name = donor.donor_type === 'contact' ? contactNames.get(donor.donor_id) : orgNames.get(donor.donor_id);
        let lifetimeTotal = 0, lastGiftDate = null;
        for (const yr of donor.years.values()) {
          lifetimeTotal += yr.total;
          if (!lastGiftDate || yr.lastDate > lastGiftDate) lastGiftDate = yr.lastDate;
        }
        return {
          donor_type: donor.donor_type,
          donor_id: donor.donor_id,
          name: name || '(deleted)',
          last_gift_date: lastGiftDate,
          lifetime_total: lifetimeTotal,
        };
      }).sort((a, b) => (b.last_gift_date || '').localeCompare(a.last_gift_date || ''));
    }

    const [lybunt, sybunt] = await Promise.all([resolveDonorList(lybuntKeys), resolveDonorList(sybuntKeys)]);

    if (format === 'csv') {
      const chosen = list === 'sybunt' ? sybunt : lybunt;
      const listName = list === 'sybunt' ? 'sybunt' : 'lybunt';
      const headers = ['Donor', 'Type', 'Last Gift Date', 'Lifetime Total'];
      const lines = [
        headers.join(','),
        ...chosen.map((r) => [
          `"${(r.name || '').replace(/"/g, '""')}"`,
          r.donor_type,
          r.last_gift_date ? new Date(r.last_gift_date).toISOString().slice(0, 10) : '',
          Number(r.lifetime_total).toFixed(2),
        ].join(',')),
      ];
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="donor-retention-${listName}-${year}.csv"`);
      return res.send(lines.join('\r\n'));
    }

    res.json({
      year,
      summary: {
        retention_rate: retentionRate,
        current_year_donor_count: currentYearKeys.size,
        prior_year_donor_count: priorYearKeys.size,
        new_donor_count: newDonorCount,
        returning_donor_count: returningDonorCount,
        lybunt_count: lybunt.length,
        sybunt_count: sybunt.length,
      },
      trend,
      lybunt,
      sybunt,
    });
  } catch (err) { next(err); }
});

module.exports = router;
