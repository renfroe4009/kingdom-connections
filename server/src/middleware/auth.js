// =============================================================================
// JWT auth + RBAC middleware
// =============================================================================
const jwt = require('jsonwebtoken');
const { db } = require('../db');

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

async function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Missing token' });

    const decoded = jwt.verify(token, JWT_SECRET);

    // Determine which user ID to load: impersonated agent or actual caller
    const loadId = decoded.impersonating_as || decoded.sub;

    const [rows] = await db.query(
      `SELECT u.id, u.email, u.first_name, u.last_name, u.is_active, u.contact_id, u.default_dashboard
         FROM users u WHERE u.id = :id`,
      { id: loadId }
    );
    const user = rows[0];
    if (!user || !user.is_active) return res.status(401).json({ error: 'Invalid user' });

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

    req.user = user;
    next();
  } catch (err) {
    if (err?.name === 'JsonWebTokenError' || err?.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Invalid token' });
    }
    next(err);
  }
}

function requirePermission(...needed) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthenticated' });
    if (req.user.roles?.includes('admin')) return next();
    const have = new Set(req.user.permissions || []);
    const ok = needed.every((p) => have.has(p));
    if (!ok) return res.status(403).json({ error: 'Forbidden', required: needed });
    next();
  };
}

module.exports = { signToken, requireAuth, requirePermission };
