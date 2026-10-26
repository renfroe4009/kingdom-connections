// =============================================================================
// /api/payments  —  gateway settings, checkout sessions, webhooks, history
// =============================================================================
const express = require('express');
const router = express.Router();
const { z } = require('zod');
const crypto = require('crypto');
const { db } = require('../db');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { logActivity } = require('../services/activity');
const {
  getGateway, getDefaultGateway,
  createHostedCheckout, authnetFetchTransaction, valorFetchTransaction,
  valorSearchByInvoice, mapValorTransactionResponse,
  valorVaultCharge, mapValorVaultChargeResponse,
  valorVaultAddCustomer, valorVaultAddACHProfile, valorVaultAchCharge,
  computeProcessingFee, resolveCardholderName,
  authnetVoid, authnetRefund, mapAuthnetReversalResponse,
  valorVoid, valorRefund, isValorReversalApproved,
} = require('../services/gateways');
const {
  reconcileAllActiveGateways, listRecentRuns,
} = require('../services/batchReconciliation');
const { loadReceiptDataByToken, renderReceiptHtml, renderReceiptPdf, maybeSendReceiptEmail } = require('../services/receipts');
const { sendMail } = require('../services/mailer');
const { renderBySlug } = require('../services/templates');
const { tagInvoicePaymentAsDonation } = require('../services/constituents');
const moduleSettings = require('../services/moduleSettings');
const { encrypt: encryptSecret } = require('../services/secretsCrypto');

// ---------- helpers ----------

function maskSecret(v) { return v ? '********' : ''; }

// Rate limiter for public payment endpoints — prevents carding attacks and
// brute-force of payment tokens. Shared across all three charge routes.
const { rateLimit } = require('express-rate-limit');
const publicPaymentLimiter = rateLimit({
  windowMs: 60 * 1000,  // 1 minute
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many payment attempts — please wait before trying again.' },
  skip: () => process.env.NODE_ENV !== 'production', // only enforce in production
});

// Hex-token regex reused by multiple endpoints.
const PAY_TOKEN_RE = /^[a-f0-9]{64}$/i;

async function refreshInvoiceAfterPayment(invoiceId) {
  const [[inv]] = await db.query('SELECT total FROM invoices WHERE id = :id', { id: invoiceId });
  if (!inv) return null;
  // Apply *principal* (amount minus processing fee) to the invoice — the fee
  // is a separate line on the customer's charge and isn't owed against the
  // invoice's total. Without subtracting fee_amount, balance_due ended up
  // negative (or stayed wrong on partial-payment scenarios) any time a
  // gateway-added fee was present.
  const [[agg]] = await db.query(
    `SELECT COALESCE(SUM(amount - COALESCE(fee_amount, 0)), 0) AS paid
       FROM payments
      WHERE invoice_id = :id AND status IN ('captured','authorized')`,
    { id: invoiceId });
  const amount_paid = Math.round(Number(agg.paid) * 100) / 100;
  const balance_due = Math.round((Number(inv.total) - amount_paid) * 100) / 100;
  const isPaid = balance_due <= 0.005;
  await db.query(
    `UPDATE invoices
        SET amount_paid = :amount_paid,
            balance_due = :balance_due,
            status = CASE
              WHEN :paid = 1 THEN 'paid'
              WHEN :amount_paid > 0 AND status IN ('sent','overdue','draft') THEN 'partial'
              ELSE status END,
            paid_at = CASE WHEN :paid = 1 AND paid_at IS NULL THEN NOW() ELSE paid_at END
      WHERE id = :id`,
    { amount_paid, balance_due, paid: isPaid ? 1 : 0, id: invoiceId }
  );
  return { amount_paid, balance_due, paid: isPaid };
}

// maybeSendReceiptEmail lives in services/receipts.js — shared by this route
// (checkout/manual-send call sites) and billing-cron.js's recurring auto-
// charge success path, so both get the same donation/membership/commerce
// slug branching instead of two copies of this logic drifting apart.

// =============================================================================
// Public (unauthenticated) endpoints first — customer-facing checkout + webhooks.
// =============================================================================

// Public invoice view scoped by a 256-bit random payment_token — the primary
// endpoint for the customer pay page.  Token-based URLs prevent enumeration
// of sequential invoice IDs and the PII they contain.
router.get('/public/invoice/by-token/:token', async (req, res, next) => {
  try {
    const token = String(req.params.token || '');
    if (!PAY_TOKEN_RE.test(token)) return res.status(400).json({ error: 'Invalid token' });

    const [[invoice]] = await db.query(
      `SELECT i.id, i.invoice_number, i.issue_date, i.due_date, i.currency,
              i.subtotal, i.tax_rate, i.tax_amount, i.discount_amount,
              i.total, i.amount_paid, i.balance_due, i.status, i.memo,
              CONCAT_WS(' ', c.first_name, c.last_name) AS contact_name,
              c.email AS contact_email,
              o.name AS organization_name
         FROM invoices i
         LEFT JOIN contacts c      ON c.id = i.contact_id
         LEFT JOIN organizations o ON o.id = i.organization_id
        WHERE i.payment_token = :token`,
      { token });
    if (!invoice) return res.status(404).json({ error: 'Not found' });

    const [lines] = await db.query(
      'SELECT id, description, quantity, unit_price, amount FROM invoice_line_items WHERE invoice_id = :id ORDER BY sort_order, id',
      { id: invoice.id });
    const [[latestPayment]] = await db.query(
      `SELECT id, amount, status, received_at, created_at, receipt_token
         FROM payments
        WHERE invoice_id = :id
          AND status IS NOT NULL
          AND LOWER(status) NOT IN ('failed','voided','refunded','cancelled')
        ORDER BY id DESC LIMIT 1`, { id: invoice.id });
    await db.query(
      `UPDATE invoices SET viewed_at = COALESCE(viewed_at, NOW()) WHERE id = :id`, { id: invoice.id });
    res.json({ invoice, line_items: lines, latest_payment: latestPayment || null });
  } catch (err) { next(err); }
});

// The legacy public-invoice-by-integer-id route (security remediation C-04)
// was retired here: unauthenticated, sequential id, no proof the caller
// owned the invoice, and it leaked a receipt_token capability plus invoice
// financial detail to anyone who could count. Confirmed via the mirrored
// production data that every invoice already carries a payment_token, so no
// live pre-token pay-link depends on this route — use /by-token/:token,
// which requires actually holding the token.

// Public Passage.js client-token — no auth required, used by the pay page.
// Only works for Valor; returns the same clientToken + epi as the auth'd vault route.
router.get('/public/client-token', async (req, res, next) => {
  try {
    const { valorGetClientToken } = require('../services/gateways');
    const cfg = await getDefaultGateway();
    if (!cfg || cfg.gateway !== 'valor') {
      return res.status(400).json({ error: 'No active Valor gateway configured' });
    }
    const clientToken = await valorGetClientToken(cfg);
    res.json({
      clientToken, epi: String(cfg.epi_id || ''), mode: cfg.mode,
      achEnabled: !!cfg.ach_enabled, achAuthorizationText: cfg.ach_authorization_text || null,
    });
  } catch (err) { next(err); }
});

// Create a hosted-payment session for this invoice — returns iframe src/token
// Public: customers don't have to log in to pay.
router.post('/public/checkout/:invoiceId', async (req, res, next) => {
  try {
    const invoiceId = Number(req.params.invoiceId);
    const gateway = req.body?.gateway || null;   // 'valor' | 'authnet' | null (default)
    const mode    = req.body?.mode || null;

    const [[inv]] = await db.query(
      `SELECT i.id, i.invoice_number, i.currency, i.balance_due, i.status,
              i.contact_id, i.organization_id, i.tax_amount, i.tax_rate,
              i.discount_amount, i.customer_po_number, i.tax_exempt,
              i.processing_fee, i.fee_label,
              c.email AS contact_email
         FROM invoices i LEFT JOIN contacts c ON c.id = i.contact_id
        WHERE i.id = :id`, { id: invoiceId });
    if (!inv) return res.status(404).json({ error: 'Not found' });
    if (Number(inv.balance_due) <= 0) {
      return res.status(400).json({ error: 'Invoice has no balance due' });
    }
    if (inv.status === 'void') {
      return res.status(400).json({ error: 'Invoice is void' });
    }

    // Fetch line items + org for L2/L3 enrichment.
    const [lineItems] = await db.query(
      `SELECT id, description, quantity, unit_price, amount,
              commodity_code, product_code, unit_of_measure
         FROM invoice_line_items WHERE invoice_id = :id ORDER BY sort_order, id`,
      { id: invoiceId });
    let org = null;
    if (inv.organization_id) {
      const [[o]] = await db.query(
        `SELECT id, name, tax_exempt, tax_id, default_po_number
           FROM organizations WHERE id = :id`, { id: inv.organization_id });
      org = o || null;
    }

    // Honor a client-provided returnUrl when same-origin (safer than letting
    // an external host be the post-payment landing — that'd be a phishing
    // hand-off). Otherwise build the default one. Default points back at the
    // /pay/:id page (NOT /pay/:id/return — that has no React route, so the
    // gateway's redirect would 404 and the auto-confirm useEffect would
    // never fire).
    // Security remediation (Phase 5 adversarial retest, new finding) — the
    // same-origin check used to be `requested.startsWith(origin)`, a prefix
    // check bypassable with `${origin}.evil.com`, `${origin}@evil.com`, or
    // (since origin here has no trailing slash) `${origin}evil.com`. This
    // matters more than a typical open redirect: returnUrl feeds directly
    // into the gateway call below — Authorize.net's hosted-payment
    // iframe-communicator origin AND Valor's redirect/callback URLs — so a
    // bypass could redirect the gateway's own transaction-response
    // hand-off to an attacker-controlled host. Compare the PARSED origin
    // exactly (scheme+host+port), matching the same allowedOrigins list
    // index.js's CORS check uses (CLIENT_ORIGIN, comma-separated).
    const allowedOrigins = (process.env.CLIENT_ORIGIN || 'http://localhost:5173')
      .split(',').map((o) => o.trim().replace(/\/+$/, '')).filter(Boolean);
    const origin = allowedOrigins[0];
    const requested = String(req.body?.returnUrl || '').trim();
    let requestedOrigin = null;
    try { requestedOrigin = new URL(requested).origin; } catch { /* not a valid absolute URL */ }
    const returnUrl = (requested && requestedOrigin && allowedOrigins.includes(requestedOrigin))
      ? requested
      : `${origin}/pay/${invoiceId}?paid=1`;

    // Valor uses the inline Passage.js form — no hosted-page session needed.
    // Just resolve the gateway config + fee and return early. The pending payment
    // row is created by POST /public/charge/:invoiceId when the card is charged.
    const resolvedGateway = gateway || null;
    const cfgCheck = await (resolvedGateway
      ? getGateway(resolvedGateway, mode)
      : getDefaultGateway());
    if (!cfgCheck) return res.status(400).json({ error: 'No active payment gateway configured.' });

    if (cfgCheck.gateway === 'valor') {
      // Mirror /public/charge/:invoiceId's fee resolution exactly — if a fee
      // was already quoted and baked into balance_due at checkout time (e.g.
      // a donor's voluntary "cover the fee" add-on), use it as-is rather than
      // also running computeProcessingFee() on top, which would preview a
      // double-counted charge amount the actual charge step won't match.
      let fee;
      if (Number(inv.processing_fee) > 0) {
        fee = { amount: Number(inv.processing_fee), label: inv.fee_label || 'Processing Fee' };
      } else {
        const isB2B = Boolean(inv.organization_id);
        const feeAllowed = !cfgCheck.b2b_only || isB2B;
        fee = feeAllowed ? computeProcessingFee({ cfg: cfgCheck, baseAmount: Number(inv.balance_due) }) : null;
      }
      const charge_amount = Number(inv.processing_fee) > 0
        ? Number(inv.balance_due)
        : Math.round((Number(inv.balance_due) + (fee?.amount || 0)) * 100) / 100;
      return res.json({ gateway: 'valor', fee, charge_amount, base_amount: Number(inv.balance_due) });
    }

    const result = await createHostedCheckout({
      gateway, mode, invoice: inv, lineItems, org, returnUrl,
    });

    // Persist the fee + L2/L3 markers on the invoice. We do this BEFORE handing
    // the user to the iframe so even if they abandon the flow the invoice
    // reflects what was offered. The fee clears itself on successful capture
    // via the webhook's balance recompute.
    await db.query(
      `UPDATE invoices
          SET processing_fee = :fee,
              fee_label      = :flab,
              level2_sent    = :l2,
              level3_sent    = :l3
        WHERE id = :id`,
      {
        id: invoiceId,
        fee:  result.fee?.amount || 0,
        flab: result.fee?.label || null,
        l2:   result.l2 ? 1 : 0,
        l3:   result.l3 ? 1 : 0,
      }
    );

    // Record a pending payment so the webhook/return has something to attach
    // to. Snapshot the gateway mode, fee, and customer IP up front — we have
    // them now even if the gateway response is sparse later.
    // req.ip (security remediation H-06) — respects the configured trust
    // proxy hop count rather than trusting a raw, spoofable header.
    const customerIp = req.ip || null;
    // 256-bit random token used as the PUBLIC receipt URL for this payment.
    // Generated up-front so even an abandoned/pending payment has a stable
    // unguessable identifier — never expose `payments.id` in customer-facing
    // URLs (it's a small sequential int and trivially enumerable).
    const receiptToken = crypto.randomBytes(32).toString('hex');
    // IMPORTANT: external_txn_id is the GATEWAY TRANSACTION ID — assigned
    // only AFTER the card is charged. We do NOT store the hosted-page session
    // token here (Valor's `uid`, Auth.net's hosted token), because those are
    // session references, not transaction ids. Conflating them confuses every
    // downstream lookup (refresh-from-gateway, backfill, reporting reconciliation).
    // external_txn_id stays NULL on this insert and is filled in by the
    // webhook / postMessage / confirm path once Valor returns the real
    // transactionId.
    // Store the Valor session uid in external_txn_id so auto-enrich can use it
    // to call ?txnstatus after the customer pays. It will be overwritten by the
    // real transaction ID once the webhook or confirm path receives it.
    const sessionToken = result.token || null;
    await db.query(
      `INSERT INTO payments
         (invoice_id, gateway, method, amount, currency, status,
          fee_amount, fee_label, gateway_mode, customer_ip,
          external_txn_id,
          receipt_token)
       VALUES (:iid, :gw, 'card', :amt, :cur, 'pending',
               :fee, :flab, :gmode, :cip,
               :stok,
               :rtok)`,
      {
        iid: invoiceId,
        gw: result.kind,
        amt: Number(result.charge_amount),
        cur: inv.currency,
        fee:  result.fee?.amount || null,
        flab: result.fee?.label  || null,
        gmode: result.cfg?.mode || null,
        cip: customerIp,
        stok: sessionToken,
        rtok: receiptToken,
      }
    );

    res.json({
      gateway: result.kind,
      token: result.token,
      iframeSrc: result.iframeSrc,
      postUrl: result.postUrl,
      fee: result.fee,
      charge_amount: result.charge_amount,
      base_amount: result.base_amount,
      level2_sent: !!result.l2,
      level3_sent: !!result.l3,
    });
  } catch (err) { next(err); }
});

