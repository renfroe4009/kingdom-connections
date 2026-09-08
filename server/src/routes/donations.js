// =============================================================================
// /api/donations — funds/campaigns admin CRUD + public donation checkout
//
// A donation is never its own money record: it's a synthetic invoice + a
// payment created through the SAME invoice -> payment pipeline every other
// invoice uses (see db/migrations/039_fundraising_funds_donations.sql). This
// route only creates the synthetic invoice and, once a payment has actually
// captured, tags it as a gift. The card charge itself is handled entirely by
// the existing gateway-agnostic /api/payments/public/checkout/:invoiceId and
// /api/payments/public/charge/:invoiceId endpoints — nothing gateway-specific
// lives here.
// =============================================================================
const express = require('express');
const crypto = require('crypto');
const { rateLimit } = require('express-rate-limit');
const { db } = require('../db');
const { requireAuth, tryAuth, requirePermission } = require('../middleware/auth');
const { getDefaultGateway } = require('../services/gateways');
const moduleSettings = require('../services/moduleSettings');
const { ensureConstituentTag, notifyDonationCaptured } = require('../services/constituents');

const router = express.Router();

// Matches payments.js's publicPaymentLimiter style/rationale — skip outside
// production so local dev/testing isn't throttled.
const finalizeLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests — please wait before trying again.' },
  skip: () => process.env.NODE_ENV !== 'production',
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function toSlug(str) {
  return String(str || '')
    .toLowerCase().trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/[\s]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 140);
}

