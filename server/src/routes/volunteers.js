// =============================================================================
// /api/volunteers — event volunteer assignments (admin only; volunteers
// themselves are contacts, tagged "Volunteer" — see forms.js's
// volunteer_signup crm_action — not a parallel person table).
//
// Shift check-in/out mirrors the event_tickets QR/PIN pattern
// (services/eventTickets.js, events.checkin_pin) applied to
// event_volunteer_assignments instead of tickets: each assignment gets its
// own qr_token at creation; scanning it once stamps checked_in_at, again
// stamps checked_out_at and computes actual_hours from the real elapsed
// time — auditable, not self-reported, then a coordinator approves it for
// grant reporting via hours_approved_by/_at.
// =============================================================================
const express = require('express');
const crypto = require('crypto');
const QRCode = require('qrcode');
const { db } = require('../db');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { ensureConstituentTag } = require('../services/constituents');
const { verifyEventPin, checkinPinLimiter } = require('../services/checkinPin');

const router = express.Router();

function newQrToken() {
  return crypto.randomBytes(16).toString('hex'); // 32 hex chars, matches qr_token CHAR(32)
}

// Same pasted-URL resilience as eventTickets.js's extractToken — a volunteer
// might paste a copied badge-image URL instead of the bare token.
function extractToken(raw) {
  const s = String(raw || '').trim();
  const match = s.match(/[0-9a-f]{32}/i);
  return match ? match[0].toLowerCase() : s;
}

// Shared scan/check-in logic for both the staff-authed and public PIN-link
// scan routes below. Returns a result object rather than throwing so both
// HTTP handlers can just forward it with a matching status code.
async function performVolunteerScan(rawToken, { eventId = null } = {}) {
  const qrToken = extractToken(rawToken);
  const [[assignment]] = await db.query(
    `SELECT a.id, a.event_id, a.checked_in_at, a.checked_out_at,
            CONCAT_WS(' ', c.first_name, c.last_name) AS contact_name
       FROM event_volunteer_assignments a
       JOIN contacts c ON c.id = a.contact_id
      WHERE a.qr_token = :qrToken`,
    { qrToken }
  );
  if (!assignment) return { httpStatus: 404, ok: false, reason: 'not_found', message: 'Volunteer badge not found' };
  if (eventId != null && Number(assignment.event_id) !== Number(eventId)) {
    return { httpStatus: 400, ok: false, reason: 'wrong_event', message: 'This badge is for a different event' };
  }

  if (!assignment.checked_in_at) {
    await db.query('UPDATE event_volunteer_assignments SET checked_in_at = NOW() WHERE id = :id', { id: assignment.id });
    return { httpStatus: 200, ok: true, reason: 'checked_in', message: `Checked in — ${assignment.contact_name}` };
  }
  if (!assignment.checked_out_at) {
    await db.query(
      `UPDATE event_volunteer_assignments
          SET checked_out_at = NOW(),
              actual_hours = ROUND(TIMESTAMPDIFF(MINUTE, checked_in_at, NOW()) / 60, 2)
        WHERE id = :id`,
      { id: assignment.id }
    );
    const [[updated]] = await db.query('SELECT actual_hours FROM event_volunteer_assignments WHERE id = :id', { id: assignment.id });
    return { httpStatus: 200, ok: true, reason: 'checked_out', message: `Checked out — ${assignment.contact_name} (${updated.actual_hours}h)` };
  }
  return {
    httpStatus: 409, ok: false, reason: 'already_done',
    message: `Already checked out at ${assignment.checked_out_at} — ask a coordinator to adjust hours directly`,
  };
}

// ---------- public: badge + scan (no CRM login required) ----------

// GET /public/badge/:qrToken/qr.png — same pattern as events.js's ticket QR
// route: no auth, the qr_token itself is the unguessable secret.
router.get('/public/badge/:qrToken/qr.png', async (req, res, next) => {
  try {
    const [[a]] = await db.query('SELECT id FROM event_volunteer_assignments WHERE qr_token = :t', { t: req.params.qrToken });
    if (!a) return res.status(404).end();
    const png = await QRCode.toBuffer(req.params.qrToken, { type: 'png', width: 320, margin: 2 });
    res.set('Content-Type', 'image/png');
    res.set('Cache-Control', 'public, max-age=31536000, immutable');
    res.send(png);
  } catch (err) { next(err); }
});

