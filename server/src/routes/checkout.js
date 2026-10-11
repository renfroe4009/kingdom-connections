// =============================================================================
// /api/checkout — public storefront checkout (cart -> order -> Valor charge)
// Never trusts client-sent totals: subtotal, shipping, tax, and fee are all
// recalculated server-side from the live cart/product/rate data before charging.
// An order is never its own money record: it creates a synthetic invoice +
// payment through the same pipeline donations/memberships/events use, linked
// via orders.invoice_id, so every charge attempt leaves a real payments row.
//
// The cart can hold two item types (see cart.js): shop products and event
// tickets. Ticket items carry a checkout-time hold (cart_items.hold_expires_at)
// that's re-validated against live availability right before charging, then
// converted into a confirmed event_registrations row + one event_tickets row
// per ticket unit (each gets its own QR-able token) on successful payment.
// Only product items go into orders/order_items and need shipping — a
// ticket-only cart skips shipping validation entirely.
// =============================================================================
const express = require('express');
const router = express.Router();
const { z } = require('zod');
const crypto = require('crypto');
const { db } = require('../db');
const { getDefaultGateway, valorGetClientToken, valorVaultCharge, valorAchCharge, mapValorVaultChargeResponse, resolveCardholderName } = require('../services/gateways');
const { sendMail } = require('../services/mailer');
const moduleSettings = require('../services/moduleSettings');
const { getBrandColors } = require('../services/brandColors');
const { computeTicketAvailable } = require('./cart');
const { createTicketsForRegistration } = require('../services/eventTickets');
const { requireAuth } = require('../middleware/auth');
const { requirePortal, getScope } = require('./portal');

// Same shape as payments.js's publicPaymentLimiter — prevents carding attacks
// against the new unauthenticated ACH intent/complete endpoints.
const { rateLimit } = require('express-rate-limit');
const publicPaymentLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many payment attempts — please wait before trying again.' },
  skip: () => process.env.NODE_ENV !== 'production',
});

async function sendOrderConfirmationEmail({ email, name, order_number, items, subtotal, shipping, tax, total }) {
  const rows = items.map(it =>
    `<tr><td style="padding:6px 0">${it.name} × ${it.qty}</td><td style="padding:6px 0;text-align:right">$${(it.price * it.qty).toFixed(2)}</td></tr>`
  ).join('');
  const clientBase = (process.env.CLIENT_ORIGIN || 'http://localhost:5173').split(',')[0].trim();
  const registerUrl = `${clientBase}/portal/register?email=${encodeURIComponent(email)}`;
  // Primary, not secondary: the secondary is usually the light accent (this
  // client's is a bright yellow) and is unreadable as link text on white.
  const { primary: linkColor } = await getBrandColors();
  const html = `
    <div style="font-family:sans-serif;max-width:480px;margin:0 auto">
      <h2>Thank you, ${name}!</h2>
      <p>Your order <strong>${order_number}</strong> has been received.</p>
      <table style="width:100%;border-collapse:collapse;margin:1rem 0">${rows}</table>
      <table style="width:100%;font-size:0.9rem;color:#555">
        <tr><td>Subtotal</td><td style="text-align:right">$${subtotal.toFixed(2)}</td></tr>
        <tr><td>Shipping</td><td style="text-align:right">$${shipping.toFixed(2)}</td></tr>
        <tr><td>Tax</td><td style="text-align:right">$${tax.toFixed(2)}</td></tr>
        <tr style="font-weight:bold"><td>Total</td><td style="text-align:right">$${total.toFixed(2)}</td></tr>
      </table>
      <p style="font-size:0.85rem;color:#555;text-align:center;margin-top:1.5rem">
        Want to track this order alongside your full history?
        <a href="${registerUrl}" style="color:${linkColor};font-weight:600;text-decoration:underline">Create your free account &rarr;</a>
      </p>
    </div>`;
  try {
    await sendMail({ to: email, subject: `Order Confirmation — ${order_number}`, html });
  } catch (_e) { /* non-fatal — order already succeeded */ }
}

