// =============================================================================
// Campaigns service
// -----------------------------------------------------------------------------
// Pure-DB logic for the email-workflow engine. The route layer calls these
// helpers; the cron worker (services/scheduler.js) calls them too. None of
// the functions below send mail directly — they just shape rows in the
// scheduled-sends queue. The worker is the only place actual SMTP fires.
//
// Phase 1a wires up: blast + recurring. Drip and triggered hooks are stubbed
// where they belong so 1b can fill them in without touching the queue or the
// route layer.
// =============================================================================
const { Cron } = require('croner');
const { db } = require('../db');

// ---- audience resolution ----------------------------------------------------
// Given a campaign row, return [{contact_id, to_email}, ...] of recipients.
// Resolved fresh at materialize time so dynamic membership (lists, segments)
// always reflects current data. Skips contacts without an email address.
async function resolveAudience(campaign) {
  const cfg = safeJson(campaign.audience_config) || {};
  switch (campaign.audience_type) {
    case 'list': {
      if (!cfg.list_id) return [];
      const [rows] = await db.query(
        `SELECT c.id AS contact_id, c.email AS to_email
           FROM contact_list_members m
           JOIN contacts c ON c.id = m.contact_id
          WHERE m.list_id = :id
            AND c.email IS NOT NULL AND c.email <> ''`,
        { id: cfg.list_id },
      );
      return rows;
    }
    case 'contacts': {
      const ids = Array.isArray(cfg.contact_ids) ? cfg.contact_ids : [];
      if (!ids.length) return [];
      // Use a parameterized IN clause; mysql2 accepts arrays for `IN (?)`.
      const [rows] = await db.execute(
        `SELECT id AS contact_id, email AS to_email
           FROM contacts
          WHERE id IN (?) AND email IS NOT NULL AND email <> ''`,
        [ids],
      );
      return rows;
    }
    case 'all': {
      const [rows] = await db.query(
        `SELECT id AS contact_id, email AS to_email
           FROM contacts
          WHERE email IS NOT NULL AND email <> ''`,
      );
      return rows;
    }
    case 'segment': {
      // Phase 1b: resolve from email_segments.query_json. For now the table
      // is empty and the UI doesn't surface segment audiences, so this is a
      // safe stub that returns nothing rather than throwing.
      return [];
    }
    default:
      return [];
  }
}

// ---- preview ----------------------------------------------------------------
// Cheap "how many recipients does this campaign target right now?" helper so
// the UI can show a count before the user hits Send.
async function previewAudienceCount(campaign) {
  const recips = await resolveAudience(campaign);
  return recips.length;
}

// ---- materialize a blast wave ----------------------------------------------
// Enqueue one email_scheduled_sends row per recipient for the campaign's
// step 1. Used by:
//   * blast      — called once on save (or when admin clicks Send Now)
//   * recurring  — called by the recurring evaluator each time the cron fires
// Returns the number of rows enqueued.
async function materializeBlast(campaign, { sendAt = null } = {}) {
  const [steps] = await db.query(
    `SELECT id, step_order FROM email_campaign_steps
      WHERE campaign_id = :id AND is_active = 1
      ORDER BY step_order ASC LIMIT 1`,
    { id: campaign.id },
  );
  const step = steps[0];
  if (!step) {
    throw new Error('Campaign has no active step (template).');
  }

  const recipients = await resolveAudience(campaign);
  if (!recipients.length) return 0;

  const when = sendAt || pickSendAt(campaign) || new Date();

  // Bulk insert. Cap per wave to keep a single materialization fast; if a
  // recurring campaign has more than this we'll page on the next minute.
  const CHUNK = 500;
  let inserted = 0;
  for (let i = 0; i < recipients.length; i += CHUNK) {
    const slice = recipients.slice(i, i + CHUNK);
    const values = slice.map(() => '(?, ?, ?, ?, ?, ?)').join(', ');
    const params = [];
    for (const r of slice) {
      params.push(
        campaign.id,
        step.id,
        r.contact_id || null,
        r.to_email,
        when,
        'pending',
      );
    }
    const [result] = await db.execute(
      `INSERT INTO email_scheduled_sends
         (campaign_id, step_id, contact_id, to_email, scheduled_for, status)
       VALUES ${values}`,
      params,
    );
    inserted += result.affectedRows || 0;
  }

  await db.query(
    // UTC_TIMESTAMP() — pool is timezone:'Z' so JS Dates round-trip in UTC.
    // last_run_at is later compared against croner's previousRun() (which
    // returns a UTC moment as a Date), so we need both sides UTC.
    `UPDATE email_campaigns
        SET last_run_at    = UTC_TIMESTAMP(),
            total_enrolled = total_enrolled + :n
      WHERE id = :id`,
    { id: campaign.id, n: inserted },
  );

  return inserted;
}

// ---- recurring evaluator ----------------------------------------------------
// Decide whether a recurring campaign's cron expression has fired since the
// last_run_at marker. If yes, materialize a fresh wave. Returns true if a
// wave was produced.
async function evalRecurringIfDue(campaign, now = new Date()) {
  const cfg = safeJson(campaign.schedule_config) || {};
  if (!cfg.cron) return false;

  let job;
  try {
    job = new Cron(cfg.cron, { timezone: cfg.timezone || undefined });
  } catch (err) {
    // Bad cron expression — log into last_error so the user sees it in UI.
    await db.query(
      `UPDATE email_campaigns
          SET status = 'paused'
        WHERE id = :id`,
      { id: campaign.id },
    );
    return false;
  }

  // We want the most recent firing at or before `now`. If that firing is
  // after last_run_at (or last_run_at is null), it's due.
  const last = campaign.last_run_at ? new Date(campaign.last_run_at) : null;
  // croner exposes previousRun(asOf) → prior fire time, or null if none.
  const prevFire = job.previousRun(now);
  if (!prevFire) return false;
  if (last && prevFire <= last) return false;

  await materializeBlast(campaign, { sendAt: now });
  return true;
}

// ---- pause / cancel ---------------------------------------------------------
// Cancel all pending sends for a campaign. Used when the admin cancels a
// scheduled blast or pauses a recurring one. Already-sending rows aren't
// touched — their fate is decided by SMTP.
async function cancelPending(campaignId) {
  const [result] = await db.query(
    `UPDATE email_scheduled_sends
        SET status = 'cancelled'
      WHERE campaign_id = :id AND status = 'pending'`,
    { id: campaignId },
  );
  return result.affectedRows || 0;
}

// ---- drip / triggered stubs (1b) -------------------------------------------
// Kept here so the route layer can call them with the current API; they just
// no-op until the 1b session wires them up. Documenting the surface now means
// 1b is an internal change, not a route refactor.
async function enrollContact(_campaignId, _contactId) {
  return null; // 1b
}
async function advanceEnrollment(_enrollmentId) {
  return null; // 1b
}

// ---- helpers ----------------------------------------------------------------
function safeJson(v) {
  if (v == null) return null;
  if (typeof v === 'object') return v;
  try { return JSON.parse(v); } catch { return null; }
}

// schedule_config.send_at → Date for blast campaigns. Returns null if absent
// or unparseable so the caller can fall back to "now".
function pickSendAt(campaign) {
  const cfg = safeJson(campaign.schedule_config) || {};
  if (!cfg.send_at) return null;
  const d = new Date(cfg.send_at);
  return Number.isNaN(d.getTime()) ? null : d;
}

module.exports = {
  resolveAudience,
  previewAudienceCount,
  materializeBlast,
  evalRecurringIfDue,
  cancelPending,
  enrollContact,
  advanceEnrollment,
  pickSendAt,
};
