// =============================================================================
// SMTP mailer — prefers DB smtp_settings, falls back to env
// =============================================================================
const nodemailer = require('nodemailer');
const { db } = require('../db');

// Last-resort display name when neither smtp_settings.from_name nor
// SMTP_FROM_NAME is set — the org's real name from Business Settings beats a
// generic product name in a recipient's inbox.
async function resolveFallbackFromName() {
  try {
    const [[biz]] = await db.query('SELECT business_name FROM business_settings WHERE id = 1');
    return biz?.business_name || 'Our Organization';
  } catch (_e) {
    return 'Our Organization';
  }
}

async function getSmtpConfig() {
  try {
    const [rows] = await db.query(
      'SELECT * FROM smtp_settings WHERE is_active = 1 ORDER BY id DESC LIMIT 1'
    );
    if (rows[0]) {
      if (!rows[0].from_name) rows[0].from_name = await resolveFallbackFromName();
      return rows[0];
    }
  } catch (_e) { /* fall through */ }

  return {
    host:       process.env.SMTP_HOST,
    port:       Number(process.env.SMTP_PORT) || 587,
    secure:     process.env.SMTP_SECURE === 'true',
    username:   process.env.SMTP_USER,
    password:   process.env.SMTP_PASS,
    from_email: process.env.SMTP_FROM_EMAIL || 'noreply@example.org',
    from_name:  process.env.SMTP_FROM_NAME  || await resolveFallbackFromName(),
  };
}

async function sendMail({ to, cc, bcc, subject, html, text, attachments, entityType = null, entityId = null, userId = null }) {
  const cfg = await getSmtpConfig();
  if (!cfg?.host) {
    await logEmail({ userId, to, cc, bcc, subject, html, text, entityType, entityId, status: 'failed', error: 'SMTP not configured' });
    throw new Error('SMTP not configured');
  }
  const transporter = nodemailer.createTransport({
    host: cfg.host,
    port: Number(cfg.port) || 587,
    secure: Boolean(cfg.secure),
    auth: cfg.username ? { user: cfg.username, pass: cfg.password } : undefined,
  });

  try {
    const info = await transporter.sendMail({
      from: `"${cfg.from_name || await resolveFallbackFromName()}" <${cfg.from_email}>`,
      to, cc, bcc, subject, html, text,
      attachments: attachments && attachments.length ? attachments : undefined,
    });
    await logEmail({ userId, to, cc, bcc, subject, html, text, entityType, entityId, status: 'sent' });
    return info;
  } catch (err) {
    await logEmail({ userId, to, cc, bcc, subject, html, text, entityType, entityId, status: 'failed', error: err.message });
    throw err;
  }
}

async function logEmail({ userId, to, cc, bcc, subject, html, text, entityType, entityId, status, error }) {
  try {
    await db.query(
      `INSERT INTO email_logs
        (from_user_id, to_email, cc_email, bcc_email, subject, body_html, body_text,
         entity_type, entity_id, status, error, sent_at)
       VALUES
        (:userId, :to, :cc, :bcc, :subject, :html, :text,
         :entityType, :entityId, :status, :error, IF(:status='sent', NOW(), NULL))`,
      {
        userId: userId || null,
        to,
        cc: cc || null,
        bcc: bcc || null,
        subject,
        html: html || null,
        text: text || null,
        entityType,
        entityId,
        status,
        error: error || null,
      }
    );
  } catch (_e) { /* ignore logging errors */ }
}

module.exports = { sendMail, getSmtpConfig };
