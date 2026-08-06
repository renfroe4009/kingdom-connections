// =============================================================================
// /api/campaigns — Email Workflow management
// -----------------------------------------------------------------------------
// CRUD + lifecycle actions for blast / recurring / drip / triggered campaigns.
// Phase 1a wires up blast + recurring end-to-end. Drip and triggered routes
// accept the same payloads but are not surfaced in the UI yet.
//
// Lifecycle actions mirror what the user clicks in the UI:
//   POST /:id/start       — schedule a blast or activate a recurring campaign
//   POST /:id/pause       — stop materializing new sends, leave in-flight rows
//   POST /:id/resume      — flip paused → active/scheduled
//   POST /:id/cancel      — kill it; cancels every pending row
//   POST /:id/send-now    — admin override: materialize and drain immediately
// =============================================================================
const router = require('express').Router();
const { z } = require('zod');
const { db } = require('../db');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { resolveOwnerScope } = require('../services/scope');
const {
  resolveAudience,
  previewAudienceCount,
  materializeBlast,
  cancelPending,
  pickSendAt,
} = require('../services/campaigns');
const { drainNow, validateCron } = require('../services/scheduler');

router.use(requireAuth);

// ---- shared helpers ---------------------------------------------------------
function safeJson(v) {
  if (v == null) return null;
  if (typeof v === 'object') return v;
  try { return JSON.parse(v); } catch { return null; }
}

// Hydrate a campaign row + its steps + a quick-look at send queue counts.
async function hydrate(campaign) {
  const [steps] = await db.query(
    `SELECT s.id, s.step_order, s.template_id, s.delay_minutes,
            s.subject_override, s.is_active,
            t.name AS template_name, t.subject AS template_subject,
            t.channel AS template_channel
       FROM email_campaign_steps s
       JOIN message_templates t ON t.id = s.template_id
      WHERE s.campaign_id = :id
      ORDER BY s.step_order ASC`,
    { id: campaign.id },
  );
  const [[counts]] = await db.query(
    `SELECT
        SUM(status='pending')   AS pending,
        SUM(status='sending')   AS sending,
        SUM(status='sent')      AS sent,
        SUM(status='failed')    AS failed,
        SUM(status='cancelled') AS cancelled
       FROM email_scheduled_sends WHERE campaign_id = :id`,
    { id: campaign.id },
  );
  return {
    ...campaign,
    audience_config: safeJson(campaign.audience_config) || {},
    schedule_config: safeJson(campaign.schedule_config) || {},
    steps,
    send_counts: {
      pending:   Number(counts?.pending   || 0),
      sending:   Number(counts?.sending   || 0),
      sent:      Number(counts?.sent      || 0),
      failed:    Number(counts?.failed    || 0),
      cancelled: Number(counts?.cancelled || 0),
    },
  };
}

// ---- schemas ----------------------------------------------------------------
const stepSchema = z.object({
  template_id:      z.number().int().positive(),
  delay_minutes:    z.number().int().nonnegative().default(0),
  subject_override: z.string().max(500).optional().nullable(),
  is_active:        z.boolean().optional(),
});

const baseSchema = z.object({
  name:        z.string().min(1).max(200),
  description: z.string().max(1000).optional().nullable(),
  type:        z.enum(['blast', 'recurring', 'drip', 'triggered']),
  audience_type:   z.enum(['list', 'segment', 'contacts', 'all']),
  audience_config: z.record(z.any()).default({}),
  schedule_config: z.record(z.any()).default({}),
  steps: z.array(stepSchema).min(1, 'At least one step is required'),
});

// ---- list -------------------------------------------------------------------
router.get('/', requirePermission('campaigns.read'), async (req, res, next) => {
  try {
    const { type, status } = req.query;
    const where = []; const params = {};
    if (type)   { where.push('c.type   = :type');   params.type   = type; }
    if (status) { where.push('c.status = :status'); params.status = status; }

    // Row-level scope — sales agents see only campaigns they created;
    // managers see campaigns created by themselves or any of their reports.
    const scopeIds = await resolveOwnerScope(req.user);
    if (scopeIds !== null) {
      const ids = scopeIds.map((n) => parseInt(n, 10));
      if (ids.length === 0) return res.json([]);
      where.push(`c.created_by IN (${ids.join(', ')})`);
    }

    const [rows] = await db.query(
      `SELECT c.id, c.name, c.description, c.type, c.status,
              c.audience_type, c.last_run_at, c.total_enrolled,
              c.created_at, c.updated_at,
              CONCAT_WS(' ', u.first_name, u.last_name) AS created_by_name,
              (SELECT COUNT(*) FROM email_campaign_steps s WHERE s.campaign_id = c.id) AS step_count,
              (SELECT COUNT(*) FROM email_scheduled_sends s
                 WHERE s.campaign_id = c.id AND s.status='pending')                  AS pending_sends
         FROM email_campaigns c
         LEFT JOIN users u ON u.id = c.created_by
        ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
        ORDER BY c.created_at DESC`,
      params,
    );
    res.json(rows);
  } catch (err) { next(err); }
});