// ---------- receipts (public) ----------
//
// GET  /public/receipt/by-token/:token            → HTML (browser can print-to-PDF)
// GET  /public/receipt/by-token/:token.pdf        → PDF download
// POST /public/receipt/by-token/:token/email      → emails PDF to contact (or `to` body field)
//
// `:token` is the per-payment 64-char hex `receipt_token` (256 bits of
// entropy). It MUST be used in customer-facing URLs — the receipt itself
// exposes name/email/last-4/amount, and the old `:paymentId` form was
// trivially enumerable (sequential primary key). Anyone in possession of the
// token has a capability link to that one receipt; no token = no access.
//
// We deliberately removed the `:paymentId` form. It existed only because
// random-token URLs hadn't been added yet; keeping it would re-open the IDOR.
// If a server-side caller (admin UI, scheduled job) needs a receipt by id,
// it can look up the token first via the authenticated payments API.

const TOKEN_RE = /^[a-f0-9]{64}$/i;

// PDF receipt — must be declared BEFORE the HTML route. Express's
// path-to-regexp treats `:token` as greedy within the segment, so without
// this ordering the HTML handler would steal "abc...123.pdf".
router.get('/public/receipt/by-token/:token.pdf', async (req, res, next) => {
  try {
    const token = String(req.params.token || '');
    if (!TOKEN_RE.test(token)) return res.status(400).json({ error: 'Invalid receipt token' });
    const data = await loadReceiptDataByToken(token);
    if (!data) return res.status(404).json({ error: 'Not found' });
    const buf = await renderReceiptPdf(data);
    res.set('Content-Type', 'application/pdf');
    res.set('Content-Disposition',
      `attachment; filename="receipt-${data.payment.invoice_number}-${data.payment.id}.pdf"`);
    res.send(buf);
  } catch (err) { next(err); }
});

router.get('/public/receipt/by-token/:token', async (req, res, next) => {
  try {
    // Strip any trailing extension (.pdf, .html) defensively, then validate.
    // Without this, a URL like "/by-token/<tok>.pdf" that slipped past the
    // .pdf route would mis-fire token validation below.
    const raw = String(req.params.token || '').replace(/\.[a-zA-Z0-9]+$/, '');
    if (!TOKEN_RE.test(raw)) return res.status(400).send('Invalid receipt token');
    const data = await loadReceiptDataByToken(raw);
    if (!data) return res.status(404).send('Receipt not found');
    res.set('Content-Type', 'text/html; charset=utf-8');
    res.send(renderReceiptHtml(data));
  } catch (err) { next(err); }
});

router.post('/public/receipt/by-token/:token/email', express.json(), async (req, res, next) => {
  try {
    const token = String(req.params.token || '');
    if (!TOKEN_RE.test(token)) return res.status(400).json({ error: 'Invalid receipt token' });
    const data = await loadReceiptDataByToken(token);
    if (!data) return res.status(404).json({ error: 'Not found' });

    // Always send to the contact on file — do NOT allow the caller to override
    // the recipient address.  Allowing an arbitrary `to` turns this into an open
    // email relay that can be used to spam or phish any address (Finding 3).
    const to = data.payment.contact_email;
    if (!to) return res.status(400).json({ error: 'No recipient email address on file for this receipt.' });

    const pdf = await renderReceiptPdf(data);

    // Try system template; fall back to raw receipt HTML
    let subject, html;
    try {
      const rendered = await renderBySlug('payment_receipt', {
        contact_id: data.payment.contact_id,
        payment_id: data.payment.id,
      });
      subject = rendered.subject;
      html    = rendered.html;
    } catch (_) {
      html    = renderReceiptHtml(data);
      const receiptNo = `RCPT-${String(data.payment.id).padStart(6, '0')}`;
      subject = `Receipt ${receiptNo} — Invoice ${data.payment.invoice_number}`;
    }

    subject = subject || `Receipt — Invoice ${data.payment.invoice_number}`;

    await sendMail({
      to,
      subject,
      html,
      attachments: [{
        filename: `receipt-${data.payment.invoice_number}-${data.payment.id}.pdf`,
        content: pdf,
        contentType: 'application/pdf',
      }],
      entityType: 'invoice',
      entityId: data.payment.invoice_id,
    });

    await logActivity({
      entityType: 'invoice', entityId: data.payment.invoice_id,
      action: 'receipt_emailed',
      description: `Receipt ${receiptNo} emailed to ${to}`,
    });

    res.json({ ok: true, to });
  } catch (err) { next(err); }
});

// ---------- legacy receipt routes (REMOVED — see comment above) ----------
//
// The `:paymentId` form is intentionally gone. We return 410 Gone so any old
// links still in transit (cached emails, bookmarks) get a clear, monitorable
// signal rather than a silent 404 — and a uniform 410 also avoids leaking
// "real id, can't read it" vs "doesn't exist" via response timing.
//
// Two handlers cover the three pre-existing URL shapes:
//   /public/receipt/:legacy           (HTML and `.pdf` extension)
//   /public/receipt/:legacy/email     (email POST)
// They sit AFTER the by-token routes so the new paths take precedence in
// Express's match-in-order routing.
const legacyGone = (_req, res) => res.status(410).json({
  error: 'Receipt URLs by id are no longer supported. Use /public/receipt/by-token/:token instead.',
});
router.all('/public/receipt/:legacy', legacyGone);
router.all('/public/receipt/:legacy/email', legacyGone);

// ---------- Passage.js inline charge (Valor) ----------
// Called by PassagePaymentForm after the customer enters card details directly
// in our page (no hosted-page redirect). Valor tokenizes the card client-side
// via Passage.js; we receive the token and run a direct /?pagesale charge.
// Returns the full payment result immediately — no auto-enrich needed.
router.post('/public/charge/:invoiceId', publicPaymentLimiter, express.json(), async (req, res, next) => {
  try {
    const invoiceId = Number(req.params.invoiceId);
    const { card_token, cardholder_name, last4, card_brand, expiry } = req.body || {};
    if (!card_token) return res.status(400).json({ error: 'card_token is required' });

    const [[inv]] = await db.query(
      `SELECT i.id, i.invoice_number, i.total, i.balance_due, i.currency,
              i.contact_id, i.organization_id, i.processing_fee, i.fee_label,
              c.email AS contact_email, c.first_name, c.last_name
         FROM invoices i
         LEFT JOIN contacts c ON c.id = i.contact_id
        WHERE i.id = :id AND i.status NOT IN ('paid','voided','cancelled')`,
      { id: invoiceId }
    );
    if (!inv) return res.status(404).json({ error: 'Invoice not found or already paid' });

    const cfg = await getGateway('valor', null);
    if (!cfg) return res.status(400).json({ error: 'No active Valor gateway configured' });

    // Passage.js's cardholder-name field isn't always populated (donor left it
    // blank, or Passage didn't render it) — Valor rejects a blank name with
    // E08 "INVALID CARD HOLDER NAME". Fall back to the invoice's contact name
    // rather than send undefined (same fallback donations.js/membership.js use).
    const cardholderName = resolveCardholderName(cardholder_name, `${inv.first_name || ''} ${inv.last_name || ''}`);

    // If a fee was already decided and baked into balance_due at checkout
    // time (e.g. a donor's voluntary "cover the fee" add-on — see
    // donations.js's /public/checkout), use that recorded amount as-is and
    // never also run computeProcessingFee() on top of it: balance_due
    // already includes it, so re-adding would double-charge the customer.
    // Only fall back to the mandatory-surcharge computation when no fee was
    // quoted up front.
    let fee;
    if (Number(inv.processing_fee) > 0) {
      fee = { amount: Number(inv.processing_fee), label: inv.fee_label || 'Processing Fee' };
    } else {
      // Same b2b_only gate the checkout-preview step (/public/checkout/:invoiceId)
      // applies — card-network rules restrict surcharging individual consumers
      // in many states, so a b2b_only gateway only surcharges org-billed invoices.
      const isB2B = Boolean(inv.organization_id);
      const feeAllowed = !cfg.b2b_only || isB2B;
      fee = feeAllowed ? computeProcessingFee({ cfg, baseAmount: Number(inv.balance_due) }) : null;
    }
    const chargeAmount = Number(inv.processing_fee) > 0
      ? Number(inv.balance_due)
      : Number(inv.balance_due) + (fee?.amount || 0);
    const receiptToken = crypto.randomBytes(32).toString('hex');
    const customerIp = req.ip || null; // security remediation H-06

    // Insert pending payment row.
    const [ins] = await db.query(
      `INSERT INTO payments
         (invoice_id, gateway, method, amount, currency, status,
          fee_amount, fee_label, gateway_mode, customer_ip,
          card_last4, card_brand, card_expiry, card_holder_name,
          receipt_token)
       VALUES (:iid, 'valor', 'card', :amt, :cur, 'pending',
               :fee, :flab, :gmode, :cip,
               :last4, :brand, :exp, :holder,
               :rtok)`,
      {
        iid:   invoiceId,
        amt:   Number(chargeAmount.toFixed(2)),
        cur:   inv.currency || 'USD',
        fee:   fee?.amount || null,
        flab:  fee?.label  || null,
        gmode: cfg.mode    || null,
        cip:   customerIp,
        last4: last4   || null,
        brand: card_brand || null,
        exp:   expiry  || null,
        holder: cardholderName || null,
        rtok:  receiptToken,
      }
    );
    const paymentId = ins.insertId;

    // Charge via Valor /?pagesale.
    let txnResult;
    try {
      txnResult = await valorVaultCharge(cfg, {
        card_token,
        amount:           chargeAmount,
        invoicenumber:    inv.invoice_number,
        cardholdername:   cardholderName,
        email:            inv.contact_email || undefined,
        surcharge_amount: fee?.amount || 0,
      });
    } catch (chargeErr) {
      await db.query(
        `UPDATE payments SET status='failed', processor_code = :pcode, processor_message = :pmsg WHERE id=:id`,
        { id: paymentId, pcode: chargeErr.gatewayCode || null, pmsg: chargeErr.rawMessage || chargeErr.message || null }
      );
      return res.status(402).json({ error: chargeErr.message });
    }

    const mapped = mapValorVaultChargeResponse(txnResult);
    const resolvedStatus = mapped?.status || 'failed';

    await db.query(
      `UPDATE payments
          SET status           = :status,
              external_txn_id  = COALESCE(:tid,   external_txn_id),
              external_auth_code = COALESCE(:auth, external_auth_code),
              card_last4       = COALESCE(:last4,  card_last4),
              card_brand       = COALESCE(:brand,  card_brand),
              card_expiry      = COALESCE(:exp,    card_expiry),
              card_holder_name = COALESCE(:holder, card_holder_name),
              processor_message = COALESCE(:pmsg,  processor_message),
              processor_code   = COALESCE(:pcode,  processor_code),
              received_at      = NOW()
        WHERE id = :id`,
      {
        status: resolvedStatus,
        tid:    mapped?.txnId   || null,
        auth:   mapped?.auth    || null,
        last4:  mapped?.last4   || last4  || null,
        brand:  mapped?.brand   || card_brand || null,
        exp:    mapped?.exp     || expiry  || null,
        holder: mapped?.holder  || cardholder_name || null,
        pmsg:   mapped?.pmsg    || null,
        pcode:  mapped?.pcode   || null,
        id:     paymentId,
      }
    );

    if (resolvedStatus === 'captured' || resolvedStatus === 'authorized') {
      await refreshInvoiceAfterPayment(invoiceId);
      (async () => {
        await tagInvoicePaymentAsDonation(paymentId);
        await maybeSendReceiptEmail(paymentId);
      })();
    }

    await logActivity({
      entityType: 'invoice', entityId: invoiceId,
      action: resolvedStatus === 'captured' ? 'payment_captured' : 'payment_failed',
      description: `Inline Passage.js charge: ${resolvedStatus}${mapped?.txnId ? ` (txn ${mapped.txnId})` : ''}`,
    });

    return res.json({
      ok:                true,
      status:            resolvedStatus,
      txnId:             mapped?.txnId   || null,
      last4:             mapped?.last4   || last4  || null,
      brand:             mapped?.brand   || card_brand || null,
      amount:            chargeAmount,
      processor_message: mapped?.pmsg    || null,
      receipt_token:     receiptToken,
    });
  } catch (err) { next(err); }
});

