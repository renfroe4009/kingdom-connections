// =============================================================================
// /api/auth
// =============================================================================
const router = require('express').Router();
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const { z } = require('zod');
const { db } = require('../db');
const { signToken, requireAuth } = require('../middleware/auth');
const { sendMail } = require('../services/mailer');
const { passwordSchema, hashPassword, needsRehash, isPasswordBreached } = require('../services/passwordPolicy');

// Security remediation M-05 — a non-existent email returned in a few ms
// (no bcrypt.compare call at all), while an existing one cost ~100ms for the
// real comparison. That gap is stable and large enough to enumerate valid
// accounts remotely. Comparing against a fixed dummy hash on the "no such
// user" path costs the same ~100ms regardless, closing the timing gap. The
// hash itself is never checked against anything real — any fixed bcrypt
// hash works, since bcrypt.compare('x', DUMMY_HASH) always returns false.
const DUMMY_HASH = bcrypt.hashSync('sectest-dummy-password-for-timing-parity', 12);

const loginSchema = z.object({
  email:    z.string().email(),
  password: z.string().min(1),
});

// Rate limit login attempts to slow down credential-stuffing / brute-force.
// Keyed on email + IP so a single attacker can't lock a victim out (when their
// IP rotates) and a single user behind NAT isn't penalized for someone else's
// failed attempts on the same IP. Successful logins don't count against the
// quota — we only consume a slot when the request *failed* (skipSuccessfulRequests).
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,                  // 10 failed attempts per window per (email + IP)
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: { error: 'Too many login attempts. Please wait 15 minutes and try again.' },
  keyGenerator: (req, res) => {
    // Use the library's ipKeyGenerator so IPv6 clients are normalized to
    // their /64 prefix — otherwise an attacker on IPv6 can rotate the
    // host suffix and bypass the limit. We append the email so failed
    // attempts on different accounts don't share a single bucket.
    const email = (req.body && typeof req.body.email === 'string')
      ? req.body.email.toLowerCase().trim()
      : '';
    return `${ipKeyGenerator(req, res)}|${email}`;
  },
});

router.post('/login', loginLimiter, async (req, res, next) => {
  try {
    const { email, password } = loginSchema.parse(req.body);
    const [rows] = await db.query(
      `SELECT id, email, password_hash, first_name, last_name, is_active, contact_id, default_dashboard, token_epoch
         FROM users WHERE email = :email LIMIT 1`,
      { email }
    );
    const user = rows[0];
    // Security remediation M-05 — always run a bcrypt comparison, even when
    // no user matched, so both paths cost the same regardless of whether
    // the email exists. See DUMMY_HASH above.
    const ok = await bcrypt.compare(password, user?.password_hash || DUMMY_HASH);
    if (!user || !user.is_active || !ok) return res.status(401).json({ error: 'Invalid credentials' });

    // Security remediation M-04 — rehash on successful login if the stored
    // hash predates the current bcrypt cost (12), rather than forcing every
    // existing user to reset. Best-effort: never blocks the login itself.
    if (needsRehash(user.password_hash)) {
      hashPassword(password)
        .then((hash) => db.query('UPDATE users SET password_hash = :hash WHERE id = :id', { hash, id: user.id }))
        .catch((e) => console.warn('[auth] rehash-on-login failed:', e.message));
    }

    await db.query('UPDATE users SET last_login_at = NOW() WHERE id = :id', { id: user.id });
    // Security remediation M-07 — login is a security-relevant event; a
    // silently-failed audit write means a login (including an attacker's)
    // leaves no trace. Not wrapped in its own try/catch — a failure here
    // propagates to the route's own catch → next(err), failing the request
    // rather than silently vanishing.
    await db.query(
      `INSERT INTO activities (user_id, entity_type, entity_id, action, description)
         VALUES (:uid, 'user', :uid, 'login', 'User signed in')`,
      { uid: user.id }
    );

    const token = signToken(user, { epoch: user.token_epoch });
    const { password_hash, token_epoch, ...safe } = user;

    // Hydrate roles + permissions so the client's `can()` works immediately after login.
    const [roleRows] = await db.query(
      `SELECT r.name FROM roles r
         JOIN user_roles ur ON ur.role_id = r.id
        WHERE ur.user_id = :id`,
      { id: user.id }
    );
    safe.roles = roleRows.map((r) => r.name);

    const [permRows] = await db.query(
      `SELECT DISTINCT p.\`key\`
         FROM permissions p
         JOIN role_permissions rp ON rp.permission_id = p.id
         JOIN user_roles ur       ON ur.role_id = rp.role_id
        WHERE ur.user_id = :id`,
      { id: user.id }
    );
    safe.permissions = permRows.map((r) => r.key);

    res.json({ token, user: safe });
  } catch (err) { next(err); }
});

router.get('/me', requireAuth, async (req, res) => {
  res.json({ user: req.user });
});

// Self-service preference — any authenticated user may set which admin
// dashboard shows on login. No special permission required, since a user
// changing their own preference isn't a privileged action.
router.put('/me/dashboard', requireAuth, async (req, res, next) => {
  try {
    const value = z.enum(['nonprofit', 'sales']).parse(req.body?.default_dashboard);
    await db.query('UPDATE users SET default_dashboard = :value WHERE id = :id', { value, id: req.user.id });
    res.json({ ok: true, default_dashboard: value });
  } catch (err) { next(err); }
});

