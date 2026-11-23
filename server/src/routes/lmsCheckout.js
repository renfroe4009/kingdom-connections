// =============================================================================
// /api/lms-checkout — public course catalog + self-serve paid enrollment.
//
// Mirrors routes/membership.js's /public/signup pipeline exactly (vault the
// card, charge the first cycle, create the invoice/payment, and — only if
// recurring — a subscriptions row), with one extra final step: on a captured
// charge, grant access by calling the vendored LMS engine's own addMember(),
// the same call LmsCohortsPage's staff "enroll" button already makes. Paid
// access is the payment flow automating that one staff action, not a new
// parallel access-control system — see vendor/kcc-lms/src/services/enrolment.ts.
//
// Pricing lives in the app-owned lms_course_pricing table (not the vendor's
// schema — see scripts/ensure-lms-pricing-table.js), one row per course,
// carrying the one dedicated "self-enrolled" cohort that admin's Pricing tab
// auto-creates the first time a course is marked non-free (routes/lms.js).
//
// Mounted at its own prefix (not nested under /api/lms or /api/portal/lms)
// because both of those routers apply a blanket requireAuth/requirePortal at
// the top of the file — these routes must stay reachable with no session.
// =============================================================================
const express = require('express');
const crypto = require('crypto');
const { eq } = require('drizzle-orm');
const { db } = require('../db');
const moduleSettings = require('../services/moduleSettings');
const { membershipTerms } = require('../services/membershipTerms');
const { loadRuntime, contextFor } = require('../lms/runtime');
const { requireAuth } = require('../middleware/auth');
const { requirePortal } = require('./portal');

const router = express.Router();

async function upsertDonorContact({ first_name, last_name, email, phone }) {
  if (!email) return null;
  const [[existing]] = await db.query('SELECT id FROM contacts WHERE email = :email LIMIT 1', { email });
  if (existing) return existing.id;
  const [r] = await db.query(
    `INSERT INTO contacts (first_name, last_name, email, phone, lead_source)
     VALUES (:first_name, :last_name, :email, :phone, 'lms_course_signup')`,
    { first_name: first_name || '', last_name: last_name || '', email, phone: phone || null }
  );
  return r.insertId;
}

async function pricingFor(courseId) {
  const [[row]] = await db.query('SELECT * FROM lms_course_pricing WHERE course_id = :id', { id: courseId });
  return row || null;
}

// =============================================================================
// Public catalog — browse + one course's marketing detail
// =============================================================================

// Published courses only, with price merged in from the app-owned pricing
// table (a second, plain query rather than a cross-pool join — lms_course_pricing
// lives in the app's own `db` pool; the vendor's tables are queried through
// runtime.js's dedicated pool for its own date-handling reasons, see that
// file's header comment).
router.get('/courses', async (req, res, next) => {
  try {
    const { schema, db: lmsDb } = await loadRuntime();
    const courses = await lmsDb.select().from(schema.courses).where(eq(schema.courses.status, 'published'));
    const [pricingRows] = await db.query('SELECT * FROM lms_course_pricing');
    const pricingByCourse = new Map(pricingRows.map((p) => [p.course_id, p]));
    res.json(courses.map((c) => ({ ...c, pricing: pricingByCourse.get(c.id) || { access_type: 'free' } })));
  } catch (err) { next(err); }
});

