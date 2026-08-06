// =============================================================================
// Batch reconciliation cron
// -----------------------------------------------------------------------------
// Runs once per day, shortly after 3:30 AM local time. By then both Auth.net
// and Valor have closed their previous-day merchant batches and the settled-
// transaction list is final. We poll for transactions settled in the last 48
// hours (overlapping by a day to catch late-batched txns) and reconcile.
//
// We use setTimeout/setInterval here to match the existing billing-cron style
// (no extra dependency). The 24h interval drifts a few seconds per run but
// that is fine for a daily report — payments are eventually-consistent and
// the next run picks up anything we missed.
// =============================================================================

const { reconcileAllActiveGateways } = require('../services/batchReconciliation');

function msUntilNext(hour = 3, minute = 30) {
  const now = new Date();
  const target = new Date(now);
  target.setHours(hour, minute, 0, 0);
  if (target <= now) target.setDate(target.getDate() + 1);
  return target.getTime() - now.getTime();
}

async function tick() {
  try {
    // Look back 48 hours so we catch any txn the previous run could have
    // missed (e.g. server was down at 3:30 AM yesterday).
    const window_end   = new Date();
    const window_start = new Date(window_end.getTime() - 48 * 60 * 60 * 1000);

    const results = await reconcileAllActiveGateways({
      window_start, window_end, trigger_kind: 'cron',
    });

    const totals = results.reduce((acc, r) => {
      acc.matched   += Number(r.txns_matched   || 0);
      acc.unmatched += Number(r.txns_unmatched || 0);
      acc.errors    += r.ok === false ? 1 : 0;
      return acc;
    }, { matched: 0, unmatched: 0, errors: 0 });

    // eslint-disable-next-line no-console
    console.log('[batch-reconciliation] tick', { gateways: results.length, ...totals });
    if (!global._jobStatus) global._jobStatus = {};
    global._jobStatus.batchRecon = { lastRan: new Date().toISOString(), ...totals };
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[batch-reconciliation] tick failed:', err);
    if (!global._jobStatus) global._jobStatus = {};
    global._jobStatus.batchRecon = { lastRan: new Date().toISOString(), error: err.message };
  }
}

function startBatchReconciliationCron() {
  // First run scheduled for the next 3:30 AM, then every 24 hours after.
  const wait = msUntilNext(3, 30);
  setTimeout(() => {
    tick();
    setInterval(tick, 24 * 60 * 60 * 1000);
  }, wait);
  // eslint-disable-next-line no-console
  console.log(`[batch-reconciliation] scheduled (first run in ~${Math.round(wait / 60000)} min, then every 24h)`);
}

module.exports = startBatchReconciliationCron;
module.exports.tick = tick;
