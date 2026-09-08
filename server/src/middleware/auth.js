// =============================================================================
// JWT auth + RBAC middleware
// =============================================================================
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { db } = require('../db');
const { logActivity } = require('../services/activity');
const { isMfaEnabledOrgWide, permissionsRequireMfa, getMfaStatus } = require('../services/mfa');

// JWT_SECRET is required — no fallback. We previously fell back to 'dev-secret'
// which meant any reader of this file could forge tokens for any user. Refuse
// to start without one. Keep at least 32 random characters in server/.env
// (e.g. `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`).
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET || JWT_SECRET.length < 16) {
  throw new Error(
    'JWT_SECRET is missing or too short. Set a strong random JWT_SECRET (>=16 chars) in server/.env before starting the server.'
  );
}

// Security remediation H-05 — every token gets a unique `jti` so a single
// session can be revoked (see revoked_tokens, checked in
// loadUserFromRequest) without invalidating every other token issued to
// the same user. Callers should pass `epoch: <the target user's current
// token_epoch>` in `extra` so a stale token (issued before a password
// reset bumped the epoch) is rejected even if it hasn't been individually
// revoked and hasn't expired yet.
function signToken(user, extra = {}) {
  const { expiresIn, ...extraClaims } = extra;
  return jwt.sign(
    { sub: user.id, email: user.email, jti: crypto.randomUUID(), ...extraClaims },
    JWT_SECRET,
    { expiresIn: expiresIn || process.env.JWT_EXPIRES_IN || '8h' }
  );
}

// Verifies a bearer token and loads the full user (roles + permissions).
// Returns { user: null, reason } for any missing/invalid/expired token or
// inactive user — throws only on a genuine unexpected error (e.g. DB
// failure). Shared by requireAuth (which turns a null user into the exact
// same 401 messages as before this refactor) and tryAuth (which lets the
// caller decide what an absent session means, for routes with more than
// one valid way to prove you're allowed to act — see donations.js's
// public finalize route for why that's needed).
async function loadUserFromRequest(req) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return { user: null, reason: 'missing_token' };

  let decoded;
  try {
    decoded = jwt.verify(token, JWT_SECRET);
  } catch (err) {
    if (err?.name === 'JsonWebTokenError' || err?.name === 'TokenExpiredError') {
      return { user: null, reason: 'invalid_token' };
    }
    throw err;
  }

  // Security remediation H-01 — an mfa_pending token (issued mid-login,
  // before the second factor is verified) must never work as a real
  // session token. Without this check it would: it has a valid `sub` and
  // signature, and nothing else here inspects the claim.
  if (decoded.mfa_pending) return { user: null, reason: 'invalid_token' };

  // Security remediation H-05 — explicit per-token revocation (logout).
  // Tokens signed before this fix shipped have no `jti` and can't match a
  // revoked_tokens row, so they're unaffected until they naturally expire.
  if (decoded.jti) {
    const [[revoked]] = await db.query(
      'SELECT 1 FROM revoked_tokens WHERE jti = :jti', { jti: decoded.jti }
    );
    if (revoked) return { user: null, reason: 'invalid_token' };
  }

  // Determine which user ID to load: impersonated agent or actual caller
  const loadId = decoded.impersonating_as || decoded.sub;

  const [rows] = await db.query(
    `SELECT u.id, u.email, u.first_name, u.last_name, u.is_active, u.contact_id, u.default_dashboard, u.token_epoch
       FROM users u WHERE u.id = :id`,
    { id: loadId }
  );
  const user = rows[0];
  if (!user || !user.is_active) return { user: null, reason: 'invalid_user' };

  // Security remediation H-05 — a token issued before a password reset
  // bumped this user's token_epoch is stale even though it's neither
  // expired nor individually revoked. Tokens signed before this fix
  // shipped carry no `epoch` claim at all; treat that as epoch 0 (the
  // column's default for every existing user) rather than rejecting every
  // live session the moment this deploys.
  const tokenEpoch = decoded.epoch ?? 0;
  if (tokenEpoch !== user.token_epoch) return { user: null, reason: 'invalid_token' };
  delete user.token_epoch;

  // When impersonating, expose the real caller's ID for audit trails
  if (decoded.impersonating_as) {
    user.impersonated_by = decoded.sub;
  }

  // Load permissions
  const [permRows] = await db.query(
    `SELECT DISTINCT p.\`key\`
       FROM permissions p
       JOIN role_permissions rp ON rp.permission_id = p.id
       JOIN user_roles ur       ON ur.role_id = rp.role_id
      WHERE ur.user_id = :id`,
    { id: user.id }
  );
  user.permissions = permRows.map((r) => r.key);

  const [roleRows] = await db.query(
    `SELECT r.name FROM roles r
       JOIN user_roles ur ON ur.role_id = r.id
      WHERE ur.user_id = :id`,
    { id: user.id }
  );
  user.roles = roleRows.map((r) => r.name);

  return { user, reason: null, jti: decoded.jti || null, exp: decoded.exp || null };
}

const REASON_MESSAGES = {
  missing_token: 'Missing token',
  invalid_token: 'Invalid token',
  invalid_user:  'Invalid user',
};

