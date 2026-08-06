// =============================================================================
// Email Workflow scheduler — in-process cron worker
// -----------------------------------------------------------------------------
// Two ticks running side-by-side:
//
//   sendDueTick()       — every minute. Drains email_scheduled_sends:
//                         picks up pending rows whose scheduled_for <= now,
//                         renders each with the contact context, ships via
//                         sendMail(), marks the row sent/failed, and (for
//                         drip enrollments) lines up the next step.
//
//   evalRecurringTick() — every 5 minutes. Walks active recurring campaigns,
//                         asks each "have you fired since last_run_at?", and
//                         materializes a fresh wave if so. The 5-min cadence
//                         means recurring campaigns can use minute-grained
//                         crons but won't fire more than once per 5 min —
//                         which is the right trade-off for "weekly newsletter
//                         at 9am Mon" while keeping DB pressure modest.
//
// Concurrency: we mark rows 'sending' before SMTP to make double-send
// impossible across overlapping ticks. Single-process app, so a row-level
// transition with affectedRows>0 acts as a lease.
//
// To turn the worker off (tests, debugging, second app instance) set
// CAMPAIGNS_CRON=off in env.
// =============================================================================
const { Cron } = require('croner');
const { db } = require('../db');
const { sendMail } = require('./mailer');
const { render, buildContext } = require('./templates');
const {
  evalRecurringIfDue,
  advanceEnrollment,
} = require('./campaigns');

// Module-level guards so we never start two workers in the same process
// (nodemon hot-reload, dev re-init, etc.)
let _sendJob = null;
let _recurringJob = null;
let _draining = false;

const SEND_BATCH    = 100;        // rows pulled per minute tick
const MAX_ATTEMPTS  = 3;          // retries before a send is marked 'failed'

// ---- start / stop -----------------------------------------------------------
function start() {
  if (_sendJob || _recurringJob) return; // idempotent

  _sendJob = new Cron('* * * * *', { protect: true }, () =>
    sendDueTick().then(() => {
      if (!global._jobStatus) global._jobStatus = {};
      global._jobStatus.campaigns = { ...global._jobStatus.campaigns, lastSend: new Date().toISOString() };
    }).catch(logErr));
  _recurringJob = new Cron('*/5 * * * *', { protect: true }, () =>
    evalRecurringTick().then(() => {
      if (!global._jobStatus) global._jobStatus = {};
      global._jobStatus.campaigns = { ...global._jobStatus.campaigns, lastRecurring: new Date().toISOString() };
    }).catch(logErr));

  // eslint-disable-next-line no-console
  console.log('[scheduler] campaign worker started (send=1m, recurring=5m)');
}

function stop() {
  if (_sendJob) { _sendJob.stop(); _sendJob = null; }
  if (_recurringJob) { _recurringJob.stop(); _recurringJob = null; }
}

// ---- send-due tick ----------------------------------------------------------
async function sendDueTick() {
  if (_draining) return; // previous tick still running, skip
  _draining = true;
  try {
    // Lease a batch of rows by flipping pending → sending. Doing it as one
    // UPDATE means a second worker (or a re-entrant tick) can't grab the
    // same row.
    //
    // We compare against UTC_TIMESTAMP() (not NOW()) because the pool is
    // configured with timezone: 'Z' — mysql2 inserts JS Date objects as UTC
    // literals. NOW() returns *server local time*, so on a non-UTC DB box
    // the lease silently rejects rows whose scheduled_for is in the future
    // relative to local time. This was the "1 enqueued / 0 sent / 1 pending"
    // bug on send-now.
    const [leased] = await db.query(
      `UPDATE email_scheduled_sends
          SET status = 'sending'
        WHERE status = 'pending' AND scheduled_for <= UTC_TIMESTAMP()
        ORDER BY scheduled_for ASC
        LIMIT :n`,
      { n: SEND_BATCH },
    );
    if (!leased.affectedRows) return;

    const [rows] = await db.query(
      `SELECT s.id, s.campaign_id, s.step_id, s.enrollment_id,
              s.contact_id, s.to_email, s.attempts,
              c.name           AS campaign_name,
              st.template_id, st.subject_override,
              t.subject        AS template_subject,
              t.body           AS template_body
         FROM email_scheduled_sends s
         JOIN email_campaigns       c  ON c.id  = s.campaign_id
         JOIN email_campaign_steps  st ON st.id = s.step_id
         JOIN message_templates     t  ON t.id  = st.template_id
        WHERE s.status = 'sending'
        ORDER BY s.scheduled_for ASC
        LIMIT :n`,
      { n: SEND_BATCH },
    );

    // Send serially — SMTP is a serial resource and parallel sends just
    // make rate-limit errors more likely.
    for (const r of rows) {
      await processOne(r);
    }
  } finally {
    _draining = false;
  }
}

