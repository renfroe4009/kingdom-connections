// =============================================================================
// Event check-in PIN — generation + verification (security remediation H-08)
//
// Widened from 6 digits (900k space) to 8 characters from a 32-symbol
// alphabet (~1.1 trillion space), verified with a constant-time compare,
// and auto-expired once the event's end_at has passed. Deliberately still
// stored in plaintext, not hashed — EventDetail.jsx displays the current
// PIN persistently to staff and builds shareable check-in URLs that embed
// it (`?pin=...`), a real, actively-used feature that a one-way hash would
// break. The rate limit applied at both call sites (10 attempts / 15 min
// per event) is what actually closes the brute-force window the audit
// flagged — at that ceiling, even the old 900k-value space would take
// years to exhaust, let alone this one.
// =============================================================================
const crypto = require('crypto');
const { rateLimit } = require('express-rate-limit');
const { db } = require('../db');

// Excludes visually-ambiguous characters (0/O, 1/I/L) so a PIN read aloud
// or handwritten by a volunteer coordinator doesn't get mistyped.
const PIN_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const PIN_LENGTH = 8;

function generatePin() {
  let pin = '';
  for (let i = 0; i < PIN_LENGTH; i++) {
    pin += PIN_ALPHABET[crypto.randomInt(0, PIN_ALPHABET.length)];
  }
  return pin;
}

function constantTimeEqual(suppliedPin, storedPin) {
  const a = Buffer.from(String(suppliedPin));
  const b = Buffer.from(String(storedPin));
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// Verifies a supplied PIN against the event's stored PIN: presence, not
// expired (end_at, when set), and a constant-time comparison.
async function verifyEventPin(eventId, suppliedPin) {
  if (!suppliedPin) return false;
  const [[event]] = await db.query(
    'SELECT checkin_pin, end_at FROM events WHERE id = :id', { id: eventId }
  );
  if (!event || !event.checkin_pin) return false;
  if (event.end_at && new Date(event.end_at).getTime() < Date.now()) return false;
  return constantTimeEqual(suppliedPin, event.checkin_pin);
}

// Shared by BOTH public scan routes (events.js's ticket scan and
// volunteers.js's badge scan) — a single instance/store so an attacker
// can't double their effective attempt budget by splitting requests
// across the two endpoints; both check the same events.checkin_pin.
// Keyed on eventId alone, not IP: the threat is brute-forcing one event's
// PIN, potentially from many IPs at once, not one abusive client.
const checkinPinLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `checkin-pin:${req.params.eventId}`,
  message: { error: 'Too many check-in attempts for this event. Please wait and try again.' },
});

module.exports = { generatePin, verifyEventPin, checkinPinLimiter, PIN_LENGTH };
