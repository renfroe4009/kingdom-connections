// =============================================================================
// /api/portal — customer-facing endpoints (role "portal" only)
// -----------------------------------------------------------------------------
// All endpoints require requireAuth and that the logged-in user has the
// 'portal' role. Data is scoped by user.contact_id / user.organization binding.
// =============================================================================
const router = require('express').Router();
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const { z } = require('zod');
const { db } = require('../db');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { sendMail } = require('../services/mailer');
const { renderBySlug } = require('../services/templates');
const { tagInvoicePaymentAsDonation } = require('../services/constituents');
const { maybeSendReceiptEmail } = require('../services/receipts');
const { passwordSchema, hashPassword, isPasswordBreached, BCRYPT_COST } = require('../services/passwordPolicy');

// Require the user to be in the 'portal' role (in addition to an admin bypass)
function requirePortal(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Unauthenticated' });
  if (req.user.roles?.includes('admin')) return next();
  if (req.user.roles?.includes('portal')) return next();
  return res.status(403).json({ error: 'Portal access required' });
}

async function getScope(user) {
  // Portal users see invoices where (contact_id = their contact) or (organization_id = their org)
  const [[row]] = await db.query(
    `SELECT u.contact_id, c.organization_id
       FROM users u LEFT JOIN contacts c ON c.id = u.contact_id
      WHERE u.id = :id`, { id: user.id });
  return { contact_id: row?.contact_id || null, organization_id: row?.organization_id || null };
}

// ---------- /api/portal/admin (internal users managing portal accounts) ----------

router.get('/admin/users', requireAuth, requirePermission('portal.manage'), async (_req, res, next) => {
  try {
    const [rows] = await db.query(
      `SELECT u.id, u.email, u.first_name, u.last_name, u.is_active, u.contact_id, u.last_login_at,
              CONCAT_WS(' ', c.first_name, c.last_name) AS linked_contact_name,
              o.name AS organization_name
         FROM users u
         JOIN user_roles ur ON ur.user_id = u.id
         JOIN roles r       ON r.id = ur.role_id
         LEFT JOIN contacts c      ON c.id = u.contact_id
         LEFT JOIN organizations o ON o.id = c.organization_id
        WHERE r.name = 'portal'
        ORDER BY u.created_at DESC`);
    res.json({ rows });
  } catch (err) { next(err); }
});

const createPortalSchema = z.object({
  contact_id: z.number().int(),
  send_invite: z.boolean().optional(),
});
router.post('/admin/users', requireAuth, requirePermission('portal.manage'), async (req, res, next) => {
  try {
    const d = createPortalSchema.parse(req.body);
    const [[contact]] = await db.query(
      'SELECT id, email, first_name, last_name FROM contacts WHERE id = :id', { id: d.contact_id });
    if (!contact) return res.status(404).json({ error: 'Contact not found' });
    if (!contact.email) return res.status(400).json({ error: 'Contact has no email address' });

    // Does a user already exist for this email?
    const [[existing]] = await db.query('SELECT id FROM users WHERE email = :e', { e: contact.email });

    const tempPassword = crypto.randomBytes(12).toString('base64url');
    // Security remediation M-04 — standardized bcrypt cost (this is a
    // random, high-entropy system-generated password, not user-chosen, so
    // no length/breach check applies — only the hash cost needed bumping).
    const password_hash = await bcrypt.hash(tempPassword, BCRYPT_COST);

    let userId;
    if (existing) {
      userId = existing.id;
      await db.query(
        `UPDATE users SET contact_id = :cid, is_active = 1 WHERE id = :id`,
        { cid: contact.id, id: userId });
    } else {
      const [ins] = await db.query(
        `INSERT INTO users (email, password_hash, first_name, last_name, contact_id, is_active)
         VALUES (:e, :p, :f, :l, :cid, 1)`,
        {
          e: contact.email,
          p: password_hash,
          f: contact.first_name,
          l: contact.last_name,
          cid: contact.id,
        });
      userId = ins.insertId;
    }
    // Assign portal role
    await db.query(
      `INSERT IGNORE INTO user_roles (user_id, role_id)
       VALUES (:uid, (SELECT id FROM roles WHERE name='portal'))`,
      { uid: userId });

    // Optionally email the invite
    if (d.send_invite) {
      const origin = (process.env.CLIENT_ORIGIN || 'http://localhost:5173').split(',')[0].trim();
      const loginUrl = `${origin}/portal/login`;
      let subject = 'Your customer portal access';
      let html =
`<p>Hi ${contact.first_name || ''},</p>
<p>Your customer portal is ready.<br>
Sign in here: <a href="${loginUrl}">${loginUrl}</a><br>
Email: ${contact.email}<br>
Password: ${tempPassword}</p>
<p>Please change your password after signing in.</p>`;
      try {
        const rendered = await renderBySlug('donor_portal_welcome', { contact_id: contact.id },
          { portal: { login_url: loginUrl, temp_password: tempPassword } });
        if (rendered) {
          subject = rendered.subject;
          html = rendered.html;
        }
      } catch (_e) { /* use fallback above */ }
      try {
        await sendMail({
          to: contact.email, subject, html,
          text: `Your customer portal is ready. Sign in: ${loginUrl}\nEmail: ${contact.email}\nPassword: ${tempPassword}`,
        });
      } catch (_e) { /* ignore — show password in response so admin can share */ }
    }

    // Do NOT return temp_password in the response body — it would be captured
    // by reverse-proxy access logs and API response logging (Finding 10).
    // The password is delivered only via the invite email.
    res.status(201).json({ id: userId, invited: !!d.send_invite });
  } catch (err) { next(err); }
});

