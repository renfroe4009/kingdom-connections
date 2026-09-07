// =============================================================================
// Centralised error handler
// =============================================================================
const crypto = require('crypto');

// eslint-disable-next-line no-unused-vars
module.exports = function errorHandler(err, req, res, _next) {
  // Zod validation error
  if (err?.issues) {
    return res.status(400).json({ error: 'Validation failed', issues: err.issues });
  }

  const status = err.status || err.statusCode || 500;

  // Client errors (4xx) are almost always intentionally-thrown, safe-to-show
  // messages ("Invalid storage key", "Outside your management scope", etc.)
  // — leave those untouched. Only 5xx responses (uncaught exceptions, raw
  // MySQL/driver errors) get genericised: those can carry table/column
  // names, file paths, or library internals (security remediation M-01).
  if (status < 500) {
    const payload = { error: err.message || 'Request failed' };
    if (process.env.NODE_ENV !== 'production' && err.stack) payload.stack = err.stack;
    return res.status(status).json(payload);
  }

  // 5xx: never expose err.message/stack to the client, in any environment —
  // full detail goes to the server log only, keyed by correlation_id so it
  // can still be found there (including in local dev; check the console).
  const correlationId = crypto.randomUUID();
  // eslint-disable-next-line no-console
  console.error(`[ERR ${correlationId}]`, err);
  res.status(status).json({ error: 'Internal server error', correlation_id: correlationId });
};
