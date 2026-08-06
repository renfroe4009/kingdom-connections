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
      `SELECT id, email, password_hash, first_name, last_name, is_active, contact_id
         FROM users WHERE email = :email LIMIT 1`,
      { email }
    );
    const user = rows[0];
    if (!user || !user.is_active) return res.status(401).json({ error: 'Invalid credentials' });

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: 'Invalid credentials' });

    await db.query('UPDATE users SET last_login_at = NOW() WHERE id = :id', { id: user.id });
    try {
      await db.query(
        `INSERT INTO activities (user_id, entity_type, entity_id, action, description)
           VALUES (:uid, 'user', :uid, 'login', 'User signed in')`,
        { uid: user.id }
      );
    } catch (_e) { /* non-fatal */ }

    const token = signToken(user);
    const { password_hash, ...safe } = user;

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

router.post('/logout', requireAuth, async (req, res) => {
  // Stateless JWT — client drops the token. Server-side we just log the event.
  try {
    await db.query(
      `INSERT INTO activities (user_id, entity_type, entity_id, action, description)
         VALUES (:uid, 'user', :uid, 'logout', 'User signed out')`,
      { uid: req.user.id }
    );
  } catch (_e) { /* non-fatal */ }
  res.json({ ok: true });
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
router.post('/reset-password', async (req, res, next) => {
  try {
    const { token, password } = z.object({
      token:    z.string().min(1),
      password: z.string().min(8),
    }).parse(req.body);

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

    const newHash = await bcrypt.hash(password, 12);
    await db.query(
      `UPDATE users
          SET password_hash = :hash,
              password_reset_token = NULL,
              password_reset_expires_at = NULL
        WHERE id = :id`,
      { hash: newHash, id: user.id }
    );

    try {
      await db.query(
        `INSERT INTO activities (user_id, entity_type, entity_id, action, description)
           VALUES (:id, 'user', :id, 'password_reset', 'Password reset via email link')`,
        { id: user.id }
      );
    } catch (_e) { /* non-fatal */ }

    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;
