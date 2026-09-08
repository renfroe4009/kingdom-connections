// =============================================================================
// captcha.js — optional Cloudflare Turnstile verification for public forms.
// -----------------------------------------------------------------------------
// Security remediation M-03 — public form submission had a honeypot only
// (any targeted script bypasses `body.__hp`). Turnstile is opt-in: with no
// TURNSTILE_SECRET_KEY configured, verifyTurnstile() always passes — this
// keeps every existing form working with zero setup, matching this repo's
// existing pattern for optional third-party controls (AV scanning, HIBP).
// Set TURNSTILE_SECRET_KEY (and the matching site key in the client's
// VITE_TURNSTILE_SITE_KEY) to actually enforce it.
// =============================================================================
const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

function isConfigured() {
  return !!process.env.TURNSTILE_SECRET_KEY;
}

// Fails CLOSED once configured (a network error or malformed response means
// "not verified", not "skip the check") — the whole point of turning this on
// is to stop scripted abuse, so a transient outage should degrade to
// rejecting new submissions, not silently disabling the control.
async function verifyTurnstile(token, remoteIp) {
  if (!isConfigured()) return { ok: true, skipped: true };
  if (!token || typeof token !== 'string') return { ok: false, reason: 'missing_token' };

  try {
    const body = new URLSearchParams({ secret: process.env.TURNSTILE_SECRET_KEY, response: token });
    if (remoteIp) body.set('remoteip', remoteIp);
    const res = await fetch(VERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(5000),
    });
    const data = await res.json();
    return data.success ? { ok: true } : { ok: false, reason: 'verification_failed', errors: data['error-codes'] };
  } catch (err) {
    return { ok: false, reason: 'verification_error', message: err.message };
  }
}

module.exports = { isConfigured, verifyTurnstile };
