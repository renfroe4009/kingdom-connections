// =============================================================================
// /api/sms — outbound + log read + inbound webhooks
// -----------------------------------------------------------------------------
// The two Twilio webhook routes are registered BEFORE router.use(requireAuth)
// below — Twilio can't attach a session JWT, so they were unreachable by real
// Twilio traffic when they sat after it (a real pre-existing bug: inbound
// delivery and status callbacks have been silently broken since they were
// built). They're authenticated instead by Twilio's own request signature.
// =============================================================================
const router = require('express').Router();
const { z } = require('zod');
const { db } = require('../db');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { sendSms } = require('../services/sms');
const { render, buildContext } = require('../services/templates');
const { logActivity } = require('../services/activity');

// ---------------------------------------------------------------------------
// Twilio delivery status callback — /api/sms/webhook/twilio/status
// Twilio POSTs here whenever a message status changes (queued→sent→delivered
// or failed/undelivered). No auth — validated by Twilio signature.
// ---------------------------------------------------------------------------
router.post('/webhook/twilio/status', async (req, res) => {
  try {
    const { getSmsConfig } = require('../services/sms');
    const cfg = await getSmsConfig();

    if (cfg.auth_token && cfg.provider === 'twilio') {
      const Twilio     = require('twilio');
      const sig        = req.headers['x-twilio-signature'] || '';
      const proto      = req.headers['x-forwarded-proto'] || req.protocol;
      const host       = req.headers['x-forwarded-host']  || req.get('host');
      const webhookUrl = `${proto}://${host}${req.originalUrl}`;
      const isValid    = Twilio.validateRequest(cfg.auth_token, sig, webhookUrl, req.body || {});
      if (!isValid) {
        console.warn('[sms status callback] invalid Twilio signature');
        return res.status(403).send('Forbidden');
      }
    }

    const sid       = req.body?.MessageSid;
    const status    = req.body?.MessageStatus;  // queued|sending|sent|delivered|undelivered|failed
    const errorCode = req.body?.ErrorCode  || null;
    const errorMsg  = req.body?.ErrorMessage || null;

    if (sid && status) {
      const allowed = ['queued','sending','sent','delivered','undelivered','failed','received'];
      const safeStatus = allowed.includes(status) ? status : 'failed';
      const errorDetail = errorCode ? `Twilio error ${errorCode}: ${errorMsg || ''}` : null;

      await db.query(
        `UPDATE sms_logs
            SET status = :status,
                error  = COALESCE(:error, error),
                error_code = COALESCE(:errorCode, error_code)
          WHERE provider_message_id = :sid`,
        { status: safeStatus, error: errorDetail, errorCode: errorCode ? String(errorCode) : null, sid },
      );
      console.log(`[sms status] ${sid} → ${safeStatus}${errorCode ? ` (${errorCode})` : ''}`);
    }

    res.status(204).send();
  } catch (err) {
    console.error('[sms status callback]', err.message);
    res.status(500).send('Error');
  }
});