// GET /public/badge/:qrToken — badge display data (name, event, role)
router.get('/public/badge/:qrToken', async (req, res, next) => {
  try {
    const [[a]] = await db.query(
      `SELECT a.role, e.name AS event_name, e.start_at AS event_start_at,
              CONCAT_WS(' ', c.first_name, c.last_name) AS contact_name
         FROM event_volunteer_assignments a
         JOIN events e ON e.id = a.event_id
         JOIN contacts c ON c.id = a.contact_id
        WHERE a.qr_token = :t`,
      { t: req.params.qrToken }
    );
    if (!a) return res.status(404).json({ error: 'Badge not found' });
    res.json({ ...a, qr_token: req.params.qrToken });
  } catch (err) { next(err); }
});

// POST /public/checkin/:eventId/scan — PIN-link check-in/out for volunteers
// scanning their own (or each other's) badge with no CRM login. Reuses the
// same events.checkin_pin the ticket-scanning gate link already relies on.
router.post('/public/checkin/:eventId/scan', checkinPinLimiter, async (req, res, next) => {
  try {
    const eventId = Number(req.params.eventId);
    const { pin, qr_token } = req.body || {};
    if (!pin || !qr_token) return res.status(400).json({ error: 'pin and qr_token are required' });

    if (!(await verifyEventPin(eventId, pin))) {
      return res.status(403).json({ error: 'Invalid or expired check-in PIN' });
    }

    const result = await performVolunteerScan(qr_token, { eventId });
    res.status(result.httpStatus).json(result);
  } catch (err) { next(err); }
});

// ---------- admin ----------
router.use(requireAuth, requirePermission('volunteers.read'));

// Staff-authed scan (same shared logic, from within the CRM instead of the PIN link)
router.post('/admin/scan', requirePermission('volunteers.write'), async (req, res, next) => {
  try {
    const { qr_token, event_id } = req.body || {};
    if (!qr_token) return res.status(400).json({ error: 'qr_token is required' });
    const result = await performVolunteerScan(qr_token, { eventId: event_id || null });
    res.status(result.httpStatus).json(result);
  } catch (err) { next(err); }
});

// GET /api/volunteers/admin?event_id=&contact_id= — list assignments,
// optionally filtered to one event (event's Volunteers tab) or one contact
// (a volunteer's own assignment history).
router.get('/admin', async (req, res, next) => {
  try {
    const conditions = [];
    const params = {};
    if (req.query.event_id) { conditions.push('a.event_id = :event_id'); params.event_id = req.query.event_id; }
    if (req.query.contact_id) { conditions.push('a.contact_id = :contact_id'); params.contact_id = req.query.contact_id; }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const [rows] = await db.query(
      `SELECT a.*, e.name AS event_name, e.start_at AS event_start_at,
              c.first_name, c.last_name, c.email AS contact_email
         FROM event_volunteer_assignments a
         JOIN events e ON e.id = a.event_id
         JOIN contacts c ON c.id = a.contact_id
        ${where}
        ORDER BY e.start_at DESC, c.last_name, c.first_name`,
      params
    );
    res.json(rows);
  } catch (err) { next(err); }
});

