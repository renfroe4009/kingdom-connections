// =============================================================================
// /api/invites — create/manage user invites
// /api/invites/:token   (public) — validate invite token
// /api/invites/:token/accept (public) — accept invite + set password
// =============================================================================
const router = require('express').Router();
const crypto = require('crypto');
const { z } = require('zod');
const { db } = require('../db');
const { requireAuth, requirePermission, signToken } = require('../middleware/auth');
const { sendMail } = require('../services/mailer');
const { renderBySlug } = require('../services/templates');
const { passwordSchema, hashPassword, isPasswordBreached } = require('../services/passwordPolicy');

function sha256(s) { return crypto.createHash('sha256').update(s).digest('hex'); }
function acceptUrl(token) {
  const base = process.env.CLIENT_ORIGIN || 'http://localhost:5173';
  return `${base.replace(/\/+$/, '')}/invite/${token}`;
}

// ------------------------------------------------------------------
// PUBLIC:  GET /api/invites/:token   -> { email, first_name, ... }
// ------------------------------------------------------------------
router.get('/:token', async (req, res, next) => {
  try {
    const token = String(req.params.token || '');
    const token_hash = sha256(token);
    const [rows] = await db.query(
      `SELECT id, email, first_name, last_name, expires_at, accepted_at
         FROM user_invites
        WHERE token_hash = :token_hash
        LIMIT 1`,
      { token_hash }
    );
    const inv = rows[0];
    if (!inv) return res.status(404).json({ error: 'Invalid invite link' });
    if (inv.accepted_at) return res.status(410).json({ error: 'Invite already used' });
    if (new Date(inv.expires_at) < new Date()) return res.status(410).json({ error: 'Invite expired' });
    res.json({ email: inv.email, first_name: inv.first_name, last_name: inv.last_name });
  } catch (err) { next(err); }
});

// ------------------------------------------------------------------
// PUBLIC:  POST /api/invites/:token/accept
// Body: { password, first_name?, last_name?, phone? }
// Creates the user, consumes invite, returns JWT (auto-login).
// ------------------------------------------------------------------
const acceptSchema = z.object({
  // Security remediation M-04 — shared passwordSchema, see users.js's
  // identical change for why the composition-rule regexes were removed.
  password: passwordSchema,
  first_name: z.string().optional(),
  last_name: z.string().optional(),
  phone: z.string().optional(),
});

router.post('/:token/accept', async (req, res, next) => {
  try {
    const token = String(req.params.token || '');
    const token_hash = sha256(token);
    const data = acceptSchema.parse(req.body);

    const [rows] = await db.query(
      `SELECT * FROM user_invites WHERE token_hash = :token_hash LIMIT 1`,
      { token_hash }
    );
    const inv = rows[0];
    if (!inv) return res.status(404).json({ error: 'Invalid invite link' });
    if (inv.accepted_at) return res.status(410).json({ error: 'Invite already used' });
    if (new Date(inv.expires_at) < new Date()) return res.status(410).json({ error: 'Invite expired' });

    // Make sure email isn't already a user
    const [existing] = await db.query('SELECT id FROM users WHERE email = :email LIMIT 1', { email: inv.email });
    if (existing[0]) return res.status(409).json({ error: 'A user with this email already exists. Please sign in instead.' });

    const breach = await isPasswordBreached(data.password);
    if (breach.breached) {
      return res.status(400).json({ error: 'This password has appeared in a known data breach. Please choose a different one.' });
    }
    const password_hash = await hashPassword(data.password);
    const [ins] = await db.query(
      `INSERT INTO users (email, password_hash, first_name, last_name, phone, is_active)
       VALUES (:email, :password_hash, :first_name, :last_name, :phone, 1)`,
      {
        email: inv.email,
        password_hash,
        first_name: data.first_name || inv.first_name || null,
        last_name:  data.last_name  || inv.last_name  || null,
        phone:      data.phone      || inv.phone      || null,
      }
    );
    const userId = ins.insertId;

    // Assign roles from invite, if any
    try {
      const roleIds = inv.role_ids_json ? JSON.parse(inv.role_ids_json) : [];
      if (Array.isArray(roleIds) && roleIds.length) {
        const values = roleIds.map((rid) => [userId, Number(rid)]).filter((r) => Number.isFinite(r[1]));
        if (values.length) {
          await db.query('INSERT INTO user_roles (user_id, role_id) VALUES ?', [values]);
        }
      }
    } catch (_e) { /* ignore malformed role JSON */ }

    await db.query(
      `UPDATE user_invites SET accepted_at = NOW(), accepted_user_id = :uid WHERE id = :id`,
      { uid: userId, id: inv.id }
    );

    const [userRows] = await db.query(
      `SELECT id, email, first_name, last_name, token_epoch FROM users WHERE id = :id`, { id: userId }
    );
    const user = userRows[0];
    const jwt = signToken(user, { epoch: user.token_epoch });
    const { token_epoch, ...safeUser } = user;
    res.json({ token: jwt, user: safeUser });
  } catch (err) {
    if (err?.name === 'ZodError') return res.status(400).json({ error: err.errors?.[0]?.message || 'Invalid input' });
    next(err);
  }
});

// ------------------------------------------------------------------
// AUTHENTICATED endpoints below
// ------------------------------------------------------------------
router.use(requireAuth);

// List pending invites
router.get('/', requirePermission('users.manage'), async (_req, res, next) => {
  try {
    const [rows] = await db.query(
      `SELECT i.id, i.email, i.first_name, i.last_name, i.created_at, i.expires_at, i.accepted_at,
              iu.email AS invited_by_email
         FROM user_invites i
         LEFT JOIN users iu ON iu.id = i.invited_by
        WHERE i.accepted_at IS NULL
        ORDER BY i.created_at DESC`
    );
    res.json(rows);
  } catch (err) { next(err); }
});

