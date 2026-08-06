// =============================================================================
// Shared event-ticket QR + check-in service. One place for both the staff
// scan path (events.js /admin/checkin/scan) and the public PIN-link scan
// path (events.js /public/checkin/:eventId/scan) to share the exact same
// scan logic — see FUNDRAISING-MODULE-GAP-REVIEW.md's "build one QR/check-in
// service, not three" note. Also shared by both places a registration gets
// created (server/src/routes/checkout.js's cart-based flow and
// server/src/routes/events.js's standalone /public/register/finalize flow)
// so every registration, however it was made, gets real scannable tickets.
// =============================================================================
const crypto = require('crypto');
const { db } = require('../db');

function nextTicketToken() {
  return crypto.randomBytes(16).toString('hex'); // 32 hex chars, matches event_tickets.qr_token CHAR(32)
}

// Manual entry sometimes gets a pasted QR image URL instead of the bare code
// (there's nowhere else to copy a plain-text code from except the ticket
// display, and "copy image address" is a natural thing to try) — pull the
// 32-char hex token out of whatever was pasted rather than requiring an
// exact match. Falls back to a trimmed copy of the input so a genuinely
// invalid code still surfaces the normal "not found" message.
function extractToken(raw) {
  const s = String(raw || '').trim();
  const match = s.match(/[0-9a-f]{32}/i);
  return match ? match[0].toLowerCase() : s;
}

// One event_tickets row per unit of quantity, so a quantity-4 purchase
// yields 4 independently scannable QR codes.
async function createTicketsForRegistration({ registrationId, eventId, ticketTypeId, quantity, attendeeName }) {
  const tickets = [];
  for (let i = 0; i < quantity; i++) {
    const qrToken = nextTicketToken();
    await db.query(
      `INSERT INTO event_tickets (registration_id, event_id, ticket_type_id, qr_token, status, attendee_name)
       VALUES (:registration_id, :event_id, :ticket_type_id, :qr_token, 'valid', :attendee_name)`,
      { registration_id: registrationId, event_id: eventId, ticket_type_id: ticketTypeId, qr_token: qrToken, attendee_name: attendeeName || null }
    );
    tickets.push({ qr_token: qrToken });
  }
  return tickets;
}

// Shared scan/check-in logic. `checkedInBy` is a CRM user id for the staff
// path, or null for the PIN-link path (there's no CRM user to attribute it
// to). Returns a result object rather than throwing, so both HTTP handlers
// can just forward it as JSON with a matching status code.
async function performScan(rawToken, { checkedInBy = null, eventId = null } = {}) {
  const qrToken = extractToken(rawToken);
  const [[ticket]] = await db.query(
    `SELECT t.id, t.status, t.event_id, t.attendee_name, t.checked_in_at,
            ett.name AS ticket_type_name, e.name AS event_name
       FROM event_tickets t
       JOIN event_ticket_types ett ON ett.id = t.ticket_type_id
       JOIN events e ON e.id = t.event_id
      WHERE t.qr_token = :qrToken`,
    { qrToken }
  );
  if (!ticket) return { httpStatus: 404, ok: false, reason: 'not_found', message: 'Ticket not found' };
  if (eventId != null && Number(ticket.event_id) !== Number(eventId)) {
    return { httpStatus: 400, ok: false, reason: 'wrong_event', message: 'This ticket is for a different event' };
  }
  if (ticket.status === 'void') {
    return { httpStatus: 409, ok: false, reason: 'void', message: 'This ticket has been voided', ticket };
  }
  if (ticket.status === 'checked_in') {
    return { httpStatus: 409, ok: false, reason: 'already_used', message: `Already checked in at ${ticket.checked_in_at}`, ticket };
  }

  await db.query(
    `UPDATE event_tickets SET status = 'checked_in', checked_in_at = :now, checked_in_by = :checkedInBy WHERE id = :id`,
    { id: ticket.id, now: new Date(), checkedInBy }
  );
  return {
    httpStatus: 200, ok: true, reason: 'checked_in',
    message: `Checked in — ${ticket.attendee_name || 'Guest'}`,
    ticket: { ...ticket, status: 'checked_in' },
  };
}

module.exports = { createTicketsForRegistration, performScan };