router.get('/courses/:slug', async (req, res, next) => {
  try {
    const { schema, db: lmsDb } = await loadRuntime();
    const [course] = await lmsDb.select().from(schema.courses).where(eq(schema.courses.slug, req.params.slug));
    if (!course || course.status !== 'published') return res.status(404).json({ error: 'No such course.' });

    // Syllabus preview — titles only, no lesson body/attachments/video, and
    // only published lessons/modules. Deliberately not getCourse() (which
    // requires cohort entitlement) — a marketing page has to be readable by
    // someone who isn't enrolled yet.
    const modules = await lmsDb.select().from(schema.modules).where(eq(schema.modules.courseId, course.id));
    const lessons = await lmsDb.select().from(schema.lessons);
    const lessonsByModule = new Map();
    for (const l of lessons) {
      if (!l.isPublished) continue;
      if (!lessonsByModule.has(l.moduleId)) lessonsByModule.set(l.moduleId, []);
      lessonsByModule.get(l.moduleId).push({ title: l.title, kind: l.kind, estimatedMinutes: l.estimatedMinutes });
    }
    const outline = modules
      .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
      .map((m) => ({ title: m.title, summary: m.summary, lessons: (lessonsByModule.get(m.id) || []) }));

    const pricing = (await pricingFor(course.id)) || { access_type: 'free' };
    res.json({ ...course, outline, pricing });
  } catch (err) { next(err); }
});

// =============================================================================
// Checkout — card path (see routes/membership.js's /public/signup, which this
// mirrors step for step) and the ACH intent handoff (completed server-side by
// completeLmsACH in routes/payments.js's /public/vault-ach/:intentId).
// =============================================================================

async function loadPaidCourse(slug) {
  const { schema, db: lmsDb } = await loadRuntime();
  const [course] = await lmsDb.select().from(schema.courses).where(eq(schema.courses.slug, slug));
  if (!course || course.status !== 'published') return { error: 'No such course.' };
  const pricing = await pricingFor(course.id);
  if (!pricing || pricing.access_type === 'free') return { error: 'This course does not require payment.' };
  if (!pricing.cohort_id) return { error: 'This course is not yet configured for enrollment. Please check back soon.' };
  return { course, pricing };
}

function chosenFrequency(pricing, requested) {
  if (!pricing.allow_buyer_choice) return pricing.access_type === 'recurring' ? 'monthly' : 'once';
  return requested === 'monthly' ? 'monthly' : 'once';
}

router.post('/courses/:slug/signup-intent', async (req, res, next) => {
  try {
    const body = req.body || {};
    const donor = body.donor || {};
    if (!donor.email) return res.status(400).json({ error: 'Email is required' });
    const { course, pricing, error } = await loadPaidCourse(req.params.slug);
    if (error) return res.status(400).json({ error });

    const [ins] = await db.query(
      `INSERT INTO payment_intents (kind, surface, payload, expires_at)
       VALUES ('vault', 'lms', CAST(:payload AS JSON), DATE_ADD(NOW(), INTERVAL 30 MINUTE))`,
      { payload: JSON.stringify({ course_slug: course.slug, donor, frequency: chosenFrequency(pricing, body.frequency) }) }
    );
    res.json({ intentId: ins.insertId });
  } catch (err) { next(err); }
});

