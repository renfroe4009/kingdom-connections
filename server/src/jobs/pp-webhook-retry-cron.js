// =============================================================================
// Praying Planet webhook retry sweep — runs every 5 minutes.
//
// automations.js's webhook action never retries (single best-effort POST);
// that's fine for internal, staff-configured automations, but a missed
// member.app_data_deleted delivery is a compliance-relevant miss for a real
// 3rd-party partner, so failed deliveries here get exponential-backoff
// retries up to MAX_ATTEMPTS (services/ppWebhooks.js), then are left failed
// for manual review.
//
// Candidates are read back out of pp_sync_log itself (no separate queue
// table) — each row's request_json carries enough to replay the delivery
// (endpointId, eventType, attempt, payload). A candidate is claimed by
// flipping its status to 'retried' before firing the retry, so the same
// failed row is never picked up twice.
// =============================================================================
const { Cron } = require('croner');
const { db } = require('../db');
const { deliverToEndpoint, MAX_ATTEMPTS, BACKOFF_MINUTES } = require('../services/ppWebhooks');

let _started = false;

async function sweepFailedDeliveries() {
  const [rows] = await db.query(
    `SELECT id, request_json, created_at FROM pp_sync_log
      WHERE direction = 'out' AND status = 'failed'
        AND created_at > NOW() - INTERVAL 1 DAY
      ORDER BY id ASC
      LIMIT 200`
  );

  for (const row of rows) {
    let meta;
    try {
      meta = typeof row.request_json === 'string' ? JSON.parse(row.request_json) : row.request_json;
    } catch { continue; }
    const { endpointId, eventType, attempt = 1, payload } = meta || {};
    if (!endpointId || !eventType) continue;
    if (attempt >= MAX_ATTEMPTS) continue;

    const backoffMs = (BACKOFF_MINUTES[attempt - 1] || BACKOFF_MINUTES.at(-1)) * 60 * 1000;
    const dueAt = new Date(row.created_at).getTime() + backoffMs;
    if (Date.now() < dueAt) continue;

    // Claim this row so a slower-than-expected concurrent tick can't retry it twice.
    const [claim] = await db.query(
      `UPDATE pp_sync_log SET status = 'retried' WHERE id = :id AND status = 'failed'`,
      { id: row.id }
    );
    if (!claim.affectedRows) continue;

    const [[endpoint]] = await db.query(
      `SELECT id, api_client_id, target_url, signing_secret FROM webhook_endpoints
        WHERE id = :id AND is_active = 1`,
      { id: endpointId }
    );
    if (!endpoint) continue; // endpoint deleted/deactivated since — nothing to retry

    await deliverToEndpoint(endpoint, eventType, payload, attempt + 1).catch((err) => {
      console.error('[pp-webhook-retry-cron] delivery error:', err.message);
    });
  }
}

function start() {
  if (_started) return;
  _started = true;

  Cron('*/5 * * * *', { name: 'pp-webhook-retry' }, async () => {
    try {
      await sweepFailedDeliveries();
      if (!global._jobStatus) global._jobStatus = {};
      global._jobStatus.ppWebhookRetry = { lastRun: new Date().toISOString() };
    } catch (err) {
      console.error('[pp-webhook-retry-cron] sweep error:', err.message);
      if (!global._jobStatus) global._jobStatus = {};
      global._jobStatus.ppWebhookRetry = { lastError: err.message };
    }
  });

  console.log('Praying Planet webhook retry cron started');
}

module.exports = start;