// GET /api/volunteers/admin/roster — all Volunteer-tagged contacts, with
// their assignment count, for the standalone Volunteers list page.
router.get('/admin/roster', async (req, res, next) => {
  try {
    const [rows] = await db.query(
      `SELECT c.id, c.first_name, c.last_name, c.email, c.phone,
              COUNT(DISTINCT a.id) AS assignment_count,
              MAX(e.start_at) AS last_event_at,
              COALESCE(SUM(CASE WHEN a.hours_approved_at IS NOT NULL THEN a.actual_hours ELSE 0 END), 0) AS total_approved_hours,
              COALESCE(vci.alert_count, 0) AS compliance_alert_count
         FROM contacts c
         JOIN contact_tags ct ON ct.contact_id = c.id
         JOIN tags t ON t.id = ct.tag_id AND t.name = 'Volunteer'
         LEFT JOIN event_volunteer_assignments a ON a.contact_id = c.id
         LEFT JOIN events e ON e.id = a.event_id
         LEFT JOIN (
           SELECT contact_id, COUNT(*) AS alert_count
             FROM volunteer_compliance_items
            WHERE status IN ('pending', 'submitted', 'expired')
               OR (status = 'approved' AND expiry_date IS NOT NULL AND DATEDIFF(expiry_date, CURDATE()) <= 30)
            GROUP BY contact_id
         ) vci ON vci.contact_id = c.id
        GROUP BY c.id
        ORDER BY c.last_name, c.first_name`
    );
    res.json(rows);
  } catch (err) { next(err); }
});

router.post('/admin', requirePermission('volunteers.write'), async (req, res, next) => {
  try {
    const b = req.body || {};
    if (!b.event_id || !b.contact_id) return res.status(400).json({ error: 'event_id and contact_id are required' });
    // qr_token is only actually used when this INSERT is a fresh row — the
    // ON DUPLICATE branch never touches it, so an existing assignment's
    // badge token (already possibly printed/handed out) never changes.
    const [ins] = await db.query(
      `INSERT INTO event_volunteer_assignments (event_id, contact_id, role, shift_start, shift_end, status, notes, qr_token)
       VALUES (:event_id, :contact_id, :role, :shift_start, :shift_end, :status, :notes, :qr_token)
       ON DUPLICATE KEY UPDATE role = VALUES(role), shift_start = VALUES(shift_start),
         shift_end = VALUES(shift_end), status = VALUES(status), notes = VALUES(notes)`,
      {
        event_id: b.event_id, contact_id: b.contact_id, role: b.role || null,
        shift_start: b.shift_start || null, shift_end: b.shift_end || null,
        status: b.status || 'invited', notes: b.notes || null, qr_token: newQrToken(),
      }
    );
    await ensureConstituentTag(b.contact_id, 'Volunteer');
    const [[assignment]] = await db.query(
      `SELECT a.*, e.name AS event_name, c.first_name, c.last_name, c.email AS contact_email
         FROM event_volunteer_assignments a
         JOIN events e ON e.id = a.event_id JOIN contacts c ON c.id = a.contact_id
        WHERE a.event_id = :event_id AND a.contact_id = :contact_id`,
      { event_id: b.event_id, contact_id: b.contact_id }
    );
    res.status(201).json(assignment);
  } catch (err) { next(err); }
});

router.put('/admin/:id', requirePermission('volunteers.write'), async (req, res, next) => {
  try {
    const b = req.body || {};
    const [[existing]] = await db.query('SELECT id FROM event_volunteer_assignments WHERE id = :id', { id: req.params.id });
    if (!existing) return res.status(404).json({ error: 'Assignment not found' });
    await db.query(
      `UPDATE event_volunteer_assignments
          SET role=:role, shift_start=:shift_start, shift_end=:shift_end, status=:status, notes=:notes
        WHERE id=:id`,
      {
        id: req.params.id, role: b.role || null, shift_start: b.shift_start || null,
        shift_end: b.shift_end || null, status: b.status || 'invited', notes: b.notes || null,
      }
    );
    const [[assignment]] = await db.query('SELECT * FROM event_volunteer_assignments WHERE id = :id', { id: req.params.id });
    res.json(assignment);
  } catch (err) { next(err); }
});

router.delete('/admin/:id', requirePermission('volunteers.write'), async (req, res, next) => {
  try {
    await db.query('DELETE FROM event_volunteer_assignments WHERE id = :id', { id: req.params.id });
    res.status(204).end();
  } catch (err) { next(err); }
});

