// =============================================================================
// Auth for the Praying Planet mobile API (/api/mobile/v1/*) — server-to-
// server client-credentials, deliberately separate from middleware/auth.js's
// staff JWT_SECRET-based session auth. A leaked mobile API credential must
// never be usable to forge an admin/staff session, so this signs with its
// own MOBILE_API_JWT_SECRET (same isolation principle as
// SECRETS_ENCRYPTION_KEY vs GOOGLE_TOKEN_SECRET in services/secretsCrypto.js
// and services/google.js).
// =============================================================================
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const { db } = require('../db');

const MOBILE_API_JWT_SECRET = process.env.MOBILE_API_JWT_SECRET;
if (!MOBILE_API_JWT_SECRET || MOBILE_API_JWT_SECRET.length < 16) {
  throw new Error(
    'MOBILE_API_JWT_SECRET is missing or too short. Set a strong random value (>=16 chars) in server/.env — ' +
    'e.g. `node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'base64url\'))"`. ' +
    'Must be different from JWT_SECRET.'
  );
}

const TOKEN_TTL = '1h';

function hashSecret(secret) {
  return crypto.createHash('sha256').update(secret).digest('hex');
}

function constantTimeEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

// Rate-limits the token endpoint keyed per client_id (falling back to IP if
// none supplied) — same reasoning as services/checkinPin.js's limiter: the
// threat is brute-forcing one client's secret, potentially from many IPs.
const tokenLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  // ipKeyGenerator normalizes IPv6 clients to their /64 prefix — required
  // whenever a custom keyGenerator can fall back to req.ip (same reasoning
  // as routes/forms.js's formSubmitLimiter).
  keyGenerator: (req, res) => `mobile-token:${req.body?.client_id || ipKeyGenerator(req, res)}`,
  message: { error: 'Too many token requests. Please wait and try again.' },
});

// POST /api/mobile/oauth/token — { client_id, client_secret } -> { access_token, expires_in, scopes }
async function issueToken(req, res, next) {
  try {
    const { client_id, client_secret } = req.body || {};
    if (!client_id || !client_secret) {
      return res.status(400).json({ error: 'client_id and client_secret are required' });
    }

    const [[client]] = await db.query(
      'SELECT id, client_id, client_secret_hash, scopes, is_active FROM api_clients WHERE client_id = :client_id',
      { client_id }
    );

    // Always hash+compare even on a miss so a nonexistent client_id doesn't
    // respond measurably faster than a wrong secret (basic timing hygiene).
    const suppliedHash = hashSecret(client_secret);
    const storedHash = client?.client_secret_hash || hashSecret('placeholder-does-not-match');
    const secretOk = constantTimeEqual(suppliedHash, storedHash);

    if (!client || !client.is_active || !secretOk) {
      return res.status(401).json({ error: 'Invalid client credentials' });
    }

    const scopes = Array.isArray(client.scopes) ? client.scopes : JSON.parse(client.scopes || '[]');
    const token = jwt.sign(
      { client_id: client.client_id, scopes },
      MOBILE_API_JWT_SECRET,
      { expiresIn: TOKEN_TTL }
    );

    db.query('UPDATE api_clients SET last_used_at = NOW() WHERE id = :id', { id: client.id }).catch(() => {});

    res.json({ access_token: token, token_type: 'Bearer', expires_in: 3600, scopes });
  } catch (err) { next(err); }
}

// requireApiClient('members:read', ...) — verifies the bearer JWT and that
// every listed scope is present. Attaches req.apiClient = { id, clientId, scopes }.
function requireApiClient(...neededScopes) {
  return async (req, res, next) => {
    try {
      const header = req.headers.authorization || '';
      const token = header.startsWith('Bearer ') ? header.slice(7) : null;
      if (!token) return res.status(401).json({ error: 'Missing token' });

      let decoded;
      try {
        decoded = jwt.verify(token, MOBILE_API_JWT_SECRET);
      } catch (_err) {
        return res.status(401).json({ error: 'Invalid or expired token' });
      }

      const [[client]] = await db.query(
        'SELECT id, client_id, is_active FROM api_clients WHERE client_id = :client_id',
        { client_id: decoded.client_id }
      );
      if (!client || !client.is_active) {
        return res.status(401).json({ error: 'Invalid or expired token' });
      }

      const have = new Set(decoded.scopes || []);
      if (!neededScopes.every((s) => have.has(s))) {
        return res.status(403).json({ error: 'Forbidden', required: neededScopes });
      }

      req.apiClient = { id: client.id, clientId: client.client_id, scopes: decoded.scopes || [] };
      next();
    } catch (err) { next(err); }
  };
}

module.exports = { issueToken, requireApiClient, tokenLimiter, hashSecret };
