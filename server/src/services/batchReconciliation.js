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

function fmtValorDateOnly(d) {
  // Both /?txnlist and /?achtxnfetch take plain YYYY-MM-DD (no time component) —
  // confirmed against Valor's live sandbox (see gateways.js-adjacent notes below).
  const dt = new Date(d);
  const pad = (n) => String(n).padStart(2, '0');
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
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

  // Don't downgrade — once captured, we only enrich — EXCEPT a captured payment
  // can still move to failed/refunded/voided if the gateway later reports a
  // genuine reversal (txn.isReversal). This matters specifically for ACH: unlike
  // cards (which decline instantly, before ever reaching 'captured'), an ACH
  // debit can settle as 'captured' first and then bounce as a return/NSF up to
  // several business days later — exactly the gap this nightly job exists to
  // catch when the webhook for that later return is missed.
  const finalizedNoReversal = new Set(['refunded', 'voided']);
  const newStatus =
    finalizedNoReversal.has(row.status) ? row.status
    : (row.status === 'captured' && !(txn.isReversal && txn.status)) ? row.status
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
// Valor splits transaction reporting across two entirely separate endpoints —
// there is no single "give me everything" call. Confirmed live against the
// sandbox (2026-08-07), including real field names, since Valor's own docs
// ship an empty response schema for both:
//
//   Cards:  POST /?txnlist       (port 443)  txn_type: 'txnfetch_date'
//           start_date_range / end_date_range (YYYY-MM-DD), limit (max 1000)
//           → { number_of_records, data: [{ REF_TXN_ID, IS_SETTLED, BATCH_NO,
//               NET_AMOUNT (cents), INVOICE_NO, PAN, CARD_SCHEME, RESPONSE_CODE,
//               DISPLAY_MESSAGE, IS_VOID, IS_REVERSAL, REFUND_AMOUNT, ... }] }
//
//   ACH:    POST /?achtxnfetch   (port 4430) txn_type: 'achtxnlist'
//           start_date / end_date (YYYY-MM-DD), limit (max 50)
//           → { records, data: [{ uid, current_state, posting_date, amount
//               (decimal dollars, NOT cents), batch_number, invoice_no,
//               payee_name, account_number, routing_number, ... }] }
//
// We call both and merge — this is the fix for "reconcile must cover ACH as
// well as cards, not just cards" (the old code only ever hit a single,
// nonexistent /?txnhistory endpoint and silently returned nothing for either).
//
// Unlike a card decline (synchronous — already known at charge time), an ACH
// debit can settle as 'captured' first and then return/NSF up to several
// business days later. `current_state`/`posting_date` vocabulary for that
// terminal-negative case hasn't been observed live yet (this sandbox account
// has no aged/returned ACH txns to inspect), so unrecognized non-pending
// states are never silently dropped — they're recorded in `unmatched` with
// the raw state string so an admin can see them in the reconciliation UI and
// we can tighten the classifier against real data as it shows up.
// =============================================================================

async function valorListCardTxns(cfg, { from, to }) {
  const baseUrl = cfg.mode === 'live'
    ? 'https://securelink.valorpaytech.com:443'
    : 'https://securelink-staging.valorpaytech.com:443';

  const out = [];
  let offset = 0;
  const limit = 1000;
  for (let page = 0; page < 20; page++) {
    const body = {
      appid: cfg.app_id || '', appkey: cfg.app_key || '', epi: String(cfg.epi_id || ''),
      txn_type: 'txnfetch_date',
      start_date_range: fmtValorDateOnly(from), end_date_range: fmtValorDateOnly(to),
      limit: String(limit), offset: String(offset),
    };
    const res = await fetch(`${baseUrl}/?txnlist`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch (_e) { json = { raw: text }; }
    if (!res.ok) {
      throw new Error(`Valor card txn list failed (${res.status}): ${String(json?.desc || json?.message || json?.raw || res.statusText).slice(0, 300)}`);
    }
    const batch = json?.data || [];
    out.push(...batch);
    if (batch.length < limit) break;
    offset += limit;
  }
  return out;
}

async function valorListAchTxns(cfg, { from, to }) {
  const baseUrl = cfg.mode === 'live'
    ? 'https://securelink.valorpaytech.com:4430'
    : 'https://securelink-staging.valorpaytech.com:4430';

  const out = [];
  let offset = 0;
  const limit = 50; // Valor-documented max for this endpoint
  for (let page = 0; page < 20; page++) {
    const body = {
      appid: cfg.app_id || '', appkey: cfg.app_key || '', epi: String(cfg.epi_id || ''),
      txn_type: 'achtxnlist',
      start_date: fmtValorDateOnly(from), end_date: fmtValorDateOnly(to),
      limit, offset,
    };
    const res = await fetch(`${baseUrl}/?achtxnfetch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch (_e) { json = { raw: text }; }
    if (!res.ok) {
      throw new Error(`Valor ACH txn list failed (${res.status}): ${String(json?.desc || json?.message || json?.raw || res.statusText).slice(0, 300)}`);
    }
    const batch = json?.data || [];
    out.push(...batch);
    if (batch.length < limit) break;
    offset += limit;
  }
  return out;
}

// Card classification: IS_SETTLED is an explicit, unambiguous flag — no string
// guessing needed. Void/reversal/refund flags are similarly explicit.
function classifyCardTxn(t) {
  if (String(t.IS_VOID) === '1') return 'voided';
  if (String(t.IS_REVERSAL) === '1') return 'failed';
  if (Number(t.REFUND_AMOUNT || 0) > 0 || Number(t.REFUND_COUNT || 0) > 0) return 'refunded';
  if (String(t.IS_SETTLED) === '1') return 'captured';
  return null; // not settled yet — still in flight, nothing to reconcile
}

// ACH classification: posting_date (empty → non-empty) is the confirmed,
// observed signal for "this has posted" — current_state text is the secondary
// signal, and is what carries a negative outcome (return/NSF) even if a
// posting_date was already set from an earlier provisional post.
function classifyAchTxn(t) {
  const state = String(t.current_state || '').toLowerCase();
  if (/return|nsf|reject|fail|declin|revers|unauth|cancel/.test(state)) return 'failed';
  if (/void/.test(state)) return 'voided';
  if (t.posting_date || /fund|settl|complet|success|approv|post/.test(state)) return 'captured';
  if (/wait|pend/.test(state)) return null; // still in flight
  return 'unknown'; // don't recognize this state — flag for triage, don't drop
}

async function reconcileValor({ runId, cfg, from, to }) {
  const summary = { batches_seen: 0, txns_seen: 0, txns_matched: 0, txns_unmatched: 0, unmatched: [] };
  const batchSet = new Set();

  const [cardTxns, achTxns] = await Promise.all([
    valorListCardTxns(cfg, { from, to }),
    valorListAchTxns(cfg, { from, to }),
  ]);
  summary.txns_seen = cardTxns.length + achTxns.length;

  for (const t of cardTxns) {
    const mapped = classifyCardTxn(t);
    if (mapped === null) continue; // unsettled — expected, not an error
    if (t.BATCH_NO) batchSet.add(String(t.BATCH_NO));

    const last4 = (t.PAN || '').replace(/\s|X/gi, '').slice(-4) || null;
    const result = await applySettledTxn({
      runId, gateway: 'valor',
      txn: {
        external_txn_id: t.REF_TXN_ID ? String(t.REF_TXN_ID) : null,
        invoice_number:  t.INVOICE_NO || null,
        status:          mapped,
        isReversal:      mapped !== 'captured',
        batch_id:        t.BATCH_NO || null,
        settled_at:      t.TXN_ORIG_DATE || null,
        amount:          Number(t.NET_AMOUNT || t.BASE_AMOUNT || 0) / 100 || null,
        last4,
        brand:           t.CARD_SCHEME || null,
        holder:          t.CARDHOLDER_NAME || null,
        auth_code:       t.AUTH_CODE || t.APPROVAL_CODE || null,
        processor_msg:   t.DISPLAY_MESSAGE || null,
        processor_code:  t.RESPONSE_CODE || null,
      },
    });
    if (result.matched) summary.txns_matched++;
    else { summary.txns_unmatched++; summary.unmatched.push({ txn: t.REF_TXN_ID, method: 'card', reason: result.reason }); }
  }

  for (const t of achTxns) {
    const mapped = classifyAchTxn(t);
    if (mapped === null) continue; // still waiting — expected, not an error
    if (t.batch_number) batchSet.add(String(t.batch_number));

    if (mapped === 'unknown') {
      summary.txns_unmatched++;
      summary.unmatched.push({ txn: t.uid, method: 'ach', reason: `unrecognized current_state: ${t.current_state}` });
      continue;
    }

    const result = await applySettledTxn({
      runId, gateway: 'valor',
      txn: {
        external_txn_id: t.uid || null,
        invoice_number:  t.invoice_no || null,
        status:          mapped,
        isReversal:      mapped !== 'captured',
        batch_id:        t.batch_number || null,
        settled_at:      t.posting_date || t.txn_date || null,
        amount:          Number(t.amount || t.base_amount || 0) || null,
        holder:          t.payee_name || t.company_name || null,
        processor_msg:   t.current_state || null,
      },
    });
    if (result.matched) summary.txns_matched++;
    else { summary.txns_unmatched++; summary.unmatched.push({ txn: t.uid, method: 'ach', reason: result.reason }); }
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
