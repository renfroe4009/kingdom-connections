// =============================================================================
// passwordPolicy.js — the single shared password policy for every place a
// user chooses or an admin sets a password.
// -----------------------------------------------------------------------------
// Security remediation M-04 — password rules were inconsistent across 6 call
// sites (6-8 char minimums, bcrypt cost 10-12, one path with composition
// requirements the others lacked). Per NIST SP 800-63B: a longer minimum
// length beats composition rules (they push users toward predictable
// patterns like "Password1!"), so this enforces length only.
// =============================================================================
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { z } = require('zod');

const MIN_LENGTH = 12;
const MAX_LENGTH = 128;
const BCRYPT_COST = 12;

const passwordSchema = z.string()
  .min(MIN_LENGTH, `Password must be at least ${MIN_LENGTH} characters`)
  .max(MAX_LENGTH, `Password must be at most ${MAX_LENGTH} characters`);

async function hashPassword(password) {
  return bcrypt.hash(password, BCRYPT_COST);
}

// True if a stored hash was made with a lower cost than the current
// standard — callers rehash on next successful login rather than forcing
// every existing user to reset (see auth.js's /login).
function needsRehash(hash) {
  try { return bcrypt.getRounds(hash) < BCRYPT_COST; } catch (_e) { return false; }
}

// Have I Been Pwned k-anonymity check (no API key needed) — only the SHA-1
// prefix ever leaves this server, never the password itself. Best-effort:
// fails OPEN (checked:false, breached:false) on any network/API issue, so a
// third-party outage never blocks a legitimate password change — this is
// defense in depth on top of the length requirement, not the primary
// control.
async function isPasswordBreached(password) {
  try {
    const sha1 = crypto.createHash('sha1').update(password).digest('hex').toUpperCase();
    const prefix = sha1.slice(0, 5);
    const suffix = sha1.slice(5);
    const res = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return { checked: false, breached: false };
    const text = await res.text();
    const breached = text.split('\n').some((line) => line.split(':')[0].trim() === suffix);
    return { checked: true, breached };
  } catch (_e) {
    return { checked: false, breached: false };
  }
}

module.exports = { MIN_LENGTH, MAX_LENGTH, BCRYPT_COST, passwordSchema, hashPassword, needsRehash, isPasswordBreached };