// ---------- Passage.js ACH charge (Valor) ----------
// Passage.js POSTs a hidden form here (URL-encoded body) after the customer
// fills in bank account details. We call Valor /?pagesale with the ACH fields
// and return an HTML page that relays the result to the parent frame via
// postMessage — because the form navigates the iframe to this URL.
router.post('/public/ach-charge/:invoiceId', publicPaymentLimiter, express.urlencoded({ extended: false }), async (req, res, next) => {
  // Use the explicit allowed origin so postMessage is not broadcast to every
  // frame — wildcard '*' would let any parent window intercept the ACH result.
  const _achOrigin = (process.env.CLIENT_ORIGIN || 'http://localhost:5173').split(',')[0].trim();
  function htmlResult(payload) {
    const json        = JSON.stringify(payload).replace(/</g, '\\u003c');
    const safeOrigin  = JSON.stringify(_achOrigin); // quoted for inline JS
    return `<!DOCTYPE html><html><body><script>
      (function(){
        var t = window.parent !== window ? window.parent : window.opener;
        if (t) t.postMessage(${json}, ${safeOrigin});
      })();
    <\/script></body></html>`;
  }

  try {
    const invoiceId = Number(req.params.invoiceId);
    const b = req.body || {};
    // Passage.js's ACH sub-form is a real, uncontrollable browser form POST
    // (unlike card, which fires a JS event). Confirmed via live traffic
    // capture (not DOM inspection, which reflects the visible <input> names
    // and NOT what Passage.js actually submits): it POSTs
    // routing_number/account_number/account_type/account_holder_name/
    // ach_entry_class/ach_txn_type verbatim — only the txn type's VALUE needs
    // mapping, from Passage's own "Debit"/"Credit" to Valor's expected
    // "ACHDebit"/"ACHCredit".
    const routing_number      = b.routing_number;
    const account_number      = b.account_number;
    const account_type        = b.account_type;
    const account_holder_name = b.account_holder_name;
    const ach_entry_class     = b.ach_entry_class;
    const ach_txn_type        = b.ach_txn_type === 'Credit' ? 'ACHCredit' : 'ACHDebit';

    if (!routing_number || !account_number) {
      return res.send(htmlResult({ type: 'PASSAGE_ACH_RESULT', status: 'failed', error: 'Routing and account number are required.' }));
    }

    const [[inv]] = await db.query(
      `SELECT i.id, i.invoice_number, i.total, i.balance_due, i.currency,
              i.contact_id, i.organization_id,
              c.email AS contact_email, c.first_name, c.last_name
         FROM invoices i
         LEFT JOIN contacts c ON c.id = i.contact_id
        WHERE i.id = :id AND i.status NOT IN ('paid','voided','cancelled')`,
      { id: invoiceId }
    );
    if (!inv) return res.send(htmlResult({ type: 'PASSAGE_ACH_RESULT', status: 'failed', error: 'Invoice not found or already paid.' }));

    const cfg = await getGateway('valor', null);
    if (!cfg) return res.send(htmlResult({ type: 'PASSAGE_ACH_RESULT', status: 'failed', error: 'No active Valor gateway configured.' }));

    // Fee is OFF for ACH by default (computeProcessingFee returns null for
    // method: 'ach' unless fee_applies_to is 'all') — this route had no fee
    // handling at all before, which happened to already match that default,
    // but silently: turning fee_applies_to to 'all' did nothing here.
    const isB2B = Boolean(inv.organization_id);
    const feeAllowed = !cfg.b2b_only || isB2B;
    const fee = feeAllowed ? computeProcessingFee({ cfg, baseAmount: Number(inv.balance_due), method: 'ach' }) : null;
    const chargeAmount = Math.round((Number(inv.balance_due) + (fee?.amount || 0)) * 100) / 100;
    if (fee?.amount > 0) {
      const [[{ lineCount }]] = await db.query(
        'SELECT COUNT(*) AS lineCount FROM invoice_line_items WHERE invoice_id = :id', { id: invoiceId });
      await db.query(
        `INSERT INTO invoice_line_items (invoice_id, description, quantity, unit_price, amount, sort_order)
         VALUES (:invoice_id, :desc, 1, :amount, :amount, :sort_order)`,
        { invoice_id: invoiceId, desc: fee.label, amount: fee.amount, sort_order: lineCount }
      );
    }

    const receiptToken = crypto.randomBytes(32).toString('hex');
    const customerIp = req.ip || null; // security remediation H-06

    const [ins] = await db.query(
      `INSERT INTO payments
         (invoice_id, gateway, method, amount, currency, status,
          fee_amount, fee_label, gateway_mode, customer_ip, card_holder_name, receipt_token)
       VALUES (:iid, 'valor', 'ach', :amt, :cur, 'pending',
               :fee, :flab, :gmode, :cip, :holder, :rtok)`,
      {
        iid:    invoiceId,
        amt:    Number(chargeAmount.toFixed(2)),
        cur:    inv.currency || 'USD',
        fee:    fee?.amount || null,
        flab:   fee?.label || null,
        gmode:  cfg.mode || null,
        cip:    customerIp,
        holder: account_holder_name || null,
        rtok:   receiptToken,
      }
    );
    const paymentId = ins.insertId;

    // Call Valor /?pagesale with ACH fields.
    const { valorAchCharge } = require('../services/gateways');
    let txnResult;
    try {
      txnResult = await valorAchCharge(cfg, {
        routing_number,
        account_number,
        account_type:        account_type        || 'checking',
        account_holder_name: account_holder_name || '',
        ach_entry_class:     ach_entry_class      || 'WEB',
        ach_txn_type:        ach_txn_type         || 'sale',
        amount:              chargeAmount,
        invoicenumber:       inv.invoice_number,
        email:               inv.contact_email    || undefined,
      });
    } catch (chargeErr) {
      await db.query(`UPDATE payments SET status='failed' WHERE id=:id`, { id: paymentId });
      return res.send(htmlResult({ type: 'PASSAGE_ACH_RESULT', status: 'failed', error: chargeErr.message }));
    }

    const { mapValorVaultChargeResponse } = require('../services/gateways');
    const mapped = mapValorVaultChargeResponse(txnResult);
    const resolvedStatus = mapped?.status || 'failed';

    await db.query(
      `UPDATE payments
          SET status             = :status,
              external_txn_id    = COALESCE(:tid,   external_txn_id),
              external_auth_code = COALESCE(:auth,  external_auth_code),
              card_holder_name   = COALESCE(:holder, card_holder_name),
              processor_message  = COALESCE(:pmsg,  processor_message),
              processor_code     = COALESCE(:pcode, processor_code),
              received_at        = NOW()
        WHERE id = :id`,
      {
        status: resolvedStatus,
        tid:    mapped?.txnId || null,
        auth:   mapped?.auth  || null,
        holder: account_holder_name || null,
        pmsg:   mapped?.pmsg  || null,
        pcode:  mapped?.pcode || null,
        id:     paymentId,
      }
    );

    if (resolvedStatus === 'captured') {
      // Mark invoice paid if balance is now covered.
      await db.query(
        `UPDATE invoices SET status = 'paid', paid_at = NOW()
          WHERE id = :id AND balance_due <= :amt`,
        { id: invoiceId, amt: chargeAmount }
      );
    }

    // ACH settles over 1-3 business days rather than approving instantly —
    // a healthy debit comes back 'pending' (Valor's IPN webhook flips it to
    // captured/failed later, same as any other pending payment in this app),
    // not an immediate decline. Only a genuine failed/voided/refunded status
    // is treated as an actual error here.
    const ok = resolvedStatus === 'captured' || resolvedStatus === 'pending';
    return res.send(htmlResult({
      type:    'PASSAGE_ACH_RESULT',
      status:  resolvedStatus,
      txnId:   mapped?.txnId  || null,
      amount:  chargeAmount,
      pmsg:    mapped?.pmsg   || null,
      error:   ok ? null : (mapped?.pmsg || 'ACH payment was not approved.'),
    }));
  } catch (err) { next(err); }
});

// =============================================================================
// Vault-ACH — recurring/vaulted ACH debits (membership signup, recurring
// donation setup, portal/staff "add payment method"). Shares one endpoint
// across all three "surfaces" since the shape is identical: vault the bank
// account server-side at Valor (never store the raw routing/account numbers
// ourselves — same PCI-adjacent posture as never storing a card PAN), then
// dispatch to whatever that surface needs to do next.
//
// Passage.js's ACH sub-form does a real, uncontrollable browser form POST —
// it can't carry the donor/tier/fund fields the way a card's tokenReceived
// JS event lets us hand them off directly. Those fields are captured into a
// payment_intents row (kind='vault') by each surface's own intent-creation
// endpoint below, BEFORE the payment iframe ever loads, and looked up here
// by id once the raw POST lands.
// =============================================================================

async function upsertContactFromDonor({ first_name, last_name, email, phone }, leadSource) {
  const [[existing]] = await db.query('SELECT id FROM contacts WHERE email = :email LIMIT 1', { email });
  if (existing) return existing.id;
  const [r] = await db.query(
    `INSERT INTO contacts (first_name, last_name, email, phone, lead_source)
     VALUES (:first_name, :last_name, :email, :phone, :lead_source)`,
    { first_name: first_name || '', last_name: last_name || '', email, phone: phone || null, lead_source: leadSource }
  );
  return r.insertId;
}

async function nextVaultInvoiceNumber() {
  const cfg = await moduleSettings.get('invoices');
  const pfx = (cfg.invoice_prefix || 'INV').trim().toUpperCase();
  const year = new Date().getUTCFullYear();
  const prefix = `${pfx}-${year}-`;
  const [rows] = await db.query(
    `SELECT invoice_number FROM invoices WHERE invoice_number LIKE :p ORDER BY id DESC LIMIT 1`,
    { p: `${prefix}%` }
  );
  const last = rows[0]?.invoice_number;
  const seq = last ? Number(last.split('-').pop()) + 1 : 1;
  return `${prefix}${String(seq).padStart(6, '0')}`;
}

// Vaults the bank account under an existing (or new) Valor vault customer and
// records it in vault_profiles. Shared by all three surfaces below.
async function vaultACHAccount(cfg, {
  contactId, organizationId, customerName, customerEmail, customerPhone,
  routing_number, account_number, account_type, account_holder_name, ach_entry_class,
}) {
  const [[existing]] = await db.query(
    `SELECT valor_vault_id FROM vault_profiles
      WHERE gateway = 'valor' AND valor_vault_id IS NOT NULL
        AND ((:cid IS NOT NULL AND contact_id = :cid) OR (:oid IS NOT NULL AND organization_id = :oid))
      LIMIT 1`,
    { cid: contactId ?? null, oid: organizationId ?? null }
  );
  let vaultId = existing?.valor_vault_id || null;
  if (!vaultId) {
    vaultId = await valorVaultAddCustomer(cfg, {
      customer_name: customerName || 'Customer', customer_email: customerEmail, customer_phone: customerPhone,
    });
  }
  const achProfileId = await valorVaultAddACHProfile(cfg, {
    vault_id: vaultId, routing_number, account_number, account_type,
    payee_name: account_holder_name, entry_class: ach_entry_class,
  });

  const [vp] = await db.query(
    `INSERT INTO vault_profiles
       (contact_id, organization_id, gateway, valor_vault_id, valor_payment_profile_id,
        last4, cardholder_name, payment_method, is_default, created_by)
     VALUES
       (:contact_id, :organization_id, 'valor', :vault_id, :ach_profile_id,
        :last4, :holder, 'ach', 0, NULL)`,
    {
      contact_id: contactId ?? null, organization_id: organizationId ?? null,
      vault_id: vaultId, ach_profile_id: achProfileId || vaultId,
      last4: String(account_number).slice(-4), holder: account_holder_name || null,
    }
  );
  return { vaultProfileId: vp.insertId, vaultId, achProfileId: achProfileId || vaultId };
}