// ---- detail -----------------------------------------------------------------
router.get('/:id', requirePermission('campaigns.read'), async (req, res, next) => {
  try {
    const [[c]] = await db.query(
      'SELECT * FROM email_campaigns WHERE id = :id',
      { id: req.params.id },
    );
    if (!c) return res.status(404).json({ error: 'Campaign not found' });
    res.json(await hydrate(c));
  } catch (err) { next(err); }
});

// ---- create -----------------------------------------------------------------
router.post('/', requirePermission('campaigns.write'), async (req, res, next) => {
  try {
    const d = baseSchema.parse(req.body);
    validateScheduleConfig(d);

    const [result] = await db.query(
      `INSERT INTO email_campaigns
         (name, description, type, status, audience_type,
          audience_config, schedule_config, created_by)
       VALUES
         (:name, :description, :type, 'draft', :audience_type,
          CAST(:audience_config AS JSON), CAST(:schedule_config AS JSON), :uid)`,
      {
        name:            d.name,
        description:     d.description || null,
        type:            d.type,
        audience_type:   d.audience_type,
        audience_config: JSON.stringify(d.audience_config || {}),
        schedule_config: JSON.stringify(d.schedule_config || {}),
        uid:             req.user.id,
      },
    );
    await replaceSteps(result.insertId, d.steps);
    const [[c]] = await db.query('SELECT * FROM email_campaigns WHERE id = :id', { id: result.insertId });
    res.json(await hydrate(c));
  } catch (err) { next(err); }
});

// ---- update -----------------------------------------------------------------
router.put('/:id', requirePermission('campaigns.write'), async (req, res, next) => {
  try {
    const d = baseSchema.parse(req.body);
    validateScheduleConfig(d);

    const [[existing]] = await db.query(
      'SELECT * FROM email_campaigns WHERE id = :id',
      { id: req.params.id },
    );
    if (!existing) return res.status(404).json({ error: 'Campaign not found' });
    if (existing.status === 'completed' || existing.status === 'cancelled') {
      return res.status(400).json({ error: `Cannot edit a ${existing.status} campaign` });
    }

    await db.query(
      `UPDATE email_campaigns SET
         name = :name, description = :description, type = :type,
         audience_type = :audience_type,
         audience_config = CAST(:audience_config AS JSON),
         schedule_config = CAST(:schedule_config AS JSON)
       WHERE id = :id`,
      {
        id:              req.params.id,
        name:            d.name,
        description:     d.description || null,
        type:            d.type,
        audience_type:   d.audience_type,
        audience_config: JSON.stringify(d.audience_config || {}),
        schedule_config: JSON.stringify(d.schedule_config || {}),
      },
    );
    await replaceSteps(req.params.id, d.steps);
    const [[c]] = await db.query('SELECT * FROM email_campaigns WHERE id = :id', { id: req.params.id });
    res.json(await hydrate(c));
  } catch (err) { next(err); }
});

// ---- delete -----------------------------------------------------------------
// Cascades through email_campaign_steps + email_scheduled_sends + enrollments
// via the FKs. Refuses to delete if a wave is mid-send.
router.delete('/:id', requirePermission('campaigns.write'), async (req, res, next) => {
  try {
    const [[busy]] = await db.query(
      `SELECT COUNT(*) AS n FROM email_scheduled_sends
        WHERE campaign_id = :id AND status = 'sending'`,
      { id: req.params.id },
    );
    if (busy?.n > 0) {
      return res.status(409).json({ error: 'Campaign has sends in flight; pause and retry.' });
    }
    await db.query('DELETE FROM email_campaigns WHERE id = :id', { id: req.params.id });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ---- preview audience -------------------------------------------------------
// Cheap "how many recipients?" probe so the UI can display a count before
// the user commits.
router.get('/:id/preview-audience', requirePermission('campaigns.read'), async (req, res, next) => {
  try {
    const [[c]] = await db.query(
      'SELECT * FROM email_campaigns WHERE id = :id',
      { id: req.params.id },
    );
    if (!c) return res.status(404).json({ error: 'Campaign not found' });
    const count = await previewAudienceCount(c);
    res.json({ count });
  } catch (err) { next(err); }
});

// ---- list sends -------------------------------------------------------------
// Paged view of the queue for one campaign — used by the detail page to show
// pending/sent/failed rows so admins can spot delivery issues.
router.get('/:id/sends', requirePermission('campaigns.read'), async (req, res, next) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 50, 500);
    const offset = Number(req.query.offset) || 0;
    const status = req.query.status || null;
    const where = ['s.campaign_id = :id']; const params = { id: req.params.id, limit, offset };
    if (status) { where.push('s.status = :status'); params.status = status; }

    const [rows] = await db.query(
      `SELECT s.id, s.contact_id, s.to_email, s.scheduled_for, s.status,
              s.attempts, s.last_error, s.sent_at, s.email_log_id,
              CONCAT_WS(' ', c.first_name, c.last_name) AS contact_name
         FROM email_scheduled_sends s
         LEFT JOIN contacts c ON c.id = s.contact_id
        WHERE ${where.join(' AND ')}
        ORDER BY s.scheduled_for DESC, s.id DESC
        LIMIT :limit OFFSET :offset`,
      params,
    );
    res.json(rows);
  } catch (err) { next(err); }
});

