// =============================================================================
// JWT auth + RBAC middleware
// =============================================================================
const jwt = require('jsonwebtoken');
const { db } = require('../db');
const { logActivity } = require('../services/activity');

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

function signToken(user, extra = {}) {
  const { expiresIn, ...extraClaims } = extra;
  return jwt.sign(
    { sub: user.id, email: user.email, ...extraClaims },
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

  // Determine which user ID to load: impersonated agent or actual caller
  const loadId = decoded.impersonating_as || decoded.sub;

  const [rows] = await db.query(
    `SELECT u.id, u.email, u.first_name, u.last_name, u.is_active, u.contact_id, u.default_dashboard
       FROM users u WHERE u.id = :id`,
    { id: loadId }
  );
  const user = rows[0];
  if (!user || !user.is_active) return { user: null, reason: 'invalid_user' };

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

  return { user, reason: null };
}

const REASON_MESSAGES = {
  missing_token: 'Missing token',
  invalid_token: 'Invalid token',
  invalid_user:  'Invalid user',
};

async function requireAuth(req, res, next) {
  try {
    const { user, reason } = await loadUserFromRequest(req);
    if (!user) return res.status(401).json({ error: REASON_MESSAGES[reason] });
    req.user = user;
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
    const { user } = await loadUserFromRequest(req);
    if (user) req.user = user;
    next();
  } catch (err) {
    next(err);
  }
}

function requirePermission(...needed) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthenticated' });
    if (req.user.roles?.includes('admin')) return next();
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
    next();
  };
}

module.exports = { signToken, requireAuth, tryAuth, requirePermission };