async function requireAuth(req, res, next) {
  try {
    const { user, reason, jti, exp } = await loadUserFromRequest(req);
    if (!user) return res.status(401).json({ error: REASON_MESSAGES[reason] });
    req.user = user;
    req.jti = jti;
    req.tokenExp = exp;
    next();
  } catch (err) {
    next(err);
  }
}

// Optional-auth variant for routes that accept more than one form of proof
// (e.g. a public endpoint that's fine either with a staff session that
// holds a specific permission, or with a possession-proving token in the
// body). Sets req.user when a valid session is present; otherwise leaves
// it undefined and calls next() regardless — never rejects the request
// itself. The route is responsible for deciding what "no session" means.
async function tryAuth(req, _res, next) {
  try {
    const { user, jti, exp } = await loadUserFromRequest(req);
    if (user) {
      req.user = user;
      req.jti = jti;
      req.tokenExp = exp;
    }
    next();
  } catch (err) {
    next(err);
  }
}

function requirePermission(...needed) {
  return async (req, res, next) => {
    try {
      if (!req.user) return res.status(401).json({ error: 'Unauthenticated' });
      const isAdmin = req.user.roles?.includes('admin');
      if (!isAdmin) {
        const have = new Set(req.user.permissions || []);
        const ok = needed.every((p) => have.has(p));
        if (!ok) {
          // Security remediation M-07 — this is the single choke point for
          // every requirePermission() check in the app, so logging here gives
          // near-total coverage of permission denials with one change instead
          // of touching ~500 routes individually. Fire-and-forget, best-effort
          // (not required:true) — a 403 response must stay fast and must
          // never itself fail because logging it failed; unlike the other
          // M-07 events this one is high-volume and largely informational (a
          // user clicking a button their role can't use is routine, not
          // necessarily an attack).
          logActivity({
            userId: req.user.id, entityType: 'user', entityId: req.user.id, action: 'permission_denied',
            description: `${req.user.email} denied ${req.method} ${req.originalUrl} (missing: ${needed.join(', ')})`,
          }).catch(() => {});
          return res.status(403).json({ error: 'Forbidden', required: needed });
        }
      }

      // Security remediation H-01 — MFA step-up gate. Runs only after
      // permission is otherwise granted (admin bypass or an explicit
      // match), so a caller who wouldn't be allowed anyway gets a plain
      // 403 rather than one that leaks "you'd be allowed if only you had
      // MFA enrolled." Gated on the SPECIFIC permission(s) this route
      // needs, not on "is this caller an admin" — admin naturally trips
      // this for every one of the 5 mandatory permissions anyway (it holds
      // all of them), which is what actually matters; gating literally
      // every admin action regardless of sensitivity turned an unenrolled
      // admin's very first click after enabling org MFA into a total
      // lockout, including from the settings.manage route needed to turn
      // it back off. Deliberately not using isAdmin here.
      if (permissionsRequireMfa(needed)) {
        if (await isMfaEnabledOrgWide()) {
          const status = await getMfaStatus(req.user.id);
          if (!status.enrolled) {
            return res.status(403).json({
              error: 'Two-factor authentication is required for this action. Set it up under Settings → Security.',
              mfa_setup_required: true,
            });
          }
        }
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}

// Security remediation H-01 — a short-lived (5 min), minimal-claim token
// issued after a correct password when the user has TOTP confirmed. Carries
// NO permissions/roles and is accepted only by POST /auth/mfa/verify —
// loadUserFromRequest() explicitly refuses to treat it as a real session
// (see the `decoded.mfa_pending` check below), so a password alone can
// never substitute for the second factor even if this token leaks.
function signMfaPendingToken(userId) {
  return jwt.sign({ sub: userId, mfa_pending: true }, JWT_SECRET, { expiresIn: '5m' });
}

// Verifies an mfa_pending token specifically (POST /auth/mfa/verify's own
// auth mechanism, distinct from requireAuth's bearer-token flow) — returns
// the decoded payload, or null for anything invalid/expired/not actually a
// pending token. Keeps JWT_SECRET encapsulated in this module rather than
// exporting it.
function verifyMfaPendingToken(token) {
  let decoded;
  try {
    decoded = jwt.verify(token, JWT_SECRET);
  } catch (_e) {
    return null;
  }
  return decoded.mfa_pending ? decoded : null;
}

// Security remediation H-01 — escape hatch for the org-wide MFA toggle
// itself (PUT/GET /api/settings/module/security). Every other
// settings.manage-gated route stays behind the MFA gate above, but
// settings.manage is itself in MFA_MANDATORY_PERMISSIONS — without this,
// an admin who turns org MFA on without having enrolled first would have
// no way to ever turn it back off again (the only route that could undo
// it would itself demand the MFA enrollment it's trying to disable). Same
// permission check as requirePermission, deliberately without the MFA
// block.
function requirePermissionNoMfaGate(...needed) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthenticated' });
    if (req.user.roles?.includes('admin')) return next();
    const have = new Set(req.user.permissions || []);
    if (!needed.every((p) => have.has(p))) {
      return res.status(403).json({ error: 'Forbidden', required: needed });
    }
    next();
  };
}

module.exports = {
  signToken, signMfaPendingToken, verifyMfaPendingToken,
  requireAuth, tryAuth, requirePermission, requirePermissionNoMfaGate,
};