// Creates the invoice for the first cycle, charges the vaulted ACH account,
// and (if captured) creates the subscription that carries every renewal
// forward. Shared by the membership and recurring-donation surfaces — the
// only things that differ between them are handled by the caller via
// extraSubscriptionFields and whatever surface-specific row they create
// afterward (a donations row + fund tag vs a membership tag).
async function chargeVaultAchAndCreateSubscription({
  cfg, contactId, vaultId, achProfileId, vaultProfileId, amount, memo, achTxnType, email,
  intervalUnit, intervalCount, extraSubscriptionFields,
}) {
  const number = await nextVaultInvoiceNumber();
  const today = new Date().toISOString().slice(0, 10);
  const paymentToken = crypto.randomBytes(32).toString('hex');

  // Fee is OFF for ACH by default — see computeProcessingFee's method:'ach'
  // gate. Both callers (membership, recurring donation) are always
  // individuals, never org-billed, same as their card equivalents
  // (donations.js/membership.js's /public/recurring and /public/signup).
  const fee = !cfg.b2b_only ? computeProcessingFee({ cfg, baseAmount: amount, method: 'ach' }) : null;
  const chargeAmount = Math.round((amount + (fee?.amount || 0)) * 100) / 100;

  const [inv] = await db.query(
    `INSERT INTO invoices
       (payment_token, invoice_number, contact_id, issue_date, due_date, currency,
        subtotal, tax_rate, tax_amount, discount_rate, discount_amount, total,
        amount_paid, balance_due, status, memo)
     VALUES
       (:payment_token, :invoice_number, :contact_id, :issue_date, :due_date, 'USD',
        :amount, 0, 0, 0, 0, :total, 0, :total, 'sent', :memo)`,
    { payment_token: paymentToken, invoice_number: number, contact_id: contactId, issue_date: today, due_date: today, amount, total: chargeAmount, memo }
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
    chargeJson = await valorVaultAchCharge(cfg, { vault_id: vaultId, payment_profile_id: achProfileId, amount: chargeAmount, invoicenumber: number, email, ach_txn_type: achTxnType });
  } catch (chargeErr) {
    return { ok: false, error: chargeErr.message || 'Your bank account could not be charged.' };
  }
  const mapped = mapValorVaultChargeResponse(chargeJson);
  // ACH settles over 1-3 business days rather than approving instantly — a
  // healthy debit comes back 'pending' (Valor's IPN webhook flips it to
  // captured/failed later), not an immediate decline. The subscription still
  // gets created now (waiting for settlement would mean no ACH signup ever
  // completes) — only a genuine failed/voided/refunded status blocks it.
  const fulfilled = mapped?.status === 'captured' || mapped?.status === 'pending';
  const receiptToken = crypto.randomBytes(32).toString('hex');
  const [pay] = await db.query(
    `INSERT INTO payments
       (invoice_id, gateway, method, amount, currency, status,
        fee_amount, fee_label,
        external_txn_id, external_auth_code, card_holder_name,
        processor_message, processor_code, processor_response, received_at, receipt_token, vault_profile_id)
     VALUES
       (:iid, 'valor', 'ach', :amount, 'USD', :status, :fee, :flab, :txnId, :auth, :holder,
        :pmsg, :pcode, CAST(:raw AS JSON), NOW(), :rtok, :vaultProfileId)`,
    {
      iid: invoiceId, amount: chargeAmount, status: mapped?.status || 'failed',
      fee: fee?.amount || null, flab: fee?.label || null,
      txnId: mapped?.txnId || null, auth: mapped?.auth || null, holder: mapped?.holder || null,
      pmsg: mapped?.pmsg || null, pcode: mapped?.pcode || null, raw: JSON.stringify(chargeJson),
      rtok: receiptToken, vaultProfileId,
    }
  );
  if (!fulfilled) {
    return { ok: false, error: mapped?.pmsg || 'Your first payment could not be processed. Please try a different account.' };
  }

  const { refreshInvoiceTotalsById } = require('./invoices');
  await refreshInvoiceTotalsById(invoiceId);

  const { addInterval } = require('../jobs/billing-cron');
  const nextRun = addInterval(today, intervalUnit, intervalCount);
  const [sub] = await db.query(
    `INSERT INTO subscriptions
       (name, contact_id, currency, interval_unit, interval_count, start_date, next_run_date, end_date,
        status, auto_charge, gateway, gateway_profile_id, vault_profile_id, fund_id, membership_tier_id, owner_id)
     VALUES
       (:name, :contact_id, 'USD', :interval_unit, :interval_count, :start_date, :next_run_date, :end_date,
        'active', :auto_charge, 'valor', :gateway_profile_id, :vault_profile_id, :fund_id, :membership_tier_id, NULL)`,
    {
      name: memo, contact_id: contactId, interval_unit: intervalUnit, interval_count: intervalCount,
      start_date: today, next_run_date: nextRun, gateway_profile_id: String(vaultProfileId), vault_profile_id: vaultProfileId,
      fund_id: extraSubscriptionFields?.fund_id || null, membership_tier_id: extraSubscriptionFields?.membership_tier_id || null,
      // Only a one-time membership sets these (services/membershipTerms.js);
      // every other caller keeps an open-ended, auto-charging subscription.
      end_date: extraSubscriptionFields?.end_date || null, auto_charge: extraSubscriptionFields?.auto_charge ?? 1,
    }
  );
  await db.query(
    `INSERT INTO subscription_items (subscription_id, description, quantity, unit_price, sort_order)
     VALUES (:sid, :desc, 1, :amount, 0)`,
    { sid: sub.insertId, desc: memo, amount }
  );

  return { ok: true, invoiceId, paymentId: pay.insertId, subscriptionId: sub.insertId, status: mapped.status };
}

async function completeMembershipACH({ cfg, d, achFields }) {
  const [[tier]] = await db.query(
    'SELECT * FROM membership_tiers WHERE slug = :slug AND is_active = 1', { slug: d.tier_slug }
  );
  if (!tier) return { ok: false, error: 'Unknown or inactive membership tier' };
  const donor = d.donor || {};
  if (!donor.email) return { ok: false, error: 'Donor email is required' };

  const contactId = await upsertContactFromDonor(donor, 'membership_signup');
  const donorFullName = `${donor.first_name || ''} ${donor.last_name || ''}`.trim();
  const { vaultProfileId, vaultId, achProfileId } = await vaultACHAccount(cfg, {
    contactId, organizationId: null, customerName: donorFullName || 'Member',
    customerEmail: donor.email, customerPhone: donor.phone, ...achFields,
  });

  const amount = Number(tier.price);
  const { membershipTerms } = require('../services/membershipTerms');
  const terms = membershipTerms(d.frequency, new Date().toISOString().slice(0, 10));
  const memo = `Membership — ${tier.name} (${terms.label})`;
  const result = await chargeVaultAchAndCreateSubscription({
    cfg, contactId, vaultId, achProfileId, vaultProfileId, amount, memo, achTxnType: achFields.ach_txn_type, email: donor.email,
    intervalUnit: terms.intervalUnit, intervalCount: terms.intervalCount,
    extraSubscriptionFields: { membership_tier_id: tier.id, end_date: terms.endDate, auto_charge: terms.autoCharge },
  });
  if (!result.ok) return result;

  const { ensureConstituentTag, notifyMembershipEvent } = require('../services/constituents');
  await ensureConstituentTag(contactId, 'Member');
  await notifyMembershipEvent('membership.started', contactId, { tierName: tier.name, amount });
  return { ok: true, subscriptionId: result.subscriptionId, status: result.status };
}

async function completeRecurringDonationACH({ cfg, d, achFields }) {
  const amount = Number(d.amount);
  if (!amount || amount <= 0) return { ok: false, error: 'Invalid donation amount' };
  const donor = d.donor || {};
  if (!donor.email) return { ok: false, error: 'Donor email is required' };

  const fundSlug = String(d.fund_slug || '').trim();
  let fund = null;
  if (fundSlug) {
    const [[f]] = await db.query('SELECT id, name FROM funds WHERE slug = :slug AND is_active = 1', { slug: fundSlug });
    if (!f) return { ok: false, error: 'Unknown or inactive fund' };
    fund = f;
  }

  const contactId = await upsertContactFromDonor(donor, 'donation_form');
  const donorFullName = `${donor.first_name || ''} ${donor.last_name || ''}`.trim();
  const { vaultProfileId, vaultId, achProfileId } = await vaultACHAccount(cfg, {
    contactId, organizationId: null, customerName: donorFullName || 'Donor',
    customerEmail: donor.email, customerPhone: donor.phone, ...achFields,
  });

  const intervalUnit = ['day', 'week', 'month', 'year'].includes(d.interval_unit) ? d.interval_unit : 'month';
  const intervalCount = Number(d.interval_count) > 0 ? Number(d.interval_count) : 1;
  const memo = fund ? `Recurring donation to ${fund.name}` : 'Recurring donation';

  const result = await chargeVaultAchAndCreateSubscription({
    cfg, contactId, vaultId, achProfileId, vaultProfileId, amount, memo, achTxnType: achFields.ach_txn_type, email: donor.email,
    intervalUnit, intervalCount, extraSubscriptionFields: { fund_id: fund?.id || null },
  });
  if (!result.ok) return result;

  const [donIns] = await db.query(
    `INSERT INTO donations (contact_id, fund_id, payment_id, invoice_id, source, dedication_note, is_anonymous)
     VALUES (:contact_id, :fund_id, :payment_id, :invoice_id, :source, :dedication_note, :is_anonymous)`,
    {
      contact_id: contactId, fund_id: fund?.id || null, payment_id: result.paymentId, invoice_id: result.invoiceId,
      source: d.source === 'sms' ? 'sms' : 'form',
      dedication_note: d.dedication_note || null, is_anonymous: d.is_anonymous ? 1 : 0,
    }
  );
  const { ensureConstituentTag, notifyDonationCaptured } = require('../services/constituents');
  await ensureConstituentTag(contactId, 'Donor');
  await notifyDonationCaptured(contactId, { amount, fundName: fund?.name, isRecurring: true });
  return { ok: true, subscriptionId: result.subscriptionId, donationId: donIns.insertId, status: result.status };
}

// No charge here — just vaults the account for future use (portal donor
// managing their own methods, or staff adding one on a customer's behalf).
async function completeAddPaymentMethodACH({ cfg, intent, achFields }) {
  const contactId = intent.contact_id || null;
  const organizationId = intent.organization_id || null;
  if (!contactId && !organizationId) return { ok: false, error: 'No contact or organization linked to this payment method' };
  const payload = typeof intent.payload === 'string' ? JSON.parse(intent.payload) : intent.payload;

  let customerName, customerEmail, customerPhone;
  if (contactId) {
    const [[ct]] = await db.query(
      `SELECT CONCAT_WS(' ', first_name, last_name) AS name, email, phone FROM contacts WHERE id = :id`, { id: contactId }
    );
    customerName = ct?.name; customerEmail = ct?.email; customerPhone = ct?.phone;
  } else {
    const [[org]] = await db.query('SELECT name, email, phone FROM organizations WHERE id = :id', { id: organizationId });
    customerName = org?.name; customerEmail = org?.email; customerPhone = org?.phone;
  }

  const { vaultProfileId } = await vaultACHAccount(cfg, {
    contactId, organizationId, customerName: customerName || 'Customer', customerEmail, customerPhone, ...achFields,
  });

  if (payload.nickname) {
    await db.query('UPDATE vault_profiles SET nickname = :n WHERE id = :id', { n: payload.nickname, id: vaultProfileId });
  }
  if (payload.is_default) {
    await db.query(
      `UPDATE vault_profiles SET is_default = 0
        WHERE gateway = 'valor' AND ((:cid IS NOT NULL AND contact_id = :cid) OR (:oid IS NOT NULL AND organization_id = :oid))`,
      { cid: contactId, oid: organizationId }
    );
    await db.query('UPDATE vault_profiles SET is_default = 1 WHERE id = :id', { id: vaultProfileId });
  }
  return { ok: true, vaultProfileId };
}

router.post('/public/vault-ach/:intentId', publicPaymentLimiter, express.urlencoded({ extended: false }), async (req, res, next) => {
  const _achOrigin = (process.env.CLIENT_ORIGIN || 'http://localhost:5173').split(',')[0].trim();
  function htmlResult(payload) {
    const json = JSON.stringify(payload).replace(/</g, '\\u003c');
    const safeOrigin = JSON.stringify(_achOrigin);
    return `<!DOCTYPE html><html><body><script>
      (function(){
        var t = window.parent !== window ? window.parent : window.opener;
        if (t) t.postMessage(${json}, ${safeOrigin});
      })();
    <\/script></body></html>`;
  }

  try {
    const intentId = Number(req.params.intentId);
    const [[intent]] = await db.query(
      `SELECT * FROM payment_intents WHERE id = :id AND kind = 'vault'`, { id: intentId }
    );
    if (!intent || intent.status !== 'pending' || new Date(intent.expires_at) < new Date()) {
      return res.send(htmlResult({ type: 'PASSAGE_ACH_RESULT', status: 'failed', error: 'This session has expired — please go back and try again.' }));
    }
    const d = typeof intent.payload === 'string' ? JSON.parse(intent.payload) : intent.payload;

    const b = req.body || {};
    const routing_number      = b.routing_number;
    const account_number      = b.account_number;
    const account_type        = b.account_type;
    const account_holder_name = b.account_holder_name;
    const ach_entry_class     = b.ach_entry_class;
    const ach_txn_type        = b.ach_txn_type === 'Credit' ? 'ACHCredit' : 'ACHDebit';

    if (!routing_number || !account_number) {
      return res.send(htmlResult({ type: 'PASSAGE_ACH_RESULT', status: 'failed', error: 'Routing and account number are required.' }));
    }

    const cfg = await getGateway('valor', null);
    if (!cfg) return res.send(htmlResult({ type: 'PASSAGE_ACH_RESULT', status: 'failed', error: 'No active Valor gateway configured.' }));

    const achFields = { routing_number, account_number, account_type, account_holder_name, ach_entry_class, ach_txn_type };
    let result;
    try {
      if (intent.surface === 'membership') {
        result = await completeMembershipACH({ cfg, d, achFields });
      } else if (intent.surface === 'recurring_donation') {
        result = await completeRecurringDonationACH({ cfg, d, achFields });
      } else if (intent.surface === 'add_payment_method') {
        result = await completeAddPaymentMethodACH({ cfg, intent, achFields });
      } else {
        result = { ok: false, error: 'Unknown request' };
      }
    } catch (surfaceErr) {
      result = { ok: false, error: surfaceErr.message || 'Could not process your bank account.' };
    }

    await db.query('UPDATE payment_intents SET status = :status, completed_at = NOW() WHERE id = :id',
      { status: result.ok ? 'completed' : 'failed', id: intentId });

    if (!result.ok) return res.send(htmlResult({ type: 'PASSAGE_ACH_RESULT', status: 'failed', error: result.error }));
    // add_payment_method never charges anything (result.status is unset
    // there), so 'captured' is the right generic "done" signal for it —
    // membership/recurring_donation set result.status to the real charge
    // outcome ('captured' or 'pending', since ACH settles asynchronously).
    return res.send(htmlResult({ type: 'PASSAGE_ACH_RESULT', status: result.status || 'captured', ...result }));
  } catch (err) { next(err); }
});