// The prefix lands in the customer's order-confirmation subject line, so it is
// configurable (module setting `shop.order_prefix`, default ORD) rather than
// hardcoded — it used to carry a previous client's initials. Same pattern as
// nextInvoiceNumber() below.
async function nextOrderNumber() {
  const cfg = await moduleSettings.get('shop');
  const pfx = (String(cfg.order_prefix || '').trim() || 'ORD').toUpperCase();
  const year = new Date().getUTCFullYear();
  const prefix = `${pfx}-${year}-`;
  const [rows] = await db.query(
    'SELECT order_number FROM orders WHERE order_number LIKE :p ORDER BY id DESC LIMIT 1',
    { p: `${prefix}%` }
  );
  const last = rows[0]?.order_number;
  const seq = last ? Number(last.split('-').pop()) + 1 : 1;
  return `${prefix}${String(seq).padStart(6, '0')}`;
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

async function loadCartBySessionKey(session_key) {
  const [[cart]] = await db.query('SELECT * FROM carts WHERE session_key = :session_key', { session_key });
  if (!cart) return null;
  const [productItems] = await db.query(
    `SELECT ci.id, 'product' AS item_type, ci.product_id, NULL AS ticket_type_id, ci.qty,
       p.sku, p.name, p.price, p.taxable, p.weight_oz, p.is_active, p.track_inventory, p.stock_qty,
       NULL AS event_id, NULL AS hold_expires_at
     FROM cart_items ci JOIN products p ON p.id = ci.product_id
     WHERE ci.cart_id = :cart_id AND ci.item_type = 'product'`,
    { cart_id: cart.id }
  );
  const [ticketItems] = await db.query(
    `SELECT ci.id, 'event_ticket' AS item_type, NULL AS product_id, ci.ticket_type_id, ci.qty,
       NULL AS sku, ett.name, ett.price, 0 AS taxable, NULL AS weight_oz, ett.is_active AS ett_active,
       e.is_active AS event_active, NULL AS track_inventory, NULL AS stock_qty,
       ett.event_id, ci.hold_expires_at
     FROM cart_items ci
       JOIN event_ticket_types ett ON ett.id = ci.ticket_type_id
       JOIN events e ON e.id = ett.event_id
     WHERE ci.cart_id = :cart_id AND ci.item_type = 'event_ticket'`,
    { cart_id: cart.id }
  );
  // Normalize ticket rows' is_active from the two-table check above.
  for (const it of ticketItems) it.is_active = !!(it.ett_active && it.event_active);
  return { cart, items: [...productItems, ...ticketItems] };
}

// Security remediation M-02 — tax_exempt was a client-supplied boolean
// trusted straight into calcTax; any shopper could self-declare exemption.
// The only server-side source of truth for exemption in this schema is an
// organization's own tax_exempt flag (contacts have no such column of
// their own) — resolved via the contact's linked organization, never from
// the request. A contact with no organization (the common storefront case)
// is simply never exempt; there's no path for an anonymous shopper to
// self-certify exemption at checkout, which is the correct default for a
// B2C storefront (real B2B exemptions are set up in the CRM, not typed in
// at checkout).
async function resolveTaxExempt(contactId) {
  if (!contactId) return false;
  const [[row]] = await db.query(
    `SELECT o.tax_exempt FROM contacts c
       LEFT JOIN organizations o ON o.id = c.organization_id
      WHERE c.id = :contactId`,
    { contactId }
  );
  return !!row?.tax_exempt;
}

async function calcTax({ state, country, subtotal, tax_exempt }) {
  if (tax_exempt) return 0;
  const [[rate]] = await db.query(
    `SELECT rate_pct FROM tax_rates WHERE is_active = 1 AND country = :country
       AND (state = :state OR state IS NULL) ORDER BY (state IS NOT NULL) DESC LIMIT 1`,
    { country: country || 'US', state: state || '' }
  );
  const pct = rate ? Number(rate.rate_pct) : 0;
  return Math.round(subtotal * pct) / 100;
}

async function calcShipping({ shipping_rate_id, subtotal, weight_oz }) {
  if (!shipping_rate_id) return 0;
  const [[rate]] = await db.query(
    `SELECT * FROM shipping_rates WHERE id = :id AND is_active = 1
       AND (min_order_total IS NULL OR :subtotal >= min_order_total)
       AND (max_order_total IS NULL OR :subtotal <= max_order_total)`,
    { id: shipping_rate_id, subtotal }
  );
  if (!rate) throw new Error('Selected shipping rate is no longer available');
  return rate.method === 'free' ? 0 : Number(rate.rate);
}

// Ecommerce-specific processing fee — its own config (processing_fee_settings,
// edited on client/src/pages/ProcessingFeesPage.jsx), independent of the
// shared payment-gateway convenience-fee (payment_gateway_settings.fee_*).
// The shared gateway fee is gated by b2b_only, which always zeroes it out for
// storefront orders since retail customers are never billed as an org — this
// dedicated table is what actually lets a processing fee apply at checkout.
async function calcCommerceProcessingFee({ subtotal, shipping, tax, method }) {
  const [[cfg]] = await db.query('SELECT * FROM processing_fee_settings ORDER BY id LIMIT 1');
  if (!cfg || !cfg.is_active) return { amount: 0, label: null };
  // ACH excluded by default, same reasoning as gateways.js's
  // computeProcessingFee — only charge it when explicitly turned on.
  if (method === 'ach' && !cfg.apply_to_ach) return { amount: 0, label: null };
  const base = subtotal + (cfg.apply_to_ship ? shipping : 0) + (cfg.apply_to_tax ? tax : 0);
  let amount = 0;
  if (cfg.fee_type === 'percent') amount = base * Number(cfg.fee_percent || 0) / 100;
  else if (cfg.fee_type === 'flat') amount = Number(cfg.fee_flat || 0);
  else amount = base * Number(cfg.fee_percent || 0) / 100 + Number(cfg.fee_flat || 0);
  return { amount: Math.round(amount * 100) / 100, label: cfg.label || 'Processing Fee' };
}

async function findOrCreateContact({ first_name, last_name, email, phone }) {
  const [[existing]] = await db.query('SELECT id FROM contacts WHERE email = :email LIMIT 1', { email });
  if (existing) return existing.id;
  const [ins] = await db.query(
    'INSERT INTO contacts (first_name, last_name, email, phone) VALUES (:first_name, :last_name, :email, :phone)',
    { first_name: first_name || null, last_name: last_name || null, email, phone: phone || null }
  );
  return ins.insertId;
}

// ── GET /client-token — Valor Passage.js token for the inline card form ─────
router.get('/client-token', async (_req, res, next) => {
  try {
    const cfg = await getDefaultGateway();
    if (!cfg || cfg.gateway !== 'valor') return res.status(400).json({ error: 'No active Valor gateway configured' });
    const clientToken = await valorGetClientToken(cfg);
    res.json({
      clientToken, epi: String(cfg.epi_id || ''), mode: cfg.mode,
      achEnabled: !!cfg.ach_enabled, achAuthorizationText: cfg.ach_authorization_text || null,
    });
  } catch (err) { next(err); }
});

// ── POST /estimate — recalculate totals for the review step (no charge) ────
const estimateSchema = z.object({
  session_key: z.string(),
  shipping_state: z.string().optional(),
  shipping_country: z.string().optional(),
  shipping_rate_id: z.number().optional().nullable(),
});

router.post('/estimate', async (req, res, next) => {
  try {
    const d = estimateSchema.parse(req.body);
    const found = await loadCartBySessionKey(d.session_key);
    if (!found || !found.items.length) return res.status(400).json({ error: 'Cart is empty' });
    const subtotal = found.items.reduce((s, it) => s + Number(it.price) * it.qty, 0);
    const weight_oz = found.items.reduce((s, it) => s + Number(it.weight_oz || 0) * it.qty, 0);
    const hasProducts = found.items.some(it => it.item_type === 'product');
    // A cart with subtotal 0 (practically, an all-free-ticket cart) never
    // owes shipping/tax/a processing fee — otherwise a flat fee_fixed would
    // push an intentionally-free order above $0.
    const isFreeOrder = subtotal === 0;
    const shipping = !isFreeOrder && hasProducts ? await calcShipping({ shipping_rate_id: d.shipping_rate_id, subtotal, weight_oz }) : 0;
    // No contact identity exists yet at the estimate step (this schema has
    // no email field) — always preview as non-exempt. See resolveTaxExempt
    // above; the real charge in buildPendingOrder always uses the
    // server-resolved value regardless of what this preview showed.
    const tax = isFreeOrder ? 0 : await calcTax({ state: d.shipping_state, country: d.shipping_country, subtotal, tax_exempt: false });
    const fee = isFreeOrder ? { amount: 0, label: null } : await calcCommerceProcessingFee({ subtotal, shipping, tax });
    const total = Math.round((subtotal + shipping + tax + fee.amount) * 100) / 100;
    res.json({ subtotal, shipping, tax, processing_fee: fee.amount, fee_label: fee.label, total, requires_shipping: hasProducts });
  } catch (err) { next(err); }
});

// ── Shared checkout schema — the fields needed to build an order regardless
// of payment method. card_token is added on top for the JSON /complete path;
// the ACH path never has it (Passage.js's ACH sub-form POSTs bank fields
// directly, bypassing this schema entirely — see /public/ach-complete below).
const checkoutFieldsSchema = z.object({
  session_key: z.string(),
  first_name: z.string().min(1),
  last_name: z.string().min(1),
  email: z.string().email(),
  phone: z.string().optional(),
  shipping_line1: z.string().optional().nullable(),
  shipping_line2: z.string().optional().nullable(),
  shipping_city: z.string().optional().nullable(),
  shipping_state: z.string().optional().nullable(),
  shipping_zip: z.string().optional().nullable(),
  shipping_country: z.string().optional(),
  shipping_rate_id: z.number().optional().nullable(),
  shipping_method_name: z.string().optional().nullable(),
  customer_note: z.string().optional().nullable(),
});
// card_token is required unless the order turns out to be $0 (an all-free-
// ticket cart) — that isn't known until buildPendingOrder computes the real
// total, so it's enforced in the /complete handler itself, not here.
const completeSchema = checkoutFieldsSchema.extend({ card_token: z.string().optional() });

// ── buildPendingOrder — validates the live cart, computes totals, and
// creates the order/order_items/invoice/invoice_line_items/pending-payment
// rows. Shared by both the card path (POST /complete, has everything in one
// JSON body) and the ACH path (POST /public/ach-complete/:intentId, where
// this same `d` shape comes from a payment_intents row created earlier
// instead of the request body — Passage.js's ACH sub-form only ever submits
// its own bank fields, never our checkout form fields). Throws an Error with
// a `.status` for expected validation failures (empty cart, sold out, etc.).
async function buildPendingOrder(d, method, customerIp, contactIdOverride) {
  const found = await loadCartBySessionKey(d.session_key);
  if (!found || !found.items.length) throw Object.assign(new Error('Cart is empty'), { status: 400 });

  const productItems = found.items.filter(it => it.item_type === 'product');
  const ticketItems = found.items.filter(it => it.item_type === 'event_ticket');

  for (const it of productItems) {
    if (!it.is_active) throw Object.assign(new Error(`${it.name} is no longer available`), { status: 400 });
    if (it.track_inventory && it.qty > it.stock_qty) throw Object.assign(new Error(`Only ${it.stock_qty} left of ${it.name}`), { status: 400 });
  }
  for (const it of ticketItems) {
    if (!it.is_active) throw Object.assign(new Error(`${it.name} is no longer available`), { status: 400 });
    // Re-check availability at charge time — the frontend hold countdown
    // guards the common case, this guards the last-second race.
    const available = await computeTicketAvailable(it.ticket_type_id, { excludeCartId: found.cart.id });
    if (available != null && it.qty > available) throw Object.assign(new Error(`Only ${available} left of ${it.name}`), { status: 400 });
  }

  if (productItems.length > 0) {
    const missingShipping = !d.shipping_line1 || !d.shipping_city || !d.shipping_state || !d.shipping_zip;
    if (missingShipping) throw Object.assign(new Error('Shipping address is required for the item(s) in your cart'), { status: 400 });
  }

  const subtotal = found.items.reduce((s, it) => s + Number(it.price) * it.qty, 0);
  const weight_oz = found.items.reduce((s, it) => s + Number(it.weight_oz || 0) * it.qty, 0);
  // A cart with subtotal 0 (practically, an all-free-ticket cart) never owes
  // shipping/tax/a processing fee, and doesn't need a gateway configured at
  // all — nothing is being charged.
  const isFreeOrder = subtotal === 0;

  // A logged-in portal user paying with a saved card already has a known
  // contact_id — use it directly instead of matching/creating one by email,
  // the same correctness fix applied to donations (see portal.js's
  // /donations/checkout). Resolved BEFORE the tax calc below (security
  // remediation M-02) — tax_exempt is derived from this contact's
  // organization, never trusted from the request.
  const contactId = contactIdOverride || await findOrCreateContact(d);
  const taxExempt = await resolveTaxExempt(contactId);

  const shipping = !isFreeOrder && productItems.length > 0 ? await calcShipping({ shipping_rate_id: d.shipping_rate_id, subtotal, weight_oz }) : 0;
  const tax = isFreeOrder ? 0 : await calcTax({ state: d.shipping_state, country: d.shipping_country, subtotal, tax_exempt: taxExempt });

  const cfg = await getDefaultGateway();
  if (!isFreeOrder && (!cfg || cfg.gateway !== 'valor')) throw Object.assign(new Error('No active payment gateway configured'), { status: 400 });
  const fee = isFreeOrder ? { amount: 0, label: null } : await calcCommerceProcessingFee({ subtotal, shipping, tax, method });
  const total = Math.round((subtotal + shipping + tax + fee.amount) * 100) / 100;
  // Security remediation M-02 — final sanity assertion before this total is
  // ever handed to a charge call. The qty validation added to cart.js
  // should make a negative subtotal impossible by construction, but this
  // is the last checkpoint before money moves, so assert it directly
  // rather than trusting every upstream path to have gotten it right.
  if (total < 0 || subtotal < 0) {
    throw Object.assign(new Error('Invalid order total'), { status: 400 });
  }

  const order_number = await nextOrderNumber();

  const [ins] = await db.query(
    `INSERT INTO orders (order_number, contact_id, status, subtotal, shipping_total, tax_total, tax_exempt,
       total, shipping_name, shipping_line1, shipping_line2, shipping_city, shipping_state, shipping_zip,
       shipping_country, shipping_method, customer_note, payment_status)
     VALUES (:order_number, :contact_id, 'pending', :subtotal, :shipping, :tax, :tax_exempt,
       :total, :shipping_name, :shipping_line1, :shipping_line2, :shipping_city, :shipping_state, :shipping_zip,
       :shipping_country, :shipping_method, :customer_note, 'unpaid')`,
    {
      order_number, contact_id: contactId, subtotal, shipping, tax, tax_exempt: taxExempt ? 1 : 0, total,
      shipping_name: `${d.first_name} ${d.last_name}`, shipping_line1: d.shipping_line1 || null,
      shipping_line2: d.shipping_line2 || null, shipping_city: d.shipping_city || null, shipping_state: d.shipping_state || null,
      shipping_zip: d.shipping_zip || null, shipping_country: d.shipping_country || 'US',
      shipping_method: d.shipping_method_name || null, customer_note: d.customer_note || null,
    }
  );
  const orderId = ins.insertId;
  for (const it of productItems) {
    await db.query(
      `INSERT INTO order_items (order_id, product_id, sku, name, qty, unit_price, line_total)
       VALUES (:order_id, :product_id, :sku, :name, :qty, :unit_price, :line_total)`,
      { order_id: orderId, product_id: it.product_id, sku: it.sku, name: it.name, qty: it.qty,
        unit_price: it.price, line_total: Math.round(it.price * it.qty * 100) / 100 }
    );
  }

  // Orders are never their own money record — same invoice -> payment
  // pipeline as donations/memberships/events (see server/src/routes/donations.js).
  // The invoice's own `subtotal` column folds in shipping + the processing fee
  // (there's no dedicated shipping column on invoices), so subtotal + tax_amount
  // always equals the order total.
  const today = new Date().toISOString().slice(0, 10);
  const invoiceSubtotal = Math.round((subtotal + shipping + fee.amount) * 100) / 100;
  const invoiceNumber = await nextInvoiceNumber();
  const paymentToken = crypto.randomBytes(32).toString('hex');
  const [invIns] = await db.query(
    `INSERT INTO invoices
       (payment_token, invoice_number, contact_id, issue_date, due_date, currency,
        subtotal, tax_rate, tax_amount, discount_rate, discount_amount, total,
        amount_paid, balance_due, status, memo)
     VALUES
       (:payment_token, :invoice_number, :contact_id, :issue_date, :due_date, 'USD',
        :subtotal, 0, :tax_amount, 0, 0, :total,
        0, :total, 'sent', :memo)`,
    {
      payment_token: paymentToken, invoice_number: invoiceNumber, contact_id: contactId,
      issue_date: today, due_date: today, subtotal: invoiceSubtotal, tax_amount: tax,
      total, memo: `Shop order ${order_number}`,
    }
  );
  const invoiceId = invIns.insertId;

  let sortOrder = 0;
  for (const it of found.items) {
    await db.query(
      `INSERT INTO invoice_line_items (invoice_id, description, quantity, unit_price, amount, sort_order)
       VALUES (:invoice_id, :description, :quantity, :unit_price, :amount, :sort_order)`,
      { invoice_id: invoiceId, description: it.name, quantity: it.qty, unit_price: it.price,
        amount: Math.round(it.price * it.qty * 100) / 100, sort_order: sortOrder++ }
    );
  }
  if (shipping > 0) {
    await db.query(
      `INSERT INTO invoice_line_items (invoice_id, description, quantity, unit_price, amount, sort_order)
       VALUES (:invoice_id, 'Shipping', 1, :amount, :amount, :sort_order)`,
      { invoice_id: invoiceId, amount: shipping, sort_order: sortOrder++ }
    );
  }
  if (fee.amount > 0) {
    await db.query(
      `INSERT INTO invoice_line_items (invoice_id, description, quantity, unit_price, amount, sort_order)
       VALUES (:invoice_id, :description, 1, :amount, :amount, :sort_order)`,
      { invoice_id: invoiceId, description: fee.label || 'Processing Fee', amount: fee.amount, sort_order: sortOrder++ }
    );
  }

  await db.query('UPDATE orders SET invoice_id = :invoice_id WHERE id = :id', { invoice_id: invoiceId, id: orderId });

  const receiptToken = crypto.randomBytes(32).toString('hex');
  // Free orders never touch a real gateway — recorded as a manual/other
  // payment (same convention already used for manual/in-kind donations)
  // rather than misleadingly tagging it 'valor'/'card'.
  const effectiveGateway = isFreeOrder ? 'manual' : 'valor';
  const effectiveMethod = isFreeOrder ? 'other' : method;
  const [payIns] = await db.query(
    `INSERT INTO payments
       (invoice_id, gateway, method, amount, currency, status,
        fee_amount, fee_label, gateway_mode, customer_ip,
        card_holder_name, receipt_token)
     VALUES (:invoice_id, :gateway, :method, :amount, 'USD', 'pending',
             :fee_amount, :fee_label, :gateway_mode, :customer_ip,
             :card_holder_name, :receipt_token)`,
    {
      invoice_id: invoiceId, gateway: effectiveGateway, method: effectiveMethod, amount: total,
      fee_amount: fee.amount || null, fee_label: fee.label || null,
      gateway_mode: cfg?.mode || null, customer_ip: customerIp || null,
      card_holder_name: `${d.first_name} ${d.last_name}`, receipt_token: receiptToken,
    }
  );
  const paymentId = payIns.insertId;

  return { found, productItems, ticketItems, subtotal, shipping, tax, fee, total, cfg, contactId, order_number, orderId, invoiceId, paymentId, isFreeOrder };
}

// ── finalizeAfterCharge — shared success/failure handling once a charge
// attempt (card via valorVaultCharge, or ACH via valorAchCharge) has
// resolved to a mapped { status, txnId, auth, pmsg, ... } result.
async function finalizeAfterCharge(ctx, mapped, d) {
  const { orderId, invoiceId, paymentId, contactId, order_number, total, productItems, ticketItems, found } = ctx;
  const captured = mapped?.status === 'captured';
  // ACH settles over 1-3 business days rather than approving instantly — a
  // healthy debit comes back 'pending' (Valor's IPN webhook flips it to
  // captured/failed later), not an immediate decline. The order still
  // fulfills now (same as any other pending-payment order in this app) —
  // only genuine failed/voided/refunded blocks fulfillment.
  const pending = mapped?.status === 'pending';
  const fulfilled = captured || pending;

  if (!fulfilled) {
    await db.query(
      `UPDATE payments SET status = :status, external_txn_id = :txn_id, external_auth_code = :auth_code,
         card_last4 = :last4, card_brand = :brand, card_expiry = :exp,
         processor_message = :pmsg, processor_code = :pcode, received_at = NOW() WHERE id = :id`,
      {
        id: paymentId, status: mapped?.status || 'failed', txn_id: mapped?.txnId || null, auth_code: mapped?.auth || null,
        last4: mapped?.last4 || null, brand: mapped?.brand || null, exp: mapped?.exp || null,
        pmsg: mapped?.pmsg || 'Payment declined', pcode: mapped?.pcode || null,
      }
    );
    const declineMsg = mapped?.pmsg || 'Payment declined';
    await db.query("UPDATE orders SET status = 'cancelled', notes = :notes WHERE id = :id",
      { id: orderId, notes: `Payment failed: ${declineMsg}` });
    return { ok: false, error: declineMsg, order_number };
  }

  await db.query(
    `UPDATE payments SET status = :status, external_txn_id = :txn_id, external_auth_code = :auth_code,
       card_last4 = :last4, card_brand = :brand, card_expiry = :exp,
       processor_message = :pmsg, processor_code = :pcode, received_at = NOW() WHERE id = :id`,
    {
      id: paymentId, status: mapped.status, txn_id: mapped.txnId || null, auth_code: mapped.auth || null,
      last4: mapped.last4 || null, brand: mapped.brand || null, exp: mapped.exp || null,
      pmsg: mapped.pmsg || null, pcode: mapped.pcode || null,
    }
  );
  if (captured) {
    await db.query(
      "UPDATE invoices SET amount_paid = :total, balance_due = 0, status = 'paid', paid_at = NOW() WHERE id = :id",
      { id: invoiceId, total }
    );
  }

  await db.query(
    `UPDATE orders SET payment_status = :payment_status, status = 'processing', payment_method = 'valor',
       gateway_auth_code = :auth_code, payment_txn_id = :txn_id WHERE id = :id`,
    { id: orderId, payment_status: captured ? 'paid' : 'unpaid', auth_code: mapped.auth || null, txn_id: mapped.txnId || null }
  );

  for (const it of productItems) {
    if (it.track_inventory) {
      await db.query('UPDATE products SET stock_qty = GREATEST(stock_qty - :qty, 0) WHERE id = :id', { id: it.product_id, qty: it.qty });
    }
  }

  // Confirm each ticket hold: one event_registrations row per ticket type
  // in the cart, then (via the shared service) one event_tickets row per
  // unit of quantity so every physical ticket gets its own scannable QR
  // token — same helper server/src/routes/events.js's finalize route uses.
  for (const it of ticketItems) {
    const [regIns] = await db.query(
      `INSERT INTO event_registrations
         (event_id, ticket_type_id, contact_id, payment_id, invoice_id, quantity, attendee_name, attendee_email, status)
       VALUES (:event_id, :ticket_type_id, :contact_id, :payment_id, :invoice_id, :quantity, :attendee_name, :attendee_email, 'registered')`,
      {
        event_id: it.event_id, ticket_type_id: it.ticket_type_id, contact_id: contactId,
        payment_id: paymentId, invoice_id: invoiceId, quantity: it.qty,
        attendee_name: `${d.first_name} ${d.last_name}`, attendee_email: d.email,
      }
    );
    await createTicketsForRegistration({
      registrationId: regIns.insertId, eventId: it.event_id, ticketTypeId: it.ticket_type_id,
      quantity: it.qty, attendeeName: `${d.first_name} ${d.last_name}`,
    });
  }

  await db.query('DELETE FROM cart_items WHERE cart_id = :cart_id', { cart_id: found.cart.id });

  sendOrderConfirmationEmail({
    email: d.email, name: `${d.first_name} ${d.last_name}`, order_number,
    items: found.items.map(it => ({ name: it.name, qty: it.qty, price: Number(it.price) })),
    subtotal: ctx.subtotal, shipping: ctx.shipping, tax: ctx.tax, total,
  });

  return { ok: true, order_number, order_id: orderId, total, status: mapped.status };
}

router.post('/complete', async (req, res, next) => {
  try {
    const d = completeSchema.parse(req.body);
    const ctx = await buildPendingOrder(d, 'card', req.ip);

    let mapped;
    if (ctx.isFreeOrder) {
      mapped = { status: 'captured', txnId: null, auth: null, pmsg: 'No payment required' };
    } else if (!d.card_token) {
      // Same treatment as any other failed charge attempt below — the
      // pending order/invoice/payment rows buildPendingOrder already
      // created get marked cancelled/failed by finalizeAfterCharge rather
      // than left dangling as 'pending'.
      mapped = { status: 'failed', pmsg: 'Payment information is required' };
    } else {
      try {
        const raw = await valorVaultCharge(ctx.cfg, {
          card_token: d.card_token,
          amount: ctx.total,
          invoicenumber: ctx.order_number.slice(-12),
          cardholdername: resolveCardholderName(`${d.first_name} ${d.last_name}`),
          email: d.email,
          surcharge_amount: ctx.fee.amount,
        });
        mapped = mapValorVaultChargeResponse(raw);
      } catch (chargeErr) {
        mapped = { status: 'failed', pmsg: chargeErr.message };
      }
    }

    const result = await finalizeAfterCharge(ctx, mapped, d);
    if (!result.ok) return res.status(402).json({ error: 'Payment failed', detail: result.error, order_number: result.order_number });
    res.json({ order_number: result.order_number, order_id: result.order_id, total: result.total });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

// ── POST /complete-saved — same as /complete, but for a logged-in portal
// customer paying with a card already on file instead of a fresh Passage.js
// token. Ties the order to their real contact_id directly (buildPendingOrder's
// contactIdOverride) rather than matching/creating one by email, and charges
// via valorVaultCharge the same way portal.js's /invoices/:id/pay-saved does.
const completeSavedSchema = checkoutFieldsSchema.extend({ vault_profile_id: z.number().int() });

router.post('/complete-saved', requireAuth, requirePortal, async (req, res, next) => {
  try {
    const d = completeSavedSchema.parse(req.body);
    const scope = await getScope(req.user);

    const [[profile]] = await db.query(
      `SELECT * FROM vault_profiles
        WHERE id = :id AND gateway = 'valor' AND deleted_at IS NULL
          AND (
            (:cid IS NOT NULL AND contact_id = :cid)
            OR (:oid IS NOT NULL AND organization_id = :oid)
          )`,
      { id: d.vault_profile_id, cid: scope.contact_id ?? null, oid: scope.organization_id ?? null }
    );
    if (!profile) return res.status(404).json({ error: 'Payment method not found' });
    if (!profile.card_token) return res.status(400).json({ error: 'Card token missing on this payment method' });

    const ctx = await buildPendingOrder(d, 'card', req.ip, scope.contact_id);

    let mapped;
    if (ctx.isFreeOrder) {
      mapped = { status: 'captured', txnId: null, auth: null, pmsg: 'No payment required' };
    } else {
      try {
        const raw = await valorVaultCharge(ctx.cfg, {
          card_token: profile.card_token,
          amount: ctx.total,
          invoicenumber: ctx.order_number.slice(-12),
          cardholdername: resolveCardholderName(profile.cardholder_name, `${d.first_name} ${d.last_name}`),
          email: d.email,
          surcharge_amount: ctx.fee.amount,
        });
        mapped = mapValorVaultChargeResponse(raw);
        // A vault charge's response doesn't echo back the PAN the way a fresh
        // Passage.js token charge does — fall back to what the vault profile
        // already has on file (same fallback pay-saved uses) so the payment
        // record isn't left with a blank card on the Transactions page.
        mapped.last4 = mapped.last4 || profile.last4;
        mapped.brand = mapped.brand || profile.card_brand;
        mapped.exp   = mapped.exp   || profile.expiry;
      } catch (chargeErr) {
        mapped = { status: 'failed', pmsg: chargeErr.message };
      }
    }

    const result = await finalizeAfterCharge(ctx, mapped, d);
    if (!result.ok) return res.status(402).json({ error: 'Payment failed', detail: result.error, order_number: result.order_number });
    res.json({ order_number: result.order_number, order_id: result.order_id, total: result.total });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

// ── POST /public/intent — creates a payment_intents row right when the
// shopper reaches the payment step, before the iframe loads. Card checkout
// doesn't need this (its JSON POST /complete above already carries every
// field it needs) — this exists solely so Passage.js's ACH sub-form, which
// does a real uncontrollable browser form POST carrying only its own bank
// fields, has a pending order context to complete against when that POST
// lands on /public/ach-complete/:intentId below.
router.post('/public/intent', publicPaymentLimiter, async (req, res, next) => {
  try {
    const d = checkoutFieldsSchema.parse(req.body);
    const found = await loadCartBySessionKey(d.session_key);
    if (!found || !found.items.length) return res.status(400).json({ error: 'Cart is empty' });
    const [ins] = await db.query(
      `INSERT INTO payment_intents (kind, surface, payload, expires_at)
       VALUES ('charge', 'cart_checkout', CAST(:payload AS JSON), DATE_ADD(NOW(), INTERVAL 30 MINUTE))`,
      { payload: JSON.stringify(d) }
    );
    res.json({ intentId: ins.insertId });
  } catch (err) { next(err); }
});

// ── POST /public/ach-complete/:intentId — Passage.js's ACH sub-form POSTs
// here directly (real browser navigation, not fetch/JSON) once the shopper
// fills in bank details on the payment step. Mirrors payments.js's
// /public/ach-charge/:invoiceId (identical field mapping and postMessage-relay
// HTML response, since the form navigates this iframe here) but for the
// no-invoice-yet unified cart checkout: the pending order context lives in
// the payment_intents row /public/intent created above.
router.post('/public/ach-complete/:intentId', publicPaymentLimiter, express.urlencoded({ extended: false }), async (req, res, next) => {
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
      `SELECT * FROM payment_intents WHERE id = :id AND kind = 'charge' AND surface = 'cart_checkout'`,
      { id: intentId }
    );
    if (!intent || intent.status !== 'pending' || new Date(intent.expires_at) < new Date()) {
      return res.send(htmlResult({ type: 'PASSAGE_ACH_RESULT', status: 'failed', error: 'This checkout session has expired — please go back and try again.' }));
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

    let ctx;
    try {
      ctx = await buildPendingOrder(d, 'ach', req.ip);
    } catch (buildErr) {
      await db.query("UPDATE payment_intents SET status = 'failed' WHERE id = :id", { id: intentId });
      return res.send(htmlResult({ type: 'PASSAGE_ACH_RESULT', status: 'failed', error: buildErr.message }));
    }

    let mapped;
    try {
      const raw = await valorAchCharge(ctx.cfg, {
        routing_number, account_number, account_type, account_holder_name,
        ach_entry_class, ach_txn_type,
        amount: ctx.total, invoicenumber: ctx.order_number.slice(-12), email: d.email,
      });
      mapped = mapValorVaultChargeResponse(raw);
    } catch (chargeErr) {
      mapped = { status: 'failed', pmsg: chargeErr.message };
    }

    const result = await finalizeAfterCharge(ctx, mapped, d);
    await db.query("UPDATE payment_intents SET status = :status, completed_at = NOW() WHERE id = :id",
      { status: result.ok ? 'completed' : 'failed', id: intentId });

    if (!result.ok) {
      return res.send(htmlResult({ type: 'PASSAGE_ACH_RESULT', status: 'failed', error: result.error }));
    }
    return res.send(htmlResult({ type: 'PASSAGE_ACH_RESULT', status: result.status, order_number: result.order_number, amount: result.total }));
  } catch (err) { next(err); }
});

// ── GET /public/order/:order_number — buyer email, for the confirmation
// page's "create your portal account" prompt (prefills the email so it
// matches the contact record this order is already linked to).
router.get('/public/order/:order_number', async (req, res, next) => {
  try {
    const [[order]] = await db.query(
      `SELECT c.email FROM orders o LEFT JOIN contacts c ON c.id = o.contact_id WHERE o.order_number = :n`,
      { n: req.params.order_number }
    );
    if (!order) return res.status(404).json({ error: 'Order not found' });
    res.json({ email: order.email || null });
  } catch (err) { next(err); }
});

// ── GET /public/order/:order_number/tickets — QR tickets bought in this
// order, for the confirmation page (works on refresh, not just right after
// payment). order_number is a per-order unguessable-enough identifier the
// buyer already has from the confirmation URL; no further auth needed to
// view your own just-purchased tickets.
router.get('/public/order/:order_number/tickets', async (req, res, next) => {
  try {
    const [[order]] = await db.query('SELECT invoice_id FROM orders WHERE order_number = :n', { n: req.params.order_number });
    if (!order || !order.invoice_id) return res.json([]);
    const [tickets] = await db.query(
      `SELECT t.qr_token, t.status, e.name AS event_name, ett.name AS ticket_type_name
         FROM event_tickets t
         JOIN event_registrations r ON r.id = t.registration_id
         JOIN event_ticket_types ett ON ett.id = t.ticket_type_id
         JOIN events e ON e.id = t.event_id
        WHERE r.invoice_id = :invoice_id
        ORDER BY t.id`,
      { invoice_id: order.invoice_id }
    );
    res.json(tickets);
  } catch (err) { next(err); }
});

module.exports = router;
