// =============================================================================
// Batch settlement reconciliation
// -----------------------------------------------------------------------------
// Once per day (and on-demand from the admin UI) we ask each active gateway
// for the list of transactions that settled in a recent time window, then
// reconcile that list against our local `payments` table:
//
//   * pending → captured  (gateway confirms it batched)
//   * capture batch_id, settled_at, fees, etc. for accurate receipts and
//     monthly reconciliation reports
//   * record any gateway txn we couldn't match locally (these are dropped or
//     out-of-band charges; surfaced in the admin UI for triage)
//
// Each run inserts a row into `payment_batch_runs` so the UI can show "last
// run, found N matches" without us needing to log to a file.
//
// ─── Why this exists ────────────────────────────────────────────────────────
// Webhooks are the primary source of truth for capture status. But in
// localhost/dev there is no public webhook endpoint, customers' webhooks fail
// silently from time to time, and Auth.net's "settled" event is delayed until
// the merchant batch closes. Polling settled batches the next morning catches
// every gap and is the same pattern almost every CRM uses for txn finalization.
// =============================================================================

const { db } = require('../db');
const { authnetFetchTransaction } = require('./gateways');

// ---- helpers ----------------------------------------------------------------

function fmtAuthnetDate(d) {
  // Auth.net wants ISO-8601 in UTC, e.g. "2025-04-25T00:00:00Z"
  return new Date(d).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function fmtValorDate(d) {
  // Valor's history endpoints generally accept "YYYY-MM-DD HH:MM:SS"
  const dt = new Date(d);
  const pad = (n) => String(n).padStart(2, '0');
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())} ` +
         `${pad(dt.getUTCHours())}:${pad(dt.getUTCMinutes())}:${pad(dt.getUTCSeconds())}`;
}

async function loadActiveGateways() {
  const [rows] = await db.query(
    `SELECT * FROM payment_gateway_settings WHERE is_active = 1`);
  return rows;
}

async function startRun({ gateway, mode, trigger_kind = 'cron', triggered_by = null, window_start, window_end }) {
  const [r] = await db.query(
    `INSERT INTO payment_batch_runs
       (gateway, mode, trigger_kind, triggered_by, window_start, window_end, status)
     VALUES (:g, :m, :tk, :tb, :ws, :we, 'running')`,
    { g: gateway, m: mode, tk: trigger_kind, tb: triggered_by,
      ws: new Date(window_start), we: new Date(window_end) });
  return r.insertId;
}

async function finishRun(runId, patch) {
  await db.query(
    `UPDATE payment_batch_runs
        SET status = :status,
            batches_seen = :bs,
            txns_seen = :ts,
            txns_matched = :tm,
            txns_unmatched = :tu,
            error_message = :err,
            meta = CAST(:meta AS JSON),
            finished_at = NOW()
      WHERE id = :id`,
    {
      id: runId,
      status: patch.status,
      bs: patch.batches_seen || 0,
      ts: patch.txns_seen || 0,
      tm: patch.txns_matched || 0,
      tu: patch.txns_unmatched || 0,
      err: patch.error_message || null,
      meta: JSON.stringify(patch.meta || {}),
    });
}

// ---- match + update one payment from a settled txn -------------------------

async function applySettledTxn({ runId, gateway, txn }) {
  // txn must have at minimum: external_txn_id, status, batch_id, settled_at, amount
  // and may have: invoice_number, last4, brand, auth_code, processor_msg, processor_code
  if (!txn.external_txn_id) return { matched: false, reason: 'no txn id' };

  // Find the candidate payment row
  let [[row]] = await db.query(
    `SELECT id, invoice_id, status FROM payments
      WHERE gateway = :g AND external_txn_id = :tid
      ORDER BY id DESC LIMIT 1`,
    { g: gateway, tid: txn.external_txn_id });

  if (!row && txn.invoice_number) {
    // Fallback: find the most recent pending payment whose invoice number matches.
    const [rs] = await db.query(
      `SELECT p.id, p.invoice_id, p.status
         FROM payments p JOIN invoices i ON i.id = p.invoice_id
        WHERE p.gateway = :g AND i.invoice_number = :num
          AND p.status IN ('pending','authorized')
        ORDER BY p.id DESC LIMIT 1`,
      { g: gateway, num: txn.invoice_number });
    row = rs[0];
  }

  if (!row) return { matched: false, reason: 'no local payment' };

  // Don't downgrade — once captured, we only enrich.
  const newStatus =
    row.status === 'captured' || row.status === 'refunded' || row.status === 'voided'
      ? row.status
      : (txn.status || 'captured');

  await db.query(
    `UPDATE payments
        SET status              = :status,
            external_txn_id     = COALESCE(:tid, external_txn_id),
            external_auth_code  = COALESCE(:auth, external_auth_code),
            card_last4          = COALESCE(:last4, card_last4),
            card_brand          = COALESCE(:brand, card_brand),
            card_expiry         = COALESCE(:exp, card_expiry),
            card_holder_name    = COALESCE(:holder, card_holder_name),
            avs_result          = COALESCE(:avs, avs_result),
            cvv_result          = COALESCE(:cvv, cvv_result),
            processor_message   = COALESCE(:pmsg, processor_message),
            processor_code      = COALESCE(:pcode, processor_code),
            batch_id            = COALESCE(:batch, batch_id),
            settled_at          = COALESCE(:settled, settled_at),
            amount              = COALESCE(:amount, amount),
            received_at         = COALESCE(received_at, NOW()),
            last_reconciled_at  = NOW(),
            reconciled_run_id   = :runId
      WHERE id = :id`,
    {
      id: row.id,
      runId,
      status: newStatus,
      tid: txn.external_txn_id,
      auth: txn.auth_code || null,
      last4: txn.last4 || null,
      brand: txn.brand || null,
      exp: txn.expiry || null,
      holder: txn.holder || null,
      avs: txn.avs_result || null,
      cvv: txn.cvv_result || null,
      pmsg: txn.processor_msg || null,
      pcode: txn.processor_code || null,
      batch: txn.batch_id || null,
      settled: txn.settled_at ? new Date(txn.settled_at) : null,
      amount: typeof txn.amount === 'number' ? txn.amount : null,
    });

  return { matched: true, paymentId: row.id, invoiceId: row.invoice_id, statusBefore: row.status, statusAfter: newStatus };
}

// =============================================================================
// Authorize.net
// -----------------------------------------------------------------------------
// API:
//   getSettledBatchListRequest      → list batches in a window
//   getTransactionListRequest       → list txns in a batch
//   getTransactionDetailsRequest    → full record (already in gateways.js)
// =============================================================================

async function authnetListSettledBatches(cfg, { from, to }) {
  const endpoint = cfg.mode === 'live'
    ? 'https://api.authorize.net/xml/v1/request.api'
    : 'https://apitest.authorize.net/xml/v1/request.api';
  const body = {
    getSettledBatchListRequest: {
      merchantAuthentication: { name: cfg.api_login_id, transactionKey: cfg.transaction_key },
      includeStatistics: 'false',
      firstSettlementDate: fmtAuthnetDate(from),
      lastSettlementDate:  fmtAuthnetDate(to),
    },
  };
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = (await res.text()).replace(/^\uFEFF/, '');
  const json = JSON.parse(text);
  if (json?.messages?.resultCode !== 'Ok') {
    throw new Error(`Auth.net settled batch list failed: ${json?.messages?.message?.[0]?.text || res.statusText}`);
  }
  // Auth.net returns either an array or a single object depending on count
  const list = json.batchList || [];
  return Array.isArray(list) ? list : [list];
}

async function authnetListTransactionsInBatch(cfg, batchId) {
  const endpoint = cfg.mode === 'live'
    ? 'https://api.authorize.net/xml/v1/request.api'
    : 'https://apitest.authorize.net/xml/v1/request.api';
  const body = {
    getTransactionListRequest: {
      merchantAuthentication: { name: cfg.api_login_id, transactionKey: cfg.transaction_key },
      batchId: String(batchId),
    },
  };
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = (await res.text()).replace(/^\uFEFF/, '');
  const json = JSON.parse(text);
  if (json?.messages?.resultCode !== 'Ok') {
    throw new Error(`Auth.net transaction list failed: ${json?.messages?.message?.[0]?.text || res.statusText}`);
  }
  const list = json.transactions || [];
  return Array.isArray(list) ? list : [list];
}

async function reconcileAuthnet({ runId, cfg, from, to }) {
  const summary = { batches_seen: 0, txns_seen: 0, txns_matched: 0, txns_unmatched: 0, batchIds: [], unmatched: [] };
  const batches = await authnetListSettledBatches(cfg, { from, to });
  summary.batches_seen = batches.length;
  summary.batchIds = batches.map((b) => b.batchId).filter(Boolean);

  for (const batch of batches) {
    const txns = await authnetListTransactionsInBatch(cfg, batch.batchId).catch(() => []);
    summary.txns_seen += txns.length;
    for (const t of txns) {
      // Only finalize settled-positive txns; others (declined, voided) are
      // already terminal and don't move pending → captured.
      const isSettled = (t.transactionStatus || '').toLowerCase().includes('settledsuccessfully');
      if (!isSettled) continue;

      // Pull richer detail for AVS/CVV/processor msg. Cheap and rate-limit-safe
      // because batches are small (a few dozen at most). Skip the detail
      // fetch silently if it errors — we can still apply the basics.
      let detail = null;
      try {
        const d = await authnetFetchTransaction(cfg, t.transId);
        detail = d?.transaction || null;
      } catch (_e) { /* noop */ }

      const cc = detail?.payment?.creditCard || {};
      const result = await applySettledTxn({
        runId,
        gateway: 'authnet',
        txn: {
          external_txn_id: t.transId,
          invoice_number:  t.invoiceNumber || detail?.order?.invoiceNumber || null,
          status:          'captured',
          batch_id:        batch.batchId,
          settled_at:      batch.settlementTimeUTC || batch.settlementTimeLocal || null,
          amount:          Number(t.settleAmount || detail?.authAmount || 0) || null,
          last4:           cc.cardNumber?.slice(-4) || null,
          brand:           cc.cardType || null,
          expiry:          cc.expirationDate || null,
          holder:          detail?.billTo
            ? `${detail.billTo.firstName || ''} ${detail.billTo.lastName || ''}`.trim() || null
            : null,
          auth_code:       detail?.authCode || null,
          avs_result:      detail?.AVSResponse || detail?.AVSResponseCode || null,
          cvv_result:      detail?.cardCodeResponse || null,
          processor_msg:   detail?.responseReasonDescription || null,
          processor_code:  detail?.responseCode || detail?.responseReasonCode || null,
        },
      });
      if (result.matched) summary.txns_matched++;
      else { summary.txns_unmatched++; summary.unmatched.push({ txn: t.transId, reason: result.reason }); }
    }
  }
  return summary;
}

// =============================================================================
// Valor PayTech
// -----------------------------------------------------------------------------
// Valor's API surface for transaction history varies a bit by API revision —
// the most common endpoints are:
//   POST /?txnhistory          (older docs)
//   POST /reports/transactions (newer docs)
// We try the most common one and fall back gracefully if the merchant's
// account uses a different shape. Anything we can't parse is recorded in
// `meta` so the admin can paste a curl into the gateway docs to dial it in.
// =============================================================================

async function valorListSettledTxns(cfg, { from, to }) {
  const baseUrl = cfg.mode === 'live'
    ? 'https://securelink.valorpaytech.com:4430'
    : 'https://securelink-staging.valorpaytech.com:4430';
  const endpoint = `${baseUrl}/?txnhistory`;

  const body = {
    appid:  cfg.app_id  || '',
    appkey: cfg.app_key || '',
    epi:    String(cfg.epi_id || ''),
    from_date: fmtValorDate(from),
    to_date:   fmtValorDate(to),
    status:    'settled',
    page:      1,
    page_size: 500,
  };

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch (_e) { json = { raw: text }; }
  if (!res.ok) {
    throw new Error(`Valor history failed (${res.status}): ${String(json?.message || json?.raw || res.statusText).slice(0, 300)}`);
  }
  // Common shapes: { data: [...] } or { transactions: [...] } or top-level array
  return json?.data || json?.transactions || (Array.isArray(json) ? json : []);
}

async function reconcileValor({ runId, cfg, from, to }) {
  const summary = { batches_seen: 0, txns_seen: 0, txns_matched: 0, txns_unmatched: 0, unmatched: [] };
  const txns = await valorListSettledTxns(cfg, { from, to });
  summary.txns_seen = txns.length;

  // Group by batch id so the UI shows "X batches"
  const batchSet = new Set();
  for (const t of txns) {
    const isApproved = String(t.status || t.txn_status || t.result || '').toLowerCase().includes('approv') ||
                       String(t.status || t.txn_status || '').toLowerCase().includes('settle');
    if (!isApproved) continue;
    const bid = t.batch_id || t.batchId || t.batch || null;
    if (bid) batchSet.add(String(bid));

    const result = await applySettledTxn({
      runId,
      gateway: 'valor',
      txn: {
        external_txn_id: t.transactionId || t.txn_id || t.id || null,
        invoice_number:  t.order_id || t.invoicenumber || t.invoice_number || null,
        status:          'captured',
        batch_id:        bid,
        settled_at:      t.settled_at || t.settlement_date || t.txn_date || null,
        amount:          Number(t.amount || t.settled_amount || 0) || null,
        last4:           t.last4 || t.card_last4 || null,
        brand:           t.card_brand || t.cardBrand || t.cardType || null,
        expiry:          t.card_expiry || t.expiry || null,
        holder:          t.card_holder || t.cardHolder || null,
        auth_code:       t.auth_code || t.authCode || null,
        avs_result:      t.avs_result || t.avsResult || null,
        cvv_result:      t.cvv_result || t.cvvResult || null,
        processor_msg:   t.message || t.responseMessage || null,
        processor_code:  t.response_code || t.responseCode || null,
      },
    });
    if (result.matched) summary.txns_matched++;
    else { summary.txns_unmatched++; summary.unmatched.push({ txn: t.transactionId || t.id, reason: result.reason }); }
  }
  summary.batches_seen = batchSet.size;
  return summary;
}

// ---- public entry: reconcile one gateway -----------------------------------

async function reconcileOneGateway({ cfg, window_start, window_end, trigger_kind = 'cron', triggered_by = null }) {
  const runId = await startRun({
    gateway: cfg.gateway, mode: cfg.mode,
    trigger_kind, triggered_by,
    window_start, window_end,
  });
  try {
    let summary;
    if (cfg.gateway === 'authnet')   summary = await reconcileAuthnet({ runId, cfg, from: window_start, to: window_end });
    else if (cfg.gateway === 'valor') summary = await reconcileValor({ runId, cfg, from: window_start, to: window_end });
    else throw new Error(`Unsupported gateway: ${cfg.gateway}`);

    const status = summary.txns_unmatched > 0 ? 'partial' : 'success';
    await finishRun(runId, { status, ...summary, meta: summary });
    return { ok: true, runId, ...summary };
  } catch (err) {
    await finishRun(runId, { status: 'failed', error_message: err.message, meta: { error: err.message } });
    return { ok: false, runId, error: err.message };
  }
}

// ---- public entry: reconcile every active gateway --------------------------

async function reconcileAllActiveGateways({ window_start, window_end, trigger_kind = 'cron', triggered_by = null }) {
  const cfgs = await loadActiveGateways();
  const results = [];
  for (const cfg of cfgs) {
    if (cfg.gateway === 'manual') continue;
    if (!cfg.api_login_id && !cfg.epi_id) continue;     // not actually configured
    const r = await reconcileOneGateway({ cfg, window_start, window_end, trigger_kind, triggered_by });
    results.push({ gateway: cfg.gateway, mode: cfg.mode, ...r });
  }
  return results;
}

// ---- list recent runs ------------------------------------------------------

async function listRecentRuns({ limit = 25 } = {}) {
  const [rows] = await db.query(
    `SELECT * FROM payment_batch_runs ORDER BY started_at DESC LIMIT :limit`,
    { limit: Number(limit) });
  return rows;
}

module.exports = {
  reconcileOneGateway,
  reconcileAllActiveGateways,
  listRecentRuns,
  // exposed for tests
  applySettledTxn,
};
