// =============================================================================
// Centralised error handler
// =============================================================================
// eslint-disable-next-line no-unused-vars
module.exports = function errorHandler(err, req, res, _next) {
  // Zod validation error
  if (err?.issues) {
    return res.status(400).json({ error: 'Validation failed', issues: err.issues });
  }

  const status = err.status || err.statusCode || 500;
  const payload = {
    error: err.message || 'Internal server error',
  };
  if (process.env.NODE_ENV !== 'production' && err.stack) {
    payload.stack = err.stack;
  }
  // eslint-disable-next-line no-console
  if (status >= 500) console.error('[ERR]', err);
  res.status(status).json(payload);
};