// ---- start ------------------------------------------------------------------
// Move a draft campaign into its working state. For blasts that means
// "scheduled" + materializing the send queue; for recurring it just means
// "active" — the evaluator picks it up on the next 5-minute tick.
router.post('/:id/start', requirePermission('campaigns.write'), async (req, res, next) => {
  try {
    const [[c]] = await db.query(
      'SELECT * FROM email_campaigns WHERE id = :id',
      { id: req.params.id },
    );
    if (!c) return res.status(404).json({ error: 'Campaign not found' });

    if (c.type === 'blast') {
      const sendAt = pickSendAt(c);
      if (!sendAt) {
        return res.status(400).json({ error: 'Blast campaign needs schedule_config.send_at' });
      }
      const enqueued = await materializeBlast(c, { sendAt });
      await db.query(
        "UPDATE email_campaigns SET status='scheduled' WHERE id = :id",
        { id: c.id },
      );
      // If send_at is already in the past (admin scheduled "asap"), drain
      // immediately so they don't wait up to a minute for the worker tick.
      if (sendAt <= new Date()) drainNow().catch(() => {});
      return res.json({ ok: true, enqueued, status: 'scheduled' });
    }

    if (c.type === 'recurring') {
      await db.query(
        "UPDATE email_campaigns SET status='active' WHERE id = :id",
        { id: c.id },
      );
      return res.json({ ok: true, status: 'active' });
    }

    if (c.type === 'drip' || c.type === 'triggered') {
      // 1b: enrollment / event subscriber wiring goes here.
      await db.query(
        "UPDATE email_campaigns SET status='active' WHERE id = :id",
        { id: c.id },
      );
      return res.json({ ok: true, status: 'active', note: 'Drip/triggered enrollment lands in phase 1b' });
    }

    return res.status(400).json({ error: 'Unknown campaign type' });
  } catch (err) { next(err); }
});

// ---- pause / resume / cancel -----------------------------------------------
router.post('/:id/pause', requirePermission('campaigns.write'), async (req, res, next) => {
  try {
    await db.query(
      `UPDATE email_campaigns
          SET status = 'paused'
        WHERE id = :id AND status IN ('scheduled','active')`,
      { id: req.params.id },
    );
    res.json({ ok: true, status: 'paused' });
  } catch (err) { next(err); }
});

router.post('/:id/resume', requirePermission('campaigns.write'), async (req, res, next) => {
  try {
    const [[c]] = await db.query(
      'SELECT type FROM email_campaigns WHERE id = :id',
      { id: req.params.id },
    );
    if (!c) return res.status(404).json({ error: 'Campaign not found' });
    const next_status = c.type === 'blast' ? 'scheduled' : 'active';
    await db.query(
      `UPDATE email_campaigns
          SET status = :st
        WHERE id = :id AND status = 'paused'`,
      { id: req.params.id, st: next_status },
    );
    res.json({ ok: true, status: next_status });
  } catch (err) { next(err); }
});

router.post('/:id/cancel', requirePermission('campaigns.write'), async (req, res, next) => {
  try {
    const cancelled = await cancelPending(req.params.id);
    await db.query(
      "UPDATE email_campaigns SET status = 'cancelled' WHERE id = :id",
      { id: req.params.id },
    );
    res.json({ ok: true, status: 'cancelled', cancelled_sends: cancelled });
  } catch (err) { next(err); }
});

