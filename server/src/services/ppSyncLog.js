// =============================================================================
// Audit trail for the Praying Planet mobile-API integration — every inbound
// call and every outbound webhook delivery gets a row here. Mirrors
// connectwise.js's logSync() shape/behavior: best-effort (a logging failure
// must never break the real request), swallowed with a console.warn.
// =============================================================================
const { db } = require('../db');

async function logPpSync({ apiClientId = null, direction, eventType, entityType = null, entityId = null, request, response, status, error }) {
  try {
    await db.query(
      `INSERT INTO pp_sync_log (api_client_id, direction, event_type, entity_type, entity_id, request_json, response_json, status, error)
       VALUES (:apiClientId, :direction, :eventType, :entityType, :entityId, CAST(:req AS JSON), CAST(:res AS JSON), :status, :error)`,
      {
        apiClientId, direction, eventType, entityType, entityId,
        req: request  ? JSON.stringify(request)  : null,
        res: response ? JSON.stringify(response) : null,
        status,
        error: error || null,
      }
    );
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[pp_sync_log]', e.message);
  }
}

module.exports = { logPpSync };
