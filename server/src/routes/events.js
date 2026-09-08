// =============================================================================
// /api/events — event CRUD/ticket types (admin) + public browse/register
//
// A paid registration is a synthetic invoice + payment, same pipeline as
// one-time donations (see donations.js header comment) — this route creates
// the invoice, the EXISTING gateway-agnostic /api/payments/public/checkout
// and /public/charge endpoints handle the actual charge (reused unchanged,
// via the client's <DonationCheckout> component), and this route's
// /register/finalize tags the resulting payment with an event_registrations
// row. A free ticket (price 0) skips invoicing entirely — registration is
// the record, not a money transaction.
// =============================================================================
const express = require('express');
const crypto = require('crypto');
const QRCode = require('qrcode');
const { db } = require('../db');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { ensureConstituentTag } = require('../services/constituents');
const moduleSettings = require('../services/moduleSettings');
const { createTicketsForRegistration, performScan } = require('../services/eventTickets');
const { sendMail } = require('../services/mailer');
const { generatePin, verifyEventPin, checkinPinLimiter } = require('../services/checkinPin');

// Free tickets never touch the invoice/payment pipeline, so they never hit
// payments.js's payment_receipt email either — without this, a free
// registrant got no confirmation of any kind. Kept as a small inline
// template like checkout.js's order-confirmation email, rather than the
// DB-template system, since there's no payment/invoice context to render it
// against.
async function sendFreeRegistrationEmail({ email, name, event, ticketName, quantity, tickets }) {
  if (!email) return;
  const clientBase = (process.env.CLIENT_ORIGIN || 'http://localhost:5173').split(',')[0].trim();
  const registerUrl = `${clientBase}/portal/register?email=${encodeURIComponent(email)}`;
  const ticketImgs = (tickets || []).map(t =>
    `<img src="${clientBase}/api/events/public/ticket/${t.qr_token}/qr.png" alt="Ticket QR code" width="120" height="120" style="margin:6px">`
  ).join('');
  const html = `
    <div style="font-family:sans-serif;max-width:480px;margin:0 auto">
      <h2>You're registered, ${name}!</h2>
      <p><strong>${event.name}</strong><br>${new Date(event.start_at).toLocaleString()}${event.location ? ` · ${event.location}` : ''}</p>
      <p>${ticketName} × ${quantity}</p>
      ${ticketImgs ? `<p>Show one of these at the gate:</p><div style="text-align:center">${ticketImgs}</div>` : ''}
      <p style="font-size:0.85rem;color:#555;text-align:center;margin-top:1.5rem">
        Want to track this alongside your full history?
        <a href="${registerUrl}" style="color:#C9A227;font-weight:600;text-decoration:underline">Create your free account &rarr;</a>
      </p>
    </div>`;
  try {
    await sendMail({ to: email, subject: `You're registered — ${event.name}`, html });
  } catch (_e) { /* non-fatal — registration already succeeded */ }
}

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

function roundMoney(n) { return Math.round((Number(n) + Number.EPSILON) * 100) / 100; }

async function upsertAttendeeContact({ first_name, last_name, email, phone }) {
  if (!email) return null;
  const [[existing]] = await db.query('SELECT id FROM contacts WHERE email = :email LIMIT 1', { email });
  if (existing) return existing.id;
  const [r] = await db.query(
    `INSERT INTO contacts (first_name, last_name, email, phone, lead_source)
     VALUES (:first_name, :last_name, :email, :phone, 'event_registration')`,
    { first_name: first_name || '', last_name: last_name || '', email, phone: phone || null }
  );
  return r.insertId;
}