router.delete('/admin/users/:id', requireAuth, requirePermission('portal.manage'), async (req, res, next) => {
  try {
    await db.query(
      `DELETE ur FROM user_roles ur
         JOIN roles r ON r.id = ur.role_id
        WHERE ur.user_id = :id AND r.name = 'portal'`,
      { id: req.params.id });
    await db.query('UPDATE users SET is_active = 0 WHERE id = :id', { id: req.params.id });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ---------- Public self-registration (no auth) ----------
// Lets a donor/supporter create their own portal account instead of waiting
// for a staff-sent invite. Mirrors the admin-invite flow above (same
// users/user_roles shape) but the account starts inactive until the donor
// clicks the emailed verification link, and matches/creates a contact by
// email the same way donations.js's upsertDonorContact does.

const registerLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many signup attempts. Please wait 15 minutes and try again.' },
  keyGenerator: (req, res) => ipKeyGenerator(req, res),
});

const registerSchema = z.object({
  email:      z.string().email(),
  // Security remediation M-04 — shared passwordSchema.
  password:   passwordSchema,
  first_name: z.string().min(1),
  last_name:  z.string().min(1),
  phone:      z.string().optional().nullable(),
});

router.post('/register', registerLimiter, async (req, res, next) => {
  try {
    const d = registerSchema.parse(req.body);
    const email = d.email.toLowerCase().trim();

    const [[existingUser]] = await db.query('SELECT id FROM users WHERE email = :e', { e: email });
    if (existingUser) {
      return res.status(409).json({ error: 'An account with this email already exists. Try signing in, or use "Forgot password".' });
    }

    // Match an existing contact by email (e.g. a past donor) or create a new one.
    let contactId;
    const [[contact]] = await db.query('SELECT id FROM contacts WHERE email = :e LIMIT 1', { e: email });
    if (contact) {
      contactId = contact.id;
    } else {
      const [ins] = await db.query(
        `INSERT INTO contacts (first_name, last_name, email, phone, lead_source)
         VALUES (:f, :l, :e, :p, 'portal_signup')`,
        { f: d.first_name, l: d.last_name, e: email, p: d.phone || null }
      );
      contactId = ins.insertId;
    }

    const breach = await isPasswordBreached(d.password);
    if (breach.breached) {
      return res.status(400).json({ error: 'This password has appeared in a known data breach. Please choose a different one.' });
    }
    const password_hash = await hashPassword(d.password);
    const rawToken  = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const expires   = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24h to verify

    const [ins] = await db.query(
      `INSERT INTO users
         (email, password_hash, first_name, last_name, contact_id, is_active,
          email_verify_token, email_verify_expires_at)
       VALUES (:e, :p, :f, :l, :cid, 0, :tok, :exp)`,
      {
        e: email, p: password_hash, f: d.first_name, l: d.last_name, cid: contactId,
        tok: tokenHash, exp: expires.toISOString().slice(0, 19).replace('T', ' '),
      }
    );
    const userId = ins.insertId;

    await db.query(
      `INSERT IGNORE INTO user_roles (user_id, role_id)
       VALUES (:uid, (SELECT id FROM roles WHERE name='portal'))`,
      { uid: userId }
    );

    const origin = (process.env.CLIENT_ORIGIN || 'http://localhost:5173').split(',')[0].trim();
    const verifyUrl = `${origin}/portal/verify-email?token=${rawToken}`;
    let subject = 'Verify your account';
    let html = `<p>Hi ${d.first_name},</p><p>Confirm your email to finish setting up your account: <a href="${verifyUrl}">${verifyUrl}</a></p><p>This link expires in 24 hours.</p>`;
    try {
      const rendered = await renderBySlug('donor_portal_verify_email', { contact_id: contactId },
        { portal: { verify_url: verifyUrl } });
      if (rendered) {
        subject = rendered.subject;
        html = rendered.html;
      }
    } catch (_e) { /* use fallback above */ }
    try {
      await sendMail({
        to: email, subject, html,
        text: `Confirm your email to finish setting up your account: ${verifyUrl}\n\nThis link expires in 24 hours.`,
      });
    } catch (_e) { /* non-fatal — user can request a fresh link later once that flow exists */ }

    res.status(201).json({ ok: true });
  } catch (err) { next(err); }
});

router.post('/verify-email', async (req, res, next) => {
  try {
    const token = String(req.body?.token || '');
    if (!token) return res.status(400).json({ error: 'Missing token' });
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    const [[user]] = await db.query(
      `SELECT id FROM users
        WHERE email_verify_token = :hash
          AND email_verify_expires_at > NOW()
        LIMIT 1`,
      { hash: tokenHash }
    );
    if (!user) return res.status(400).json({ error: 'Verification link is invalid or has expired.' });

    await db.query(
      `UPDATE users
          SET is_active = 1,
              email_verified_at = NOW(),
              email_verify_token = NULL,
              email_verify_expires_at = NULL
        WHERE id = :id`,
      { id: user.id }
    );

    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ---------- Portal-side endpoints ----------
router.use(requireAuth, requirePortal);

router.get('/me', async (req, res, next) => {
  try {
    const scope = await getScope(req.user);
    // Explicit column lists — avoid SELECT * which would expose internal flags
    // and future columns to portal (customer) users (Finding 18).
    const [[contact]] = scope.contact_id
      ? await db.query(
          `SELECT id, first_name, last_name, email, phone, mobile,
                  address_line1, address_line2, city, state, postal_code, country
             FROM contacts WHERE id = :id`,
          { id: scope.contact_id })
      : [[]];
    const [[org]] = scope.organization_id
      ? await db.query(
          `SELECT id, name, website, phone,
                  address_line1, address_line2, city, state, postal_code, country
             FROM organizations WHERE id = :id`,
          { id: scope.organization_id })
      : [[]];
    res.json({ user: req.user, contact, organization: org });
  } catch (err) { next(err); }
});

router.put('/me/profile', async (req, res, next) => {
  try {
    const scope = await getScope(req.user);
    if (!scope.contact_id) return res.status(400).json({ error: 'No contact linked to user' });
    const d = z.object({
      first_name: z.string().optional(),
      last_name:  z.string().optional(),
      phone:      z.string().optional(),
      mobile:     z.string().optional(),
      address_line1: z.string().optional(),
      address_line2: z.string().optional(),
      city: z.string().optional(),
      state: z.string().optional(),
      postal_code: z.string().optional(),
      country: z.string().optional(),
    }).parse(req.body);
    const keys = Object.keys(d);
    if (keys.length) {
      const set = keys.map((k) => `${k} = :${k}`).join(', ');
      await db.query(`UPDATE contacts SET ${set} WHERE id = :id`, { ...d, id: scope.contact_id });
    }
    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.get('/invoices', async (req, res, next) => {
  try {
    const scope = await getScope(req.user);
    const conds = []; const params = {};
    if (scope.contact_id)       { conds.push('i.contact_id = :cid');      params.cid = scope.contact_id; }
    if (scope.organization_id)  { conds.push('i.organization_id = :oid'); params.oid = scope.organization_id; }
    if (!conds.length) return res.json({ rows: [] });
    const [rows] = await db.query(
      `SELECT i.id, i.invoice_number, i.issue_date, i.due_date, i.total, i.balance_due, i.status
         FROM invoices i
        WHERE (${conds.join(' OR ')}) AND i.status != 'draft'
        ORDER BY i.issue_date DESC`, params);
    res.json({ rows });
  } catch (err) { next(err); }
});

router.get('/invoices/:id', async (req, res, next) => {
  try {
    const scope = await getScope(req.user);
    const [[inv]] = await db.query(
      `SELECT * FROM invoices
        WHERE id = :id AND status != 'draft'
          AND (contact_id = :cid OR organization_id = :oid)`,
      { id: req.params.id, cid: scope.contact_id, oid: scope.organization_id });
    if (!inv) return res.status(404).json({ error: 'Not found' });
    const [lines] = await db.query(
      'SELECT * FROM invoice_line_items WHERE invoice_id = :id ORDER BY sort_order, id', { id: inv.id });
    const [payments] = await db.query(
      'SELECT id, amount, method, status, received_at FROM payments WHERE invoice_id = :id ORDER BY created_at DESC', { id: inv.id });
    res.json({ invoice: inv, line_items: lines, payments });
  } catch (err) { next(err); }
});

router.get('/donations', async (req, res, next) => {
  try {
    const scope = await getScope(req.user);
    const conds = []; const params = {};
    if (scope.contact_id)      { conds.push('d.contact_id = :cid');      params.cid = scope.contact_id; }
    if (scope.organization_id) { conds.push('d.organization_id = :oid'); params.oid = scope.organization_id; }
    if (!conds.length) return res.json({ rows: [] });
    const [rows] = await db.query(
      `SELECT d.id, d.created_at, d.is_anonymous, d.dedication_note,
              f.name AS fund_name,
              p.amount, p.currency, p.status AS payment_status, p.receipt_token,
              i.invoice_number
         FROM donations d
         JOIN payments p ON p.id = d.payment_id
         JOIN invoices i ON i.id = d.invoice_id
         LEFT JOIN funds f ON f.id = d.fund_id
        WHERE (${conds.join(' OR ')}) AND p.status IN ('captured','authorized')
        ORDER BY d.created_at DESC`, params);
    const total = rows.reduce((a, r) => a + Number(r.amount || 0), 0);
    res.json({ rows, total });
  } catch (err) { next(err); }
});

// Self-service year-end giving statement — only for the logged-in donor's
// own contact_id (households/orgs use the admin-side statement instead,
// since "which contact's statement" isn't well-defined for a shared org).
router.get('/donations/statement/:year', async (req, res, next) => {
  try {
    const scope = await getScope(req.user);
    if (!scope.contact_id) return res.status(404).json({ error: 'No giving history on this account' });
    const { loadYearEndStatementData, renderYearEndStatementPdf } = require('../services/receipts');
    const data = await loadYearEndStatementData(scope.contact_id, Number(req.params.year));
    if (!data || !data.gifts.length) return res.status(404).json({ error: 'No gifts found for that year' });
    const pdf = await renderYearEndStatementPdf(data);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="giving-statement-${req.params.year}.pdf"`);
    res.send(pdf);
  } catch (err) { next(err); }
});

// POST /api/portal/donations/checkout — same synthetic invoice donations.js's
// public /public/checkout builds, except contact/org comes from the logged-in
// donor's own scope (getScope) rather than a donor-supplied email — no
// upsertDonorContact, no chance this ever links to the wrong contact or spins
// up a duplicate. Returns the same shape the public route does so the
// frontend can point the same <DonationCheckout> at either one.
router.post('/donations/checkout', async (req, res, next) => {
  try {
    const scope = await getScope(req.user);
    if (!scope.contact_id && !scope.organization_id) {
      return res.status(400).json({ error: 'No contact linked to this account' });
    }

    const { roundMoney, nextInvoiceNumber, estimateCoverFeeAmount } = require('./donations');
    const { getDefaultGateway } = require('../services/gateways');

    const body = req.body || {};
    const amount = Number(body.amount);
    if (!amount || amount <= 0) return res.status(400).json({ error: 'Invalid donation amount' });

    const fundSlug = String(body.fund_slug || '').trim();
    let fund = null;
    if (fundSlug) {
      const [[f]] = await db.query('SELECT id, name FROM funds WHERE slug = :slug AND is_active = 1', { slug: fundSlug });
      if (!f) return res.status(400).json({ error: 'Unknown or inactive fund' });
      fund = f;
    }

    const coverFees = Boolean(body.cover_fees);
    const feeAmount = coverFees ? await estimateCoverFeeAmount(amount) : 0;
    const feeLabel = feeAmount > 0 ? (await getDefaultGateway())?.fee_label || 'Processing Fee' : null;
    const total = roundMoney(amount + feeAmount);

    const paymentToken = crypto.randomBytes(32).toString('hex');
    const number = await nextInvoiceNumber();
    const today = new Date().toISOString().slice(0, 10);
    const memo = fund ? `Donation to ${fund.name}` : 'Donation';

    const [ins] = await db.query(
      `INSERT INTO invoices
         (payment_token, invoice_number, contact_id, organization_id, issue_date, due_date, currency,
          subtotal, tax_rate, tax_amount, discount_rate, discount_amount, total,
          amount_paid, balance_due, status, memo, processing_fee, fee_label)
       VALUES
         (:payment_token, :invoice_number, :contact_id, :organization_id, :issue_date, :due_date, 'USD',
          :subtotal, 0, 0, 0, 0, :total,
          0, :total, 'sent', :memo, :feeAmount, :feeLabel)`,
      {
        payment_token: paymentToken, invoice_number: number,
        contact_id: scope.contact_id, organization_id: scope.organization_id,
        issue_date: today, due_date: today, subtotal: amount, total, memo,
        feeAmount, feeLabel,
      }
    );
    const invoiceId = ins.insertId;

    await db.query(
      `INSERT INTO invoice_line_items (invoice_id, description, quantity, unit_price, amount, sort_order)
       VALUES (:invoice_id, :desc, 1, :amount, :amount, 0)`,
      { invoice_id: invoiceId, desc: memo, amount }
    );
    if (feeAmount > 0) {
      await db.query(
        `INSERT INTO invoice_line_items (invoice_id, description, quantity, unit_price, amount, sort_order)
         VALUES (:invoice_id, 'Optional: help cover processing fees', 1, :amount, :amount, 1)`,
        { invoice_id: invoiceId, amount: feeAmount }
      );
    }

    // payment_token proves to /public/finalize below that the caller is the
    // one this checkout was actually handed to (security remediation H-04).
    res.status(201).json({ invoiceId, total, feeAmount, contactId: scope.contact_id, payment_token: paymentToken });
  } catch (err) { next(err); }
});

// My Membership — active/past membership subscriptions for the logged-in
// donor, with tier details joined in (plain /subscriptions below shows the
// generic billing list; this is the nicer donor-facing view).
router.get('/membership', async (req, res, next) => {
  try {
    const scope = await getScope(req.user);
    const conds = []; const params = {};
    if (scope.contact_id)      { conds.push('s.contact_id = :cid');      params.cid = scope.contact_id; }
    if (scope.organization_id) { conds.push('s.organization_id = :oid'); params.oid = scope.organization_id; }
    if (!conds.length) return res.json({ rows: [] });
    const [rows] = await db.query(
      `SELECT s.id AS subscription_id, s.status, s.next_run_date, s.start_date, s.end_date, s.auto_charge,
              s.interval_unit, s.interval_count,
              t.name AS tier_name, t.description, t.price, t.benefits_json
         FROM subscriptions s
         JOIN membership_tiers t ON t.id = s.membership_tier_id
        WHERE (${conds.join(' OR ')})
        ORDER BY s.status = 'active' DESC, s.created_at DESC`, params);
    res.json({ rows });
  } catch (err) { next(err); }
});

router.get('/event-registrations', async (req, res, next) => {
  try {
    const scope = await getScope(req.user);
    const conds = []; const params = {};
    if (scope.contact_id)      { conds.push('r.contact_id = :cid');      params.cid = scope.contact_id; }
    if (scope.organization_id) { conds.push('r.organization_id = :oid'); params.oid = scope.organization_id; }
    if (!conds.length) return res.json({ rows: [] });
    const [rows] = await db.query(
      `SELECT r.id, r.quantity, r.status, r.created_at,
              e.name AS event_name, e.start_at, e.location,
              t.name AS ticket_name, t.price
         FROM event_registrations r
         JOIN events e ON e.id = r.event_id
         JOIN event_ticket_types t ON t.id = r.ticket_type_id
        WHERE (${conds.join(' OR ')})
        ORDER BY e.start_at DESC`, params);
    res.json({ rows });
  } catch (err) { next(err); }
});

// My Orders — shop purchase history. orders has no organization_id column,
// so org-scoped portal users (a shared org login) see orders placed by any
// contact under their org, same as the admin-side organization timeline.
router.get('/orders', async (req, res, next) => {
  try {
    const scope = await getScope(req.user);
    const conds = []; const params = {};
    if (scope.contact_id)      { conds.push('o.contact_id = :cid'); params.cid = scope.contact_id; }
    if (scope.organization_id) { conds.push('o.contact_id IN (SELECT id FROM contacts WHERE organization_id = :oid)'); params.oid = scope.organization_id; }
    if (!conds.length) return res.json({ rows: [] });
    const [rows] = await db.query(
      `SELECT o.id, o.order_number, o.created_at, o.status, o.payment_status,
              o.subtotal, o.shipping_total, o.tax_total, o.total, o.tracking_number
         FROM orders o
        WHERE (${conds.join(' OR ')})
        ORDER BY o.created_at DESC`, params);
    res.json({ rows });
  } catch (err) { next(err); }
});

router.get('/orders/:id', async (req, res, next) => {
  try {
    const scope = await getScope(req.user);
    const [[order]] = await db.query('SELECT * FROM orders WHERE id = :id', { id: req.params.id });
    if (!order) return res.status(404).json({ error: 'Order not found' });
    const owns = (scope.contact_id && order.contact_id === scope.contact_id);
    if (!owns) {
      const [[inOrg]] = await db.query(
        'SELECT 1 FROM contacts WHERE id = :cid AND organization_id = :oid',
        { cid: order.contact_id, oid: scope.organization_id }
      );
      if (!inOrg) return res.status(403).json({ error: 'Forbidden' });
    }
    const [items] = await db.query('SELECT * FROM order_items WHERE order_id = :id', { id: req.params.id });
    res.json({ order, items });
  } catch (err) { next(err); }
});

router.get('/subscriptions', async (req, res, next) => {
  try {
    const scope = await getScope(req.user);
    const conds = []; const params = {};
    if (scope.contact_id)      { conds.push('s.contact_id = :cid');      params.cid = scope.contact_id; }
    if (scope.organization_id) { conds.push('s.organization_id = :oid'); params.oid = scope.organization_id; }
    if (!conds.length) return res.json({ rows: [] });
    // Per-run total + payment count are computed in SQL so the portal list
    // can render an "Amount" column and a transactions badge in one round-trip.
    const [rows] = await db.query(
      `SELECT s.id, s.name, s.currency, s.interval_unit, s.interval_count,
              s.next_run_date, s.status,
              ROUND(COALESCE(it.subtotal, 0), 2) AS subtotal,
              ROUND(
                COALESCE(it.subtotal, 0)
                * (1 - (COALESCE(s.discount_rate,0)/100))
                * (1 + (COALESCE(s.tax_rate,0)/100))
              , 2) AS per_run_total,
              COALESCE(pay.payment_count, 0) AS payment_count,
              COALESCE(pay.captured_total, 0) AS captured_total
         FROM subscriptions s
         LEFT JOIN (
           SELECT subscription_id, SUM(quantity * unit_price) AS subtotal
             FROM subscription_items
            GROUP BY subscription_id
         ) it ON it.subscription_id = s.id
         LEFT JOIN (
           SELECT i.subscription_id,
                  COUNT(p.id) AS payment_count,
                  SUM(CASE WHEN p.status = 'captured' THEN p.amount ELSE 0 END) AS captured_total
             FROM payments p
             JOIN invoices i ON i.id = p.invoice_id
            WHERE i.subscription_id IS NOT NULL
            GROUP BY i.subscription_id
         ) pay ON pay.subscription_id = s.id
        WHERE ${conds.join(' OR ')}
        ORDER BY s.next_run_date`, params);
    res.json({ rows });
  } catch (err) { next(err); }
});

router.get('/subscriptions/:id', async (req, res, next) => {
  try {
    const scope = await getScope(req.user);
    // Look up the subscription scoped to this portal user.
    const [[sub]] = await db.query(
      `SELECT * FROM subscriptions
        WHERE id = :id AND (contact_id = :cid OR organization_id = :oid)`,
      { id: req.params.id, cid: scope.contact_id, oid: scope.organization_id });
    if (!sub) return res.status(404).json({ error: 'Not found' });
    const [items] = await db.query(
      'SELECT id, description, quantity, unit_price, sort_order FROM subscription_items WHERE subscription_id = :id ORDER BY sort_order, id',
      { id: sub.id });
    const [invoices] = await db.query(
      `SELECT id, invoice_number, issue_date, due_date, total, balance_due, status
         FROM invoices
        WHERE subscription_id = :id
        ORDER BY issue_date DESC`,
      { id: sub.id });
    // Hide raw processor responses + recorded_by from portal users.
    const [payments] = await db.query(
      `SELECT p.id, p.invoice_id, p.gateway, p.method, p.amount, p.currency,
              p.status, p.card_last4, p.card_brand,
              p.received_at, p.refund_amount, p.created_at,
              i.invoice_number
         FROM payments p
         JOIN invoices i ON i.id = p.invoice_id
        WHERE i.subscription_id = :id
        ORDER BY p.created_at DESC, p.id DESC`,
      { id: sub.id });
    res.json({ subscription: sub, items, invoices, payments });
  } catch (err) { next(err); }
});

// Donor self-service: pause/resume or cancel a recurring gift/plan. Scoped
// the same way GET /subscriptions/:id is (contact_id or organization_id
// match) so a portal user can only touch their own plan. Deliberately
// narrower than the admin-side PUT /api/subscriptions/:id/status (which also
// allows 'completed') — that's a system/staff terminal state, not something
// a donor sets themselves; to restart after canceling, they set up a new gift.
router.put('/subscriptions/:id/status', async (req, res, next) => {
  try {
    const scope = await getScope(req.user);
    const status = z.enum(['active', 'paused', 'canceled']).parse(req.body?.status);
    const [[sub]] = await db.query(
      `SELECT id, status FROM subscriptions WHERE id = :id AND (contact_id = :cid OR organization_id = :oid)`,
      { id: req.params.id, cid: scope.contact_id, oid: scope.organization_id }
    );
    if (!sub) return res.status(404).json({ error: 'Not found' });
    if (sub.status === 'canceled') return res.status(409).json({ error: 'This plan is already canceled.' });
    if (sub.status === 'completed') return res.status(409).json({ error: 'This plan has already run its course.' });
    await db.query('UPDATE subscriptions SET status = :s WHERE id = :id', { s: status, id: sub.id });
    res.json({ ok: true, status });
  } catch (err) { next(err); }
});

router.get('/documents', async (req, res, next) => {
  try {
    const scope = await getScope(req.user);
    const conds = []; const params = {};
    if (scope.contact_id)      { conds.push("(entity_type='contact' AND entity_id = :cid)"); params.cid = scope.contact_id; }
    if (scope.organization_id) { conds.push("(entity_type='organization' AND entity_id = :oid)"); params.oid = scope.organization_id; }
    if (!conds.length) return res.json({ rows: [] });
    const [rows] = await db.query(
      `SELECT id, file_name, content_type, size_bytes, created_at
         FROM attachments
        WHERE ${conds.join(' OR ')}
        ORDER BY created_at DESC`, params);
    res.json({ rows });
  } catch (err) { next(err); }
});

// =============================================================================
// Portal — Payment Methods (vault profiles for the logged-in portal user)
// =============================================================================

// GET /api/portal/payment-methods
// Returns vault profiles scoped to this portal user's contact/org.
router.get('/payment-methods', async (req, res, next) => {
  try {
    const scope = await getScope(req.user);
    const { contact_id, organization_id } = scope;
    const where = []; const params = {};
    if (contact_id)      { where.push('contact_id = :cid');      params.cid = contact_id; }
    if (organization_id) { where.push('organization_id = :oid'); params.oid = organization_id; }
    if (!where.length) return res.json({ profiles: [] });

    const [rows] = await db.query(
      `SELECT id, gateway, last4, card_brand, cardholder_name, expiry,
              payment_method, nickname, is_default, created_at
         FROM vault_profiles
        WHERE (${where.join(' OR ')})
          AND deleted_at IS NULL
        ORDER BY is_default DESC, created_at DESC`,
      params
    );
    res.json({ profiles: rows });
  } catch (err) { next(err); }
});

// GET /api/portal/vault/active-gateway
// Returns which payment gateway is active so the portal shows the right card form.
// Response: { gateway: 'valor'|'authnet', mode: 'sandbox'|'live' }
router.get('/vault/active-gateway', async (req, res, next) => {
  try {
    const { getDefaultGateway } = require('../services/gateways');
    const cfg = await getDefaultGateway();
    if (!cfg) return res.status(400).json({ error: 'No active payment gateway configured' });
    // For Auth.net, return the public client key needed by Accept.js
    res.json({
      gateway:          cfg.gateway,
      mode:             cfg.mode,
      // Valor fields
      epi:              cfg.epi_id ? String(cfg.epi_id) : undefined,
      // Auth.net Accept.js public fields (safe to expose)
      authnet_login_id: cfg.gateway === 'authnet' ? cfg.api_login_id : undefined,
      authnet_client_key: cfg.gateway === 'authnet' ? cfg.client_key : undefined,
    });
  } catch (err) { next(err); }
});

// GET /api/portal/vault/client-token
// Proxies to the Valor client-token for Passage.js card-save form.
router.get('/vault/client-token', async (req, res, next) => {
  try {
    const { getGateway, valorGetClientToken } = require('../services/gateways');
    const cfg = await getGateway('valor', null);
    if (!cfg) return res.status(400).json({ error: 'No active Valor gateway configured' });
    const clientToken = await valorGetClientToken(cfg);
    res.json({
      clientToken, epi: String(cfg.epi_id || ''), mode: cfg.mode,
      achEnabled: !!cfg.ach_enabled, achAuthorizationText: cfg.ach_authorization_text || null,
    });
  } catch (err) { next(err); }
});

// POST /api/portal/vault/intent
// Creates a payment_intents row right before the payment iframe loads — only
// needed for ACH (see membership.js's /public/signup-intent for the full
// explanation). Card still goes straight through POST /payment-methods/save-card
// below. contact_id/organization_id come from the logged-in portal user's own
// scope, never from the request body — a portal user can only ever vault a
// payment method for themselves.
router.post('/vault/intent', async (req, res, next) => {
  try {
    const scope = await getScope(req.user);
    const { contact_id, organization_id } = scope;
    if (!contact_id && !organization_id) {
      return res.status(400).json({ error: 'No contact or organization linked to this portal user' });
    }
    const d = z.object({
      nickname: z.string().max(100).optional().nullable(),
      is_default: z.boolean().optional(),
    }).parse(req.body);
    const [ins] = await db.query(
      `INSERT INTO payment_intents (kind, surface, payload, contact_id, organization_id, expires_at)
       VALUES ('vault', 'add_payment_method', CAST(:payload AS JSON), :contact_id, :organization_id, DATE_ADD(NOW(), INTERVAL 30 MINUTE))`,
      {
        payload: JSON.stringify({ nickname: d.nickname || null, is_default: !!d.is_default }),
        contact_id: contact_id ?? null, organization_id: organization_id ?? null,
      }
    );
    res.json({ intentId: ins.insertId });
  } catch (err) { next(err); }
});

// POST /api/portal/payment-methods/save-card
// Saves a new card from the portal — Valor (Passage.js token) or Auth.net (Accept.js opaque data).
router.post('/payment-methods/save-card', async (req, res, next) => {
  try {
    const scope = await getScope(req.user);
    const { contact_id, organization_id } = scope;
    if (!contact_id && !organization_id) {
      return res.status(400).json({ error: 'No contact or organization linked to this portal user' });
    }

    const d = z.object({
      gateway:             z.enum(['valor', 'authnet']).default('valor'),
      card_token:          z.string().min(1).optional().nullable(),
      authnet_opaque_data: z.string().optional().nullable(), // JSON string {dataDescriptor,dataValue}
      cardholder_name:     z.string().max(100).optional().nullable(),
      last4:               z.string().max(4).optional().nullable(),
      card_brand:          z.string().max(32).optional().nullable(),
      expiry:              z.string().max(7).optional().nullable(),
      nickname:            z.string().max(100).optional().nullable(),
      is_default:          z.boolean().optional(),
    }).parse(req.body);

    const {
      getGateway,
      valorVaultAddCustomer,
      valorVaultAddPaymentProfile,
      authnetVaultCreateProfile,
      authnetVaultAddPaymentProfile,
    } = require('../services/gateways');

    const cidParam = contact_id      ?? null;
    const oidParam = organization_id ?? null;

    // Helper: load contact/org info for building gateway customer records
    async function loadBillingInfo() {
      if (contact_id) {
        const [[ct]] = await db.query(
          `SELECT first_name, last_name, CONCAT_WS(' ', first_name, last_name) AS name,
                  email, phone, address_line1, city, state, postal_code
             FROM contacts WHERE id = :id`, { id: contact_id });
        return ct ? {
          customer_name:  ct.name || d.cardholder_name || 'Customer',
          first_name:     ct.first_name,
          last_name:      ct.last_name,
          customer_email: ct.email   || undefined,
          customer_phone: ct.phone   || undefined,
          address: { address: ct.address_line1 || '', city: ct.city || '', state: ct.state || '', zip: ct.postal_code || '' },
        } : {};
      } else if (organization_id) {
        const [[org]] = await db.query(
          `SELECT name, email, phone, address_line1, city, state, postal_code
             FROM organizations WHERE id = :id`, { id: organization_id });
        return org ? {
          customer_name:  org.name || d.cardholder_name || 'Customer',
          company:        org.name,
          customer_email: org.email          || undefined,
          customer_phone: org.phone          || undefined,
          address: {
            address: org.address_line1 || '',
            city:    org.city          || '',
            state:   org.state         || '',
            zip:     org.postal_code   || '',
          },
        } : {};
      }
      return {};
    }

    let valor_vault_id           = null;
    let valor_payment_profile_id = null;
    let authnet_customer_profile_id  = null;
    let authnet_payment_profile_id   = null;
    let card_token_to_store          = null;

    if (d.gateway === 'valor') {
      if (!d.card_token) return res.status(400).json({ error: 'card_token is required for Valor' });
      const cfg = await getGateway('valor', null);
      if (!cfg) return res.status(400).json({ error: 'No active Valor gateway configured' });

      // Reuse existing vault customer if present
      const [[existing]] = await db.query(
        `SELECT valor_vault_id FROM vault_profiles
          WHERE gateway = 'valor' AND valor_vault_id IS NOT NULL AND deleted_at IS NULL
            AND ((:cid IS NOT NULL AND contact_id = :cid) OR (:oid IS NOT NULL AND organization_id = :oid))
          LIMIT 1`,
        { cid: cidParam, oid: oidParam }
      );
      valor_vault_id = existing?.valor_vault_id || null;

      if (!valor_vault_id) {
        const info = await loadBillingInfo();
        valor_vault_id = await valorVaultAddCustomer(cfg, {
          customer_name: info.customer_name || d.cardholder_name || 'Customer',
          customer_email: info.customer_email,
          customer_phone: info.customer_phone,
          address: info.address,
        });
      }

      const profileId = await valorVaultAddPaymentProfile(cfg, {
        vault_id: valor_vault_id, card_token: d.card_token, cardholder_name: d.cardholder_name || undefined,
      });
      valor_payment_profile_id = profileId || null;
      card_token_to_store = d.card_token;

    } else if (d.gateway === 'authnet') {
      if (!d.authnet_opaque_data) return res.status(400).json({ error: 'authnet_opaque_data is required for Auth.net' });
      let opaqueData;
      try {
        opaqueData = typeof d.authnet_opaque_data === 'string' ? JSON.parse(d.authnet_opaque_data) : d.authnet_opaque_data;
      } catch (_) {
        return res.status(400).json({ error: 'authnet_opaque_data must be valid JSON {dataDescriptor,dataValue}' });
      }
      if (!opaqueData?.dataDescriptor || !opaqueData?.dataValue) {
        return res.status(400).json({ error: 'authnet_opaque_data must include dataDescriptor and dataValue' });
      }

      const cfg = await getGateway('authnet', null);
      if (!cfg) return res.status(400).json({ error: 'No active Auth.net gateway configured' });

      const info = await loadBillingInfo();
      const [[existingAuthnet]] = await db.query(
        `SELECT authnet_customer_profile_id FROM vault_profiles
          WHERE gateway = 'authnet' AND authnet_customer_profile_id IS NOT NULL AND deleted_at IS NULL
            AND ((:cid IS NOT NULL AND contact_id = :cid) OR (:oid IS NOT NULL AND organization_id = :oid))
          LIMIT 1`,
        { cid: cidParam, oid: oidParam }
      );

      if (existingAuthnet?.authnet_customer_profile_id) {
        authnet_customer_profile_id = existingAuthnet.authnet_customer_profile_id;
        authnet_payment_profile_id = await authnetVaultAddPaymentProfile(cfg, {
          customer_profile_id: authnet_customer_profile_id,
          opaque_data: opaqueData,
          first_name: info.first_name, last_name: info.last_name, company: info.company, address: info.address,
        });
      } else {
        const ids = await authnetVaultCreateProfile(cfg, {
          opaque_data: opaqueData,
          merchant_customer_id: contact_id || organization_id,
          first_name: info.first_name, last_name: info.last_name, company: info.company, address: info.address,
        });
        authnet_customer_profile_id = ids.customerProfileId;
        authnet_payment_profile_id  = ids.customerPaymentProfileId;
      }
    } else {
      return res.status(400).json({ error: `Unsupported gateway: ${d.gateway}` });
    }

    // Clear existing defaults for this contact/org if setting new default
    if (d.is_default) {
      await db.query(
        `UPDATE vault_profiles SET is_default = 0
          WHERE gateway = :gw AND deleted_at IS NULL
            AND ((:cid IS NOT NULL AND contact_id = :cid) OR (:oid IS NOT NULL AND organization_id = :oid))`,
        { gw: d.gateway, cid: cidParam, oid: oidParam }
      );
    }

    const [ins] = await db.query(
      `INSERT INTO vault_profiles
         (contact_id, organization_id, gateway,
          valor_vault_id, valor_payment_profile_id, card_token,
          authnet_customer_profile_id, authnet_payment_profile_id,
          last4, card_brand, cardholder_name, expiry, payment_method,
          nickname, is_default, created_by)
       VALUES
         (:contact_id, :organization_id, :gateway,
          :valor_vault_id, :valor_payment_profile_id, :card_token,
          :authnet_customer_profile_id, :authnet_payment_profile_id,
          :last4, :card_brand, :cardholder_name, :expiry, 'card',
          :nickname, :is_default, :created_by)`,
      {
        contact_id: cidParam, organization_id: oidParam, gateway: d.gateway,
        valor_vault_id, valor_payment_profile_id, card_token: card_token_to_store,
        authnet_customer_profile_id, authnet_payment_profile_id,
        last4: d.last4 ?? null, card_brand: d.card_brand ?? null,
        cardholder_name: d.cardholder_name ?? null, expiry: d.expiry ?? null,
        nickname: d.nickname ?? null, is_default: d.is_default ? 1 : 0,
        created_by: req.user.id,
      }
    );

    res.status(201).json({
      id: ins.insertId, gateway: d.gateway,
      last4: d.last4, card_brand: d.card_brand, cardholder_name: d.cardholder_name,
    });
  } catch (err) { next(err); }
});

// PUT /api/portal/payment-methods/:id/default
router.put('/payment-methods/:id/default', async (req, res, next) => {
  try {
    const scope = await getScope(req.user);
    const { contact_id, organization_id } = scope;
    const id = Number(req.params.id);

    // Verify ownership — profile must belong to this portal user's scope.
    const [[profile]] = await db.query(
      `SELECT * FROM vault_profiles
        WHERE id = :id
          AND deleted_at IS NULL
          AND (
            (:cid IS NOT NULL AND contact_id = :cid)
            OR (:oid IS NOT NULL AND organization_id = :oid)
          )`,
      { id, cid: contact_id ?? null, oid: organization_id ?? null }
    );
    if (!profile) return res.status(404).json({ error: 'Not found' });

    // Clear existing defaults for same contact/org+gateway combo.
    await db.query(
      `UPDATE vault_profiles
          SET is_default = 0
        WHERE gateway = :gw
          AND deleted_at IS NULL
          AND (
            (:cid IS NOT NULL AND contact_id = :cid)
            OR (:oid IS NOT NULL AND organization_id = :oid)
          )`,
      { gw: profile.gateway, cid: profile.contact_id ?? null, oid: profile.organization_id ?? null }
    );
    await db.query('UPDATE vault_profiles SET is_default = 1 WHERE id = :id', { id });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// DELETE /api/portal/payment-methods/:id
// Soft-delete — verifies portal user owns the profile.
router.delete('/payment-methods/:id', async (req, res, next) => {
  try {
    const scope = await getScope(req.user);
    const { contact_id, organization_id } = scope;
    const id = Number(req.params.id);

    const [[profile]] = await db.query(
      `SELECT id FROM vault_profiles
        WHERE id = :id
          AND deleted_at IS NULL
          AND (
            (:cid IS NOT NULL AND contact_id = :cid)
            OR (:oid IS NOT NULL AND organization_id = :oid)
          )`,
      { id, cid: contact_id ?? null, oid: organization_id ?? null }
    );
    if (!profile) return res.status(404).json({ error: 'Not found' });

    await db.query('UPDATE vault_profiles SET deleted_at = NOW() WHERE id = :id', { id });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// POST /api/portal/invoices/:id/pay-saved
// Charges a stored vault profile to pay an invoice.
router.post('/invoices/:id/pay-saved', async (req, res, next) => {
  try {
    const scope = await getScope(req.user);
    const { contact_id, organization_id } = scope;
    const invoiceId = Number(req.params.id);

    const { vault_profile_id } = z.object({
      vault_profile_id: z.number().int(),
    }).parse(req.body);

    // Verify the invoice belongs to this portal user.
    const [[inv]] = await db.query(
      `SELECT i.*, c.email AS contact_email,
              CONCAT_WS(' ', c.first_name, c.last_name) AS contact_name
         FROM invoices i
         LEFT JOIN contacts c ON c.id = i.contact_id
        WHERE i.id = :id
          AND i.status NOT IN ('paid', 'void', 'draft')
          AND (i.contact_id = :cid OR i.organization_id = :oid)`,
      { id: invoiceId, cid: contact_id ?? null, oid: organization_id ?? null }
    );
    if (!inv) return res.status(404).json({ error: 'Invoice not found or already paid' });
    if (Number(inv.balance_due) <= 0) return res.status(400).json({ error: 'Invoice balance is zero' });

    // Verify the vault profile belongs to this portal user.
    const [[profile]] = await db.query(
      `SELECT * FROM vault_profiles
        WHERE id = :id
          AND deleted_at IS NULL
          AND (
            (:cid IS NOT NULL AND contact_id = :cid)
            OR (:oid IS NOT NULL AND organization_id = :oid)
          )`,
      { id: vault_profile_id, cid: contact_id ?? null, oid: organization_id ?? null }
    );
    if (!profile) return res.status(404).json({ error: 'Payment method not found' });

    const baseAmount = Number(inv.balance_due);
    const crypto = require('crypto');
    const receiptToken = crypto.randomBytes(32).toString('hex');

    const {
      getGateway,
      valorVaultCharge,
      mapValorVaultChargeResponse,
      authnetVaultCharge,
      mapAuthnetVaultChargeResponse,
      computeProcessingFee,
      resolveCardholderName,
    } = require('../services/gateways');

    let paymentId, txnId, chargeStatus;

    if (profile.gateway === 'valor') {
      if (!profile.card_token) return res.status(400).json({ error: 'Valor card token missing on this payment method' });

      const cfg = await getGateway('valor', null);
      if (!cfg) return res.status(500).json({ error: 'Valor gateway not configured' });

      // If a fee was already quoted and baked into balance_due at checkout
      // time (e.g. a donor's voluntary "cover the fee" add-on), use it as-is
      // rather than also running computeProcessingFee() on top — balance_due
      // already includes it, so re-adding would double-charge the customer.
      let fee;
      if (Number(inv.processing_fee) > 0) {
        fee = { amount: Number(inv.processing_fee), label: inv.fee_label || 'Processing Fee' };
      } else {
        const isB2B = Boolean(inv.organization_id);
        const feeAllowed = !cfg.b2b_only || isB2B;
        fee = feeAllowed ? computeProcessingFee({ cfg, baseAmount }) : null;
      }
      const amount = Number(inv.processing_fee) > 0
        ? baseAmount
        : Math.round((baseAmount + (fee?.amount || 0)) * 100) / 100;

      const chargeJson = await valorVaultCharge(cfg, {
        card_token:      profile.card_token,
        amount,
        invoicenumber:   inv.invoice_number,
        cardholdername:  resolveCardholderName(profile.cardholder_name),
        email:           inv.contact_email       || undefined,
        surcharge_amount: fee?.amount || 0,
      });
      const mapped = mapValorVaultChargeResponse(chargeJson);
      const captured = mapped?.status === 'captured';

      if (fee?.amount > 0) {
        const [[{ lineCount }]] = await db.query(
          'SELECT COUNT(*) AS lineCount FROM invoice_line_items WHERE invoice_id = :id', { id: invoiceId });
        await db.query(
          `INSERT INTO invoice_line_items (invoice_id, description, quantity, unit_price, amount, sort_order)
           VALUES (:invoice_id, :desc, 1, :amount, :amount, :sort_order)`,
          { invoice_id: invoiceId, desc: fee.label, amount: fee.amount, sort_order: lineCount }
        );
        await db.query(
          `UPDATE invoices SET total = total + :fee, balance_due = balance_due + :fee WHERE id = :id`,
          { fee: fee.amount, id: invoiceId }
        );
        inv.total = Number(inv.total) + fee.amount;
      }

      const [pIns] = await db.query(
        `INSERT INTO payments
           (invoice_id, gateway, method, amount, currency, status,
            fee_amount, fee_label,
            external_txn_id, external_auth_code,
            card_last4, card_brand, card_expiry, card_holder_name,
            processor_message, processor_code,
            processor_response, received_at, receipt_token, vault_profile_id)
         VALUES
           (:iid, 'valor', 'card', :amount, :currency,
            :status, :fee, :flab, :txnId, :auth,
            :last4, :brand, :exp, :holder,
            :pmsg, :pcode,
            CAST(:raw AS JSON), NOW(), :rtok, :vpid)`,
        {
          iid:      invoiceId,
          amount,
          currency: inv.currency || 'USD',
          status:   mapped?.status || 'failed',
          fee:      fee?.amount || null,
          flab:     fee?.label  || null,
          txnId:    mapped?.txnId  || null,
          auth:     mapped?.auth   || null,
          last4:    mapped?.last4  || profile.last4      || null,
          brand:    mapped?.brand  || profile.card_brand || null,
          exp:      mapped?.exp    || profile.expiry     || null,
          holder:   mapped?.holder || profile.cardholder_name || null,
          pmsg:     mapped?.pmsg   || null,
          pcode:    mapped?.pcode  || null,
          raw:      JSON.stringify(chargeJson),
          rtok:     receiptToken,
          vpid:     profile.id,
        }
      );

      paymentId    = pIns.insertId;
      txnId        = mapped?.txnId;
      chargeStatus = mapped?.status || 'failed';

      if (!captured) {
        return res.status(402).json({
          ok: false,
          error: mapped?.pmsg || 'Card declined',
          status: chargeStatus,
        });
      }

    } else if (profile.gateway === 'authnet') {
      if (!profile.authnet_customer_profile_id || !profile.authnet_payment_profile_id) {
        return res.status(400).json({ error: 'Auth.net profile IDs missing on this payment method' });
      }

      const cfg = await getGateway('authnet', null);
      if (!cfg) return res.status(500).json({ error: 'Auth.net gateway not configured' });

      // Same already-quoted-fee check as the Valor branch above.
      let fee;
      if (Number(inv.processing_fee) > 0) {
        fee = { amount: Number(inv.processing_fee), label: inv.fee_label || 'Processing Fee' };
      } else {
        const isB2B = Boolean(inv.organization_id);
        const feeAllowed = !cfg.b2b_only || isB2B;
        fee = feeAllowed ? computeProcessingFee({ cfg, baseAmount }) : null;
      }
      const amount = Number(inv.processing_fee) > 0
        ? baseAmount
        : Math.round((baseAmount + (fee?.amount || 0)) * 100) / 100;

      const chargeJson = await authnetVaultCharge(cfg, {
        customer_profile_id: profile.authnet_customer_profile_id,
        payment_profile_id:  profile.authnet_payment_profile_id,
        amount,
        invoice_number: inv.invoice_number,
        description:    `Portal payment for invoice ${inv.invoice_number}`,
        surcharge_amount: fee?.amount || 0,
      });
      const mapped = mapAuthnetVaultChargeResponse(chargeJson);
      const captured = mapped?.approved === true;

      if (fee?.amount > 0) {
        const [[{ lineCount }]] = await db.query(
          'SELECT COUNT(*) AS lineCount FROM invoice_line_items WHERE invoice_id = :id', { id: invoiceId });
        await db.query(
          `INSERT INTO invoice_line_items (invoice_id, description, quantity, unit_price, amount, sort_order)
           VALUES (:invoice_id, :desc, 1, :amount, :amount, :sort_order)`,
          { invoice_id: invoiceId, desc: fee.label, amount: fee.amount, sort_order: lineCount }
        );
        await db.query(
          `UPDATE invoices SET total = total + :fee, balance_due = balance_due + :fee WHERE id = :id`,
          { fee: fee.amount, id: invoiceId }
        );
        inv.total = Number(inv.total) + fee.amount;
      }

      const [pIns] = await db.query(
        `INSERT INTO payments
           (invoice_id, gateway, method, amount, currency, status,
            fee_amount, fee_label,
            external_txn_id, external_auth_code,
            card_last4, card_brand, card_expiry, card_holder_name,
            processor_message, processor_code,
            avs_result, cvv_result,
            processor_response, received_at, receipt_token, vault_profile_id)
         VALUES
           (:iid, 'authnet', 'card', :amount, :currency,
            :status, :fee, :flab, :txnId, :auth,
            :last4, :brand, :exp, :holder,
            :pmsg, :pcode,
            :avs, :cvv,
            CAST(:raw AS JSON), NOW(), :rtok, :vpid)`,
        {
          iid:      invoiceId,
          amount,
          currency: inv.currency || 'USD',
          status:   captured ? 'captured' : 'failed',
          fee:      fee?.amount || null,
          flab:     fee?.label  || null,
          txnId:    mapped?.external_txn_id    || null,
          auth:     mapped?.external_auth_code || null,
          last4:    mapped?.card_last4         || profile.last4      || null,
          brand:    mapped?.card_brand         || profile.card_brand || null,
          exp:      profile.expiry             || null,
          holder:   profile.cardholder_name    || null,
          pmsg:     mapped?.processor_message  || null,
          pcode:    mapped?.processor_code     || null,
          avs:      mapped?.avs_result         || null,
          cvv:      mapped?.cvv_result         || null,
          raw:      JSON.stringify(chargeJson),
          rtok:     receiptToken,
          vpid:     profile.id,
        }
      );

      paymentId    = pIns.insertId;
      txnId        = mapped?.external_txn_id;
      chargeStatus = captured ? 'captured' : 'failed';

      if (!captured) {
        return res.status(402).json({
          ok: false,
          error: mapped?.decline_reason || mapped?.processor_message || 'Card declined',
          status: chargeStatus,
        });
      }

    } else {
      return res.status(400).json({ error: `Unknown gateway: ${profile.gateway}` });
    }

    // Update invoice balance/status.
    const [[updated]] = await db.query(
      'SELECT SUM(amount) AS paid FROM payments WHERE invoice_id = :id AND status = "captured"',
      { id: invoiceId }
    );
    const totalPaid = Number(updated?.paid || 0);
    const newBalance = Math.max(0, Math.round((Number(inv.total) - totalPaid) * 100) / 100);
    const newStatus  = newBalance <= 0.005 ? 'paid' : 'partial';
    await db.query(
      `UPDATE invoices SET amount_paid = :paid, balance_due = :bal, status = :status
          ${newStatus === 'paid' ? ', paid_at = NOW()' : ''}
        WHERE id = :id`,
      { paid: totalPaid, bal: newBalance, status: newStatus, id: invoiceId }
    );

    // Tags a real `donations` row if this invoice belongs to a fund-linked
    // pledge/recurring donation, and sends the matching receipt — same as
    // every other payment-capture path.
    await tagInvoicePaymentAsDonation(paymentId);
    await maybeSendReceiptEmail(paymentId);

    res.json({ ok: true, paymentId, txnId, status: chargeStatus, balance_due: newBalance });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// PUT /me/password — portal user changes their own password
// ---------------------------------------------------------------------------
router.put('/me/password', requireAuth, requirePortal, async (req, res, next) => {
  try {
    const { current_password, new_password, confirm_password } = z.object({
      current_password: z.string().min(1),
      // Security remediation M-04 — shared passwordSchema.
      new_password:     passwordSchema,
      confirm_password: z.string().min(1),
    }).parse(req.body);

    if (new_password !== confirm_password) {
      return res.status(400).json({ error: 'Passwords do not match.' });
    }

    const [[user]] = await db.query(
      'SELECT id, password_hash FROM users WHERE id = :id AND is_active = 1 LIMIT 1',
      { id: req.user.id }
    );
    if (!user) return res.status(404).json({ error: 'User not found.' });

    const ok = await bcrypt.compare(current_password, user.password_hash);
    if (!ok) return res.status(400).json({ error: 'Current password is incorrect.' });

    const breach = await isPasswordBreached(new_password);
    if (breach.breached) {
      return res.status(400).json({ error: 'This password has appeared in a known data breach. Please choose a different one.' });
    }

    const newHash = await hashPassword(new_password);
    // Security remediation H-05 — this self-service change was the one
    // password-set path H-05 missed: it swapped password_hash but left
    // every already-issued token (including a possibly-compromised one)
    // valid, same gap H-05 closed everywhere else.
    await db.query(
      'UPDATE users SET password_hash = :hash, token_epoch = token_epoch + 1 WHERE id = :id',
      { hash: newHash, id: user.id }
    );

    res.json({ ok: true });
  } catch (err) { next(err); }
});

// Exported for reuse by checkout.js's authenticated saved-card checkout —
// same "logged-in donor acting on their own record" pattern.
module.exports = router;
module.exports.requirePortal = requirePortal;
module.exports.getScope = getScope;