// ---------------------------------------------------------------------------
// Twilio inbound webhook — /api/sms/webhook/twilio (no auth, validated by sig)
// Twilio posts application/x-www-form-urlencoded. Logs every message, tries
// to match it to an existing contact by mobile/phone, then handles (in
// order): STOP-family opt-out / START-family opt-back-in, and Text to Give
// (donor texts a keyword — see server/src/services/sms.js's getSmsConfig for
// the text_to_give_* settings this reads). Anything else just logs silently,
// same as before this session's Text-to-Give work.
// ---------------------------------------------------------------------------
router.post('/webhook/twilio', async (req, res) => {
  try {
    const { getSmsConfig, logSms, normalizeNumber } = require('../services/sms');
    const cfg = await getSmsConfig();

    // Validate Twilio signature using the official SDK helper
    if (cfg.auth_token && cfg.provider === 'twilio') {
      const Twilio  = require('twilio');
      const sig     = req.headers['x-twilio-signature'] || '';
      // Reconstruct the exact URL Twilio called — honour X-Forwarded headers
      // so reverse-proxy / ngrok setups produce the right public URL.
      const proto   = req.headers['x-forwarded-proto'] || req.protocol;
      const host    = req.headers['x-forwarded-host']  || req.get('host');
      const webhookUrl = `${proto}://${host}${req.originalUrl}`;
      const isValid = Twilio.validateRequest(cfg.auth_token, sig, webhookUrl, req.body || {});
      if (!isValid) {
        console.warn('[sms webhook] invalid Twilio signature — possible spoofed request');
        return res.status(403).send('Forbidden');
      }
    }

    const from   = normalizeNumber(req.body?.From  || '');
    const to     = normalizeNumber(req.body?.To    || '');
    const body   = req.body?.Body || '';
    const sid    = req.body?.MessageSid || null;
    const trimmedBody = body.trim();

    // Try to match to a contact by mobile or phone. Matches on the last 10
    // digits (LIKE '%...') rather than an exact stripped-formatting compare —
    // a contact's number is very often stored with a leading '+' (e.g.
    // "+18055551234"), which an exact match against a bare-digits From
    // number would never hit. This previously meant real inbound Twilio
    // messages silently never attached to a contact record at all.
    let contactId = null;
    if (from) {
      const last10 = from.replace(/\D/g, '').slice(-10);
      const [rows] = await db.query(
        `SELECT id FROM contacts
          WHERE REPLACE(REPLACE(REPLACE(mobile,'-',''),'(',''),')','') LIKE CONCAT('%', :num)
             OR REPLACE(REPLACE(REPLACE(phone, '-',''),'(',''),')','') LIKE CONCAT('%', :num)
          LIMIT 1`,
        { num: last10 }
      );
      contactId = rows[0]?.id || null;
    }

    await logSms({
      direction: 'inbound',
      fromNumber: from,
      toNumber:   to,
      body,
      entityType: contactId ? 'contact' : null,
      entityId:   contactId,
      provider:   'twilio',
      providerMessageId: sid,
      status: 'delivered',
    });

    function twiml(message) {
      const escaped = message
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      return `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escaped}</Message></Response>`;
    }
    async function replyAndLog(message) {
      await logSms({
        direction: 'outbound', fromNumber: to, toNumber: from, body: message,
        entityType: contactId ? 'contact' : null, entityId: contactId,
        provider: 'twilio', status: 'sent',
      });
      res.set('Content-Type', 'text/xml').send(twiml(message));
    }

    // ---- STOP-family opt-out / START-family opt-back-in (carrier convention:
    // exact whole-message match, case-insensitive) — checked before anything
    // else, and independent of contact match (an unmatched number can still
    // opt out; we just can't attach it to a contact record). ----
    const upperBody = trimmedBody.toUpperCase();
    if (['STOP', 'STOPALL', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT'].includes(upperBody)) {
      if (contactId) await db.query('UPDATE contacts SET sms_opt_out = 1 WHERE id = :id', { id: contactId });
      return replyAndLog("You've been unsubscribed and won't receive further texts from us. Reply START to resubscribe.");
    }
    if (['START', 'UNSTOP', 'YES'].includes(upperBody)) {
      if (contactId) await db.query('UPDATE contacts SET sms_opt_out = 0 WHERE id = :id', { id: contactId });
      return replyAndLog("You're resubscribed. Reply STOP at any time to opt out again.");
    }

    // ---- Text to Give — cfg (fetched above for signature validation) already
    // carries the text_to_give_* columns via getSmsConfig()'s SELECT *. ----
    if (cfg.text_to_give_enabled) {
      const kw = (cfg.text_to_give_keyword || 'GIVE').toUpperCase();
      if (upperBody === kw || upperBody.startsWith(kw + ' ')) {
        const fundKeyword = trimmedBody.slice(kw.length).trim();
        const clientBase = (process.env.CLIENT_ORIGIN || 'http://localhost:5173').split(',')[0].trim();
        const landingPath = cfg.text_to_give_landing_path || '/donate';

        let fund = null;
        if (fundKeyword) {
          const [[f]] = await db.query(
            'SELECT id, name, slug FROM funds WHERE sms_keyword = :kw AND is_active = 1',
            { kw: fundKeyword.toUpperCase() }
          );
          fund = f || null;
        }

        if (fundKeyword && !fund) {
          const ctx = await buildContext({ contact_id: contactId });
          const helpMsg = render(
            cfg.text_to_give_help_template
              || `We didn't recognize "${fundKeyword}". Text ${kw} on its own to give to our general fund, or check with us for the right keyword.`,
            ctx
          );
          return replyAndLog(helpMsg);
        }

        const link = `${clientBase}${landingPath}?${fund ? `fund=${encodeURIComponent(fund.slug)}&` : ''}src=sms`;
        const ctx = await buildContext({ contact_id: contactId });
        ctx.fund = fund ? { name: fund.name, slug: fund.slug } : { name: 'our general fund', slug: '' };
        ctx.link = link;
        const replyMsg = render(
          cfg.text_to_give_reply_template
            || 'Thank you for supporting {{business.name}}! Complete your gift to {{fund.name}} here: {{link}} Reply STOP to opt out.',
          ctx
        );
        return replyAndLog(replyMsg);
      }
    }

    // Twilio expects a 200 + TwiML (empty response = no auto-reply)
    res.set('Content-Type', 'text/xml').send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
  } catch (err) {
    console.error('[sms webhook]', err.message);
    res.status(500).send('Error');
  }
});

router.use(requireAuth);

const sendSchema = z.object({
  to:              z.string().min(1),
  body:            z.string().min(1).optional(),
  template_id:     z.number().int().optional(),
  entity_type:     z.enum(['contact','organization','deal']).optional(),
  entity_id:       z.number().int().optional(),
  // Optional context for merge-field rendering — we'll fall back to entity_*
  // if these aren't passed but the template has merge fields.
  contact_id:      z.number().int().optional(),
  organization_id: z.number().int().optional(),
  deal_id:         z.number().int().optional(),
}).refine((d) => d.body || d.template_id, {
  message: 'Either body or template_id is required',
});

router.post('/send', requirePermission('comms.write'), async (req, res, next) => {
  try {
    const d = sendSchema.parse(req.body);

    let body = d.body || '';
    if (d.template_id) {
      const [[t]] = await db.query(
        `SELECT body, channel FROM message_templates WHERE id = :id AND is_active = 1`,
        { id: d.template_id },
      );
      if (!t) return res.status(404).json({ error: 'Template not found or inactive' });
      if (t.channel !== 'sms') return res.status(400).json({ error: 'Template is not an SMS template' });
      body = t.body;
    }

    // Resolve merge fields, defaulting entity_* to contact_id when missing.
    const ctx = await buildContext({
      contact_id:      d.contact_id      ?? (d.entity_type === 'contact'      ? d.entity_id : undefined),
      organization_id: d.organization_id ?? (d.entity_type === 'organization' ? d.entity_id : undefined),
      deal_id:         d.deal_id         ?? (d.entity_type === 'deal'         ? d.entity_id : undefined),
      user_id:         req.user.id,
    });
    const rendered = render(body, ctx);

    const result = await sendSms({
      to: d.to,
      body: rendered,
      entityType: d.entity_type || null,
      entityId:   d.entity_id   || null,
      userId:     req.user.id,
    });

    if (d.entity_type && d.entity_id) {
      await logActivity({
        userId: req.user.id,
        entityType: d.entity_type,
        entityId: d.entity_id,
        action: 'sms_sent',
        description: `SMS sent to ${d.to}: ${rendered.slice(0, 80)}${rendered.length > 80 ? '…' : ''}`,
      });
    }

    res.json({ ok: true, ...result });
  } catch (err) { next(err); }
});

// ---- bulk send -------------------------------------------------------------
// Same recipient-shape contract as email/bulk-send, minus subject. SMS list
// resolves use mobile (with phone fallback) — addresses with neither are
// silently skipped so a list with 50 contacts and 47 numbers still fires.
const bulkSchema = z.object({
  recipients: z.array(z.object({
    to: z.string().min(1),
    contact_id: z.number().int().optional(),
  })).optional(),
  list_id:     z.number().int().optional(),
  body:        z.string().min(1).optional(),
  template_id: z.number().int().optional(),
}).refine((d) => d.recipients?.length || d.list_id, {
  message: 'Either recipients or list_id is required',
}).refine((d) => d.body || d.template_id, {
  message: 'Either body or template_id is required',
});

router.post('/bulk-send', requirePermission('comms.write'), async (req, res, next) => {
  try {
    const d = bulkSchema.parse(req.body);

    let body = d.body || '';
    if (d.template_id) {
      const [[t]] = await db.query(
        'SELECT body, channel FROM message_templates WHERE id = :id AND is_active = 1',
        { id: d.template_id },
      );
      if (!t) return res.status(404).json({ error: 'Template not found or inactive' });
      if (t.channel !== 'sms') return res.status(400).json({ error: 'Template is not an SMS template' });
      body = t.body;
    }

    let recipients = d.recipients || [];
    if (d.list_id) {
      const [rows] = await db.query(
        `SELECT c.id AS contact_id,
                COALESCE(NULLIF(c.mobile,''), NULLIF(c.phone,'')) AS to_num
           FROM contact_list_members m
           JOIN contacts c ON c.id = m.contact_id
          WHERE m.list_id = :id`,
        { id: d.list_id },
      );
      recipients = rows
        .filter((r) => r.to_num)
        .map((r) => ({ to: r.to_num, contact_id: r.contact_id }));
    }

    if (!recipients.length) return res.status(400).json({ error: 'No valid recipients' });
    if (recipients.length > 500) return res.status(400).json({ error: 'Bulk send capped at 500 recipients per request' });

    const results = { sent: 0, failed: 0, errors: [] };
    for (const r of recipients) {
      try {
        let rendered = body;
        if (r.contact_id) {
          const ctx = await buildContext({ contact_id: r.contact_id, user_id: req.user.id });
          rendered = render(body, ctx);
        }
        await sendSms({
          to: r.to,
          body: rendered,
          entityType: r.contact_id ? 'contact' : null,
          entityId:   r.contact_id || null,
          userId:     req.user.id,
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

router.get('/logs', requirePermission('comms.read'), async (req, res, next) => {
  try {
    const { entity_type, entity_id, direction, status } = req.query;
    const where = []; const params = {};
    if (entity_type) { where.push('entity_type = :et');     params.et  = entity_type; }
    if (entity_id)   { where.push('entity_id = :eid');      params.eid = entity_id; }
    if (direction)   { where.push('direction = :dir');      params.dir = direction; }
    if (status)      { where.push('status = :st');          params.st  = status; }
    const [rows] = await db.query(
      `SELECT id, direction, from_user_id, from_number, to_number, body,
              entity_type, entity_id, provider, provider_message_id, segments,
              status, error, sent_at, created_at
         FROM sms_logs
        ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
        ORDER BY created_at DESC LIMIT 200`,
      params,
    );
    res.json(rows);
  } catch (err) { next(err); }
});

module.exports = router;