async function nextInvoiceNumber() {
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

async function countRegistered(eventId, ticketTypeId) {
  const [[row]] = await db.query(
    `SELECT
       (SELECT COALESCE(SUM(quantity), 0) FROM event_registrations WHERE event_id = :eid AND status = 'registered') AS event_count,
       (SELECT COALESCE(SUM(quantity), 0) FROM event_registrations WHERE ticket_type_id = :tid AND status = 'registered') AS ticket_count`,
    { eid: eventId, tid: ticketTypeId }
  );
  return row;
}

// =============================================================================
// Public — no auth
// =============================================================================

router.get('/public/events', async (req, res, next) => {
  try {
    const [events] = await db.query(
      `SELECT id, name, slug, description, start_at, end_at, location,
              address_line1, address_line2, city, state, postal_code, country, capacity
         FROM events WHERE is_active = 1 AND (end_at IS NULL OR end_at >= NOW()) AND start_at >= NOW()
        ORDER BY start_at`
    );
    res.json(events);
  } catch (err) { next(err); }
});

router.get('/public/events/:slug', async (req, res, next) => {
  try {
    const [[event]] = await db.query(
      `SELECT id, name, slug, description, start_at, end_at, location,
              address_line1, address_line2, city, state, postal_code, country, capacity
         FROM events WHERE slug = :slug AND is_active = 1`,
      { slug: req.params.slug }
    );
    if (!event) return res.status(404).json({ error: 'Event not found' });
    const [tickets] = await db.query(
      `SELECT id, name, price, capacity FROM event_ticket_types
        WHERE event_id = :id AND is_active = 1 ORDER BY sort_order, price`,
      { id: event.id }
    );
    res.json({ ...event, tickets });
  } catch (err) { next(err); }
});

// POST /api/events/public/register — creates the registration (free) or the
// synthetic invoice for a paid ticket (checkout continues client-side via
// the existing <DonationCheckout> component + /public/checkout|charge).
router.post('/public/register', async (req, res, next) => {
  try {
    const body = req.body || {};
    const quantity = Math.max(1, Number(body.quantity) || 1);
    const attendee = body.attendee || {};
    if (!attendee.email) return res.status(400).json({ error: 'Attendee email is required' });

    const [[event]] = await db.query('SELECT * FROM events WHERE slug = :slug AND is_active = 1', { slug: body.event_slug });
    if (!event) return res.status(400).json({ error: 'Event not found or no longer active' });
    const [[ticket]] = await db.query(
      'SELECT * FROM event_ticket_types WHERE id = :id AND event_id = :eid AND is_active = 1',
      { id: body.ticket_type_id, eid: event.id }
    );
    if (!ticket) return res.status(400).json({ error: 'Ticket type not found' });

    const counts = await countRegistered(event.id, ticket.id);
    if (event.capacity != null && Number(counts.event_count) + quantity > event.capacity) {
      return res.status(409).json({ error: 'This event is at capacity' });
    }
    if (ticket.capacity != null && Number(counts.ticket_count) + quantity > ticket.capacity) {
      return res.status(409).json({ error: 'This ticket type is sold out' });
    }

    const contactId = await upsertAttendeeContact(attendee);
    const amount = roundMoney(Number(ticket.price) * quantity);

    if (amount <= 0) {
      const attendeeName = `${attendee.first_name || ''} ${attendee.last_name || ''}`.trim() || null;
      const [ins] = await db.query(
        `INSERT INTO event_registrations
           (event_id, ticket_type_id, contact_id, quantity, attendee_name, attendee_email, status)
         VALUES (:event_id, :ticket_type_id, :contact_id, :quantity, :attendee_name, :attendee_email, 'registered')`,
        {
          event_id: event.id, ticket_type_id: ticket.id, contact_id: contactId, quantity,
          attendee_name: attendeeName, attendee_email: attendee.email,
        }
      );
      const tickets = await createTicketsForRegistration({
        registrationId: ins.insertId, eventId: event.id, ticketTypeId: ticket.id, quantity, attendeeName,
      });
      await ensureConstituentTag(contactId, 'Attendee');
      sendFreeRegistrationEmail({
        email: attendee.email, name: attendeeName || 'there', event, ticketName: ticket.name, quantity, tickets,
      });
      return res.status(201).json({ ok: true, free: true, registrationId: ins.insertId, tickets });
    }

    // Paid ticket — create the synthetic invoice; client continues to the
    // existing gateway-agnostic checkout flow with the returned invoiceId.
    const paymentToken = crypto.randomBytes(32).toString('hex');
    const number = await nextInvoiceNumber();
    const today = new Date().toISOString().slice(0, 10);
    const memo = `${event.name} — ${ticket.name} x${quantity}`;

    const [inv] = await db.query(
      `INSERT INTO invoices
         (payment_token, invoice_number, contact_id, issue_date, due_date, currency,
          subtotal, tax_rate, tax_amount, discount_rate, discount_amount, total,
          amount_paid, balance_due, status, memo)
       VALUES
         (:payment_token, :invoice_number, :contact_id, :issue_date, :due_date, 'USD',
          :subtotal, 0, 0, 0, 0, :total, 0, :total, 'sent', :memo)`,
      { payment_token: paymentToken, invoice_number: number, contact_id: contactId, issue_date: today, due_date: today, subtotal: amount, total: amount, memo }
    );
    const invoiceId = inv.insertId;
    await db.query(
      `INSERT INTO invoice_line_items (invoice_id, description, quantity, unit_price, amount, sort_order)
       VALUES (:invoice_id, :desc, :quantity, :unit_price, :amount, 0)`,
      { invoice_id: invoiceId, desc: memo, quantity, unit_price: ticket.price, amount }
    );

    res.status(201).json({ ok: false, requiresPayment: true, invoiceId, total: amount });
  } catch (err) { next(err); }
});

// POST /api/events/public/register/finalize/:invoiceId — called once the
// registration's invoice shows a captured/authorized payment. Idempotent.
router.post('/public/register/finalize/:invoiceId', async (req, res, next) => {
  try {
    const invoiceId = Number(req.params.invoiceId);
    const body = req.body || {};

    const [[invoice]] = await db.query('SELECT id, contact_id FROM invoices WHERE id = :id', { id: invoiceId });
    if (!invoice) return res.status(404).json({ error: 'Invoice not found' });

    const [[payment]] = await db.query(
      `SELECT id FROM payments WHERE invoice_id = :id AND status IN ('captured','authorized') ORDER BY id DESC LIMIT 1`,
      { id: invoiceId }
    );
    if (!payment) return res.status(409).json({ error: 'Payment has not completed yet' });

    const [[existing]] = await db.query('SELECT * FROM event_registrations WHERE payment_id = :pid', { pid: payment.id });
    if (existing) return res.json({ ok: true, registration: existing });

    const [[event]] = await db.query('SELECT id FROM events WHERE slug = :slug', { slug: body.event_slug });
    if (!event) return res.status(400).json({ error: 'Unknown event' });

    const quantity = Math.max(1, Number(body.quantity) || 1);
    const [ins] = await db.query(
      `INSERT INTO event_registrations
         (event_id, ticket_type_id, contact_id, payment_id, invoice_id, quantity, attendee_name, attendee_email, status)
       VALUES (:event_id, :ticket_type_id, :contact_id, :payment_id, :invoice_id, :quantity, :attendee_name, :attendee_email, 'registered')`,
      {
        event_id: event.id, ticket_type_id: body.ticket_type_id, contact_id: invoice.contact_id,
        payment_id: payment.id, invoice_id: invoiceId, quantity,
        attendee_name: body.attendee_name || null, attendee_email: body.attendee_email || null,
      }
    );
    const [[registration]] = await db.query('SELECT * FROM event_registrations WHERE id = :id', { id: ins.insertId });
    const tickets = await createTicketsForRegistration({
      registrationId: ins.insertId, eventId: event.id, ticketTypeId: body.ticket_type_id,
      quantity, attendeeName: body.attendee_name || null,
    });
    await ensureConstituentTag(invoice.contact_id, 'Attendee');
    res.status(201).json({ ok: true, registration, tickets });
  } catch (err) { next(err); }
});

// GET /public/ticket/:qrToken/qr.png — renders the ticket's QR code as a PNG.
// No auth: the qr_token itself is the unguessable 32-char secret (crypto
// random), this endpoint only turns the token the requester already has into
// a scannable image — it doesn't reveal anything the requester doesn't know.
router.get('/public/ticket/:qrToken/qr.png', async (req, res, next) => {
  try {
    const [[ticket]] = await db.query('SELECT id FROM event_tickets WHERE qr_token = :t', { t: req.params.qrToken });
    if (!ticket) return res.status(404).end();
    const png = await QRCode.toBuffer(req.params.qrToken, { type: 'png', width: 320, margin: 2 });
    res.set('Content-Type', 'image/png');
    res.set('Cache-Control', 'public, max-age=31536000, immutable'); // a ticket's QR never changes
    res.send(png);
  } catch (err) { next(err); }
});

// POST /public/checkin/:eventId/scan — PIN-link check-in for day-of
// volunteers with no CRM account. Requires the event's current checkin_pin.
router.post('/public/checkin/:eventId/scan', checkinPinLimiter, async (req, res, next) => {
  try {
    const eventId = Number(req.params.eventId);
    const { pin, qr_token } = req.body || {};
    if (!pin || !qr_token) return res.status(400).json({ error: 'pin and qr_token are required' });

    if (!(await verifyEventPin(eventId, pin))) {
      return res.status(403).json({ error: 'Invalid or expired check-in PIN' });
    }

    const result = await performScan(qr_token, { checkedInBy: null, eventId });
    res.status(result.httpStatus).json(result);
  } catch (err) { next(err); }
});

// =============================================================================
// Admin — events, ticket types, registrations
// =============================================================================
router.get('/admin', requireAuth, requirePermission('events.read'), async (req, res, next) => {
  try {
    const [rows] = await db.query(
      `SELECT e.*,
              COALESCE((SELECT SUM(quantity) FROM event_registrations WHERE event_id = e.id AND status = 'registered'), 0) AS registered_count
         FROM events e ORDER BY e.start_at DESC`
    );
    res.json(rows);
  } catch (err) { next(err); }
});

// GET /admin/calendar?start=&end= — lightweight range query for the month
// grid (EventsCalendar.jsx) and the Dashboard's upcoming-events widget.
// Registered before /admin/:id further down so "calendar" is never captured
// as an :id param.
router.get('/admin/calendar', requireAuth, requirePermission('events.read'), async (req, res, next) => {
  try {
    const { start, end } = req.query;
    const conds = ['e.is_active = 1'];
    const params = {};
    // Overlap test: the event's own range touches the requested [start, end]
    // window, so a multi-day event still shows on every day it spans.
    if (start) { conds.push('(e.end_at IS NULL OR e.end_at >= :start)'); params.start = `${start} 00:00:00`; }
    if (end)   { conds.push('e.start_at <= :end'); params.end = `${end} 23:59:59`; }
    const [rows] = await db.query(
      `SELECT e.id, e.name, e.slug, e.start_at, e.end_at, e.location, e.capacity,
              COALESCE((SELECT SUM(quantity) FROM event_registrations WHERE event_id = e.id AND status = 'registered'), 0) AS registered_count
         FROM events e
        WHERE ${conds.join(' AND ')}
        ORDER BY e.start_at`,
      params
    );
    res.json(rows);
  } catch (err) { next(err); }
});

router.post('/admin', requireAuth, requirePermission('events.write'), async (req, res, next) => {
  try {
    const b = req.body || {};
    if (!b.name || !b.start_at) return res.status(400).json({ error: 'name and start_at are required' });
    const slug = toSlug(b.slug || b.name);
    const [ins] = await db.query(
      `INSERT INTO events
         (name, slug, description, start_at, end_at, location,
          address_line1, address_line2, city, state, postal_code, country, capacity, is_active)
       VALUES
         (:name, :slug, :description, :start_at, :end_at, :location,
          :address_line1, :address_line2, :city, :state, :postal_code, :country, :capacity, :is_active)`,
      {
        name: b.name, slug, description: b.description || null, start_at: b.start_at, end_at: b.end_at || null,
        location: b.location || null,
        address_line1: b.address_line1 || null, address_line2: b.address_line2 || null,
        city: b.city || null, state: b.state || null, postal_code: b.postal_code || null,
        country: b.country || 'US',
        capacity: b.capacity || null, is_active: b.is_active === false ? 0 : 1,
      }
    );
    const [[event]] = await db.query('SELECT * FROM events WHERE id = :id', { id: ins.insertId });
    res.status(201).json(event);
  } catch (err) { next(err); }
});

router.put('/admin/:id', requireAuth, requirePermission('events.write'), async (req, res, next) => {
  try {
    const b = req.body || {};
    const [[existing]] = await db.query('SELECT id FROM events WHERE id = :id', { id: req.params.id });
    if (!existing) return res.status(404).json({ error: 'Event not found' });
    await db.query(
      `UPDATE events SET name=:name, slug=:slug, description=:description, start_at=:start_at, end_at=:end_at,
              location=:location, address_line1=:address_line1, address_line2=:address_line2,
              city=:city, state=:state, postal_code=:postal_code, country=:country,
              capacity=:capacity, is_active=:is_active WHERE id=:id`,
      {
        id: req.params.id, name: b.name, slug: toSlug(b.slug || b.name), description: b.description || null,
        start_at: b.start_at, end_at: b.end_at || null, location: b.location || null,
        address_line1: b.address_line1 || null, address_line2: b.address_line2 || null,
        city: b.city || null, state: b.state || null, postal_code: b.postal_code || null,
        country: b.country || 'US',
        capacity: b.capacity || null, is_active: b.is_active === false ? 0 : 1,
      }
    );
    const [[event]] = await db.query('SELECT * FROM events WHERE id = :id', { id: req.params.id });
    res.json(event);
  } catch (err) { next(err); }
});

router.delete('/admin/:id', requireAuth, requirePermission('events.write'), async (req, res, next) => {
  try {
    await db.query('DELETE FROM events WHERE id = :id', { id: req.params.id });
    res.status(204).end();
  } catch (err) { next(err); }
});

router.get('/admin/:id/tickets', requireAuth, requirePermission('events.read'), async (req, res, next) => {
  try {
    const [rows] = await db.query('SELECT * FROM event_ticket_types WHERE event_id = :id ORDER BY sort_order, price', { id: req.params.id });
    res.json(rows);
  } catch (err) { next(err); }
});

router.post('/admin/:id/tickets', requireAuth, requirePermission('events.write'), async (req, res, next) => {
  try {
    const b = req.body || {};
    if (!b.name) return res.status(400).json({ error: 'name is required' });
    const [ins] = await db.query(
      `INSERT INTO event_ticket_types (event_id, name, price, capacity, is_active, sort_order)
       VALUES (:event_id, :name, :price, :capacity, :is_active, :sort_order)`,
      {
        event_id: req.params.id, name: b.name, price: Number(b.price || 0), capacity: b.capacity || null,
        is_active: b.is_active === false ? 0 : 1, sort_order: b.sort_order || 0,
      }
    );
    const [[ticket]] = await db.query('SELECT * FROM event_ticket_types WHERE id = :id', { id: ins.insertId });
    res.status(201).json(ticket);
  } catch (err) { next(err); }
});

router.put('/admin/tickets/:id', requireAuth, requirePermission('events.write'), async (req, res, next) => {
  try {
    const b = req.body || {};
    await db.query(
      `UPDATE event_ticket_types SET name=:name, price=:price, capacity=:capacity, is_active=:is_active, sort_order=:sort_order
        WHERE id=:id`,
      {
        id: req.params.id, name: b.name, price: Number(b.price || 0), capacity: b.capacity || null,
        is_active: b.is_active === false ? 0 : 1, sort_order: b.sort_order || 0,
      }
    );
    const [[ticket]] = await db.query('SELECT * FROM event_ticket_types WHERE id = :id', { id: req.params.id });
    res.json(ticket);
  } catch (err) { next(err); }
});

router.delete('/admin/tickets/:id', requireAuth, requirePermission('events.write'), async (req, res, next) => {
  try {
    await db.query('DELETE FROM event_ticket_types WHERE id = :id', { id: req.params.id });
    res.status(204).end();
  } catch (err) { next(err); }
});

router.get('/admin/:id/registrations', requireAuth, requirePermission('events.read'), async (req, res, next) => {
  try {
    const [rows] = await db.query(
      `SELECT r.id, r.quantity, r.status, r.attendee_name, r.attendee_email, r.created_at,
              t.name AS ticket_name, t.price,
              c.id AS contact_id, CONCAT_WS(' ', c.first_name, c.last_name) AS contact_name
         FROM event_registrations r
         JOIN event_ticket_types t ON t.id = r.ticket_type_id
         LEFT JOIN contacts c ON c.id = r.contact_id
        WHERE r.event_id = :id
        ORDER BY r.created_at DESC`,
      { id: req.params.id }
    );
    res.json(rows);
  } catch (err) { next(err); }
});

// GET /admin/:id/manifest.csv — one row per physical ticket: who's coming,
// what they bought, whether they paid, whether they've checked in. This is
// the attendee manifest staff print/export for gate day.
router.get('/admin/:id/manifest.csv', requireAuth, requirePermission('events.read'), async (req, res, next) => {
  try {
    const [[event]] = await db.query('SELECT name FROM events WHERE id = :id', { id: req.params.id });
    if (!event) return res.status(404).json({ error: 'Event not found' });

    const [rows] = await db.query(
      `SELECT et.qr_token, et.status AS ticket_status, et.checked_in_at,
              COALESCE(et.attendee_name, r.attendee_name) AS attendee_name, r.attendee_email,
              tt.name AS ticket_type, tt.price,
              r.payment_id, p.status AS payment_status, i.invoice_number
         FROM event_tickets et
         JOIN event_registrations r ON r.id = et.registration_id
         JOIN event_ticket_types tt ON tt.id = et.ticket_type_id
         LEFT JOIN payments p ON p.id = r.payment_id
         LEFT JOIN invoices i ON i.id = r.invoice_id
        WHERE et.event_id = :id
        ORDER BY et.created_at`,
      { id: req.params.id }
    );

    const header = ['Ticket Code', 'Attendee Name', 'Attendee Email', 'Ticket Type', 'Amount', 'Payment Status', 'Invoice #', 'Checked In', 'Checked In At'];
    const csvRows = [header.join(',')];
    for (const r of rows) {
      const line = [
        r.qr_token, r.attendee_name || '', r.attendee_email || '', r.ticket_type, Number(r.price).toFixed(2),
        r.payment_id ? r.payment_status : 'Free', r.invoice_number || '',
        r.ticket_status === 'checked_in' ? 'Yes' : (r.ticket_status === 'void' ? 'Void' : 'No'),
        r.checked_in_at || '',
      ].map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`);
      csvRows.push(line.join(','));
    }
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${toSlug(event.name)}-manifest.csv"`);
    res.send(csvRows.join('\n'));
  } catch (err) { next(err); }
});

// POST /admin/checkin/scan — staff gate check-in (requires a CRM login).
router.post('/admin/checkin/scan', requireAuth, requirePermission('events.checkin'), async (req, res, next) => {
  try {
    const { qr_token, event_id } = req.body || {};
    if (!qr_token) return res.status(400).json({ error: 'qr_token is required' });
    const result = await performScan(qr_token, { checkedInBy: req.user.id, eventId: event_id || null });
    res.status(result.httpStatus).json(result);
  } catch (err) { next(err); }
});

// POST /admin/:id/checkin/regenerate-pin — (re)issues the event's check-in
// PIN so staff can hand a fresh code to day-of volunteers.
router.post('/admin/:id/checkin/regenerate-pin', requireAuth, requirePermission('events.write'), async (req, res, next) => {
  try {
    const pin = generatePin();
    await db.query('UPDATE events SET checkin_pin = :pin WHERE id = :id', { pin, id: req.params.id });
    res.json({ checkin_pin: pin });
  } catch (err) { next(err); }
});

// GET /admin/:id/checkin/summary — running "N of capacity checked in" counts
// for the scanner UI.
router.get('/admin/:id/checkin/summary', requireAuth, requirePermission('events.read'), async (req, res, next) => {
  try {
    const [[row]] = await db.query(
      `SELECT e.capacity, e.checkin_pin,
              (SELECT COUNT(*) FROM event_tickets WHERE event_id = e.id) AS total_tickets,
              (SELECT COUNT(*) FROM event_tickets WHERE event_id = e.id AND status = 'checked_in') AS checked_in
         FROM events e WHERE e.id = :id`,
      { id: req.params.id }
    );
    if (!row) return res.status(404).json({ error: 'Event not found' });
    res.json(row);
  } catch (err) { next(err); }
});

module.exports = router;