// Create an invite
const createSchema = z.object({
  email: z.string().email(),
  first_name: z.string().optional(),
  last_name: z.string().optional(),
  phone: z.string().optional(),
  role_ids: z.array(z.number().int()).optional(),
  expires_in_days: z.number().int().min(1).max(90).optional(),
});

router.post('/', requirePermission('users.manage'), async (req, res, next) => {
  try {
    const data = createSchema.parse(req.body);

    // If user already exists, refuse
    const [existing] = await db.query('SELECT id FROM users WHERE email = :email LIMIT 1', { email: data.email });
    if (existing[0]) return res.status(409).json({ error: 'A user with this email already exists.' });

    // Invalidate any outstanding invites for this email (not accepted)
    await db.query('DELETE FROM user_invites WHERE email = :email AND accepted_at IS NULL', { email: data.email });

    const token = crypto.randomBytes(32).toString('hex');
    const token_hash = sha256(token);
    const days = data.expires_in_days || 14;
    const expires_at = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
    const role_ids_json = data.role_ids ? JSON.stringify(data.role_ids) : null;

    const [ins] = await db.query(
      `INSERT INTO user_invites (email, token_hash, first_name, last_name, phone, role_ids_json, invited_by, expires_at)
       VALUES (:email, :token_hash, :first_name, :last_name, :phone, :role_ids_json, :invited_by, :expires_at)`,
      {
        email: data.email,
        token_hash,
        first_name: data.first_name || null,
        last_name:  data.last_name  || null,
        phone:      data.phone      || null,
        role_ids_json,
        invited_by: req.user?.id || null,
        expires_at,
      }
    );

    const accept_url = acceptUrl(token);

    // Try to send email; surface status to caller without failing the request.
    let email_status = 'skipped';
    let email_error = null;
    try {
      let subject = "You've been invited";
      let html    = `<p>Hi${data.first_name ? ' ' + data.first_name : ''},</p>
        <p>You've been invited. <a href="${accept_url}">Accept invite</a></p>
        <p>Expires ${expires_at.toUTCString()}.</p>`;

      try {
        // Extra tokens (invite.accept_url/expires_at) must be passed into
        // renderBySlug, not patched onto its output afterward — render()
        // replaces any unresolved {{token}} with '' in a single pass, so a
        // post-render .replace() for a token missing from context is a
        // silent no-op (this previously left the accept-invite link blank).
        const rendered = await renderBySlug('user_account_created',
          { contact_id: null },
          { contact: { first_name: data.first_name || '' }, invite: { accept_url, expires_at: expires_at.toDateString() } });
        if (rendered) {
          subject = rendered.subject;
          html = rendered.html;
        }
      } catch (_e) { /* use fallback */ }

      await sendMail({
        to: data.email,
        subject,
        html,
        text: `You've been invited.\n\nAccept at: ${accept_url}\n\nThis invite expires on ${expires_at.toUTCString()}.`,
        userId: req.user?.id || null,
      });
      email_status = 'sent';
    } catch (err) {
      email_status = 'failed';
      email_error = err.message;
    }

    res.status(201).json({
      id: ins.insertId,
      email: data.email,
      accept_url,   // copyable fallback
      expires_at,
      email_status,
      email_error,
    });
  } catch (err) {
    if (err?.name === 'ZodError') return res.status(400).json({ error: err.errors?.[0]?.message || 'Invalid input' });
    next(err);
  }
});

// Resend an invite (regenerates token & emails again)
router.post('/:id/resend', requirePermission('users.manage'), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const [rows] = await db.query('SELECT * FROM user_invites WHERE id = :id LIMIT 1', { id });
    const inv = rows[0];
    if (!inv) return res.status(404).json({ error: 'Invite not found' });
    if (inv.accepted_at) return res.status(410).json({ error: 'Invite already accepted' });

    const token = crypto.randomBytes(32).toString('hex');
    const token_hash = sha256(token);
    const expires_at = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);

    await db.query(
      `UPDATE user_invites SET token_hash = :token_hash, expires_at = :expires_at WHERE id = :id`,
      { token_hash, expires_at, id }
    );
    const accept_url = acceptUrl(token);

    let email_status = 'skipped';
    let email_error = null;
    try {
      let subject = "Your invite (resent)";
      let html    = `<p>Here's a fresh invite link:</p>
        <p><a href="${accept_url}">${accept_url}</a></p>
        <p>Expires ${expires_at.toUTCString()}.</p>`;

      try {
        const rendered = await renderBySlug('user_account_created',
          { contact_id: null },
          { contact: { first_name: inv.first_name || '' }, invite: { accept_url, expires_at: expires_at.toDateString() } });
        if (rendered) {
          subject = rendered.subject;
          html = rendered.html;
        }
      } catch (_e) { /* use fallback */ }

      await sendMail({
        to: inv.email,
        subject,
        html,
        text: `Accept at: ${accept_url}\nExpires ${expires_at.toUTCString()}.`,
        userId: req.user?.id || null,
      });
      email_status = 'sent';
    } catch (err) {
      email_status = 'failed';
      email_error = err.message;
    }

    res.json({ id, accept_url, expires_at, email_status, email_error });
  } catch (err) { next(err); }
});

// Revoke an invite
router.delete('/:id', requirePermission('users.manage'), async (req, res, next) => {
  try {
    await db.query('DELETE FROM user_invites WHERE id = :id AND accepted_at IS NULL', { id: req.params.id });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;