router.post('/logout', requireAuth, async (req, res, next) => {
  // Security remediation H-05 — logout previously did nothing but log the
  // event; the JWT itself stayed valid until its 8h expiry regardless
  // (fully stateless). Now records the token's jti as revoked so it's
  // rejected on its very next use, even though it hasn't expired.
  // Security remediation M-07 — logout is security-relevant; let a
  // failed audit write fail the request via next(err) rather than
  // silently vanishing (this handler previously had no next() at all, so
  // a thrown error here would have gone unhandled instead of erroring
  // cleanly — fixed as part of removing the swallow, not just the swallow
  // itself).
  try {
    if (req.jti && req.tokenExp) {
      await db.query(
        `INSERT INTO revoked_tokens (jti, expires_at) VALUES (:jti, :exp)
           ON DUPLICATE KEY UPDATE expires_at = :exp`,
        { jti: req.jti, exp: new Date(req.tokenExp * 1000).toISOString().slice(0, 19).replace('T', ' ') }
      );
    }
    await db.query(
      `INSERT INTO activities (user_id, entity_type, entity_id, action, description)
         VALUES (:uid, 'user', :uid, 'logout', 'User signed out')`,
      { uid: req.user.id }
    );
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// POST /forgot-password
// Generates a 1-hour reset token and emails a link. Always returns 200 so
// callers cannot enumerate registered emails.
// ---------------------------------------------------------------------------
const forgotLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please wait 15 minutes and try again.' },
});

router.post('/forgot-password', forgotLimiter, async (req, res, next) => {
  try {
    const { email } = z.object({ email: z.string().email() }).parse(req.body);

    const [[user]] = await db.query(
      `SELECT u.id, u.first_name, u.email,
              (SELECT COUNT(*) FROM user_roles ur JOIN roles r ON ur.role_id = r.id
               WHERE ur.user_id = u.id AND r.name = 'portal') > 0 AS is_portal_only,
              (SELECT COUNT(*) FROM user_roles ur JOIN roles r ON ur.role_id = r.id
               WHERE ur.user_id = u.id AND r.name != 'portal') > 0 AS has_non_portal_role
       FROM users u WHERE u.email = :email AND u.is_active = 1 LIMIT 1`,
      { email }
    );

    if (user) {
      // Generate a cryptographically random token, store a SHA-256 hash of it.
      const rawToken  = crypto.randomBytes(32).toString('hex');
      const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
      const expires   = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

      await db.query(
        `UPDATE users SET password_reset_token = :hash, password_reset_expires_at = :exp WHERE id = :id`,
        { hash: tokenHash, exp: expires.toISOString().slice(0, 19).replace('T', ' '), id: user.id }
      );

      // Portal-only users get a portal-branded reset page; others use the main app page.
      const origin = (process.env.CLIENT_ORIGIN || 'http://localhost:5173').split(',')[0].trim();
      const resetPath = (user.is_portal_only && !user.has_non_portal_role) ? '/portal/reset-password' : '/reset-password';
      const resetUrl = `${origin}${resetPath}?token=${rawToken}`;

      try {
        await sendMail({
          to:      user.email,
          subject: 'Reset your localCRM password',
          html: `
            <p>Hi ${user.first_name || 'there'},</p>
            <p>We received a request to reset the password for your localCRM account.</p>
            <p style="margin:24px 0">
              <a href="${resetUrl}"
                 style="background:#F05523;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600">
                Reset password
              </a>
            </p>
            <p>This link expires in <strong>1 hour</strong>. If you didn't request a reset, you can safely ignore this email.</p>
            <p style="color:#999;font-size:12px">${resetUrl}</p>
          `,
          text: `Reset your localCRM password: ${resetUrl}\n\nThis link expires in 1 hour.`,
        });
      } catch (_e) { /* SMTP failure — token is still stored, admin can find it */ }
    }

    // Always return 200 regardless of whether the email was found.
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// POST /reset-password
// Validates the raw token against the stored hash, updates the password.
// ---------------------------------------------------------------------------
// Security remediation H-07 — the token itself is the only secret here
// (256-bit random per the token-generation code above), but with no limit
// at all an attacker could brute-force guess it directly against this
// endpoint. Matches forgotLimiter's shape.
const resetLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please wait 15 minutes and try again.' },
});

router.post('/reset-password', resetLimiter, async (req, res, next) => {
  try {
    const { token, password } = z.object({
      token:    z.string().min(1),
      password: passwordSchema,
    }).parse(req.body);

    // Security remediation M-04 — best-effort breach check; never blocks on
    // a network/API failure (see isPasswordBreached's own doc comment).
    const breach = await isPasswordBreached(password);
    if (breach.breached) {
      return res.status(400).json({ error: 'This password has appeared in a known data breach. Please choose a different one.' });
    }

    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    const [[user]] = await db.query(
      `SELECT id FROM users
        WHERE password_reset_token = :hash
          AND password_reset_expires_at > NOW()
          AND is_active = 1
        LIMIT 1`,
      { hash: tokenHash }
    );

    if (!user) {
      return res.status(400).json({ error: 'Reset link is invalid or has expired.' });
    }

    const newHash = await hashPassword(password);
    // Security remediation H-05 — bumping token_epoch invalidates every
    // session issued before this reset (a stolen/still-live token can no
    // longer authenticate), the actual mitigation a "reset your password"
    // flow implies but previously didn't deliver — the old password_hash
    // simply stopped matching new logins while every existing token kept
    // working until it expired on its own.
    await db.query(
      `UPDATE users
          SET password_hash = :hash,
              password_reset_token = NULL,
              password_reset_expires_at = NULL,
              token_epoch = token_epoch + 1
        WHERE id = :id`,
      { hash: newHash, id: user.id }
    );

    // Security remediation M-07 — password reset is security-relevant;
    // propagates to the outer catch → next(err) on failure, same reasoning
    // as the login/logout sites above.
    await db.query(
      `INSERT INTO activities (user_id, entity_type, entity_id, action, description)
         VALUES (:id, 'user', :id, 'password_reset', 'Password reset via email link')`,
      { id: user.id }
    );

    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;
