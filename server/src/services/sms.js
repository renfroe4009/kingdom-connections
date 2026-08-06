// =============================================================================
// SMS service — Twilio-shaped, but the only outbound action that actually
// hits the wire is gated on provider !== 'dryrun'. Phase 1 ships in dry-run
// mode by default (no real SMS) — set sms_settings.provider='twilio' and fill
// in account_sid / auth_token / from_number to start sending.
//
// Mirrors mailer.js: every send (success or failure) lands in sms_logs so the
// unified inbox + entity timeline are accurate even when the carrier is down.
// =============================================================================
const { db } = require('../db');

async function getSmsConfig() {
  try {
    const [rows] = await db.query(
      'SELECT * FROM sms_settings WHERE is_active = 1 ORDER BY id DESC LIMIT 1'
    );
    if (rows[0]) return rows[0];
  } catch (_e) { /* fall through to env */ }

  return {
    provider:    process.env.SMS_PROVIDER     || 'dryrun',
    account_sid: process.env.SMS_ACCOUNT_SID  || null,
    auth_token:  process.env.SMS_AUTH_TOKEN   || null,
    from_number: process.env.SMS_FROM_NUMBER  || null,
  };
}

// Best-effort E.164 normalization — strips formatting, leaves digits + leading
// '+'. Real validation lives at the provider; we just want consistent storage.
function normalizeNumber(num) {
  if (!num) return num;
  const trimmed = String(num).trim();
  if (trimmed.startsWith('+')) return '+' + trimmed.slice(1).replace(/\D/g, '');
  const digits = trimmed.replace(/\D/g, '');
  // Default to NANP +1 if it looks like a US 10-digit; otherwise leave bare.
  if (digits.length === 10) return '+1' + digits;
  if (digits.length === 11 && digits.startsWith('1')) return '+' + digits;
  return digits ? '+' + digits : null;
}

async function sendSms({ to, body, entityType = null, entityId = null, userId = null, statusCallbackUrl = null }) {
  const cfg = await getSmsConfig();
  const toNum = normalizeNumber(to);
  if (!toNum) {
    await logSms({ userId, fromNumber: cfg.from_number, toNumber: to, body,
      entityType, entityId, provider: cfg.provider, status: 'failed',
      error: 'Invalid recipient number' });
    throw new Error('Invalid recipient number');
  }

  // Compliance: never send to a contact who's replied STOP (or equivalent),
  // regardless of which flow is trying to send — Text-to-Give replies,
  // template sends, bulk campaigns, all of it. Matched by digits-only phone
  // comparison, same as the inbound webhook's contact lookup below.
  const digits = toNum.replace(/\D/g, '');
  const [[optedOut]] = await db.query(
    `SELECT id FROM contacts
      WHERE sms_opt_out = 1
        AND (REPLACE(REPLACE(REPLACE(mobile,'-',''),'(',''),')','') LIKE CONCAT('%', :num)
          OR REPLACE(REPLACE(REPLACE(phone, '-',''),'(',''),')','') LIKE CONCAT('%', :num))
      LIMIT 1`,
    { num: digits.slice(-10) }
  );
  if (optedOut) {
    await logSms({ userId, fromNumber: cfg.from_number, toNumber: toNum, body,
      entityType, entityId, provider: cfg.provider, status: 'failed',
      error: 'Recipient has opted out of SMS' });
    throw new Error('Recipient has opted out of SMS');
  }

  // Dry-run mode is the default — log it as 'sent' so the inbox flow works,
  // but never call the carrier. Useful for local/QA without burning credits.
  if (cfg.provider === 'dryrun' || !cfg.account_sid || !cfg.auth_token || !cfg.from_number) {
    const logId = await logSms({
      userId, fromNumber: cfg.from_number || '+10000000000', toNumber: toNum, body,
      entityType, entityId, provider: cfg.provider || 'dryrun', status: 'sent',
      providerMessageId: `dryrun_${Date.now()}`,
    });
    return { ok: true, dryRun: true, id: logId };
  }

  if (cfg.provider === 'twilio') {
    const Twilio = require('twilio');
    // API Key auth: Twilio(apiKeySid, apiKeySecret, { accountSid })
    // Auth Token auth: Twilio(accountSid, authToken)
    const client = cfg.api_key_sid
      ? Twilio(cfg.api_key_sid, cfg.auth_token, { accountSid: cfg.account_sid })
      : Twilio(cfg.account_sid, cfg.auth_token);
    try {
      const createParams = { body, to: toNum, from: cfg.from_number };
      if (statusCallbackUrl) createParams.statusCallback = statusCallbackUrl;
      const message = await client.messages.create(createParams);
      // Twilio returns 'queued' or 'sending' immediately; real delivery status
      // arrives via statusCallback webhook. If an errorCode is present on the
      // initial response the message was already rejected.
      const initialStatus = message.errorCode ? 'failed' : (message.status || 'queued');
      const errorDetail   = message.errorCode
        ? `Twilio error ${message.errorCode}: ${message.errorMessage || ''}`
        : null;
      const id = await logSms({
        userId, fromNumber: cfg.from_number, toNumber: toNum, body,
        entityType, entityId, provider: 'twilio',
        providerMessageId: message.sid,
        segments:   message.numSegments ? Number(message.numSegments) : null,
        status:     initialStatus,
        error:      errorDetail,
        errorCode:  message.errorCode ? String(message.errorCode) : null,
      });
      return { ok: !message.errorCode, sid: message.sid, id, status: initialStatus, errorCode: message.errorCode || null };
    } catch (err) {
      const detail    = err.message || String(err);
      const errorCode = err.code    ? String(err.code) : null;
      await logSms({
        userId, fromNumber: cfg.from_number, toNumber: toNum, body,
        entityType, entityId, provider: 'twilio',
        status: 'failed', error: detail, errorCode,
      });
      throw new Error(detail);
    }
  }

  throw new Error(`SMS provider not implemented: ${cfg.provider}`);
}

async function logSms({
  userId, fromNumber, toNumber, body, entityType, entityId,
  provider, providerMessageId, segments, status, error, errorCode,
  direction = 'outbound',
}) {
  try {
    const [r] = await db.query(
      `INSERT INTO sms_logs
        (direction, from_user_id, from_number, to_number, body,
         entity_type, entity_id, provider, provider_message_id, segments,
         status, error, error_code, sent_at)
       VALUES
        (:direction, :userId, :fromNumber, :toNumber, :body,
         :entityType, :entityId, :provider, :providerMessageId, :segments,
         :status, :error, :errorCode,
         IF(:status IN ('sent','delivered','queued','sending'), NOW(), NULL))`,
      {
        direction,
        userId:            userId            || null,
        fromNumber:        fromNumber        || null,
        toNumber,
        body,
        entityType:        entityType        || null,
        entityId:          entityId          || null,
        provider:          provider          || null,
        providerMessageId: providerMessageId || null,
        segments:          segments          || null,
        status,
        error:             error             || null,
        errorCode:         errorCode         || null,
      }
    );
    return r?.insertId;
  } catch (_e) { /* swallow logging errors */ }
}

module.exports = { sendSms, getSmsConfig, normalizeNumber, logSms };