async function processOne(row) {
  try {
    // Per-recipient render. If we don't have a CRM contact_id we still try
    // to send — just skip the merge step (subject/body go out as-is).
    let subject = row.subject_override || row.template_subject || '';
    let body    = row.template_body || '';
    if (row.contact_id) {
      // Look up the contact's organization so {{organization.*}} works.
      const [[c]] = await db.query(
        'SELECT id, organization_id FROM contacts WHERE id = :id',
        { id: row.contact_id },
      );
      const ctx = await buildContext({
        contact_id:      row.contact_id,
        organization_id: c?.organization_id || undefined,
      });
      subject = render(subject, ctx);
      body    = render(body, ctx);
    }

    const info = await sendMail({
      to:          row.to_email,
      subject,
      html:        body,
      text:        body,
      entityType:  row.contact_id ? 'contact' : null,
      entityId:    row.contact_id || null,
      // userId stays null — these are system-fired sends. The audit trail
      // is the campaign id on the row + the email_logs row.
    });

    // sendMail() inserts an email_logs row internally; we link it back so
    // the UI can deep-link from the send queue to the log entry.
    let emailLogId = null;
    try {
      const [[log]] = await db.query(
        `SELECT id FROM email_logs
          WHERE to_email = :to AND status = 'sent'
          ORDER BY id DESC LIMIT 1`,
        { to: row.to_email },
      );
      emailLogId = log?.id || null;
    } catch { /* non-fatal */ }

    await db.query(
      // UTC_TIMESTAMP() to stay consistent with the lease comparison and the
      // JS-Date inserts done by materializeBlast (pool is timezone:'Z').
      `UPDATE email_scheduled_sends
          SET status = 'sent', sent_at = UTC_TIMESTAMP(), attempts = attempts + 1,
              email_log_id = :log
        WHERE id = :id`,
      { id: row.id, log: emailLogId },
    );

    // For drip/triggered: schedule the next step. Stub today, real in 1b.
    if (row.enrollment_id) {
      await advanceEnrollment(row.enrollment_id).catch(logErr);
    }

    void info;
  } catch (err) {
    const attempts = (row.attempts || 0) + 1;
    const giveUp = attempts >= MAX_ATTEMPTS;
    // Surface the failure in the server log so admins can debug SMTP issues
    // without having to inspect the DB. Truncate so a verbose stack doesn't
    // dominate the log.
    // eslint-disable-next-line no-console
    console.error(
      `[scheduler] send failed (campaign=${row.campaign_id}, to=${row.to_email}, attempt=${attempts}/${MAX_ATTEMPTS}):`,
      String(err.message || err).slice(0, 400),
    );
    await db.query(
      `UPDATE email_scheduled_sends
          SET status = :st, attempts = :n, last_error = :err
        WHERE id = :id`,
      {
        id:  row.id,
        st:  giveUp ? 'failed' : 'pending',
        n:   attempts,
        err: String(err.message || err).slice(0, 1000),
      },
    );
  }
}

// ---- recurring evaluator tick ----------------------------------------------
async function evalRecurringTick() {
  const [rows] = await db.query(
    `SELECT * FROM email_campaigns
      WHERE type = 'recurring' AND status = 'active'`,
  );
  for (const c of rows) {
    try {
      await evalRecurringIfDue(c, new Date());
    } catch (err) { logErr(err); }
  }
}

// ---- one-shot helpers (used by routes) -------------------------------------
// "Send now" / "drain immediately" — the route layer calls this so admins
// don't have to wait up to a minute for the worker tick.
async function drainNow() {
  await sendDueTick();
}

function logErr(err) {
  // eslint-disable-next-line no-console
  console.error('[scheduler]', err.message || err);
}

// Validate a cron expression without scheduling it. Used by the route layer
// to give the user a useful error message at save time.
function validateCron(expr, timezone) {
  try {
    new Cron(expr, { timezone: timezone || undefined });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message || 'Invalid cron expression' };
  }
}

module.exports = { start, stop, drainNow, validateCron };