// ---------- manual confirm fallback (for localhost dev / no-webhook setups) ----------
//
// Valor's IPN can't reach http://localhost — in local dev we need a way to
// flip the pending payment to captured without the webhook.  This endpoint is
// intentionally DISABLED in production (NODE_ENV=production) because it is
// unauthenticated.  In production the Valor webhook handles all captures.
//
// To enable in a non-standard environment (e.g. staging behind a firewall),
// set ALLOW_PUBLIC_PAYMENT_CONFIRM=true explicitly.
router.post('/public/confirm/:invoiceId', publicPaymentLimiter, express.json(), async (req, res, next) => {
  // Block in production unless operator explicitly opts in.
  if (process.env.NODE_ENV === 'production' &&
      process.env.ALLOW_PUBLIC_PAYMENT_CONFIRM !== 'true') {
    return res.status(404).json({ error: 'Not found' });
  }
  try {
    const invoiceId = Number(req.params.invoiceId);
    const txnId   = req.body?.transactionId || req.body?.txnId || null;
    const amount  = Number(req.body?.amount || 0) || null;
    const last4   = req.body?.last4 || null;
    const brand   = req.body?.brand || null;
    const auth    = req.body?.authCode || req.body?.approvalCode || null;
    const exp     = req.body?.expiry  || req.body?.cardExpiry || null;
    const holder  = req.body?.cardHolder || req.body?.cardHolderName || null;
    const pmsg    = req.body?.message || req.body?.responseMessage || null;
    // Refund/void enrichment fields. The manual-confirm path is used in local
    // dev (where webhooks can't reach localhost) — capturing these here means
    // a later refund/void has the same audit trail it would in production.
    const pcode   = req.body?.processorCode || req.body?.processor_code
                    || req.body?.responseCode || null;
    const avs     = req.body?.avsResult || req.body?.avs_result || req.body?.avs || null;
    const avsMsg  = req.body?.avsMessage || req.body?.avs_message || null;
    const cvv     = req.body?.cvvResult || req.body?.cvv_result || req.body?.cvv || null;
    const cvvMsg  = req.body?.cvvMessage || req.body?.cvv_message || null;
    // Customer IP: trust an explicit body value first (the iframe return URL
    // may pass through what the gateway saw); otherwise infer from the request.
    const cip     = req.body?.customerIp || req.body?.customer_ip
                    || req.ip // security remediation H-06
                    || null;
    // Optional billing snapshot — accept either a pre-built JSON string or an
    // object we can stringify. Stored in payments.billing_address (JSON column).
    const billingRaw = req.body?.billingAddress || req.body?.billing_address || null;
    const billing = billingRaw
      ? (typeof billingRaw === 'string' ? billingRaw : JSON.stringify(billingRaw))
      : null;

    // Look at BOTH a pending row and the most-recent captured row — sometimes
    // the manual fallback flips the row to captured before this enrichment
    // path runs (race between the postMessage listener and the button), and
    // we still want to enrich. We prefer pending if it exists.
    const [[pending]] = await db.query(
      `SELECT p.id, p.amount, p.gateway, p.gateway_mode, p.external_txn_id,
              p.card_brand, p.card_last4, p.external_auth_code, p.status,
              i.invoice_number
         FROM payments p JOIN invoices i ON i.id = p.invoice_id
        WHERE p.invoice_id = :id
          AND p.status IN ('pending', 'captured')
        ORDER BY (p.status = 'pending') DESC, p.id DESC LIMIT 1`, { id: invoiceId });

    if (!pending) {
      const [[inv]] = await db.query(
        `SELECT status, balance_due FROM invoices WHERE id = :id`, { id: invoiceId });
      return res.json({ ok: true, already: true, invoice: inv || null });
    }

    // Auto-enrichment for Valor — if the row has no real gateway data yet
    // (typical for the manual "I've completed payment" fallback button, OR a
    // row that got captured with only the session uid in external_txn_id),
    // query Valor's reporting API by invoice number to find the transaction
    // the customer just made. Then call ?txnstatus to pull full details.
    // This is the localhost-dev substitute for the IPN webhook.
    //
    // Note: external_txn_id alone is NOT a reliable "we have data" signal —
    // we store Valor's session uid there at start-checkout time, before any
    // real txn exists. We use card_last4 + card_brand as the truth signal
    // because those only land after a successful transaction.
    let auto = {};
    // Use card presence (not amount) as the signal — Valor always appends
    // amount to the redirect URL even when it sends no card details, which
    // previously caused the auto-enrich search to be skipped entirely.
    const callerProvidedCardData = !!(txnId || last4 || brand || auth);
    const rowLacksCardData = !pending.card_brand && !pending.card_last4;
    if (pending.gateway === 'valor' && !callerProvidedCardData && rowLacksCardData) {
      try {
        const cfg = await getGateway('valor', pending.gateway_mode || null);
        if (cfg) {
          // valorSearchByInvoice now uses /?txnfetch with filter=VT_INVOICE and
          // returns the full transaction record directly (no second round-trip).
          // eslint-disable-next-line no-console
          console.log(`[confirm:${invoiceId}] Valor auto-enrich: searching by invoice ${pending.invoice_number}`);
          const record = await valorSearchByInvoice(cfg, pending.invoice_number).catch((e) => {
            // eslint-disable-next-line no-console
            console.warn(`[confirm:${invoiceId}] valorSearchByInvoice failed:`, e.message);
            return null;
          });
          // eslint-disable-next-line no-console
          console.log(`[confirm:${invoiceId}] valorSearchByInvoice record →`, record);

          const mapped = mapValorTransactionResponse(record);
          if (mapped) {
            auto = {
              tid:    mapped.txnId  || null,
              auth:   mapped.auth   || null,
              amt:    mapped.amount || null,
              last4:  mapped.last4  || null,
              brand:  mapped.brand  || null,
              exp:    mapped.exp    || null,
              holder: mapped.holder || null,
              pmsg:   mapped.pmsg   || null,
              pcode:  mapped.pcode  || null,
              avs:    mapped.avs    || null,
              cvv:    mapped.cvv    || null,
              // Use gateway-reported status; fall back to 'captured' for
              // manual-confirm (no Valor record found) so the button still works.
              status: mapped.status || null,
            };
          }
        }
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn(`[confirm:${invoiceId}] auto-enrich error (non-fatal):`, e.message);
      }
    }

    // Use gateway-verified status when available; default to 'captured' for
    // the manual-confirm fallback path (no auto-enrich data).
    const resolvedStatus = auto.status || 'captured';

    await db.query(
      `UPDATE payments
          SET status = :resolvedStatus,
              external_txn_id = COALESCE(:tid, external_txn_id),
              external_auth_code = COALESCE(:auth, external_auth_code),
              amount = COALESCE(:amt, amount),
              card_last4 = COALESCE(:last4, card_last4),
              card_brand = COALESCE(:brand, card_brand),
              card_expiry = COALESCE(:exp, card_expiry),
              card_holder_name = COALESCE(:holder, card_holder_name),
              processor_message = COALESCE(:pmsg, processor_message),
              processor_code = COALESCE(:pcode, processor_code),
              avs_result = COALESCE(:avs, avs_result),
              avs_message = COALESCE(:avsmsg, avs_message),
              cvv_result = COALESCE(:cvv, cvv_result),
              cvv_message = COALESCE(:cvvmsg, cvv_message),
              customer_ip = COALESCE(:cip, customer_ip),
              billing_address = COALESCE(CAST(:billing AS JSON), billing_address),
              received_at = NOW()
        WHERE id = :id`,
      // Caller-provided values take precedence; the `auto` lookup result
      // fills in when caller is silent (?? not ||, so empty strings are kept).
      { resolvedStatus,
        tid:   txnId  ?? auto.tid    ?? null,
        auth:  auth   ?? auto.auth   ?? null,
        amt:   amount ?? auto.amt    ?? null,
        last4: last4  ?? auto.last4  ?? null,
        brand: brand  ?? auto.brand  ?? null,
        exp:   exp    ?? auto.exp    ?? null,
        holder:holder ?? auto.holder ?? null,
        pmsg:  pmsg   ?? auto.pmsg   ?? null,
        pcode: pcode  ?? auto.pcode  ?? null,
        avs:   avs    ?? auto.avs    ?? null,
        avsmsg: avsMsg, cvv: cvv ?? auto.cvv ?? null, cvvmsg: cvvMsg,
        cip, billing,
        id: pending.id });

    // Only recalculate invoice totals for successful payments.
    const after = resolvedStatus === 'captured' || resolvedStatus === 'authorized'
      ? await refreshInvoiceAfterPayment(invoiceId)
      : null;
    await logActivity({
      entityType: 'invoice', entityId: invoiceId,
      action: 'payment_confirmed',
      description: `Payment manually confirmed${txnId ? ` (txn ${txnId})` : ''}`,
    });

    res.json({ ok: true, payment_id: pending.id, ...after });
  } catch (err) { next(err); }
});

// Lightweight status probe — the pay page polls this to detect webhook-driven
// captures without reloading the full invoice payload.
router.get('/public/status/:invoiceId', async (req, res, next) => {
  try {
    const id = Number(req.params.invoiceId);
    const [[inv]] = await db.query(
      `SELECT status, balance_due, amount_paid FROM invoices WHERE id = :id`, { id });
    if (!inv) return res.status(404).json({ error: 'Not found' });
    const [[lastPay]] = await db.query(
      `SELECT status FROM payments WHERE invoice_id = :id ORDER BY id DESC LIMIT 1`,
      { id });
    res.json({
      status: inv.status,
      balance_due: Number(inv.balance_due),
      amount_paid: Number(inv.amount_paid),
      last_payment_status: lastPay?.status || null,
    });
  } catch (err) { next(err); }
});

// ---------- webhooks (gateway → us) ----------

