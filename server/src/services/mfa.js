'use strict';
// =============================================================================
// mfa.js — TOTP-based multi-factor authentication (security remediation H-01)
// -----------------------------------------------------------------------------
// Scope decision (confirmed with the org): TOTP (authenticator apps) only,
// not WebAuthn/passkeys — the audit's full design includes both, but
// passkeys need a real production RP-ID and a client library this session
// can't fully exercise outside a real deployed domain. TOTP is a complete,
// industry-standard second factor on its own; WebAuthn support is a
// documented future addition (see HUMAN-ACTION-REQUIRED.md), not built here.
//
// Enforcement model: the org-wide moduleSettings 'security'.mfa_enabled
// toggle (default OFF — some nonprofits running this app won't want MFA at
// all) does NOT block login for anyone. Instead, once it's on,
// requirePermission() (middleware/auth.js) refuses any of
// MFA_MANDATORY_PERMISSIONS for a user who hasn't confirmed TOTP enrollment
// — a 403 with mfa_setup_required:true, not a login lockout. This avoids
// the chicken-and-egg problem of "how do you log in to set up MFA if MFA
// blocks login" and matches the audit's actual intent (protect privileged
// ACTIONS), without needing a separate pre-auth enrollment flow.
//
// Once a user HAS confirmed TOTP (independent of the org toggle — if you
// turned it on for your own account, you must use it), login changes
// shape: POST /auth/login stops returning a full session token and instead
// returns a short-lived, minimal-claim mfa_pending token that must be
// exchanged via POST /auth/mfa/verify (TOTP code or a recovery code)
// before a real session token is issued. loadUserFromRequest() (auth.js)
// explicitly rejects any token carrying the mfa_pending claim, so a
// pending token can never be used as a substitute session token.
// =============================================================================
const crypto = require('crypto');
const { authenticator } = require('otplib');
const QRCode = require('qrcode');
const { db } = require('../db');
const { encrypt, decrypt } = require('./secretsCrypto');

// Mirrors the audit's §7 policy list exactly.
const MFA_MANDATORY_PERMISSIONS = new Set([
  'users.manage', 'roles.manage', 'payments.write', 'donations.write', 'settings.manage',
]);

async function isMfaEnabledOrgWide() {
  const moduleSettings = require('./moduleSettings'); // lazy — avoids a require cycle risk
  const cfg = await moduleSettings.get('security');
  return !!cfg.mfa_enabled;
}

// True if this permission set requires the caller to have TOTP confirmed,
// given the org-wide toggle. 'admin' role holders are covered separately
// (requirePermission()'s own bypass runs before any permission-specific
// check — MFA enforcement for admin is checked directly against the role).
function permissionsRequireMfa(needed) {
  return (needed || []).some((p) => MFA_MANDATORY_PERMISSIONS.has(p));
}

async function getMfaStatus(userId) {
  const [[row]] = await db.query(
    'SELECT confirmed_at FROM user_mfa_totp WHERE user_id = :userId', { userId }
  );
  return { enrolled: !!row?.confirmed_at, pendingSetup: !!row && !row.confirmed_at };
}

// Starts (or restarts) enrollment — generates a fresh secret, stores it
// encrypted but NOT yet confirmed. Calling this again before confirming
// just replaces the pending secret (e.g. the user re-scans a fresh QR).
async function beginEnrollment(user) {
  const secret = authenticator.generateSecret();
  await db.query(
    `INSERT INTO user_mfa_totp (user_id, secret_enc, confirmed_at)
     VALUES (:userId, :secretEnc, NULL)
     ON DUPLICATE KEY UPDATE secret_enc = VALUES(secret_enc), confirmed_at = NULL`,
    { userId: user.id, secretEnc: encrypt(secret) }
  );
  const issuer = 'Kingdom Connections';
  const otpauthUrl = authenticator.keyuri(user.email, issuer, secret);
  const qrDataUrl = await QRCode.toDataURL(otpauthUrl);
  return { secret, otpauthUrl, qrDataUrl };
}

function generateRecoveryCodes(count = 10) {
  const raw = Array.from({ length: count }, () =>
    crypto.randomBytes(5).toString('hex').toUpperCase().match(/.{1,4}/g).join('-')
  );
  const hashed = raw.map((code) => crypto.createHash('sha256').update(code).digest('hex'));
  return { raw, hashed };
}

// Verifies the first real code and flips the pending enrollment to
// confirmed. Issues recovery codes at this point (not at beginEnrollment)
// so a secret that's generated but never actually confirmed never gets
// live recovery codes sitting unused in the table.
async function confirmEnrollment(userId, code) {
  const [[row]] = await db.query(
    'SELECT secret_enc, confirmed_at FROM user_mfa_totp WHERE user_id = :userId', { userId }
  );
  if (!row) return { ok: false, error: 'No pending MFA enrollment found. Start setup again.' };
  if (row.confirmed_at) return { ok: false, error: 'MFA is already enrolled for this account.' };

  const secret = decrypt(row.secret_enc);
  if (!authenticator.verify({ token: String(code || ''), secret })) {
    return { ok: false, error: 'Invalid code. Check your authenticator app and try again.' };
  }

  await db.query('UPDATE user_mfa_totp SET confirmed_at = NOW() WHERE user_id = :userId', { userId });
  await db.query('DELETE FROM user_mfa_recovery_codes WHERE user_id = :userId', { userId }); // clear any stale set
  const { raw, hashed } = generateRecoveryCodes();
  for (const hash of hashed) {
    await db.query(
      'INSERT INTO user_mfa_recovery_codes (user_id, code_hash) VALUES (:userId, :hash)',
      { userId, hash }
    );
  }
  return { ok: true, recoveryCodes: raw };
}

async function disableMfa(userId) {
  await db.query('DELETE FROM user_mfa_totp WHERE user_id = :userId', { userId });
  await db.query('DELETE FROM user_mfa_recovery_codes WHERE user_id = :userId', { userId });
}

// Used by POST /auth/mfa/verify (login step-up) and available for future
// step-up-on-sensitive-action use. Recovery codes are single-use — checked
// and marked used in the same call, not just checked.
async function verifyLoginFactor(userId, { code, recoveryCode }) {
  if (code) {
    const [[row]] = await db.query(
      'SELECT secret_enc FROM user_mfa_totp WHERE user_id = :userId AND confirmed_at IS NOT NULL', { userId }
    );
    if (!row) return false;
    return authenticator.verify({ token: String(code), secret: decrypt(row.secret_enc) });
  }
  if (recoveryCode) {
    const hash = crypto.createHash('sha256').update(String(recoveryCode).trim().toUpperCase()).digest('hex');
    const [[row]] = await db.query(
      'SELECT id FROM user_mfa_recovery_codes WHERE user_id = :userId AND code_hash = :hash AND used_at IS NULL',
      { userId, hash }
    );
    if (!row) return false;
    await db.query('UPDATE user_mfa_recovery_codes SET used_at = NOW() WHERE id = :id', { id: row.id });
    return true;
  }
  return false;
}

module.exports = {
  MFA_MANDATORY_PERMISSIONS,
  isMfaEnabledOrgWide,
  permissionsRequireMfa,
  getMfaStatus,
  beginEnrollment,
  confirmEnrollment,
  disableMfa,
  generateRecoveryCodes,
  verifyLoginFactor,
};