function roundMoney(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
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

// Voluntary "cover the fees" estimate — intentionally independent of a
// gateway's own fee_mode/supports_surcharge (that's a mandatory surcharge
// applied to every transaction; this is an opt-in donor add-on, itemized as
// its own line so the two are never conflated on the receipt).
async function estimateCoverFeeAmount(baseAmount) {
  const cfg = await getDefaultGateway();
  if (!cfg) return 0;
  const pct   = Number(cfg.fee_percent || 0) / 100;
  const fixed = Number(cfg.fee_fixed   || 0);
  if (!pct && !fixed) return 0;
  return roundMoney(Number(baseAmount) * pct + fixed);
}

async function upsertDonorContact({ first_name, last_name, email, phone }) {
  if (!email) return null;
  const [[existing]] = await db.query('SELECT id FROM contacts WHERE email = :email LIMIT 1', { email });
  if (existing) return existing.id;
  const [r] = await db.query(
    `INSERT INTO contacts (first_name, last_name, email, phone, lead_source)
     VALUES (:first_name, :last_name, :email, :phone, 'donation_form')`,
    { first_name: first_name || '', last_name: last_name || '', email, phone: phone || null }
  );
  return r.insertId;
}

// =============================================================================
// Public — no auth
// =============================================================================

// GET /api/donations/public/funds — active funds/campaigns for a picker
router.get('/public/funds', async (req, res, next) => {
  try {
    const [rows] = await db.query(
      `SELECT id, kind, name, slug, description, goal_amount
         FROM funds WHERE is_active = 1 ORDER BY name`
    );
    res.json(rows);
  } catch (err) { next(err); }
});

router.get('/public/funds/:slug', async (req, res, next) => {
  try {
    const [[fund]] = await db.query(
      `SELECT id, kind, name, slug, description, goal_amount
         FROM funds WHERE slug = :slug AND is_active = 1`,
      { slug: req.params.slug }
    );
    if (!fund) return res.status(404).json({ error: 'Fund not found' });
    res.json(fund);
  } catch (err) { next(err); }
});

// GET /api/donations/public/fee-info — tells the donation form whether the
// voluntary "cover the fees" checkbox has anything to actually offer, and at
// what rate, so it can default the checkbox and show a live running total
// before the donor submits (matches estimateCoverFeeAmount()'s own math,
// which reads fee_percent/fee_fixed regardless of fee_mode/b2b_only since
// this is an opt-in donor add-on, not the mandatory gateway surcharge).
//
// Also returns the MANDATORY-surcharge gating info (mandatory_active,
// b2b_only) so the staff "Record Donation" charge-now form can preview
// whether the same fee computeProcessingFee() applies at charge time will
// actually be added — that one only fires when fee_mode/supports_surcharge
// allow it AND (b2b_only is off, or the donor is an organization).
router.get('/public/fee-info', async (req, res, next) => {
  try {
    const cfg = await getDefaultGateway();
    const feePercent = Number(cfg?.fee_percent || 0);
    const feeFixed = Number(cfg?.fee_fixed || 0);
    const hasRate = feePercent > 0 || feeFixed > 0;
    res.json({
      active: hasRate,
      fee_percent: feePercent,
      fee_fixed: feeFixed,
      fee_label: cfg?.fee_label || 'Processing Fee',
      mandatory_active: hasRate && cfg?.fee_mode !== 'none' && Boolean(cfg?.supports_surcharge),
      b2b_only: Boolean(cfg?.b2b_only),
    });
  } catch (err) { next(err); }
});

// POST /api/donations/public/checkout — create the synthetic invoice for a
// one-time donation. Returns an invoiceId the existing public payment
// endpoints (/api/payments/public/checkout/:id, /public/charge/:id) then run
// through unchanged, exactly like paying any other invoice.
router.post('/public/checkout', async (req, res, next) => {
  try {
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

    const donor = body.donor || {};
    if (!donor.email) return res.status(400).json({ error: 'Donor email is required' });
    const contactId = await upsertDonorContact(donor);

    const coverFees = Boolean(body.cover_fees);
    const feeAmount = coverFees ? await estimateCoverFeeAmount(amount) : 0;
    const feeLabel = feeAmount > 0 ? (await getDefaultGateway())?.fee_label || 'Processing Fee' : null;
    const total = roundMoney(amount + feeAmount);

    const paymentToken = crypto.randomBytes(32).toString('hex');
    const number = await nextInvoiceNumber();
    const today = new Date().toISOString().slice(0, 10);
    const memo = fund ? `Donation to ${fund.name}` : 'Donation';

    // processing_fee/fee_label persist the donor's voluntary cover-fee amount
    // on the invoice itself, the same way the hosted-checkout branch of
    // POST /public/checkout/:invoiceId does (payments.js) — so it survives
    // to charge time even though computeProcessingFee()'s own mandatory-
    // surcharge gate (b2b_only, etc.) has nothing to do with this amount and
    // may not fire for an individual donor.
    const [ins] = await db.query(
      `INSERT INTO invoices
         (payment_token, invoice_number, contact_id, issue_date, due_date, currency,
          subtotal, tax_rate, tax_amount, discount_rate, discount_amount, total,
          amount_paid, balance_due, status, memo, processing_fee, fee_label)
       VALUES
         (:payment_token, :invoice_number, :contact_id, :issue_date, :due_date, 'USD',
          :subtotal, 0, 0, 0, 0, :total,
          0, :total, 'sent', :memo, :feeAmount, :feeLabel)`,
      {
        payment_token: paymentToken, invoice_number: number, contact_id: contactId,
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
    res.status(201).json({ invoiceId, total, feeAmount, contactId, payment_token: paymentToken });
  } catch (err) { next(err); }
});

// POST /api/donations/public/finalize/:invoiceId — called once the donation's
// invoice shows a captured/authorized payment. Tags that payment as a gift.
// Idempotent: calling twice for the same invoice returns the existing row
// rather than erroring (donations.payment_id is UNIQUE).
//
// Proof of possession required (security remediation H-04) — this route is
// unauthenticated by design (an anonymous donor has no session), but it was
// previously reachable by anyone who could guess a sequential invoiceId,
// letting a stranger harvest a receipt_token, reclassify someone else's
// payment as a donation with an attacker-chosen fund/dedication/soft-credit,
// and trigger a notification email. Now requires either:
//   (a) the invoice's own payment_token in the body — the same capability
//       every other public payment route already requires, proving the
//       caller is the one who was handed this specific checkout, or
//   (b) a staff session authorized to record donations (donations.write),
//       which covers the admin "record a manual gift" flow.
router.post('/public/finalize/:invoiceId', finalizeLimiter, tryAuth, async (req, res, next) => {
  try {
    const invoiceId = Number(req.params.invoiceId);
    const body = req.body || {};

    const [[invoice]] = await db.query(
      'SELECT id, contact_id, organization_id, payment_token FROM invoices WHERE id = :id', { id: invoiceId }
    );
    if (!invoice) return res.status(404).json({ error: 'Invoice not found' });

    const isStaff = !!req.user
      && (req.user.roles?.includes('admin') || req.user.permissions?.includes('donations.write'));
    const suppliedToken = typeof body.payment_token === 'string' ? body.payment_token : '';
    const hasToken = !!suppliedToken && !!invoice.payment_token && suppliedToken === invoice.payment_token;
    if (!isStaff && !hasToken) {
      return res.status(403).json({ error: 'Missing or invalid proof of possession for this invoice.' });
    }

    const [[payment]] = await db.query(
      `SELECT id, amount, receipt_token FROM payments
        WHERE invoice_id = :id AND status IN ('captured','authorized')
        ORDER BY id DESC LIMIT 1`,
      { id: invoiceId }
    );
    if (!payment) return res.status(409).json({ error: 'Payment has not completed yet' });

    const [[existingDonation]] = await db.query(
      'SELECT * FROM donations WHERE payment_id = :pid', { pid: payment.id }
    );
    if (existingDonation) {
      return res.json({ ok: true, donation: existingDonation, receipt_token: payment.receipt_token });
    }

    let fundId = null;
    let fundName = null;
    if (body.fund_id) {
      const [[f]] = await db.query('SELECT id, name FROM funds WHERE id = :id', { id: Number(body.fund_id) });
      if (!f) return res.status(400).json({ error: 'Unknown fund_id' });
      fundId = f.id;
      fundName = f.name;
    } else {
      const fundSlug = String(body.fund_slug || '').trim();
      if (fundSlug) {
        const [[f]] = await db.query('SELECT id, name FROM funds WHERE slug = :slug', { slug: fundSlug });
        if (!f) return res.status(400).json({ error: 'Unknown fund_slug' });
        fundId = f.id;
        fundName = f.name;
      }
    }

    let softCreditContactId = null;
    if (body.soft_credit_contact_id) {
      const [[sc]] = await db.query(
        'SELECT id FROM contacts WHERE id = :id', { id: Number(body.soft_credit_contact_id) }
      );
      if (!sc) return res.status(400).json({ error: 'Unknown soft_credit_contact_id' });
      softCreditContactId = sc.id;
    }

    const source = body.source === 'sms' ? 'sms' : 'form';
    const [ins] = await db.query(
      `INSERT INTO donations
         (contact_id, organization_id, fund_id, payment_id, invoice_id, source,
          soft_credit_contact_id, dedication_note, is_anonymous)
       VALUES
         (:contact_id, :organization_id, :fund_id, :payment_id, :invoice_id, :source,
          :soft_credit_contact_id, :dedication_note, :is_anonymous)`,
      {
        contact_id: invoice.contact_id, organization_id: invoice.organization_id, fund_id: fundId,
        payment_id: payment.id, invoice_id: invoiceId, source,
        soft_credit_contact_id: softCreditContactId,
        dedication_note: body.dedication_note || null,
        is_anonymous: body.is_anonymous ? 1 : 0,
      }
    );

    const [[donation]] = await db.query('SELECT * FROM donations WHERE id = :id', { id: ins.insertId });
    await ensureConstituentTag(invoice.contact_id, 'Donor');
    await notifyDonationCaptured(invoice.contact_id, { amount: payment.amount, fundName, isRecurring: false });
    res.status(201).json({ ok: true, donation, receipt_token: payment.receipt_token });
  } catch (err) { next(err); }
});

// POST /api/donations/public/save-card/:invoiceId — the donor-facing "save
// this card" checkbox needs a public route, since /api/vault/save-card is
// staff-only (requireAuth + payments.write) and an anonymous donor has
// neither. Safe because it's invoice-scoped and payment-verified exactly
// like /public/finalize above: it only runs once a captured payment already
// exists on this specific invoice (proving whoever calls this actually
// completed a real charge), and the contact_id it attaches the card to comes
// from the invoice itself — never from the request body — so there's no way
// to save a card against an arbitrary contact.
router.post('/public/save-card/:invoiceId', async (req, res, next) => {
  try {
    const invoiceId = Number(req.params.invoiceId);
    const body = req.body || {};
    if (!body.card_token) return res.status(400).json({ error: 'card_token is required' });

    const [[invoice]] = await db.query(
      'SELECT id, contact_id FROM invoices WHERE id = :id', { id: invoiceId }
    );
    if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
    if (!invoice.contact_id) return res.status(400).json({ error: 'No contact on this invoice' });

    const [[payment]] = await db.query(
      `SELECT id FROM payments WHERE invoice_id = :id AND status IN ('captured','authorized') LIMIT 1`,
      { id: invoiceId }
    );
    if (!payment) return res.status(409).json({ error: 'Payment has not completed yet' });

    const { getGateway, valorVaultAddCustomer, valorVaultAddPaymentProfile } = require('../services/gateways');
    const cfg = await getGateway('valor', null);
    if (!cfg) return res.status(400).json({ error: 'No active Valor gateway configured' });

    const [[ct]] = await db.query(
      `SELECT CONCAT_WS(' ', first_name, last_name) AS name, email, phone FROM contacts WHERE id = :id`,
      { id: invoice.contact_id }
    );
    // Passage.js's cardholder-name field isn't always populated (donor left it
    // blank, or Passage didn't render it) — Valor's vault endpoints reject a
    // missing/blank name outright (error E08: "INVALID CARD HOLDER NAME"), so
    // always fall back to the contact's real name rather than send undefined.
    const cardholderName = body.cardholder_name || ct?.name || undefined;

    const [[existing]] = await db.query(
      `SELECT valor_vault_id FROM vault_profiles
        WHERE gateway = 'valor' AND valor_vault_id IS NOT NULL AND contact_id = :cid LIMIT 1`,
      { cid: invoice.contact_id }
    );
    let vaultId = existing?.valor_vault_id || null;
    if (!vaultId) {
      vaultId = await valorVaultAddCustomer(cfg, {
        customer_name: ct?.name || body.cardholder_name || 'Donor',
        customer_email: ct?.email || undefined,
        customer_phone: ct?.phone || undefined,
      });
    }
    const paymentProfileId = await valorVaultAddPaymentProfile(cfg, {
      vault_id: vaultId, card_token: body.card_token, cardholder_name: cardholderName,
    });

    await db.query(
      `INSERT INTO vault_profiles
         (contact_id, gateway, valor_vault_id, valor_payment_profile_id, card_token,
          last4, card_brand, cardholder_name, expiry, payment_method, is_default)
       VALUES
         (:contact_id, 'valor', :valor_vault_id, :valor_payment_profile_id, :card_token,
          :last4, :card_brand, :cardholder_name, :expiry, 'card', 0)`,
      {
        contact_id: invoice.contact_id, valor_vault_id: vaultId, valor_payment_profile_id: paymentProfileId,
        card_token: body.card_token, last4: body.last4 || null, card_brand: body.card_brand || null,
        cardholder_name: cardholderName || null, expiry: body.expiry || null,
      }
    );

    res.status(201).json({ ok: true });
  } catch (err) { next(err); }
});

// POST /api/donations/public/recurring-intent — creates a payment_intents row
// right when the donor reaches the payment step, before the iframe loads.
// Only needed for ACH — see membership.js's /public/signup-intent for the
// full explanation (same reasoning applies here verbatim).
router.post('/public/recurring-intent', async (req, res, next) => {
  try {
    const body = req.body || {};
    const amount = Number(body.amount);
    if (!amount || amount <= 0) return res.status(400).json({ error: 'Invalid donation amount' });
    const donor = body.donor || {};
    if (!donor.email) return res.status(400).json({ error: 'Donor email is required' });
    if (body.fund_slug) {
      const [[f]] = await db.query('SELECT id FROM funds WHERE slug = :slug AND is_active = 1', { slug: body.fund_slug });
      if (!f) return res.status(400).json({ error: 'Unknown or inactive fund' });
    }

    const [ins] = await db.query(
      `INSERT INTO payment_intents (kind, surface, payload, expires_at)
       VALUES ('vault', 'recurring_donation', CAST(:payload AS JSON), DATE_ADD(NOW(), INTERVAL 30 MINUTE))`,
      {
        payload: JSON.stringify({
          amount, fund_slug: body.fund_slug || null, donor,
          dedication_note: body.dedication_note || null, is_anonymous: !!body.is_anonymous,
          interval_unit: body.interval_unit || 'month', interval_count: body.interval_count || 1,
          source: body.source === 'sms' ? 'sms' : 'form',
        }),
      }
    );
    res.json({ intentId: ins.insertId });
  } catch (err) { next(err); }
});

// POST /api/donations/public/recurring — set up a recurring gift in one step:
// vault the card (same call sequence as vault.js's /save-card), charge the
// first gift immediately against that vault profile, then create a
// subscriptions row (auto_charge=1, fund_id set) so billing-cron.js's
// attemptAutoCharge() carries it forward every cycle using the exact same
// stored card_token — no new gateway code path, just Valor for now since
// that's the only gateway with a proven vault-charge flow in this app today.
router.post('/public/recurring', async (req, res, next) => {
  try {
    const {
      getGateway, valorVaultAddCustomer, valorVaultAddPaymentProfile,
      valorVaultCharge, mapValorVaultChargeResponse, computeProcessingFee,
    } = require('../services/gateways');
    const { refreshInvoiceTotalsById } = require('../routes/invoices');
    const { addInterval } = require('../jobs/billing-cron');

    const body = req.body || {};
    const amount = Number(body.amount);
    if (!amount || amount <= 0) return res.status(400).json({ error: 'Invalid donation amount' });
    if (!body.card_token) return res.status(400).json({ error: 'card_token is required' });

    const donor = body.donor || {};
    if (!donor.email) return res.status(400).json({ error: 'Donor email is required' });
    const contactId = await upsertDonorContact(donor);

    const fundSlug = String(body.fund_slug || '').trim();
    let fund = null;
    if (fundSlug) {
      const [[f]] = await db.query('SELECT id, name FROM funds WHERE slug = :slug AND is_active = 1', { slug: fundSlug });
      if (!f) return res.status(400).json({ error: 'Unknown or inactive fund' });
      fund = f;
    }

    const intervalUnit = ['day', 'week', 'month', 'year'].includes(body.interval_unit) ? body.interval_unit : 'month';
    const intervalCount = Number(body.interval_count) > 0 ? Number(body.interval_count) : 1;

    const cfg = await getGateway('valor', null);
    if (!cfg) return res.status(400).json({ error: 'No active Valor gateway configured' });

    // Recurring donors are always individuals (never org-billed), so the same
    // b2b_only gate everywhere else uses (invoices, ecommerce, one-time
    // donations) resolves to "only if the gateway allows consumer surcharging".
    const fee = !cfg.b2b_only ? computeProcessingFee({ cfg, baseAmount: amount }) : null;
    const chargeAmount = Math.round((amount + (fee?.amount || 0)) * 100) / 100;

    // Passage.js's cardholder-name field isn't always populated (donor left it
    // blank, or Passage didn't render it) — Valor's vault/charge endpoints
    // reject a missing/blank name outright (error E08: "INVALID CARD HOLDER
    // NAME"), so always fall back to the donor's name from the donation form
    // rather than send undefined.
    const donorFullName = `${donor.first_name || ''} ${donor.last_name || ''}`.trim();
    const cardholderName = body.cardholder_name || donorFullName || undefined;

    // ---- Vault the card (mirrors vault.js's POST /save-card exactly) ----
    const [[existing]] = await db.query(
      `SELECT valor_vault_id FROM vault_profiles
        WHERE gateway = 'valor' AND valor_vault_id IS NOT NULL AND contact_id = :cid LIMIT 1`,
      { cid: contactId }
    );
    let vaultId = existing?.valor_vault_id || null;
    if (!vaultId) {
      vaultId = await valorVaultAddCustomer(cfg, {
        customer_name: donorFullName || 'Donor',
        customer_email: donor.email,
        customer_phone: donor.phone || undefined,
      });
    }
    const paymentProfileId = await valorVaultAddPaymentProfile(cfg, {
      vault_id: vaultId, card_token: body.card_token, cardholder_name: cardholderName,
    });

    const [vp] = await db.query(
      `INSERT INTO vault_profiles
         (contact_id, gateway, valor_vault_id, valor_payment_profile_id, card_token,
          last4, card_brand, cardholder_name, expiry, payment_method, is_default, created_by)
       VALUES
         (:contact_id, 'valor', :valor_vault_id, :valor_payment_profile_id, :card_token,
          :last4, :card_brand, :cardholder_name, :expiry, 'card', 0, NULL)`,
      {
        contact_id: contactId, valor_vault_id: vaultId, valor_payment_profile_id: paymentProfileId,
        card_token: body.card_token, last4: body.last4 || null, card_brand: body.card_brand || null,
        cardholder_name: cardholderName || null, expiry: body.expiry || null,
      }
    );
    const vaultProfileId = vp.insertId;

    // ---- Charge the first gift right now ----
    const memo = fund ? `Recurring donation to ${fund.name}` : 'Recurring donation';
    const paymentToken = crypto.randomBytes(32).toString('hex');
    const number = await nextInvoiceNumber();
    const today = new Date().toISOString().slice(0, 10);

    const [inv] = await db.query(
      `INSERT INTO invoices
         (payment_token, invoice_number, contact_id, issue_date, due_date, currency,
          subtotal, tax_rate, tax_amount, discount_rate, discount_amount, total,
          amount_paid, balance_due, status, memo)
       VALUES
         (:payment_token, :invoice_number, :contact_id, :issue_date, :due_date, 'USD',
          :subtotal, 0, 0, 0, 0, :total, 0, :total, 'sent', :memo)`,
      { payment_token: paymentToken, invoice_number: number, contact_id: contactId, issue_date: today, due_date: today, subtotal: amount, total: chargeAmount, memo }
    );
    const invoiceId = inv.insertId;
    await db.query(
      `INSERT INTO invoice_line_items (invoice_id, description, quantity, unit_price, amount, sort_order)
       VALUES (:invoice_id, :desc, 1, :amount, :amount, 0)`,
      { invoice_id: invoiceId, desc: memo, amount }
    );
    if (fee?.amount > 0) {
      await db.query(
        `INSERT INTO invoice_line_items (invoice_id, description, quantity, unit_price, amount, sort_order)
         VALUES (:invoice_id, :desc, 1, :amount, :amount, 1)`,
        { invoice_id: invoiceId, desc: fee.label, amount: fee.amount }
      );
    }

    let chargeJson;
    try {
      chargeJson = await valorVaultCharge(cfg, {
        card_token: body.card_token, amount: chargeAmount, invoicenumber: number,
        cardholdername: cardholderName, email: donor.email,
        surcharge_amount: fee?.amount || 0,
      });
    } catch (chargeErr) {
      return res.status(402).json({ error: chargeErr.message || 'Card could not be charged' });
    }
    const mapped = mapValorVaultChargeResponse(chargeJson);
    const captured = mapped?.status === 'captured';
    const receiptToken = crypto.randomBytes(32).toString('hex');
    const [pay] = await db.query(
      `INSERT INTO payments
         (invoice_id, gateway, method, amount, currency, status,
          fee_amount, fee_label,
          external_txn_id, external_auth_code, card_last4, card_brand, card_expiry, card_holder_name,
          processor_message, processor_code, processor_response, received_at, receipt_token, vault_profile_id)
       VALUES
         (:iid, 'valor', 'card', :amount, 'USD', :status, :fee, :flab, :txnId, :auth, :last4, :brand, :exp, :holder,
          :pmsg, :pcode, CAST(:raw AS JSON), NOW(), :rtok, :vaultProfileId)`,
      {
        iid: invoiceId, amount: chargeAmount, status: mapped?.status || 'failed',
        fee: fee?.amount || null, flab: fee?.label || null,
        txnId: mapped?.txnId || null, auth: mapped?.auth || null,
        last4: mapped?.last4 || body.last4 || null, brand: mapped?.brand || body.card_brand || null,
        exp: mapped?.exp || body.expiry || null, holder: mapped?.holder || cardholderName || null,
        pmsg: mapped?.pmsg || null, pcode: mapped?.pcode || null, raw: JSON.stringify(chargeJson),
        rtok: receiptToken, vaultProfileId: vaultProfileId,
      }
    );
    if (!captured) {
      return res.status(402).json({ error: mapped?.pmsg || 'Your first gift could not be charged. Please try a different card.' });
    }
    await refreshInvoiceTotalsById(invoiceId);

    const [donIns] = await db.query(
      `INSERT INTO donations (contact_id, fund_id, payment_id, invoice_id, source, dedication_note, is_anonymous)
       VALUES (:contact_id, :fund_id, :payment_id, :invoice_id, :source, :dedication_note, :is_anonymous)`,
      {
        contact_id: contactId, fund_id: fund?.id || null, payment_id: pay.insertId, invoice_id: invoiceId,
        source: body.source === 'sms' ? 'sms' : 'form',
        dedication_note: body.dedication_note || null, is_anonymous: body.is_anonymous ? 1 : 0,
      }
    );
    await ensureConstituentTag(contactId, 'Donor');
    await notifyDonationCaptured(contactId, { amount, fundName: fund?.name, isRecurring: true });

    // ---- Create the subscription for every cycle after this one ----
    const nextRun = addInterval(today, intervalUnit, intervalCount);
    const [sub] = await db.query(
      `INSERT INTO subscriptions
         (name, contact_id, currency, interval_unit, interval_count, start_date, next_run_date,
          status, auto_charge, gateway, gateway_profile_id, vault_profile_id, fund_id, owner_id)
       VALUES
         (:name, :contact_id, 'USD', :interval_unit, :interval_count, :start_date, :next_run_date,
          'active', 1, 'valor', :gateway_profile_id, :vault_profile_id, :fund_id, NULL)`,
      {
        name: memo, contact_id: contactId, interval_unit: intervalUnit, interval_count: intervalCount,
        start_date: today, next_run_date: nextRun, gateway_profile_id: String(vaultProfileId),
        vault_profile_id: vaultProfileId, fund_id: fund?.id || null,
      }
    );
    await db.query(
      `INSERT INTO subscription_items (subscription_id, description, quantity, unit_price, sort_order)
       VALUES (:sid, :desc, 1, :amount, 0)`,
      { sid: sub.insertId, desc: memo, amount }
    );

    res.status(201).json({ ok: true, subscriptionId: sub.insertId, donationId: donIns.insertId, receipt_token: receiptToken });
  } catch (err) { next(err); }
});

// =============================================================================
// Admin — donations list/detail + summary
// =============================================================================
const DONATION_SELECT = `
  SELECT d.id, d.source, d.is_anonymous, d.dedication_note, d.created_at,
         d.is_in_kind, d.in_kind_description, d.quid_pro_quo_value,
         d.matching_gift_employer, d.matching_gift_amount, d.matching_gift_state,
         f.id AS fund_id, f.name AS fund_name, f.kind AS fund_kind, f.fund_code,
         p.id AS payment_id, p.amount, p.fee_amount, p.fee_label, p.currency, p.status AS payment_status,
         (p.amount - COALESCE(p.fee_amount,0)) AS net_amount,
         p.gateway, p.method, p.receipt_token,
         i.id AS invoice_id, i.invoice_number,
         c.id AS contact_id, CONCAT_WS(' ', c.first_name, c.last_name) AS contact_name, c.email AS contact_email,
         o.id AS organization_id, o.name AS organization_name,
         sc.id AS soft_credit_contact_id, CONCAT_WS(' ', sc.first_name, sc.last_name) AS soft_credit_contact_name
    FROM donations d
    JOIN payments p ON p.id = d.payment_id
    JOIN invoices i ON i.id = d.invoice_id
    LEFT JOIN funds f ON f.id = d.fund_id
    LEFT JOIN contacts c ON c.id = d.contact_id
    LEFT JOIN organizations o ON o.id = d.organization_id
    LEFT JOIN contacts sc ON sc.id = d.soft_credit_contact_id
`;

router.get('/admin', requireAuth, requirePermission('donations.read'), async (req, res, next) => {
  try {
    const { fund_id, contact_id, organization_id, start_date, end_date, page = 1, pageSize = 50 } = req.query;
    const where = [];
    const params = {};
    if (fund_id)         { where.push('d.fund_id = :fund_id'); params.fund_id = fund_id; }
    if (contact_id)      { where.push('d.contact_id = :contact_id'); params.contact_id = contact_id; }
    if (organization_id) { where.push('d.organization_id = :organization_id'); params.organization_id = organization_id; }
    if (start_date) { where.push('d.created_at >= :start_date'); params.start_date = start_date; }
    if (end_date)   { where.push('d.created_at <= :end_date'); params.end_date = `${end_date} 23:59:59`; }
    const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const limit = Math.min(Number(pageSize) || 50, 200);
    const offset = (Math.max(Number(page) || 1, 1) - 1) * limit;

    const [rows] = await db.query(
      `${DONATION_SELECT} ${whereClause} ORDER BY d.created_at DESC LIMIT ${limit} OFFSET ${offset}`,
      params
    );
    const [[{ total }]] = await db.query(
      `SELECT COUNT(*) AS total FROM donations d ${whereClause}`, params
    );
    res.json({ rows, total, page: Number(page), pageSize: limit });
  } catch (err) { next(err); }
});

// POST /api/donations/admin — record a gift staff took offline (check, cash,
// wire, or a non-cash in-kind gift). Same invoice -> payment -> donation
// pipeline as the public checkout, just with gateway='manual' and no gateway
// call at all — the "payment" here is a ledger entry, not a real charge.
const MANUAL_METHODS = new Set(['check', 'cash', 'wire', 'other']);
router.post('/admin', requireAuth, requirePermission('donations.write'), async (req, res, next) => {
  try {
    const b = req.body || {};
    const amount = Number(b.amount);
    if (!amount || amount <= 0) return res.status(400).json({ error: 'Invalid amount' });
    if (!b.contact_id && !b.organization_id) return res.status(400).json({ error: 'contact_id or organization_id is required' });

    const method = MANUAL_METHODS.has(b.method) ? b.method : 'other';
    const isInKind = Boolean(b.is_in_kind);
    if (isInKind && !b.in_kind_description) {
      return res.status(400).json({ error: 'in_kind_description is required for in-kind gifts' });
    }

    let fundId = null;
    let fundName = null;
    if (b.fund_id) {
      const [[f]] = await db.query('SELECT id, name FROM funds WHERE id = :id', { id: b.fund_id });
      if (!f) return res.status(400).json({ error: 'Unknown fund' });
      fundId = f.id; fundName = f.name;
    }

    const paymentToken = crypto.randomBytes(32).toString('hex');
    const number = await nextInvoiceNumber();
    const today = new Date().toISOString().slice(0, 10);
    const memo = isInKind
      ? `In-kind gift${fundName ? ` — ${fundName}` : ''}: ${b.in_kind_description}`
      : `Donation${fundName ? ` to ${fundName}` : ''} (recorded manually)`;

    const [inv] = await db.query(
      `INSERT INTO invoices
         (payment_token, invoice_number, contact_id, organization_id, issue_date, due_date, currency,
          subtotal, tax_rate, tax_amount, discount_rate, discount_amount, total,
          amount_paid, balance_due, status, memo, paid_at)
       VALUES
         (:payment_token, :invoice_number, :contact_id, :organization_id, :issue_date, :due_date, 'USD',
          :subtotal, 0, 0, 0, 0, :total,
          :total, 0, 'paid', :memo, NOW())`,
      {
        payment_token: paymentToken, invoice_number: number,
        contact_id: b.contact_id || null, organization_id: b.organization_id || null,
        issue_date: today, due_date: today, subtotal: amount, total: amount, memo,
      }
    );
    const invoiceId = inv.insertId;

    await db.query(
      `INSERT INTO invoice_line_items (invoice_id, description, quantity, unit_price, amount, sort_order)
       VALUES (:invoice_id, :desc, 1, :amount, :amount, 0)`,
      { invoice_id: invoiceId, desc: memo, amount }
    );

    const receiptToken = crypto.randomBytes(32).toString('hex');
    const [pay] = await db.query(
      `INSERT INTO payments (invoice_id, gateway, method, amount, currency, status, received_at, recorded_by, receipt_token)
       VALUES (:invoice_id, 'manual', :method, :amount, 'USD', 'captured', :received_at, :recorded_by, :receipt_token)`,
      {
        invoice_id: invoiceId, method, amount,
        received_at: b.received_at || new Date().toISOString().slice(0, 19).replace('T', ' '),
        recorded_by: req.user.id, receipt_token: receiptToken,
      }
    );
    const paymentId = pay.insertId;

    const [ins] = await db.query(
      `INSERT INTO donations
         (contact_id, organization_id, fund_id, payment_id, invoice_id, source,
          soft_credit_contact_id, dedication_note, is_anonymous,
          is_in_kind, in_kind_description, quid_pro_quo_value)
       VALUES
         (:contact_id, :organization_id, :fund_id, :payment_id, :invoice_id, 'manual',
          :soft_credit_contact_id, :dedication_note, :is_anonymous,
          :is_in_kind, :in_kind_description, :quid_pro_quo_value)`,
      {
        contact_id: b.contact_id || null, organization_id: b.organization_id || null, fund_id: fundId,
        payment_id: paymentId, invoice_id: invoiceId,
        soft_credit_contact_id: b.soft_credit_contact_id || null,
        dedication_note: b.dedication_note || null,
        is_anonymous: b.is_anonymous ? 1 : 0,
        is_in_kind: isInKind ? 1 : 0,
        in_kind_description: b.in_kind_description || null,
        quid_pro_quo_value: b.quid_pro_quo_value || 0,
      }
    );

    const [[donation]] = await db.query(`${DONATION_SELECT} WHERE d.id = :id`, { id: ins.insertId });
    await ensureConstituentTag(b.contact_id, 'Donor');
    await notifyDonationCaptured(b.contact_id, { amount, fundName, isRecurring: false });
    res.status(201).json(donation);
  } catch (err) { next(err); }
});

// POST /api/donations/admin/charge — staff-initiated card/ACH donation
// ("virtual terminal"). Creates the same synthetic invoice as /admin above,
// but leaves it unpaid: the client then runs it through the existing
// gateway-agnostic /api/payments/public/checkout/:id + /public/charge/:id
// pipeline (same one InvoiceDetail's "Take Payment" uses) and, once that
// capture succeeds, calls /public/finalize/:id to tag it as a gift — mirrors
// the public donor checkout flow, just for an existing CRM contact/org
// instead of an email-upserted one.
router.post('/admin/charge', requireAuth, requirePermission('donations.write'), async (req, res, next) => {
  try {
    const b = req.body || {};
    const amount = Number(b.amount);
    if (!amount || amount <= 0) return res.status(400).json({ error: 'Invalid amount' });
    if (!b.contact_id && !b.organization_id) return res.status(400).json({ error: 'contact_id or organization_id is required' });

    let fundName = null;
    if (b.fund_id) {
      const [[f]] = await db.query('SELECT id, name FROM funds WHERE id = :id', { id: b.fund_id });
      if (!f) return res.status(400).json({ error: 'Unknown fund' });
      fundName = f.name;
    }

    const paymentToken = crypto.randomBytes(32).toString('hex');
    const number = await nextInvoiceNumber();
    const today = new Date().toISOString().slice(0, 10);
    const memo = `Donation${fundName ? ` to ${fundName}` : ''}`;

    const [inv] = await db.query(
      `INSERT INTO invoices
         (payment_token, invoice_number, contact_id, organization_id, issue_date, due_date, currency,
          subtotal, tax_rate, tax_amount, discount_rate, discount_amount, total,
          amount_paid, balance_due, status, memo)
       VALUES
         (:payment_token, :invoice_number, :contact_id, :organization_id, :issue_date, :due_date, 'USD',
          :subtotal, 0, 0, 0, 0, :total,
          0, :total, 'sent', :memo)`,
      {
        payment_token: paymentToken, invoice_number: number,
        contact_id: b.contact_id || null, organization_id: b.organization_id || null,
        issue_date: today, due_date: today, subtotal: amount, total: amount, memo,
      }
    );
    const invoiceId = inv.insertId;

    await db.query(
      `INSERT INTO invoice_line_items (invoice_id, description, quantity, unit_price, amount, sort_order)
       VALUES (:invoice_id, :desc, 1, :amount, :amount, 0)`,
      { invoice_id: invoiceId, desc: memo, amount }
    );

    res.status(201).json({ invoiceId, total: amount });
  } catch (err) { next(err); }
});

router.get('/admin/summary', requireAuth, requirePermission('donations.read'), async (req, res, next) => {
  try {
    const [[totals]] = await db.query(
      `SELECT COUNT(*) AS gift_count, COALESCE(SUM(p.amount - COALESCE(p.fee_amount,0)),0) AS total_raised,
              COALESCE(SUM(p.fee_amount),0) AS total_fees
         FROM donations d JOIN payments p ON p.id = d.payment_id
        WHERE p.status IN ('captured','authorized')`
    );
    const [[thisMonth]] = await db.query(
      `SELECT COUNT(*) AS gift_count, COALESCE(SUM(p.amount - COALESCE(p.fee_amount,0)),0) AS total_raised,
              COALESCE(SUM(p.fee_amount),0) AS total_fees
         FROM donations d JOIN payments p ON p.id = d.payment_id
        WHERE p.status IN ('captured','authorized')
          AND d.created_at >= DATE_FORMAT(CURDATE(), '%Y-%m-01')`
    );
    const [byFund] = await db.query(
      `SELECT COALESCE(f.name, 'Undesignated') AS fund_name,
              COUNT(*) AS gift_count,
              COALESCE(SUM(p.amount - COALESCE(p.fee_amount,0)),0) AS total_raised
         FROM donations d
         JOIN payments p ON p.id = d.payment_id
         LEFT JOIN funds f ON f.id = d.fund_id
        WHERE p.status IN ('captured','authorized')
        GROUP BY f.id, f.name
        ORDER BY total_raised DESC
        LIMIT 10`
    );
    const [[matching]] = await db.query(
      `SELECT
         SUM(CASE WHEN matching_gift_state IN ('eligible','submitted') THEN 1 ELSE 0 END) AS pending_count,
         COALESCE(SUM(CASE WHEN matching_gift_state IN ('eligible','submitted') THEN matching_gift_amount ELSE 0 END), 0) AS pending_amount,
         SUM(CASE WHEN matching_gift_state = 'matched' THEN 1 ELSE 0 END) AS matched_count,
         COALESCE(SUM(CASE WHEN matching_gift_state = 'matched' THEN matching_gift_amount ELSE 0 END), 0) AS matched_amount
       FROM donations`
    );
    res.json({ totals, thisMonth, byFund, matching });
  } catch (err) { next(err); }
});

router.get('/admin/export.csv', requireAuth, requirePermission('donations.read'), async (req, res, next) => {
  try {
    const [rows] = await db.query(`${DONATION_SELECT} ORDER BY d.created_at DESC`);
    const header = ['Date','Fund','Fund Code','Contact','Email','Organization','Amount','Fee','Currency','Status','Gateway','Invoice #','Anonymous','Dedication'];
    const csvRows = [header.join(',')];
    for (const r of rows) {
      const line = [
        r.created_at, r.fund_name || 'Undesignated', r.fund_code || '', r.contact_name || '', r.contact_email || '',
        r.organization_name || '', r.net_amount, r.fee_amount || '', r.currency, r.payment_status, r.gateway,
        r.invoice_number, r.is_anonymous ? 'Yes' : 'No', r.dedication_note || '',
      ].map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`);
      csvRows.push(line.join(','));
    }
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="donations.csv"');
    res.send(csvRows.join('\n'));
  } catch (err) { next(err); }
});

// =============================================================================
// Admin — funds/campaigns CRUD
// (registered before /admin/:id below so 'funds' isn't swallowed as an :id)
// =============================================================================
router.get('/admin/funds', requireAuth, requirePermission('donations.read'), async (req, res, next) => {
  try {
    const [rows] = await db.query('SELECT * FROM funds ORDER BY name');
    res.json(rows);
  } catch (err) { next(err); }
});

router.post('/admin/funds', requireAuth, requirePermission('donations.write'), async (req, res, next) => {
  try {
    const b = req.body || {};
    if (!b.name) return res.status(400).json({ error: 'name is required' });
    const slug = toSlug(b.slug || b.name);
    const smsKeyword = b.sms_keyword ? String(b.sms_keyword).trim().toUpperCase().slice(0, 30) : null;
    if (smsKeyword) {
      const [[dupe]] = await db.query('SELECT id FROM funds WHERE sms_keyword = :kw', { kw: smsKeyword });
      if (dupe) return res.status(400).json({ error: `SMS keyword "${smsKeyword}" is already used by another fund` });
    }
    const [ins] = await db.query(
      `INSERT INTO funds (kind, name, slug, description, fund_code, sms_keyword, goal_amount, start_date, end_date, is_active)
       VALUES (:kind, :name, :slug, :description, :fund_code, :sms_keyword, :goal_amount, :start_date, :end_date, :is_active)`,
      {
        kind: b.kind === 'campaign' ? 'campaign' : 'fund',
        name: b.name, slug, description: b.description || null,
        fund_code: b.fund_code || null,
        sms_keyword: smsKeyword,
        goal_amount: b.goal_amount || null,
        start_date: b.start_date || null, end_date: b.end_date || null,
        is_active: b.is_active === false ? 0 : 1,
      }
    );
    const [[fund]] = await db.query('SELECT * FROM funds WHERE id = :id', { id: ins.insertId });
    res.status(201).json(fund);
  } catch (err) { next(err); }
});

router.put('/admin/funds/:id', requireAuth, requirePermission('donations.write'), async (req, res, next) => {
  try {
    const b = req.body || {};
    const [[existing]] = await db.query('SELECT id FROM funds WHERE id = :id', { id: req.params.id });
    if (!existing) return res.status(404).json({ error: 'Fund not found' });
    const smsKeyword = b.sms_keyword ? String(b.sms_keyword).trim().toUpperCase().slice(0, 30) : null;
    if (smsKeyword) {
      const [[dupe]] = await db.query('SELECT id FROM funds WHERE sms_keyword = :kw AND id != :id', { kw: smsKeyword, id: req.params.id });
      if (dupe) return res.status(400).json({ error: `SMS keyword "${smsKeyword}" is already used by another fund` });
    }
    await db.query(
      `UPDATE funds SET
         kind = :kind, name = :name, slug = :slug, description = :description,
         fund_code = :fund_code, sms_keyword = :sms_keyword, goal_amount = :goal_amount,
         start_date = :start_date, end_date = :end_date, is_active = :is_active
       WHERE id = :id`,
      {
        id: req.params.id,
        kind: b.kind === 'campaign' ? 'campaign' : 'fund',
        name: b.name, slug: toSlug(b.slug || b.name), description: b.description || null,
        fund_code: b.fund_code || null, sms_keyword: smsKeyword, goal_amount: b.goal_amount || null,
        start_date: b.start_date || null, end_date: b.end_date || null,
        is_active: b.is_active === false ? 0 : 1,
      }
    );
    const [[fund]] = await db.query('SELECT * FROM funds WHERE id = :id', { id: req.params.id });
    res.json(fund);
  } catch (err) { next(err); }
});

router.delete('/admin/funds/:id', requireAuth, requirePermission('donations.write'), async (req, res, next) => {
  try {
    await db.query('DELETE FROM funds WHERE id = :id', { id: req.params.id });
    res.status(204).end();
  } catch (err) { next(err); }
});

router.get('/admin/statement/:contactId/:year', requireAuth, requirePermission('donations.read'), async (req, res, next) => {
  try {
    const { loadYearEndStatementData, renderYearEndStatementPdf } = require('../services/receipts');
    const data = await loadYearEndStatementData(req.params.contactId, Number(req.params.year));
    if (!data) return res.status(404).json({ error: 'Contact not found' });
    const pdf = await renderYearEndStatementPdf(data);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="giving-statement-${req.params.year}-${data.contact.id}.pdf"`);
    res.send(pdf);
  } catch (err) { next(err); }
});

router.put('/admin/:id/matching-gift', requireAuth, requirePermission('donations.write'), async (req, res, next) => {
  try {
    const b = req.body || {};
    const state = ['none', 'eligible', 'submitted', 'matched', 'denied'].includes(b.matching_gift_state) ? b.matching_gift_state : 'none';
    const [[existing]] = await db.query('SELECT id FROM donations WHERE id = :id', { id: req.params.id });
    if (!existing) return res.status(404).json({ error: 'Not found' });
    await db.query(
      `UPDATE donations SET matching_gift_employer = :employer, matching_gift_amount = :amount, matching_gift_state = :state
       WHERE id = :id`,
      {
        id: req.params.id, employer: b.matching_gift_employer || null,
        amount: b.matching_gift_amount ? Number(b.matching_gift_amount) : null, state,
      }
    );
    const [[donation]] = await db.query(`${DONATION_SELECT} WHERE d.id = :id`, { id: req.params.id });
    res.json(donation);
  } catch (err) { next(err); }
});

// Must stay registered LAST among /admin/* routes — this wildcard would
// otherwise swallow /admin/funds, /admin/summary, /admin/export.csv, /admin/statement.
router.get('/admin/:id', requireAuth, requirePermission('donations.read'), async (req, res, next) => {
  try {
    const [[donation]] = await db.query(`${DONATION_SELECT} WHERE d.id = :id`, { id: req.params.id });
    if (!donation) return res.status(404).json({ error: 'Not found' });
    res.json(donation);
  } catch (err) { next(err); }
});

// Exported for reuse by portal.js's authenticated /donations/checkout —
// same fee/invoice-numbering logic, just sourced from a logged-in donor's
// own scope instead of a donor-supplied email.
module.exports = router;
module.exports.roundMoney = roundMoney;
module.exports.nextInvoiceNumber = nextInvoiceNumber;
module.exports.estimateCoverFeeAmount = estimateCoverFeeAmount;