// Manual override — a coordinator correcting a missed check-out, or logging
// hours for a volunteer who never used the badge scanner at all.
router.post('/admin/:id/hours', requirePermission('volunteers.write'), async (req, res, next) => {
  try {
    const { actual_hours } = req.body || {};
    if (actual_hours == null || Number(actual_hours) < 0) return res.status(400).json({ error: 'actual_hours must be a non-negative number' });
    await db.query('UPDATE event_volunteer_assignments SET actual_hours = :h WHERE id = :id', { h: actual_hours, id: req.params.id });
    const [[assignment]] = await db.query('SELECT * FROM event_volunteer_assignments WHERE id = :id', { id: req.params.id });
    if (!assignment) return res.status(404).json({ error: 'Assignment not found' });
    res.json(assignment);
  } catch (err) { next(err); }
});

// Separate from setting the number itself — the grant-reporting sign-off.
router.post('/admin/:id/approve-hours', requirePermission('volunteers.write'), async (req, res, next) => {
  try {
    const [[existing]] = await db.query('SELECT actual_hours FROM event_volunteer_assignments WHERE id = :id', { id: req.params.id });
    if (!existing) return res.status(404).json({ error: 'Assignment not found' });
    if (existing.actual_hours == null) return res.status(400).json({ error: 'No hours logged yet for this assignment' });
    await db.query(
      'UPDATE event_volunteer_assignments SET hours_approved_by = :uid, hours_approved_at = NOW() WHERE id = :id',
      { uid: req.user.id, id: req.params.id }
    );
    const [[assignment]] = await db.query('SELECT * FROM event_volunteer_assignments WHERE id = :id', { id: req.params.id });
    res.json(assignment);
  } catch (err) { next(err); }
});

// ---------- compliance checklists (background checks, waivers, etc.) ----------

router.get('/admin/compliance', async (req, res, next) => {
  try {
    const where = []; const params = {};
    if (req.query.contact_id) { where.push('vci.contact_id = :contact_id'); params.contact_id = req.query.contact_id; }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const [rows] = await db.query(
      `SELECT vci.*, CONCAT_WS(' ', c.first_name, c.last_name) AS contact_name
         FROM volunteer_compliance_items vci
         JOIN contacts c ON c.id = vci.contact_id
        ${whereSql}
        ORDER BY vci.expiry_date IS NULL, vci.expiry_date ASC, vci.created_at DESC`,
      params
    );
    res.json(rows);
  } catch (err) { next(err); }
});

router.post('/admin/compliance', requirePermission('volunteers.write'), async (req, res, next) => {
  try {
    const b = req.body || {};
    if (!b.contact_id || !b.type) return res.status(400).json({ error: 'contact_id and type are required' });
    const [ins] = await db.query(
      `INSERT INTO volunteer_compliance_items (contact_id, type, status, expiry_date, notes, created_by)
       VALUES (:contact_id, :type, :status, :expiry_date, :notes, :created_by)`,
      {
        contact_id: b.contact_id, type: b.type, status: b.status || 'pending',
        expiry_date: b.expiry_date || null, notes: b.notes || null, created_by: req.user.id,
      }
    );
    const [[item]] = await db.query('SELECT * FROM volunteer_compliance_items WHERE id = :id', { id: ins.insertId });
    res.status(201).json(item);
  } catch (err) { next(err); }
});

router.put('/admin/compliance/:id', requirePermission('volunteers.write'), async (req, res, next) => {
  try {
    const b = req.body || {};
    const [[existing]] = await db.query('SELECT id FROM volunteer_compliance_items WHERE id = :id', { id: req.params.id });
    if (!existing) return res.status(404).json({ error: 'Compliance item not found' });
    await db.query(
      `UPDATE volunteer_compliance_items SET type=:type, status=:status, expiry_date=:expiry_date, notes=:notes WHERE id=:id`,
      { id: req.params.id, type: b.type, status: b.status || 'pending', expiry_date: b.expiry_date || null, notes: b.notes || null }
    );
    const [[item]] = await db.query('SELECT * FROM volunteer_compliance_items WHERE id = :id', { id: req.params.id });
    res.json(item);
  } catch (err) { next(err); }
});

router.delete('/admin/compliance/:id', requirePermission('volunteers.write'), async (req, res, next) => {
  try {
    await db.query('DELETE FROM volunteer_compliance_items WHERE id = :id', { id: req.params.id });
    res.status(204).end();
  } catch (err) { next(err); }
});

module.exports = router;
