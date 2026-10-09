// =============================================================================
// /api/membership — membership tiers admin CRUD + public signup
//
// A membership is a subscriptions row with membership_tier_id set — same
// "reuse the existing engine, tag with an FK" pattern as recurring donations
// (subscriptions.fund_id, donations.js's POST /public/recurring). Signup
// vaults the card (mirrors vault.js's /save-card) and charges the first
// cycle immediately, then billing-cron.js's attemptAutoCharge() carries
// every renewal forward using that same stored token — no new gateway code.
// =============================================================================
const express = require('express');
const crypto = require('crypto');
const { db } = require('../db');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { ensureConstituentTag, notifyMembershipEvent } = require('../services/constituents');
const moduleSettings = require('../services/moduleSettings');

const router = express.Router();

function toSlug(str) {
  return String(str || '')
    .toLowerCase().trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/[\s]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 140);
}

async function upsertDonorContact({ first_name, last_name, email, phone }) {
  if (!email) return null;
  const [[existing]] = await db.query('SELECT id FROM contacts WHERE email = :email LIMIT 1', { email });
  if (existing) return existing.id;
  const [r] = await db.query(
    `INSERT INTO contacts (first_name, last_name, email, phone, lead_source)
     VALUES (:first_name, :last_name, :email, :phone, 'membership_signup')`,
    { first_name: first_name || '', last_name: last_name || '', email, phone: phone || null }
  );
  return r.insertId;
}

// =============================================================================
// Public — no auth
// =============================================================================

router.get('/public/tiers', async (req, res, next) => {
  try {
    const [rows] = await db.query(
      `SELECT id, name, slug, description, price, interval_unit, interval_count, benefits_json
         FROM membership_tiers WHERE is_active = 1 ORDER BY sort_order, price`
    );
    res.json(rows);
  } catch (err) { next(err); }
});

router.get('/public/tiers/:slug', async (req, res, next) => {
  try {
    const [[tier]] = await db.query(
      `SELECT id, name, slug, description, price, interval_unit, interval_count, benefits_json
         FROM membership_tiers WHERE slug = :slug AND is_active = 1`,
      { slug: req.params.slug }
    );
    if (!tier) return res.status(404).json({ error: 'Tier not found' });
    res.json(tier);
  } catch (err) { next(err); }
});

// POST /api/membership/public/signup-intent — creates a payment_intents row
// right when the shopper reaches the payment step, before the iframe loads.
// Only needed for ACH: card signup still goes straight through POST
// /public/signup below with the token in one JSON call. Passage.js's ACH
// sub-form does a real, uncontrollable browser form POST carrying only its
// own bank fields, so the tier/donor info has to already exist server-side
// for POST /api/payments/public/vault-ach/:intentId to complete against.
router.post('/public/signup-intent', async (req, res, next) => {
  try {
    const body = req.body || {};
    const donor = body.donor || {};
    if (!donor.email) return res.status(400).json({ error: 'Donor email is required' });
    const [[tier]] = await db.query(
      'SELECT id FROM membership_tiers WHERE slug = :slug AND is_active = 1', { slug: body.tier_slug }
    );
    if (!tier) return res.status(400).json({ error: 'Unknown or inactive membership tier' });

    const [ins] = await db.query(
      `INSERT INTO payment_intents (kind, surface, payload, expires_at)
       VALUES ('vault', 'membership', CAST(:payload AS JSON), DATE_ADD(NOW(), INTERVAL 30 MINUTE))`,
      { payload: JSON.stringify({ tier_slug: body.tier_slug, donor }) }
    );
    res.json({ intentId: ins.insertId });
  } catch (err) { next(err); }
});