// Authorize.net webhooks are signed with HMAC-SHA512 using signature_key.
// https://developer.authorize.net/api/reference/features/webhooks.html
//
// Security: use express.raw() so we sign the exact bytes Auth.net sent — if
// we used express.json() and re-serialized, whitespace/key-order differences
// can silently invalidate the HMAC.  Use timingSafeEqual to prevent timing attacks.
router.post('/webhook/authnet', express.raw({ type: '*/*', limit: '1mb' }), async (req, res) => {
  try {
    const cfg = await getGateway('authnet', null);
    if (!cfg?.signature_key) return res.status(400).json({ error: 'Gateway not configured' });

    const rawBody = req.body; // Buffer (express.raw gives us a Buffer)
    const signatureHeader = (req.headers['x-anet-signature'] || '').toUpperCase();
    const expected = ('sha512=' +
      crypto.createHmac('sha512', cfg.signature_key)
        .update(rawBody)
        .digest('hex').toUpperCase());

    let verified = false;
    try {
      // timingSafeEqual requires same-length buffers — pad/truncate defensively.
      const sigBuf = Buffer.from(signatureHeader, 'utf8');
      const expBuf = Buffer.from(expected, 'utf8');
      verified = sigBuf.length === expBuf.length &&
                 crypto.timingSafeEqual(sigBuf, expBuf);
    } catch (_) { verified = false; }

    if (!verified) {
      // eslint-disable-next-line no-console
      console.warn('[authnet webhook] bad signature');
      return res.status(401).json({ error: 'Bad signature' });
    }

    // Parse JSON body now that the signature is verified.
    let evt;
    try { evt = JSON.parse(rawBody.toString('utf8')); }
    catch (_) { return res.status(400).json({ error: 'Invalid JSON body' }); }
    const payload = evt?.payload || {};
    const transId = payload.id;
    const eventType = evt.eventType || '';

    // Find matching pending payment
    const [[pending]] = await db.query(
      `SELECT id, invoice_id FROM payments
        WHERE gateway = 'authnet'
          AND (external_txn_id = :tid OR external_txn_id = :invNum)
        ORDER BY id DESC LIMIT 1`,
      { tid: transId, invNum: payload.invoiceNumber || '' }
    );
    if (!pending) {
      return res.status(200).json({ ok: true, ignored: true });
    }

    // Fetch full txn details for accurate capture amount
    const txn = await authnetFetchTransaction(cfg, transId).catch(() => null);
    const t = txn?.transaction || {};
    const status =
      eventType.includes('authcapture.created') ? 'captured' :
      eventType.includes('auth.created')        ? 'authorized' :
      eventType.includes('refund.created')      ? 'refunded'   :
      eventType.includes('void.created')        ? 'voided'     :
      'captured';

    // Auth.net response shape: t.payment.creditCard, t.AVSResponse, t.cardCodeResponse,
    // t.responseReasonDescription, t.batch.batchId, t.billTo, t.customerIP
    const cc = t.payment?.creditCard || {};
    const billing = t.billTo
      ? JSON.stringify({
          firstName: t.billTo.firstName, lastName: t.billTo.lastName,
          company: t.billTo.company, address: t.billTo.address,
          city: t.billTo.city, state: t.billTo.state, zip: t.billTo.zip,
          country: t.billTo.country, phoneNumber: t.billTo.phoneNumber })
      : null;

    await db.query(
      `UPDATE payments
          SET status = :status,
              external_txn_id = :tid,
              external_auth_code = :auth,
              card_last4 = :last4,
              card_brand = :brand,
              card_expiry = :exp,
              card_holder_name = :holder,
              card_type = :ctype,
              avs_result = :avs,
              avs_message = :avsmsg,
              cvv_result = :cvv,
              processor_message = :pmsg,
              processor_code = :pcode,
              customer_ip = COALESCE(:cip, customer_ip),
              billing_address = COALESCE(CAST(:billing AS JSON), billing_address),
              batch_id = :batch,
              amount = :amount,
              processor_response = CAST(:pr AS JSON),
              received_at = NOW()
        WHERE id = :id`,
      {
        status,
        tid: transId,
        auth: t.authCode || null,
        last4: cc.cardNumber?.slice(-4) || null,
        brand: cc.cardType || null,
        exp: cc.expirationDate || null,
        holder: t.billTo ? `${t.billTo.firstName || ''} ${t.billTo.lastName || ''}`.trim() || null : null,
        ctype: cc.cardType || null,
        avs: t.AVSResponse || t.AVSResponseCode || null,
        avsmsg: t.AVSResponseDescription || null,
        cvv: t.cardCodeResponse || null,
        pmsg: t.responseReasonDescription || t.transactionStatus || null,
        pcode: t.responseCode || t.responseReasonCode || null,
        cip: t.customerIP || null,
        billing,
        batch: t.batch?.batchId || null,
        amount: Number(t.authAmount || payload.authAmount || 0) || 0,
        pr: JSON.stringify(evt),
        id: pending.id,
      }
    );
    await refreshInvoiceAfterPayment(pending.invoice_id);
    await logActivity({
      entityType: 'invoice', entityId: pending.invoice_id,
      action: 'payment_webhook',
      description: `Auth.net ${status}: ${transId}`,
      meta: { eventType } });

    res.json({ ok: true });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[authnet webhook] error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Valor IPN — posts form-encoded payload; we re-verify with webhook_secret
router.post('/webhook/valor',
  express.urlencoded({ extended: true, limit: '1mb' }),
  express.json({ limit: '1mb' }),
  async (req, res) => {
    try {
      const cfg = await getGateway('valor', null);
      const body = { ...(req.body || {}), ...(req.query || {}) };

      // Fail closed: if there's no webhook_secret configured we have no way
      // to authenticate this request.
      if (!cfg?.webhook_secret) {
        // eslint-disable-next-line no-console
        console.warn('[valor webhook] rejected: no webhook_secret configured for valor gateway');
        return res.status(503).json({ error: 'Valor gateway not configured (missing webhook_secret)' });
      }
      const provided = req.headers['x-valor-signature'] || body.signature || '';
      const expected = crypto.createHmac('sha256', cfg.webhook_secret)
        .update(JSON.stringify(body)).digest('hex');

      // Use timingSafeEqual to prevent timing side-channel attacks on the HMAC.
      let sigValid = false;
      try {
        const pBuf = Buffer.from(provided, 'hex');
        const eBuf = Buffer.from(expected, 'hex');
        sigValid = pBuf.length > 0 && pBuf.length === eBuf.length &&
                   crypto.timingSafeEqual(pBuf, eBuf);
      } catch (_) { sigValid = false; }

      if (!sigValid) {
        // eslint-disable-next-line no-console
        console.warn('[valor webhook] bad signature — provided:', provided ? provided.slice(0, 8) + '…' : '(empty)');
        return res.status(401).json({ error: 'Bad signature' });
      }

      // Log AFTER verifying the signature so we don't write attacker-supplied
      // card data to application logs on unsigned requests.  Redact PAN-adjacent
      // fields even on verified payloads.
      // eslint-disable-next-line no-console
      const safeBody = { ...body };
      delete safeBody.cardNumber; delete safeBody.card_number;
      delete safeBody.accountNumber; delete safeBody.account_number;
      delete safeBody.routingNumber; delete safeBody.routing_number;
      // eslint-disable-next-line no-console
      console.log('[valor webhook] verified', {
        headers: {
          'x-valor-signature': req.headers['x-valor-signature']
            ? req.headers['x-valor-signature'].slice(0, 8) + '…' : null,
          'content-type': req.headers['content-type'] || null,
        },
        bodyKeys: Object.keys(body),
        body: safeBody,
      });

      const session = body.sessionId || body.session_id || body.id;
      const invoiceNumber = body.orderNumber || body.order_number;
      const amount = Number(body.amount || body.authorizedAmount || 0);
      const txnId = body.transactionId || body.txnId || body.id;

      // Locate payment: first by token (sessionId), else by invoice number
      let pending = null;
      if (session) {
        const [rs1] = await db.query(
          `SELECT id, invoice_id FROM payments WHERE gateway='valor' AND external_txn_id = :t ORDER BY id DESC LIMIT 1`,
          { t: session });
        pending = rs1[0] || null;
      }
      if (!pending && invoiceNumber) {
        const [rs2] = await db.query(
          `SELECT p.id, p.invoice_id
             FROM payments p JOIN invoices i ON i.id = p.invoice_id
            WHERE p.gateway='valor' AND i.invoice_number = :num
            ORDER BY p.id DESC LIMIT 1`,
          { num: invoiceNumber });
        pending = rs2[0] || null;
      }
      if (!pending) return res.status(200).json({ ok: true, ignored: true });

      const status = (body.status || body.result || '').toLowerCase().includes('approv')
        ? 'captured'
        : (body.status || 'pending').toLowerCase();

      // Valor IPN field names vary by API version; cover the common variants.
      const billingSnap = (body.billing_address || body.billingAddress)
        ? JSON.stringify({
            address: body.billing_address || body.billingAddress,
            city:    body.billing_city    || body.billingCity,
            state:   body.billing_state   || body.billingState,
            zip:     body.billing_zip     || body.billingZip,
            country: body.billing_country || body.billingCountry,
          })
        : null;

      await db.query(
        `UPDATE payments
            SET status = :status,
                external_txn_id = :tid,
                external_auth_code = COALESCE(:auth, external_auth_code),
                amount = :amount,
                card_last4 = COALESCE(:last4, card_last4),
                card_brand = COALESCE(:brand, card_brand),
                card_expiry = COALESCE(:exp, card_expiry),
                card_holder_name = COALESCE(:holder, card_holder_name),
                avs_result = COALESCE(:avs, avs_result),
                cvv_result = COALESCE(:cvv, cvv_result),
                processor_message = COALESCE(:pmsg, processor_message),
                processor_code = COALESCE(:pcode, processor_code),
                billing_address = COALESCE(CAST(:billing AS JSON), billing_address),
                batch_id = COALESCE(:batch, batch_id),
                quickbooks_synced = COALESCE(:qb, quickbooks_synced),
                quickbooks_txn_id = COALESCE(:qbid, quickbooks_txn_id),
                processor_response = CAST(:pr AS JSON),
                received_at = NOW()
          WHERE id = :id`,
        {
          status,
          tid: txnId || session,
          auth: body.authCode || body.auth_code || body.approvalCode || null,
          amount: amount || 0,
          last4: body.cardLast4 || body.last4 || body.cardNumberLast4 || null,
          brand: body.cardBrand || body.brand || body.cardType || null,
          exp: body.cardExpiry || body.expiry || body.expirationDate || null,
          holder: body.cardHolder || body.cardHolderName || body.customer_name || null,
          avs: body.avsResult || body.avs_result || body.avsResponse || null,
          cvv: body.cvvResult || body.cvv_result || body.cvvResponse || null,
          pmsg: body.message || body.responseMessage || body.statusMessage || null,
          pcode: body.responseCode || body.code || null,
          billing: billingSnap,
          batch: body.batchId || body.batch_id || null,
          qb:   body.qbsync ? 1 : null,
          qbid: body.quickbooks_txn_id || body.qb_txn_id || null,
          pr: JSON.stringify(body),
          id: pending.id,
        }
      );
      if (status === 'captured') {
        await refreshInvoiceAfterPayment(pending.invoice_id);
        (async () => {
          await tagInvoicePaymentAsDonation(pending.id);
          await maybeSendReceiptEmail(pending.id);
        })();
      }
      await logActivity({
        entityType: 'invoice', entityId: pending.invoice_id,
        action: 'payment_webhook',
        description: `Valor ${status}: ${txnId || session}`,
      });

      res.json({ ok: true });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[valor webhook] error:', err);
      res.status(500).json({ error: err.message });
    }
  });

// =============================================================================
// Authenticated endpoints  —  settings, admin, history
// =============================================================================
router.use(requireAuth);

const { resolveOwnerScope, contactOwnerClause } = require('../services/scope');

// Which module a payment "belongs to" isn't stored anywhere on payments/invoices
// — it's derived by checking which module-specific thin table (if any) claims
// the same invoice_id, same convention as donations/orders/events themselves
// (see server/src/routes/checkout.js header comment). Shared between the rows
// query and the totals query below so filtering and display stay in sync.
const SOURCE_JOINS = `
  LEFT JOIN donations d              ON d.invoice_id = i.id
  LEFT JOIN orders ord                ON ord.invoice_id = i.id
  LEFT JOIN event_registrations er   ON er.invoice_id = i.id
  LEFT JOIN subscriptions sub         ON sub.id = i.subscription_id
  LEFT JOIN recurring_invoices ri     ON ri.id = i.recurring_invoice_id
  LEFT JOIN funds df                  ON df.id = d.fund_id
  LEFT JOIN funds sf                  ON sf.id = sub.fund_id
  LEFT JOIN membership_tiers mt       ON mt.id = sub.membership_tier_id
  LEFT JOIN events ev                 ON ev.id = er.event_id
`;
const SOURCE_FILTER_SQL = {
  donation: '(d.id IS NOT NULL OR sub.fund_id IS NOT NULL)',
  order: 'ord.id IS NOT NULL',
  event: 'er.id IS NOT NULL',
  membership: 'sub.membership_tier_id IS NOT NULL',
  subscription: '(i.subscription_id IS NOT NULL AND sub.fund_id IS NULL AND sub.membership_tier_id IS NULL)',
  recurring_invoice: 'i.recurring_invoice_id IS NOT NULL',
  invoice: '(d.id IS NULL AND ord.id IS NULL AND er.id IS NULL AND i.subscription_id IS NULL AND i.recurring_invoice_id IS NULL)',
};
const SOURCE_MODULE_CASE = `
  CASE
    WHEN d.id IS NOT NULL THEN 'donation'
    WHEN ord.id IS NOT NULL THEN 'order'
    WHEN er.id IS NOT NULL THEN 'event'
    WHEN sub.membership_tier_id IS NOT NULL THEN 'membership'
    WHEN sub.fund_id IS NOT NULL THEN 'donation'
    WHEN i.subscription_id IS NOT NULL THEN 'subscription'
    WHEN i.recurring_invoice_id IS NOT NULL THEN 'recurring_invoice'
    ELSE 'invoice'
  END`;
const SOURCE_LABEL_CASE = `
  CASE
    WHEN d.id IS NOT NULL THEN CONCAT('Donation', IF(df.name IS NOT NULL, CONCAT(' — ', df.name), ''))
    WHEN ord.id IS NOT NULL THEN CONCAT('Order ', ord.order_number)
    WHEN er.id IS NOT NULL THEN CONCAT('Event — ', ev.name)
    WHEN sub.membership_tier_id IS NOT NULL THEN CONCAT('Membership — ', mt.name)
    WHEN sub.fund_id IS NOT NULL THEN CONCAT('Recurring Donation — ', sf.name)
    WHEN i.subscription_id IS NOT NULL THEN CONCAT('Subscription — ', sub.name)
    WHEN i.recurring_invoice_id IS NOT NULL THEN CONCAT('Recurring Invoice — ', ri.name)
    ELSE 'Invoice'
  END`;
const SOURCE_LINK_CASE = `
  CASE
    WHEN ord.id IS NOT NULL THEN CONCAT('/admin/orders/', ord.id)
    WHEN er.id IS NOT NULL THEN CONCAT('/events/', er.event_id)
    WHEN sub.membership_tier_id IS NOT NULL THEN CONCAT('/subscriptions/', sub.id)
    WHEN sub.fund_id IS NOT NULL THEN CONCAT('/subscriptions/', sub.id)
    WHEN i.subscription_id IS NOT NULL THEN CONCAT('/subscriptions/', sub.id)
    WHEN i.recurring_invoice_id IS NOT NULL THEN CONCAT('/recurring-invoices/', ri.id)
    ELSE NULL
  END`;

router.get('/', requirePermission('payments.read'), async (req, res, next) => {
  try {
    const {
      invoice_id, page = 1, pageSize = 25,
      q, status, gateway, source, from, to,
    } = req.query;

    // Row-level scope — sales agents see only payments tied to their contacts.
    const scopeIds = await resolveOwnerScope(req.user);
    const scopeClause = contactOwnerClause(scopeIds, 'i.contact_id');

    // Build WHERE clause. We left-join contacts and orgs so the search and
    // result rows can show the customer name regardless of which side of the
    // invoice it lives on.
    const where = ['1=1']; const params = {};
    if (scopeClause) where.push(scopeClause);
    if (invoice_id) { where.push('p.invoice_id = :iid'); params.iid = invoice_id; }
    if (status)     { where.push('p.status = :status');  params.status = String(status).toLowerCase(); }
    if (gateway)    { where.push('p.gateway = :gateway'); params.gateway = String(gateway).toLowerCase(); }
    if (source && SOURCE_FILTER_SQL[source]) { where.push(SOURCE_FILTER_SQL[source]); }
    // Date range filters operate on created_at. We coerce string inputs into
    // start-of-day / end-of-day so 'YYYY-MM-DD' values do what users expect.
    if (from) {
      where.push('p.created_at >= :from');
      params.from = /\d{4}-\d{2}-\d{2}T/.test(String(from))
        ? from
        : `${String(from).slice(0, 10)} 00:00:00`;
    }
    if (to) {
      where.push('p.created_at <= :to');
      params.to = /\d{4}-\d{2}-\d{2}T/.test(String(to))
        ? to
        : `${String(to).slice(0, 10)} 23:59:59`;
    }
    if (q) {
      where.push(`(
        i.invoice_number LIKE :q OR
        p.external_txn_id LIKE :q OR
        p.external_auth_code LIKE :q OR
        p.card_last4 LIKE :q OR
        c.first_name LIKE :q OR c.last_name LIKE :q OR c.email LIKE :q OR
        o.name LIKE :q
      )`);
      params.q = `%${q}%`;
    }

    params.limit = Number(pageSize);
    params.offset = (Number(page) - 1) * Number(pageSize);

    const [rows] = await db.query(
      `SELECT p.*, i.invoice_number, i.contact_id, i.organization_id, i.subscription_id,
              CONCAT_WS(' ', c.first_name, c.last_name) AS contact_name,
              o.name AS organization_name,
              ${SOURCE_MODULE_CASE} AS source_module,
              ${SOURCE_LABEL_CASE} AS source_label,
              ${SOURCE_LINK_CASE} AS source_link
         FROM payments p
         JOIN invoices i        ON i.id = p.invoice_id
         LEFT JOIN contacts c      ON c.id = i.contact_id
         LEFT JOIN organizations o ON o.id = i.organization_id
         ${SOURCE_JOINS}
        WHERE ${where.join(' AND ')}
        ORDER BY p.created_at DESC
        LIMIT :limit OFFSET :offset`, params);
    // Aggregates run against the SAME WHERE clause so filters (date range,
    // status, etc.) drive the totals strip in the UI. Status-bucketed sums let
    // the UI present captured / pending / refunded separately without hitting
    // the database again.
    const [[totals]] = await db.query(
      `SELECT
          COUNT(*)                                                                    AS total,
          COALESCE(SUM(p.amount), 0)                                                  AS sum_amount,
          COALESCE(SUM(p.fee_amount), 0)                                              AS sum_fee,
          COALESCE(SUM(CASE WHEN p.status = 'captured'   THEN p.amount        ELSE 0 END), 0) AS sum_captured,
          COALESCE(SUM(CASE WHEN p.status = 'authorized' THEN p.amount        ELSE 0 END), 0) AS sum_authorized,
          COALESCE(SUM(CASE WHEN p.status = 'pending'    THEN p.amount        ELSE 0 END), 0) AS sum_pending,
          COALESCE(SUM(CASE WHEN p.status = 'refunded'   THEN p.refund_amount ELSE 0 END), 0) AS sum_refunded,
          COALESCE(SUM(CASE WHEN p.status = 'voided'     THEN p.amount        ELSE 0 END), 0) AS sum_voided,
          COALESCE(SUM(CASE WHEN p.status = 'failed'     THEN p.amount        ELSE 0 END), 0) AS sum_failed
         FROM payments p
         JOIN invoices i ON i.id = p.invoice_id
         LEFT JOIN contacts c      ON c.id = i.contact_id
         LEFT JOIN organizations o ON o.id = i.organization_id
         ${SOURCE_JOINS}
        WHERE ${where.join(' AND ')}`, params);
    res.json({
      rows,
      total: Number(totals.total || 0),
      page: Number(page),
      pageSize: Number(pageSize),
      totals: {
        count:        Number(totals.total       || 0),
        amount:       Number(totals.sum_amount  || 0),
        fees:         Number(totals.sum_fee     || 0),
        captured:     Number(totals.sum_captured   || 0),
        authorized:   Number(totals.sum_authorized || 0),
        pending:      Number(totals.sum_pending  || 0),
        refunded:     Number(totals.sum_refunded || 0),
        voided:       Number(totals.sum_voided   || 0),
        failed:       Number(totals.sum_failed   || 0),
      },
    });
  } catch (err) { next(err); }
});

// ---------- gateway settings ----------

router.get('/settings', requirePermission('settings.manage'), async (_req, res, next) => {
  try {
    const [rows] = await db.query(
      'SELECT * FROM payment_gateway_settings ORDER BY gateway, mode');
    const masked = rows.map((r) => ({
      ...r,
      transaction_key:   maskSecret(r.transaction_key),
      signature_key:     maskSecret(r.signature_key),
      api_key:           maskSecret(r.api_key),
      app_key:           maskSecret(r.app_key),
      public_client_key: r.public_client_key || '',
      webhook_secret:    maskSecret(r.webhook_secret),
    }));
    res.json(masked);
  } catch (err) { next(err); }
});

const gatewaySchema = z.object({
  gateway:           z.enum(['valor','authnet']),
  mode:              z.enum(['sandbox','live']).default('sandbox'),
  display_name:      z.string().optional().nullable(),
  // Auth.net
  api_login_id:      z.string().optional().nullable(),
  transaction_key:   z.string().optional().nullable(),
  public_client_key: z.string().optional().nullable(),
  signature_key:     z.string().optional().nullable(),
  // Valor
  epi_id:            z.string().optional().nullable(),
  api_key:           z.string().optional().nullable(),
  app_id:            z.string().optional().nullable(),
  app_key:           z.string().optional().nullable(),
  webhook_secret:    z.string().optional().nullable(),
  is_active:         z.boolean().optional(),
  is_default:        z.boolean().optional(),
  // L2 / L3 / B2B
  l2_enabled:             z.boolean().optional(),
  l3_enabled:             z.boolean().optional(),
  b2b_only:               z.boolean().optional(),
  ach_enabled:            z.boolean().optional(),
  ach_authorization_text: z.string().optional().nullable(),
  merchant_tax_id:        z.string().optional().nullable(),
  summary_commodity_code: z.string().optional().nullable(),
  default_commodity_code: z.string().optional().nullable(),
  // Processing fees
  fee_mode:         z.enum(['none','surcharge','convenience_fee','service_fee']).optional(),
  fee_percent:      z.coerce.number().min(0).max(100).optional(),
  fee_fixed:        z.coerce.number().min(0).optional(),
  fee_applies_to:   z.enum(['credit_only','credit_and_debit','all']).optional(),
  fee_label:        z.string().max(64).optional().nullable(),
  fee_disclosure:   z.string().optional().nullable(),
  // QuickBooks integration — when off, we send NO QuickBooks fields to the gateway.
  quickbooks_enabled:  z.boolean().optional(),
  quickbooks_realm_id: z.string().max(64).optional().nullable(),
});

router.put('/settings', requirePermission('settings.manage'), async (req, res, next) => {
  try {
    const d = gatewaySchema.parse(req.body);
    const [existingRows] = await db.query(
      'SELECT * FROM payment_gateway_settings WHERE gateway = :g AND mode = :m',
      { g: d.gateway, m: d.mode });
    const existing = existingRows[0];

    // Preserve secret when the client sent back the mask
    // Security remediation H-13 — a genuinely new value from the client gets
    // encrypted before it's ever placed in the payload; the masked-placeholder
    // branch just reuses the stored value unchanged (already encrypted from a
    // prior save, or untouched legacy plaintext pending the one-time
    // migration script — never re-encrypted here either way).
    const secret = (key) => (d[key] === '********' ? existing?.[key] : encryptSecret(d[key]));

    const payload = {
      gateway: d.gateway,
      mode: d.mode,
      display_name: d.display_name || null,
      api_login_id: d.api_login_id || null,
      transaction_key:   secret('transaction_key'),
      public_client_key: d.public_client_key || null,
      signature_key:     secret('signature_key'),
      epi_id:  d.epi_id || null,
      api_key: secret('api_key'),
      app_id:  d.app_id || null,
      app_key: secret('app_key'),
      webhook_secret: secret('webhook_secret'),
      is_active:  d.is_active === false ? 0 : 1,
      is_default: d.is_default ? 1 : 0,
      // L2 / L3 / B2B
      l2_enabled: d.l2_enabled ? 1 : 0,
      l3_enabled: d.l3_enabled ? 1 : 0,
      b2b_only:   d.b2b_only === false ? 0 : 1,
      ach_enabled: d.ach_enabled ? 1 : 0,
      ach_authorization_text: d.ach_authorization_text || null,
      merchant_tax_id:        d.merchant_tax_id || null,
      summary_commodity_code: d.summary_commodity_code || null,
      default_commodity_code: d.default_commodity_code || null,
      // Fees
      fee_mode:       d.fee_mode || 'none',
      fee_percent:    d.fee_percent ?? 0,
      fee_fixed:      d.fee_fixed   ?? 0,
      fee_applies_to: d.fee_applies_to || 'credit_only',
      fee_label:      d.fee_label || 'Processing Fee',
      fee_disclosure: d.fee_disclosure || null,
      // QuickBooks
      quickbooks_enabled:  d.quickbooks_enabled ? 1 : 0,
      quickbooks_realm_id: d.quickbooks_realm_id || null,
    };

    if (d.is_default) {
      await db.query('UPDATE payment_gateway_settings SET is_default = 0 WHERE is_default = 1');
    }

    if (existing) {
      payload.id = existing.id;
      await db.query(
        `UPDATE payment_gateway_settings SET
            display_name=:display_name, api_login_id=:api_login_id,
            transaction_key=:transaction_key, public_client_key=:public_client_key,
            signature_key=:signature_key, epi_id=:epi_id, api_key=:api_key,
            app_id=:app_id, app_key=:app_key, webhook_secret=:webhook_secret,
            is_active=:is_active, is_default=:is_default,
            l2_enabled=:l2_enabled, l3_enabled=:l3_enabled, b2b_only=:b2b_only,
            ach_enabled=:ach_enabled, ach_authorization_text=:ach_authorization_text,
            merchant_tax_id=:merchant_tax_id,
            summary_commodity_code=:summary_commodity_code,
            default_commodity_code=:default_commodity_code,
            fee_mode=:fee_mode, fee_percent=:fee_percent, fee_fixed=:fee_fixed,
            fee_applies_to=:fee_applies_to, fee_label=:fee_label,
            fee_disclosure=:fee_disclosure,
            quickbooks_enabled=:quickbooks_enabled,
            quickbooks_realm_id=:quickbooks_realm_id
         WHERE id=:id`, payload);
    } else {
      await db.query(
        `INSERT INTO payment_gateway_settings
            (gateway, mode, display_name, api_login_id, transaction_key, public_client_key,
             signature_key, epi_id, api_key, app_id, app_key, webhook_secret, is_active, is_default,
             l2_enabled, l3_enabled, b2b_only, ach_enabled, ach_authorization_text, merchant_tax_id,
             summary_commodity_code, default_commodity_code,
             fee_mode, fee_percent, fee_fixed, fee_applies_to, fee_label, fee_disclosure,
             quickbooks_enabled, quickbooks_realm_id)
         VALUES
            (:gateway, :mode, :display_name, :api_login_id, :transaction_key, :public_client_key,
             :signature_key, :epi_id, :api_key, :app_id, :app_key, :webhook_secret, :is_active, :is_default,
             :l2_enabled, :l3_enabled, :b2b_only, :ach_enabled, :ach_authorization_text, :merchant_tax_id,
             :summary_commodity_code, :default_commodity_code,
             :fee_mode, :fee_percent, :fee_fixed, :fee_applies_to, :fee_label, :fee_disclosure,
             :quickbooks_enabled, :quickbooks_realm_id)`,
        payload);
    }
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ---------- batch settlement reconciliation ----------
//
// On-demand polling of the gateway's settled-batch APIs to flip yesterday's
// pending payments to 'captured' and capture batch_id / settled_at / fees.
// The same code runs nightly at ~3:30am via batch-reconciliation-cron.js.
//
//   GET  /payments/batch-runs            → recent run history (for the UI)
//   POST /payments/reconcile-batches     → kick a run now (admin button)
//
router.get('/batch-runs', requirePermission('payments.read'), async (_req, res, next) => {
  try {
    const rows = await listRecentRuns({ limit: 50 });
    res.json({ rows });
  } catch (err) { next(err); }
});

router.post('/reconcile-batches', requirePermission('payments.write'), async (req, res, next) => {
  try {
    // Default window: last 48 hours. Caller can override.
    const hours = Math.max(1, Math.min(168, Number(req.body?.hours || 48)));
    const window_end   = new Date();
    const window_start = new Date(window_end.getTime() - hours * 60 * 60 * 1000);

    const results = await reconcileAllActiveGateways({
      window_start, window_end,
      trigger_kind: 'manual',
      triggered_by: req.user?.id || null,
    });
    res.json({ ok: true, hours, results });
  } catch (err) { next(err); }
});

// Capture — flip a specific pending payment row to captured and refresh the
// invoice. Used by admins when the gateway IPN can't reach us (e.g. localhost
// dev) or when the gateway fired an IPN we failed to verify. Idempotent: if
// the row is already captured we just no-op and return the current state.
router.post('/:id/capture', requirePermission('payments.write'), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const [[pay]] = await db.query('SELECT * FROM payments WHERE id = :id', { id });
    if (!pay) return res.status(404).json({ error: 'Not found' });

    if (String(pay.status).toLowerCase() === 'captured' ||
        String(pay.status).toLowerCase() === 'authorized') {
      return res.json({ ok: true, already: true, status: pay.status });
    }

    const txnId  = req.body?.transactionId || pay.external_txn_id || null;
    const amount = Number(req.body?.amount || pay.amount) || Number(pay.amount);
    const last4  = req.body?.last4 || pay.card_last4 || null;
    const brand  = req.body?.brand || pay.card_brand || null;

    await db.query(
      `UPDATE payments
          SET status = 'captured',
              external_txn_id = COALESCE(:tid, external_txn_id),
              amount = COALESCE(:amt, amount),
              card_last4 = COALESCE(:last4, card_last4),
              card_brand = COALESCE(:brand, card_brand),
              received_at = COALESCE(received_at, NOW())
        WHERE id = :id`,
      { tid: txnId, amt: amount, last4, brand, id });

    const after = await refreshInvoiceAfterPayment(pay.invoice_id);
    (async () => {
      await tagInvoicePaymentAsDonation(id);
      await maybeSendReceiptEmail(id);
    })();
    await logActivity({
      userId: req.user.id, entityType: 'invoice', entityId: pay.invoice_id,
      action: 'payment_captured',
      description: `Payment #${id} marked captured${txnId ? ` (txn ${txnId})` : ''}` });

    res.json({ ok: true, payment_id: id, ...after });
  } catch (err) { next(err); }
});

// Refresh from gateway — re-fetches the transaction from the gateway by its
// external_txn_id and applies whatever's missing locally. Useful when:
//   * The webhook never arrived (local dev, blocked URL, gateway hiccup).
//   * The IPN was sparse and we want the full record (AVS/CVV/auth code/etc.).
//   * Operators want a "trust-but-verify" before issuing a refund/void.
//
// Idempotent: applies via the same COALESCE pattern as the webhook handlers,
// so re-running won't blow away non-null fields with nulls.
router.post('/:id/refresh', requirePermission('payments.write'), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const [[pay]] = await db.query('SELECT * FROM payments WHERE id = :id', { id });
    if (!pay) return res.status(404).json({ error: 'Not found' });
    if (!pay.external_txn_id) {
      return res.status(400).json({ error: 'Payment has no external_txn_id to refresh against' });
    }

    const cfg = await getGateway(pay.gateway, pay.gateway_mode);
    if (!cfg) return res.status(400).json({ error: `Gateway ${pay.gateway} is not configured` });

    let mapped = null;   // fields to UPDATE
    let raw    = null;   // raw gateway payload (for processor_response + debugging)

    if (pay.gateway === 'authnet') {
      const txn = await authnetFetchTransaction(cfg, pay.external_txn_id);
      raw = txn;
      const t = txn?.transaction;
      if (!t) {
        return res.status(502).json({
          error: 'Authorize.net returned no transaction',
          messages: txn?.messages || null,
        });
      }
      // Map Auth.net's transactionStatus → our local status enum.
      const ts = String(t.transactionStatus || '').toLowerCase();
      const status =
        ts.includes('refund')                ? 'refunded'   :
        ts.includes('void')                  ? 'voided'     :
        ts.includes('declined')              ? 'failed'     :
        ts.includes('expired')               ? 'failed'     :
        ts.includes('error')                 ? 'failed'     :
        ts.includes('settled')               ? 'captured'   :
        ts.includes('capturedpending')       ? 'captured'   :
        ts.includes('authorizedpending')     ? 'authorized' :
        pay.status;  // fall through — don't downgrade what we already have
      const cc = t.payment?.creditCard || {};
      const billing = t.billTo
        ? JSON.stringify({
            firstName: t.billTo.firstName, lastName: t.billTo.lastName,
            company: t.billTo.company, address: t.billTo.address,
            city: t.billTo.city, state: t.billTo.state, zip: t.billTo.zip,
            country: t.billTo.country, phoneNumber: t.billTo.phoneNumber })
        : null;
      mapped = {
        status,
        auth:    t.authCode || null,
        last4:   cc.cardNumber?.slice(-4) || null,
        brand:   cc.cardType || null,
        exp:     cc.expirationDate || null,
        holder:  t.billTo
                  ? `${t.billTo.firstName || ''} ${t.billTo.lastName || ''}`.trim() || null
                  : null,
        avs:     t.AVSResponse || t.AVSResponseCode || null,
        avsmsg:  t.AVSResponseDescription || null,
        cvv:     t.cardCodeResponse || null,
        pmsg:    t.responseReasonDescription || t.transactionStatus || null,
        pcode:   t.responseCode || t.responseReasonCode || null,
        cip:     t.customerIP || null,
        billing,
        batch:   t.batch?.batchId || null,
        amount:  Number(t.authAmount || t.settleAmount || 0) || null,
      };
    } else if (pay.gateway === 'valor') {
      const txn = await valorFetchTransaction(cfg, pay.external_txn_id);
      raw = txn;
      // Valor field names vary by API revision — accept the common variants.
      const d = txn?.data || txn || {};
      const statusStr = String(d.status || d.result || d.transactionStatus || '').toLowerCase();
      const status =
        statusStr.includes('refund')   ? 'refunded'   :
        statusStr.includes('void')     ? 'voided'     :
        statusStr.includes('declin')   ? 'failed'     :
        statusStr.includes('approv')   ? 'captured'   :
        statusStr.includes('captur')   ? 'captured'   :
        statusStr.includes('settled')  ? 'captured'   :
        statusStr.includes('auth')     ? 'authorized' :
        pay.status;
      const billing = (d.billing_address || d.billingAddress)
        ? JSON.stringify({
            address: d.billing_address || d.billingAddress,
            city:    d.billing_city    || d.billingCity,
            state:   d.billing_state   || d.billingState,
            zip:     d.billing_zip     || d.billingZip,
            country: d.billing_country || d.billingCountry })
        : null;
      mapped = {
        status,
        auth:    d.authCode || d.auth_code || d.approvalCode || null,
        last4:   d.cardLast4 || d.last4 || d.cardNumberLast4 || null,
        brand:   d.cardBrand || d.brand || d.cardType || null,
        exp:     d.cardExpiry || d.expiry || d.expirationDate || null,
        holder:  d.cardHolder || d.cardHolderName || d.customer_name || null,
        avs:     d.avsResult || d.avs_result || d.avsResponse || null,
        avsmsg:  d.avsMessage || d.avs_message || null,
        cvv:     d.cvvResult || d.cvv_result || d.cvvResponse || null,
        pmsg:    d.message || d.responseMessage || d.statusMessage || null,
        pcode:   d.responseCode || d.code || null,
        cip:     d.customerIp || d.customer_ip || null,
        billing,
        batch:   d.batchId || d.batch_id || null,
        amount:  Number(d.amount || d.authorizedAmount || 0) || null,
      };
    } else {
      return res.status(400).json({
        error: `Refresh-from-gateway is not implemented for gateway "${pay.gateway}"`,
      });
    }

    await db.query(
      `UPDATE payments
          SET status = COALESCE(:status, status),
              external_auth_code = COALESCE(:auth, external_auth_code),
              card_last4 = COALESCE(:last4, card_last4),
              card_brand = COALESCE(:brand, card_brand),
              card_expiry = COALESCE(:exp, card_expiry),
              card_holder_name = COALESCE(:holder, card_holder_name),
              avs_result = COALESCE(:avs, avs_result),
              avs_message = COALESCE(:avsmsg, avs_message),
              cvv_result = COALESCE(:cvv, cvv_result),
              processor_message = COALESCE(:pmsg, processor_message),
              processor_code = COALESCE(:pcode, processor_code),
              customer_ip = COALESCE(:cip, customer_ip),
              billing_address = COALESCE(CAST(:billing AS JSON), billing_address),
              batch_id = COALESCE(:batch, batch_id),
              amount = COALESCE(:amount, amount),
              processor_response = CAST(:pr AS JSON),
              received_at = COALESCE(received_at, NOW())
        WHERE id = :id`,
      {
        status: mapped.status || null,
        auth:   mapped.auth,
        last4:  mapped.last4,
        brand:  mapped.brand,
        exp:    mapped.exp,
        holder: mapped.holder,
        avs:    mapped.avs,
        avsmsg: mapped.avsmsg,
        cvv:    mapped.cvv,
        pmsg:   mapped.pmsg,
        pcode:  mapped.pcode,
        cip:    mapped.cip,
        billing: mapped.billing,
        batch:  mapped.batch,
        amount: mapped.amount,
        pr:     JSON.stringify(raw),
        id,
      }
    );
    // Invoice balance may have shifted — recompute if the status moved into
    // captured/authorized (or out of it via voided/refunded).
    await refreshInvoiceAfterPayment(pay.invoice_id);

    await logActivity({
      userId: req.user.id, entityType: 'invoice', entityId: pay.invoice_id,
      action: 'payment_refreshed',
      description: `Payment #${id} refreshed from ${pay.gateway} (txn ${pay.external_txn_id})`,
      meta: { mapped_status: mapped.status },
    });

    const [[updated]] = await db.query('SELECT * FROM payments WHERE id = :id', { id });
    res.json({ ok: true, payment: updated, mapped });
  } catch (err) { next(err); }
});

// Void — only valid on a payment that hasn't yet been settled. The real
// gateway calls (Auth.net voidTransaction / Valor /void) can be wired in
// later; for now we flip local state and log the action so the UI matches
// what the operator did. Returns 409 if the txn is already in a terminal
// state.
// Void an unsettled gateway transaction — full reversal, same day only (no
// money has moved to the merchant's bank yet). A manually-recorded payment
// (cash/check/wire — no `gateway`/`external_txn_id`) has nothing to reverse
// at a processor, so it's a local-only status flip; a real card/ACH payment
// gets an actual void call to Authorize.Net or Valor first, and the local
// row only flips if that call is actually approved.
router.post('/:id/void', requirePermission('payments.write'), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const [[pay]] = await db.query(
      `SELECT p.*, i.contact_id, c.email AS contact_email
         FROM payments p
         JOIN invoices i ON i.id = p.invoice_id
         LEFT JOIN contacts c ON c.id = i.contact_id
        WHERE p.id = :id`, { id });
    if (!pay) return res.status(404).json({ error: 'Not found' });
    const cur = String(pay.status).toLowerCase();
    if (cur === 'voided')   return res.json({ ok: true, already: true, status: 'voided' });
    if (cur === 'refunded' || cur === 'failed') {
      return res.status(409).json({ error: `Cannot void a ${cur} transaction` });
    }
    if (pay.settled_at) {
      return res.status(409).json({ error: 'This transaction has already settled and can no longer be voided — use Refund instead.' });
    }

    let processorMessage = req.body?.reason || 'Voided from CRM';
    if (pay.gateway && pay.external_txn_id) {
      const cfg = await getGateway(pay.gateway, pay.gateway_mode);
      if (!cfg) return res.status(409).json({ error: `No active ${pay.gateway} gateway configuration found — cannot void at the processor.` });

      if (pay.gateway === 'authnet') {
        const json = await authnetVoid(cfg, { transId: pay.external_txn_id });
        const mapped = mapAuthnetReversalResponse(json);
        if (!mapped.approved) return res.status(402).json({ error: `Void rejected by Authorize.Net: ${mapped.message}` });
        processorMessage = `Voided at Authorize.Net (txn ${mapped.external_txn_id || pay.external_txn_id})`;
      } else if (pay.gateway === 'valor') {
        const json = await valorVoid(cfg, { ref_txn_id: pay.external_txn_id, amount: pay.amount });
        if (!isValorReversalApproved(json)) return res.status(402).json({ error: `Void rejected by Valor: ${json.msg || json.desc || json.error_no || 'Unknown error'}` });
        processorMessage = `Voided at Valor (txn ${json.txnid || pay.external_txn_id})`;
      }
      // Any other gateway value: fall through and only flip the local row —
      // same behavior as a manual payment, rather than silently no-op.
    }

    await db.query(
      `UPDATE payments
          SET status = 'voided',
              processor_message = :msg
        WHERE id = :id`,
      { msg: processorMessage, id });
    // Voided transactions don't count toward amount_paid, so recompute the
    // invoice balance.
    await refreshInvoiceAfterPayment(pay.invoice_id);
    await logActivity({
      userId: req.user.id, entityType: 'invoice', entityId: pay.invoice_id,
      action: 'voided',
      description: `Payment #${id} voided${req.body?.reason ? ` — ${req.body.reason}` : ''}` });

    // Send void notice email if contact has an email address
    if (pay.contact_email) {
      try {
        const rendered = await renderBySlug('void_receipt', {
          contact_id: pay.contact_id,
          payment_id: id,
        });
        await sendMail({
          to:      pay.contact_email,
          subject: rendered.subject || 'Void Notice',
          html:    rendered.html,
          entityType: 'invoice',
          entityId:   pay.invoice_id,
        });
      } catch (e) {
        console.error('[void-email] failed:', e.message);
      }
    }

    res.json({ ok: true });
  } catch (err) { next(err); }
});

