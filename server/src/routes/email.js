// =============================================================================
// /api/email — send + log
// -----------------------------------------------------------------------------
// Two send modes:
//   * single recipient — body shape: { to, subject, html?, text?, ... }
//   * bulk — body shape:
//       {
//         recipients: [{ to, contact_id?, name? }, ...]   // OR
//         list_id:    number                              // resolved server-side
//         subject, html?/text?, template_id?
//       }
//
//   In bulk mode each recipient gets a per-recipient render of the template
//   (so {{contact.first_name}} works) and one row per recipient is logged. We
//   do not Promise.all — the SMTP transporter is a serial resource and 200
//   parallel sends would just rate-limit anyway.
// =============================================================================
const router = require('express').Router();
const { z } = require('zod');
const { db } = require('../db');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { sendMail } = require('../services/mailer');
const { logActivity } = require('../services/activity');
const { render, buildContext } = require('../services/templates');

router.use(requireAuth);

const sendSchema = z.object({
  to: z.string().email(),
  cc: z.string().optional(),
  bcc: z.string().optional(),
  subject: z.string().min(1),
  html: z.string().optional(),
  text: z.string().optional(),
  entity_type: z.enum(['contact','organization','deal']).optional(),
  entity_id:   z.number().int().optional(),
});

router.post('/send', requirePermission('notes.write'), async (req, res, next) => {
  try {
    const d = sendSchema.parse(req.body);
    await sendMail({
      ...d, userId: req.user.id,
      entityType: d.entity_type, entityId: d.entity_id,
    });
    if (d.entity_type && d.entity_id) {
      await logActivity({ userId: req.user.id, entityType: d.entity_type, entityId: d.entity_id,
        action: 'email_sent', description: `Email sent: ${d.subject}` });
    }
    res.json({ ok: true });
  } catch (err) { next(err); }
});

const bulkSchema = z.object({
  // exactly one of recipients/list_id is required (refine below)
  recipients:  z.array(z.object({
    to: z.string().email(),
    contact_id: z.number().int().optional(),
    name: z.string().optional(),
  })).optional(),
  list_id:     z.number().int().optional(),
  subject:     z.string().min(1),
  html:        z.string().optional(),
  text:        z.string().optional(),
  template_id: z.number().int().optional(),
}).refine((d) => d.recipients?.length || d.list_id, {
  message: 'Either recipients or list_id is required',
});

router.post('/bulk-send', requirePermission('comms.write'), async (req, res, next) => {
  try {
    const d = bulkSchema.parse(req.body);

    let subject = d.subject;
    let body    = d.html || d.text || '';

    // Template overrides ad-hoc subject/body so callers can pass either.
    if (d.template_id) {
      const [[t]] = await db.query(
        'SELECT subject, body, channel FROM message_templates WHERE id = :id AND is_active = 1',
        { id: d.template_id },
      );
      if (!t) return res.status(404).json({ error: 'Template not found or inactive' });
      if (t.channel !== 'email') return res.status(400).json({ error: 'Template is not an email template' });
      subject = t.subject || subject;
      body    = t.body    || body;
    }

    // Resolve recipients: explicit list wins; fall back to list_id lookup.
    let recipients = d.recipients || [];
    if (d.list_id) {
      const [rows] = await db.query(
        `SELECT c.id AS contact_id, c.email AS to_addr,
                CONCAT_WS(' ', c.first_name, c.last_name) AS name
           FROM contact_list_members m
           JOIN contacts c ON c.id = m.contact_id
          WHERE m.list_id = :id AND c.email IS NOT NULL AND c.email <> ''`,
        { id: d.list_id },
      );
      recipients = rows.map((r) => ({ to: r.to_addr, contact_id: r.contact_id, name: r.name }));
    }

    if (!recipients.length) {
      return res.status(400).json({ error: 'No valid recipients' });
    }

    // Cap bulk sends at 500 per request to avoid runaway loops; the UI should
    // batch beyond this. Bumping this requires a real queue (out of scope).
    if (recipients.length > 500) {
      return res.status(400).json({ error: 'Bulk send capped at 500 recipients per request' });
    }

    const results = { sent: 0, failed: 0, errors: [] };
    for (const r of recipients) {
      try {
        // Per-recipient context lets {{contact.first_name}} resolve correctly
        // for each row. If the recipient isn't a CRM contact we just skip the
        // merge step and ship the body as-is.
        let renderedSubject = subject;
        let renderedBody    = body;
        if (r.contact_id) {
          const ctx = await buildContext({ contact_id: r.contact_id, user_id: req.user.id });
          renderedSubject = render(subject, ctx);
          renderedBody    = render(body, ctx);
        }
        await sendMail({
          to: r.to,
          subject: renderedSubject,
          html: renderedBody,
          text: renderedBody,
          userId: req.user.id,
          entityType: r.contact_id ? 'contact' : null,
          entityId:   r.contact_id || null,
        });
        results.sent += 1;
      } catch (err) {
        results.failed += 1;
        results.errors.push({ to: r.to, error: err.message });
      }
    }

    res.json({ ok: true, ...results });
  } catch (err) { next(err); }
});

// -------- Test send (used by Settings → SMTP "Send test") --------
const testSchema = z.object({
  to: z.string().email(),
});

router.post('/test', requirePermission('settings.manage'), async (req, res, next) => {
  try {
    const d = testSchema.parse(req.body);
    await sendMail({
      to: d.to,
      subject: 'SMTP test message',
      text: 'This is a test message from your SMTP configuration. If you received it, things are wired up correctly.',
      html: '<p>This is a test message from your SMTP configuration.</p><p>If you received it, things are wired up correctly.</p>',
      userId: req.user.id,
    });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.get('/logs', async (req, res, next) => {
  try {
    const { entity_type, entity_id } = req.query;
    const where = []; const params = {};
    if (entity_type) { where.push('entity_type = :et');  params.et  = entity_type; }
    if (entity_id)   { where.push('entity_id = :eid');   params.eid = entity_id; }
    const [rows] = await db.query(
      `SELECT id, from_user_id, to_email, subject, status, error, sent_at, created_at, entity_type, entity_id
         FROM email_logs ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
        ORDER BY created_at DESC LIMIT 100`, params);
    res.json(rows);
  } catch (err) { next(err); }
});

module.exports = router;