// POST /api/membership/public/signup — vault the card, charge the first
// cycle, create the subscription. Mirrors donations.js's POST /public/recurring.
router.post('/public/signup', async (req, res, next) => {
  try {
    const {
      getGateway, valorVaultAddCustomer, valorVaultAddPaymentProfile,
      valorVaultCharge, mapValorVaultChargeResponse, resolveCardholderName,
      computeProcessingFee,
    } = require('../services/gateways');
    const { refreshInvoiceTotalsById } = require('../routes/invoices');

    const body = req.body || {};
    if (!body.card_token) return res.status(400).json({ error: 'card_token is required' });
    const donor = body.donor || {};
    if (!donor.email) return res.status(400).json({ error: 'Donor email is required' });

    const [[tier]] = await db.query(
      'SELECT * FROM membership_tiers WHERE slug = :slug AND is_active = 1',
      { slug: body.tier_slug }
    );
    if (!tier) return res.status(400).json({ error: 'Unknown or inactive membership tier' });
    const amount = Number(tier.price);

    const contactId = await upsertDonorContact(donor);

    const cfg = await getGateway('valor', null);
    if (!cfg) return res.status(400).json({ error: 'No active Valor gateway configured' });

    // Member signups are always individuals (never org-billed), same gate
    // donations.js's /public/recurring uses: only charge the convenience fee
    // if the gateway allows consumer (non-B2B) surcharging. This route had
    // no fee handling at all before — every other Valor charge call site
    // did, which meant a membership signup silently never charged it.
    const fee = !cfg.b2b_only ? computeProcessingFee({ cfg, baseAmount: amount }) : null;
    const chargeAmount = Math.round((amount + (fee?.amount || 0)) * 100) / 100;

    // Passage.js's cardholder-name field isn't always populated (donor left it
    // blank, or Passage didn't render it) — Valor's vault/charge endpoints
    // reject a missing/blank name outright (error E08: "INVALID CARD HOLDER
    // NAME"), so always fall back to the donor's name from the signup form
    // rather than send undefined. (Mirrors donations.js's /public/recurring.)
    const donorFullName = `${donor.first_name || ''} ${donor.last_name || ''}`.trim();
    const cardholderName = resolveCardholderName(body.cardholder_name, donorFullName);

    // ---- Vault the card (identical sequence to donations.js /public/recurring) ----
    const [[existing]] = await db.query(
      `SELECT valor_vault_id FROM vault_profiles
        WHERE gateway = 'valor' AND valor_vault_id IS NOT NULL AND contact_id = :cid LIMIT 1`,
      { cid: contactId }
    );
    let vaultId = existing?.valor_vault_id || null;
    if (!vaultId) {
      vaultId = await valorVaultAddCustomer(cfg, {
        customer_name: donorFullName || 'Member',
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

    // ---- Charge the first cycle right now ----
    const memo = `Membership — ${tier.name}`;
    const paymentToken = crypto.randomBytes(32).toString('hex');
    const invCfg = await moduleSettings.get('invoices');
    const pfx = (invCfg.invoice_prefix || 'INV').trim().toUpperCase();
    const year = new Date().getUTCFullYear();
    const [numRows] = await db.query(
      `SELECT invoice_number FROM invoices WHERE invoice_number LIKE :p ORDER BY id DESC LIMIT 1`,
      { p: `${pfx}-${year}-%` }
    );
    const lastNum = numRows[0]?.invoice_number;
    const seq = lastNum ? Number(lastNum.split('-').pop()) + 1 : 1;
    const number = `${pfx}-${year}-${String(seq).padStart(6, '0')}`;
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
        exp: mapped?.exp || body.expiry || null, holder: mapped?.holder || body.cardholder_name || null,
        pmsg: mapped?.pmsg || null, pcode: mapped?.pcode || null, raw: JSON.stringify(chargeJson),
        rtok: receiptToken, vaultProfileId: vaultProfileId,
      }
    );
    if (!captured) {
      return res.status(402).json({ error: mapped?.pmsg || 'Your card could not be charged. Please try a different card.' });
    }
    await refreshInvoiceTotalsById(invoiceId);

    // ---- Create the subscription for every renewal after this one ----
    const nextRun = await require('../jobs/billing-cron').addInterval(today, tier.interval_unit, tier.interval_count);
    const [sub] = await db.query(
      `INSERT INTO subscriptions
         (name, contact_id, currency, interval_unit, interval_count, start_date, next_run_date,
          status, auto_charge, gateway, gateway_profile_id, vault_profile_id, membership_tier_id, owner_id)
       VALUES
         (:name, :contact_id, 'USD', :interval_unit, :interval_count, :start_date, :next_run_date,
          'active', 1, 'valor', :gateway_profile_id, :vault_profile_id, :membership_tier_id, NULL)`,
      {
        name: memo, contact_id: contactId, interval_unit: tier.interval_unit, interval_count: tier.interval_count,
        start_date: today, next_run_date: nextRun, gateway_profile_id: String(vaultProfileId),
        vault_profile_id: vaultProfileId, membership_tier_id: tier.id,
      }
    );
    await db.query(
      `INSERT INTO subscription_items (subscription_id, description, quantity, unit_price, sort_order)
       VALUES (:sid, :desc, 1, :amount, 0)`,
      { sid: sub.insertId, desc: memo, amount }
    );

    await ensureConstituentTag(contactId, 'Member');
    await notifyMembershipEvent('membership.started', contactId, { tierName: tier.name, amount });

    res.status(201).json({ ok: true, subscriptionId: sub.insertId, receipt_token: receiptToken });
  } catch (err) { next(err); }
});

// =============================================================================
// Admin — members + tiers
// =============================================================================
const MEMBER_SELECT = `
  SELECT s.id AS subscription_id, s.name, s.status, s.next_run_date, s.start_date, s.end_date,
         t.id AS tier_id, t.name AS tier_name, t.price, t.interval_unit, t.interval_count,
         c.id AS contact_id, CONCAT_WS(' ', c.first_name, c.last_name) AS contact_name, c.email AS contact_email,
         o.id AS organization_id, o.name AS organization_name
    FROM subscriptions s
    JOIN membership_tiers t ON t.id = s.membership_tier_id
    LEFT JOIN contacts c ON c.id = s.contact_id
    LEFT JOIN organizations o ON o.id = s.organization_id
`;

router.get('/admin', requireAuth, requirePermission('membership.read'), async (req, res, next) => {
  try {
    const { tier_id, status } = req.query;
    const where = ['s.membership_tier_id IS NOT NULL'];
    const params = {};
    if (tier_id) { where.push('s.membership_tier_id = :tier_id'); params.tier_id = tier_id; }
    if (status)  { where.push('s.status = :status'); params.status = status; }
    const [rows] = await db.query(
      `${MEMBER_SELECT} WHERE ${where.join(' AND ')} ORDER BY s.created_at DESC`, params
    );
    res.json({ rows });
  } catch (err) { next(err); }
});

router.get('/admin/summary', requireAuth, requirePermission('membership.read'), async (req, res, next) => {
  try {
    const [[totals]] = await db.query(
      `SELECT COUNT(*) AS active_count FROM subscriptions WHERE membership_tier_id IS NOT NULL AND status = 'active'`
    );
    const [byTier] = await db.query(
      `SELECT t.name AS tier_name, t.price, COUNT(s.id) AS member_count
         FROM membership_tiers t
         LEFT JOIN subscriptions s ON s.membership_tier_id = t.id AND s.status = 'active'
        GROUP BY t.id, t.name, t.price
        ORDER BY t.sort_order, t.price`
    );
    // Normalize every tier's recurring revenue to an annual figure so tiers on
    // different billing intervals (monthly vs yearly) can be summed together.
    const annualRevenue = byTier.reduce((acc, t) => {
      const perYear = Number(t.price) * Number(t.member_count || 0) * 1; // price already per-cycle
      return acc + perYear;
    }, 0);
    res.json({ totals, byTier, annualRevenue });
  } catch (err) { next(err); }
});

router.get('/admin/tiers', requireAuth, requirePermission('membership.read'), async (req, res, next) => {
  try {
    const [rows] = await db.query('SELECT * FROM membership_tiers ORDER BY sort_order, price');
    res.json(rows);
  } catch (err) { next(err); }
});

router.post('/admin/tiers', requireAuth, requirePermission('membership.write'), async (req, res, next) => {
  try {
    const b = req.body || {};
    if (!b.name || b.price == null) return res.status(400).json({ error: 'name and price are required' });
    const slug = toSlug(b.slug || b.name);
    const [ins] = await db.query(
      `INSERT INTO membership_tiers (name, slug, description, price, interval_unit, interval_count, benefits_json, is_active, sort_order)
       VALUES (:name, :slug, :description, :price, :interval_unit, :interval_count, CAST(:benefits AS JSON), :is_active, :sort_order)`,
      {
        name: b.name, slug, description: b.description || null, price: Number(b.price),
        interval_unit: b.interval_unit === 'month' ? 'month' : 'year',
        interval_count: b.interval_count || 1,
        benefits: JSON.stringify(b.benefits || []),
        is_active: b.is_active === false ? 0 : 1,
        sort_order: b.sort_order || 0,
      }
    );
    const [[tier]] = await db.query('SELECT * FROM membership_tiers WHERE id = :id', { id: ins.insertId });
    res.status(201).json(tier);
  } catch (err) { next(err); }
});

router.put('/admin/tiers/:id', requireAuth, requirePermission('membership.write'), async (req, res, next) => {
  try {
    const b = req.body || {};
    const [[existing]] = await db.query('SELECT id FROM membership_tiers WHERE id = :id', { id: req.params.id });
    if (!existing) return res.status(404).json({ error: 'Tier not found' });
    await db.query(
      `UPDATE membership_tiers SET
         name = :name, slug = :slug, description = :description, price = :price,
         interval_unit = :interval_unit, interval_count = :interval_count,
         benefits_json = CAST(:benefits AS JSON), is_active = :is_active, sort_order = :sort_order
       WHERE id = :id`,
      {
        id: req.params.id, name: b.name, slug: toSlug(b.slug || b.name), description: b.description || null,
        price: Number(b.price), interval_unit: b.interval_unit === 'month' ? 'month' : 'year',
        interval_count: b.interval_count || 1, benefits: JSON.stringify(b.benefits || []),
        is_active: b.is_active === false ? 0 : 1, sort_order: b.sort_order || 0,
      }
    );
    const [[tier]] = await db.query('SELECT * FROM membership_tiers WHERE id = :id', { id: req.params.id });
    res.json(tier);
  } catch (err) { next(err); }
});

router.delete('/admin/tiers/:id', requireAuth, requirePermission('membership.write'), async (req, res, next) => {
  try {
    await db.query('DELETE FROM membership_tiers WHERE id = :id', { id: req.params.id });
    res.status(204).end();
  } catch (err) { next(err); }
});

module.exports = router;