router.post('/courses/:slug/signup', async (req, res, next) => {
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

    const { course, pricing, error } = await loadPaidCourse(req.params.slug);
    if (error) return res.status(400).json({ error });
    const amount = Number(pricing.price) || 0;
    if (amount <= 0) return res.status(400).json({ error: 'This course has no price configured.' });

    const contactId = await upsertDonorContact(donor);

    const cfg = await getGateway('valor', null);
    if (!cfg) return res.status(400).json({ error: 'No active Valor gateway configured' });

    const fee = !cfg.b2b_only ? computeProcessingFee({ cfg, baseAmount: amount }) : null;
    const chargeAmount = Math.round((amount + (fee?.amount || 0)) * 100) / 100;

    const donorFullName = `${donor.first_name || ''} ${donor.last_name || ''}`.trim();
    const cardholderName = resolveCardholderName(body.cardholder_name, donorFullName);

    const [[existing]] = await db.query(
      `SELECT valor_vault_id FROM vault_profiles
        WHERE gateway = 'valor' AND valor_vault_id IS NOT NULL AND contact_id = :cid LIMIT 1`,
      { cid: contactId }
    );
    let vaultId = existing?.valor_vault_id || null;
    if (!vaultId) {
      vaultId = await valorVaultAddCustomer(cfg, {
        customer_name: donorFullName || 'Learner', customer_email: donor.email, customer_phone: donor.phone || undefined,
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

    const today = new Date().toISOString().slice(0, 10);
    const frequency = chosenFrequency(pricing, body.frequency);
    const terms = frequency === 'monthly'
      ? { intervalUnit: pricing.interval_unit, intervalCount: pricing.interval_count, autoCharge: 1, endDate: null, label: `every ${pricing.interval_count > 1 ? pricing.interval_count + ' ' : ''}${pricing.interval_unit}${pricing.interval_count > 1 ? 's' : ''}` }
      : membershipTerms('once', today);
    const memo = `Course — ${course.title} (${terms.label})`;
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

    const [inv] = await db.query(
      `INSERT INTO invoices
         (payment_token, invoice_number, contact_id, issue_date, due_date, currency,
          subtotal, tax_rate, tax_amount, discount_rate, discount_amount, total,
          amount_paid, balance_due, status, memo, lms_course_pricing_id)
       VALUES
         (:payment_token, :invoice_number, :contact_id, :issue_date, :due_date, 'USD',
          :subtotal, 0, 0, 0, 0, :total, 0, :total, 'sent', :memo, :lms_course_pricing_id)`,
      { payment_token: paymentToken, invoice_number: number, contact_id: contactId, issue_date: today, due_date: today, subtotal: amount, total: chargeAmount, memo, lms_course_pricing_id: pricing.id }
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
        cardholdername: cardholderName, email: donor.email, surcharge_amount: fee?.amount || 0,
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
        rtok: receiptToken, vaultProfileId,
      }
    );
    if (!captured) {
      return res.status(402).json({ error: mapped?.pmsg || 'Your card could not be charged. Please try a different card.' });
    }
    await refreshInvoiceTotalsById(invoiceId);

    let subscriptionId = null;
    if (frequency === 'monthly') {
      const nextRun = await require('../jobs/billing-cron').addInterval(today, terms.intervalUnit, terms.intervalCount);
      const [sub] = await db.query(
        `INSERT INTO subscriptions
           (name, contact_id, currency, interval_unit, interval_count, start_date, next_run_date, end_date,
            status, auto_charge, gateway, gateway_profile_id, vault_profile_id, lms_course_pricing_id, owner_id)
         VALUES
           (:name, :contact_id, 'USD', :interval_unit, :interval_count, :start_date, :next_run_date, :end_date,
            'active', :auto_charge, 'valor', :gateway_profile_id, :vault_profile_id, :lms_course_pricing_id, NULL)`,
        {
          name: memo, contact_id: contactId, interval_unit: terms.intervalUnit, interval_count: terms.intervalCount,
          start_date: today, next_run_date: nextRun, end_date: terms.endDate, auto_charge: terms.autoCharge,
          gateway_profile_id: String(vaultProfileId), vault_profile_id: vaultProfileId, lms_course_pricing_id: pricing.id,
        }
      );
      await db.query(
        `INSERT INTO subscription_items (subscription_id, description, quantity, unit_price, sort_order)
         VALUES (:sid, :desc, 1, :amount, 0)`,
        { sid: sub.insertId, desc: memo, amount }
      );
      subscriptionId = sub.insertId;
    }

    // ---- Grant access: the one step that differs from a plain purchase —
    // automates the staff "enroll" click (routes/lms.js POST /cohorts/:id/members).
    const context = await contextFor('system', 'admin');
    const { lms } = await loadRuntime();
    await lms.addMember(context, pricing.cohort_id, String(contactId));
    // Best-effort notifications — a new paid enrollment. Fires both the
    // internal automation trigger (staff workflows) and the Praying Planet
    // signed webhook (if this contact's org is app_enabled) — see
    // services/constituents.js's notifyLmsEvent and services/ppWebhooks.js's
    // notifyLmsChange, both of which swallow their own errors.
    const { notifyLmsEvent } = require('../services/constituents');
    const { notifyLmsChange } = require('../services/ppWebhooks');
    await notifyLmsEvent('course.enrolled', contactId, { courseName: course.title });
    await notifyLmsChange('course.enrolled', contactId, { course_title: course.title, course_slug: course.slug });

    res.status(201).json({ ok: true, subscriptionId, receipt_token: receiptToken });
  } catch (err) { next(err); }
});

// POST /api/lms-checkout/courses/:slug/signup-saved — same pipeline as
// /signup above, but for a logged-in portal learner paying with a card
// they've already saved (see client/src/admin/pages/portal/PortalPaymentMethods.jsx)
// instead of tokenizing a new one. Requires portal auth specifically for
// this one route — everything else on this router stays reachable with no
// session (see the file header) — because a saved card belongs to a
// specific contact and must only be charged by that same logged-in contact,
// never by an arbitrary request carrying someone else's vault_profile_id.
router.post('/courses/:slug/signup-saved', requireAuth, requirePortal, async (req, res, next) => {
  try {
    const {
      getGateway, valorVaultCharge, mapValorVaultChargeResponse,
      resolveCardholderName, computeProcessingFee,
    } = require('../services/gateways');
    const { refreshInvoiceTotalsById } = require('../routes/invoices');

    if (!req.user.contact_id) return res.status(409).json({ error: 'Your account has no linked member record.' });
    const contactId = req.user.contact_id;

    const body = req.body || {};
    const vaultProfileId = Number(body.vault_profile_id);
    if (!vaultProfileId) return res.status(400).json({ error: 'vault_profile_id is required' });

    const [[profile]] = await db.query(
      `SELECT * FROM vault_profiles WHERE id = :id AND contact_id = :cid AND deleted_at IS NULL`,
      { id: vaultProfileId, cid: contactId }
    );
    if (!profile) return res.status(404).json({ error: 'Payment method not found' });
    if (profile.gateway !== 'valor' || !profile.card_token) {
      return res.status(400).json({ error: 'This payment method cannot be used for course checkout.' });
    }

    const [[contact]] = await db.query('SELECT first_name, last_name, email FROM contacts WHERE id = :id', { id: contactId });
    const donorEmail = contact?.email;
    if (!donorEmail) return res.status(409).json({ error: 'Your account has no email on file.' });

    const { course, pricing, error } = await loadPaidCourse(req.params.slug);
    if (error) return res.status(400).json({ error });
    const amount = Number(pricing.price) || 0;
    if (amount <= 0) return res.status(400).json({ error: 'This course has no price configured.' });

    const cfg = await getGateway('valor', null);
    if (!cfg) return res.status(400).json({ error: 'No active Valor gateway configured' });

    const fee = !cfg.b2b_only ? computeProcessingFee({ cfg, baseAmount: amount }) : null;
    const chargeAmount = Math.round((amount + (fee?.amount || 0)) * 100) / 100;

    const donorFullName = `${contact.first_name || ''} ${contact.last_name || ''}`.trim();
    const cardholderName = resolveCardholderName(profile.cardholder_name, donorFullName);

    const today = new Date().toISOString().slice(0, 10);
    const frequency = chosenFrequency(pricing, body.frequency);
    const terms = frequency === 'monthly'
      ? { intervalUnit: pricing.interval_unit, intervalCount: pricing.interval_count, autoCharge: 1, endDate: null, label: `every ${pricing.interval_count > 1 ? pricing.interval_count + ' ' : ''}${pricing.interval_unit}${pricing.interval_count > 1 ? 's' : ''}` }
      : membershipTerms('once', today);
    const memo = `Course — ${course.title} (${terms.label})`;
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

    const [inv] = await db.query(
      `INSERT INTO invoices
         (payment_token, invoice_number, contact_id, issue_date, due_date, currency,
          subtotal, tax_rate, tax_amount, discount_rate, discount_amount, total,
          amount_paid, balance_due, status, memo, lms_course_pricing_id)
       VALUES
         (:payment_token, :invoice_number, :contact_id, :issue_date, :due_date, 'USD',
          :subtotal, 0, 0, 0, 0, :total, 0, :total, 'sent', :memo, :lms_course_pricing_id)`,
      { payment_token: paymentToken, invoice_number: number, contact_id: contactId, issue_date: today, due_date: today, subtotal: amount, total: chargeAmount, memo, lms_course_pricing_id: pricing.id }
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
        card_token: profile.card_token, amount: chargeAmount, invoicenumber: number,
        cardholdername: cardholderName, email: donorEmail, surcharge_amount: fee?.amount || 0,
      });
    } catch (chargeErr) {
      return res.status(402).json({ error: chargeErr.message || 'Card could not be charged' });
    }
    const mapped = mapValorVaultChargeResponse(chargeJson);
    const captured = mapped?.status === 'captured';
    const receiptToken = crypto.randomBytes(32).toString('hex');
    await db.query(
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
        last4: mapped?.last4 || profile.last4 || null, brand: mapped?.brand || profile.card_brand || null,
        exp: mapped?.exp || profile.expiry || null, holder: mapped?.holder || cardholderName || null,
        pmsg: mapped?.pmsg || null, pcode: mapped?.pcode || null, raw: JSON.stringify(chargeJson),
        rtok: receiptToken, vaultProfileId,
      }
    );
    if (!captured) {
      return res.status(402).json({ error: mapped?.pmsg || 'Your card could not be charged. Please try a different card.' });
    }
    await refreshInvoiceTotalsById(invoiceId);

    let subscriptionId = null;
    if (frequency === 'monthly') {
      const nextRun = await require('../jobs/billing-cron').addInterval(today, terms.intervalUnit, terms.intervalCount);
      const [sub] = await db.query(
        `INSERT INTO subscriptions
           (name, contact_id, currency, interval_unit, interval_count, start_date, next_run_date, end_date,
            status, auto_charge, gateway, gateway_profile_id, vault_profile_id, lms_course_pricing_id, owner_id)
         VALUES
           (:name, :contact_id, 'USD', :interval_unit, :interval_count, :start_date, :next_run_date, :end_date,
            'active', :auto_charge, 'valor', :gateway_profile_id, :vault_profile_id, :lms_course_pricing_id, NULL)`,
        {
          name: memo, contact_id: contactId, interval_unit: terms.intervalUnit, interval_count: terms.intervalCount,
          start_date: today, next_run_date: nextRun, end_date: terms.endDate, auto_charge: terms.autoCharge,
          gateway_profile_id: String(vaultProfileId), vault_profile_id: vaultProfileId, lms_course_pricing_id: pricing.id,
        }
      );
      await db.query(
        `INSERT INTO subscription_items (subscription_id, description, quantity, unit_price, sort_order)
         VALUES (:sid, :desc, 1, :amount, 0)`,
        { sid: sub.insertId, desc: memo, amount }
      );
      subscriptionId = sub.insertId;
    }

    const context = await contextFor('system', 'admin');
    const { lms } = await loadRuntime();
    await lms.addMember(context, pricing.cohort_id, String(contactId));
    // Best-effort notifications — a new paid enrollment. Fires both the
    // internal automation trigger (staff workflows) and the Praying Planet
    // signed webhook (if this contact's org is app_enabled) — see
    // services/constituents.js's notifyLmsEvent and services/ppWebhooks.js's
    // notifyLmsChange, both of which swallow their own errors.
    const { notifyLmsEvent } = require('../services/constituents');
    const { notifyLmsChange } = require('../services/ppWebhooks');
    await notifyLmsEvent('course.enrolled', contactId, { courseName: course.title });
    await notifyLmsChange('course.enrolled', contactId, { course_title: course.title, course_slug: course.slug });

    res.status(201).json({ ok: true, subscriptionId, receipt_token: receiptToken });
  } catch (err) { next(err); }
});

module.exports = router;