// Refund a settled gateway transaction — credits the cardholder's account.
// Same gateway-aware-or-local-only split as /void above; the difference is
// settlement timing (see the comment there) — this route rejects an
// unsettled transaction and points the caller at /void instead, since
// neither Authorize.Net nor Valor's refund call works pre-settlement.
router.post('/:id/refund', requirePermission('payments.write'), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const amount = Number(req.body?.amount || 0);
    const [[pay]] = await db.query(
      `SELECT p.*, i.contact_id, c.email AS contact_email
         FROM payments p
         JOIN invoices i ON i.id = p.invoice_id
         LEFT JOIN contacts c ON c.id = i.contact_id
        WHERE p.id = :id`, { id });
    if (!pay) return res.status(404).json({ error: 'Not found' });
    const cur = String(pay.status).toLowerCase();
    if (cur === 'refunded' || cur === 'voided' || cur === 'failed') {
      return res.status(409).json({ error: `Cannot refund a ${cur} transaction` });
    }
    const refundAmount = amount || Number(pay.amount);

    let refundTxnId = req.body?.refund_txn_id || null;
    if (pay.gateway && pay.external_txn_id) {
      if (!pay.settled_at) {
        return res.status(409).json({ error: 'This transaction has not settled yet — use Void instead (no funds have moved to the bank yet).' });
      }
      const cfg = await getGateway(pay.gateway, pay.gateway_mode);
      if (!cfg) return res.status(409).json({ error: `No active ${pay.gateway} gateway configuration found — cannot refund at the processor.` });

      if (pay.gateway === 'authnet') {
        const json = await authnetRefund(cfg, {
          transId: pay.external_txn_id, amount: refundAmount,
          card_last4: pay.card_last4, card_expiry: pay.card_expiry,
        });
        const mapped = mapAuthnetReversalResponse(json);
        if (!mapped.approved) return res.status(402).json({ error: `Refund rejected by Authorize.Net: ${mapped.message}` });
        refundTxnId = mapped.external_txn_id || refundTxnId;
      } else if (pay.gateway === 'valor') {
        const [[inv]] = await db.query('SELECT invoice_number FROM invoices WHERE id = :id', { id: pay.invoice_id });
        const json = await valorRefund(cfg, {
          ref_txn_id: pay.external_txn_id, amount: refundAmount,
          invoicenumber: inv?.invoice_number,
        });
        if (!isValorReversalApproved(json)) return res.status(402).json({ error: `Refund rejected by Valor: ${json.msg || json.desc || json.error_no || 'Unknown error'}` });
        refundTxnId = json.txnid || refundTxnId;
      }
      // Any other gateway value: fall through and only flip the local row.
    }

    await db.query(
      `UPDATE payments
          SET status = 'refunded',
              refund_amount = :amt,
              refunded_at = NOW(),
              refund_txn_id = :txn
        WHERE id = :id`,
      { amt: refundAmount, txn: refundTxnId, id });
    await refreshInvoiceAfterPayment(pay.invoice_id);
    await logActivity({
      userId: req.user.id, entityType: 'invoice', entityId: pay.invoice_id,
      action: 'refunded', description: `Refund recorded $${refundAmount.toFixed(2)}` });

    // Send refund receipt email if contact has an email address
    if (pay.contact_email) {
      try {
        const rendered = await renderBySlug('refund_receipt', {
          contact_id: pay.contact_id,
          payment_id: id,
        });
        await sendMail({
          to:      pay.contact_email,
          subject: rendered.subject || 'Refund Receipt',
          html:    rendered.html,
          entityType: 'invoice',
          entityId:   pay.invoice_id,
        });
      } catch (e) {
        console.error('[refund-email] failed:', e.message);
      }
    }

    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;
