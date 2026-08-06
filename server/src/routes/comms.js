// =============================================================================
// /api/comms — unified inbox feed
// -----------------------------------------------------------------------------
// Combines email_logs + sms_logs into a single chronological feed with a
// shared shape, so the React inbox can render either kind without branching.
//
// Filters supported:
//   channel        email | sms        (omit for both)
//   direction      inbound | outbound (sms only — email is outbound-only today)
//   status         queued|sent|delivered|failed|received
//   entity_type    contact|organization|deal
//   entity_id      numeric
//   q              substring search (subject/body for email, body/number for SMS)
//   from / to      ISO date or YYYY-MM-DD
//   limit          default 100, max 500
//
// Counts the same filters for a totals strip in the UI.
// =============================================================================
const router = require('express').Router();
const { db } = require('../db');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { resolveOwnerScope } = require('../services/scope');

router.use(requireAuth);

function coerceDate(s, end = false) {
  if (!s) return null;
  const str = String(s);
  // Already a full ISO timestamp? leave alone.
  if (/T\d{2}:\d{2}/.test(str)) return str;
  return `${str.slice(0, 10)} ${end ? '23:59:59' : '00:00:00'}`;
}

router.get('/inbox', requirePermission('comms.read'), async (req, res, next) => {
  try {
    const { channel, direction, status, entity_type, entity_id, q, from, to } = req.query;
    const limit = Math.min(Number(req.query.limit) || 100, 500);

    const fromDate = coerceDate(from, false);
    const toDate   = coerceDate(to,   true);

    // Row-level scope — sales agents see only their own comms;
    // managers see their whole team's. Inlined as a SQL fragment.
    const scopeIds = await resolveOwnerScope(req.user);
    let userScopeFragment = '';   // empty = no restriction (admin / readonly)
    if (scopeIds !== null) {
      const ids = scopeIds.map((n) => parseInt(n, 10));
      // If scope is empty (no agents), return nothing.
      if (ids.length === 0) return res.json({ items: [], totals: { email: 0, sms: 0, total: 0 } });
      userScopeFragment = `AND from_user_id IN (${ids.join(', ')})`;
    }

    // ---- email branch ----
    let emailRows = [];
    if (!channel || channel === 'email') {
      const where = []; const params = {};
      if (entity_type) { where.push('entity_type = :et');  params.et  = entity_type; }
      if (entity_id)   { where.push('entity_id = :eid');   params.eid = entity_id; }
      if (status)      { where.push('status = :st');       params.st  = status; }
      if (q)           { where.push('(subject LIKE :q OR to_email LIKE :q)'); params.q = `%${q}%`; }
      if (fromDate)    { where.push('created_at >= :from'); params.from = fromDate; }
      if (toDate)      { where.push('created_at <= :to');   params.to   = toDate; }
      // email is outbound-only today; ignore direction filter unless == 'outbound'
      if (direction && direction !== 'outbound') {
        emailRows = [];
      } else {
        const [rows] = await db.query(
          `SELECT id,
                  'email'           AS channel,
                  'outbound'        AS direction,
                  from_user_id,
                  to_email          AS counterpart,
                  subject,
                  body_text         AS preview,
                  entity_type, entity_id,
                  status, error, sent_at, created_at
             FROM email_logs
            WHERE 1=1 ${userScopeFragment}
              ${where.map((c) => `AND ${c}`).join(' ')}
            ORDER BY created_at DESC LIMIT ${limit}`,
          params,
        );
        emailRows = rows;
      }
    }

    // ---- sms branch ----
    let smsRows = [];
    if (!channel || channel === 'sms') {
      const where = []; const params = {};
      if (entity_type) { where.push('entity_type = :et');  params.et  = entity_type; }
      if (entity_id)   { where.push('entity_id = :eid');   params.eid = entity_id; }
      if (direction)   { where.push('direction = :dir');   params.dir = direction; }
      if (status)      { where.push('status = :st');       params.st  = status; }
      if (q)           { where.push('(body LIKE :q OR to_number LIKE :q OR from_number LIKE :q)'); params.q = `%${q}%`; }
      if (fromDate)    { where.push('created_at >= :from'); params.from = fromDate; }
      if (toDate)      { where.push('created_at <= :to');   params.to   = toDate; }
      const [rows] = await db.query(
        `SELECT id,
                'sms'                                     AS channel,
                direction,
                from_user_id,
                IF(direction = 'inbound', from_number, to_number) AS counterpart,
                NULL                                      AS subject,
                LEFT(body, 240)                           AS preview,
                entity_type, entity_id,
                status, error, sent_at, created_at
           FROM sms_logs
          WHERE 1=1 ${userScopeFragment}
            ${where.map((c) => `AND ${c}`).join(' ')}
          ORDER BY created_at DESC LIMIT ${limit}`,
        params,
      );
      smsRows = rows;
    }

    // Merge + sort + cap. Two pre-sorted streams of length <= limit means at
    // most 2*limit rows here; trimming is cheap and keeps the wire payload bounded.
    const all = [...emailRows, ...smsRows]
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .slice(0, limit);

    // ---- totals (over the full filter, not just the page) ----
    const [[totals]] = await db.query(
      `SELECT
         (SELECT COUNT(*) FROM email_logs el
            WHERE 1=1
              ${userScopeFragment.replace(/from_user_id/g, 'el.from_user_id')}
              ${entity_type ? 'AND el.entity_type = :et'  : ''}
              ${entity_id   ? 'AND el.entity_id   = :eid' : ''}
              ${status      ? 'AND el.status      = :st'  : ''}
              ${q           ? 'AND (el.subject LIKE :q OR el.to_email LIKE :q)' : ''}
              ${fromDate    ? 'AND el.created_at >= :from': ''}
              ${toDate      ? 'AND el.created_at <= :to'  : ''}
              ${(channel && channel !== 'email') ? 'AND 1=0' : ''}
              ${(direction && direction !== 'outbound') ? 'AND 1=0' : ''}
         ) AS email_count,
         (SELECT COUNT(*) FROM sms_logs sl
            WHERE 1=1
              ${userScopeFragment.replace(/from_user_id/g, 'sl.from_user_id')}
              ${entity_type ? 'AND sl.entity_type = :et'  : ''}
              ${entity_id   ? 'AND sl.entity_id   = :eid' : ''}
              ${direction   ? 'AND sl.direction   = :dir' : ''}
              ${status      ? 'AND sl.status      = :st'  : ''}
              ${q           ? 'AND (sl.body LIKE :q OR sl.to_number LIKE :q OR sl.from_number LIKE :q)' : ''}
              ${fromDate    ? 'AND sl.created_at >= :from': ''}
              ${toDate      ? 'AND sl.created_at <= :to'  : ''}
              ${(channel && channel !== 'sms') ? 'AND 1=0' : ''}
         ) AS sms_count`,
      {
        et: entity_type, eid: entity_id, st: status, q: q ? `%${q}%` : undefined,
        from: fromDate, to: toDate, dir: direction,
      },
    );

    res.json({
      items: all,
      totals: {
        email: Number(totals.email_count) || 0,
        sms:   Number(totals.sms_count)   || 0,
        total: (Number(totals.email_count) || 0) + (Number(totals.sms_count) || 0),
      },
    });
  } catch (err) { next(err); }
});

module.exports = router;