// ---- send-now ---------------------------------------------------------------
// Bypass the scheduled_for and ship the wave immediately. Useful for "Send
// test to my list right now" or recovering a missed recurring fire.
//
// We surface concrete diagnostics so admins aren't left wondering why a
// send-now appeared to do nothing — the original implementation swallowed
// "0 recipients" / "no active step" / drainer errors silently.
router.post('/:id/send-now', requirePermission('campaigns.write'), async (req, res, next) => {
  try {
    const [[c]] = await db.query(
      'SELECT * FROM email_campaigns WHERE id = :id',
      { id: req.params.id },
    );
    if (!c) return res.status(404).json({ error: 'Campaign not found' });
    if (c.type !== 'blast' && c.type !== 'recurring') {
      return res.status(400).json({ error: 'Send-now is only supported for blast and recurring campaigns' });
    }

    // Pre-flight checks so we can return a clear reason instead of "ok:true,
    // enqueued:0" — which is what made the previous "send-now did nothing"
    // bug invisible.
    const [activeSteps] = await db.query(
      `SELECT s.id, s.template_id, t.subject, t.body
         FROM email_campaign_steps s
         JOIN message_templates t ON t.id = s.template_id
        WHERE s.campaign_id = :id AND s.is_active = 1
        ORDER BY s.step_order ASC LIMIT 1`,
      { id: c.id },
    );
    if (!activeSteps[0]) {
      return res.status(400).json({
        error: 'Campaign has no active step / template attached. Edit the campaign and pick a template.',
      });
    }

    const audienceCount = await previewAudienceCount(c);
    if (audienceCount === 0) {
      return res.status(400).json({
        error:
          'No recipients matched. Check that the selected list/segment is non-empty, '
          + 'that the picked contacts have email addresses on file, and that the audience type matches the audience config.',
      });
    }

    const enqueued = await materializeBlast(c, { sendAt: new Date() });
    await db.query(
      `UPDATE email_campaigns
          SET status = IF(type='blast','scheduled','active')
        WHERE id = :id`,
      { id: c.id },
    );

    // Drain inline so the response can report what actually happened. Errors
    // from drainNow() used to be swallowed; now we await + capture so the UI
    // can show "5 sent, 2 failed (Mailtrap auth error)".
    let drained_ok = true;
    let drain_error = null;
    try {
      await drainNow();
    } catch (err) {
      drained_ok = false;
      drain_error = err.message || String(err);
      // eslint-disable-next-line no-console
      console.error('[campaigns] send-now drain failed:', err);
    }

    // Read back the post-drain state for the response so the client can show
    // a useful summary line ("5 sent, 0 failed") instead of just "ok".
    const [[counts]] = await db.query(
      // UTC_TIMESTAMP to match how scheduled_for was inserted (pool tz='Z').
      `SELECT
          SUM(status='pending') AS pending,
          SUM(status='sent')    AS sent,
          SUM(status='failed')  AS failed
         FROM email_scheduled_sends
        WHERE campaign_id = :id
          AND scheduled_for >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 5 MINUTE)`,
      { id: c.id },
    );

    res.json({
      ok: drained_ok,
      enqueued,
      sent:    Number(counts?.sent    || 0),
      failed:  Number(counts?.failed  || 0),
      pending: Number(counts?.pending || 0),
      drain_error,
    });
  } catch (err) { next(err); }
});

// ---- helpers ----------------------------------------------------------------
async function replaceSteps(campaignId, steps) {
  await db.query('DELETE FROM email_campaign_steps WHERE campaign_id = :id', { id: campaignId });
  for (let i = 0; i < steps.length; i += 1) {
    const s = steps[i];
    await db.query(
      `INSERT INTO email_campaign_steps
         (campaign_id, step_order, template_id, delay_minutes, subject_override, is_active)
       VALUES
         (:cid, :order, :tid, :delay, :subj, :active)`,
      {
        cid:    campaignId,
        order:  i + 1,
        tid:    s.template_id,
        delay:  s.delay_minutes ?? 0,
        subj:   s.subject_override || null,
        active: s.is_active === false ? 0 : 1,
      },
    );
  }
}

// Validate type-specific schedule_config bits before we let a campaign save.
function validateScheduleConfig(d) {
  if (d.type === 'blast') {
    if (!d.schedule_config?.send_at) {
      throw zodish('schedule_config.send_at is required for blast campaigns');
    }
    if (Number.isNaN(new Date(d.schedule_config.send_at).getTime())) {
      throw zodish('schedule_config.send_at must be a valid ISO timestamp');
    }
  }
  if (d.type === 'recurring') {
    if (!d.schedule_config?.cron) {
      throw zodish('schedule_config.cron is required for recurring campaigns');
    }
    const v = validateCron(d.schedule_config.cron, d.schedule_config.timezone);
    if (!v.ok) throw zodish(`Invalid cron expression: ${v.error}`);
  }
}

function zodish(message) {
  const err = new Error(message);
  err.status = 400;
  return err;
}

module.exports = router;
