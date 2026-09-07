import { useEffect, useState } from 'react';
import api from '../../api/client.js';
import PageHeader from '../../components/PageHeader.jsx';
import { formatGateway } from '../../utils/gateway.js';

const fmtMoney = (n) =>
  `$${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const STATUS_TONE = {
  running: 'warning',
  success: 'success',
  partial: 'info',
  failed:  'danger',
};

const MISMATCH_LABELS = {
  gateway_only:    'Gateway only',
  local_only:      'Local only',
  amount_mismatch: 'Amount mismatch',
};

const METHOD_LABELS = {
  card:  'Credit / Debit Card',
  ach:   'ACH / Bank Transfer',
  check: 'Check',
  cash:  'Cash',
  wire:  'Wire',
  other: 'Other',
};

// ── Batch transactions panel ──────────────────────────────────────────────────

function RunTransactionsPanel({ runId, onClose }) {
  const [txns, setTxns]         = useState(null);
  const [run, setRun]           = useState(null);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState('');
  const [methodFilter, setMethodFilter] = useState('');
  const [brandFilter, setBrandFilter]   = useState('');

  useEffect(() => {
    setLoading(true);
    api.get(`/reports/billing/reconciliation/runs/${runId}/transactions`)
      .then((r) => { setTxns(r.data.rows); setRun(r.data.run); })
      .catch((e) => setError(e.response?.data?.error || 'Failed to load transactions.'))
      .finally(() => setLoading(false));
  }, [runId]);

  const allTxns = txns || [];

  // Derive unique method and brand values from actual data
  const methods = [...new Set(allTxns.map((t) => t.method).filter(Boolean))].sort();
  const brands  = [...new Set(allTxns.map((t) => t.card_brand).filter(Boolean))].sort();

  const filtered = allTxns.filter((t) => {
    if (methodFilter && t.method !== methodFilter) return false;
    if (brandFilter  && t.card_brand !== brandFilter) return false;
    return true;
  });

  // Subtotals by method then brand for the summary
  const byMethod = filtered.reduce((acc, t) => {
    const key = t.method || 'other';
    if (!acc[key]) acc[key] = { count: 0, amount: 0, fee: 0 };
    acc[key].count  += 1;
    acc[key].amount += Number(t.amount  || 0);
    acc[key].fee    += Number(t.fee_amount || 0);
    return acc;
  }, {});

  const totalAmt = filtered.reduce((s, t) => s + Number(t.amount || 0), 0);
  const totalFee = filtered.reduce((s, t) => s + Number(t.fee_amount || 0), 0);
  const totalNet = totalAmt - totalFee;

  const windowLabel = run
    ? `${new Date(run.window_start).toLocaleDateString()} → ${new Date(run.window_end).toLocaleDateString()}`
    : '';

  return (
    <div className="border rounded-2 bg-light p-3 mt-1 mb-2">
      {/* header */}
      <div className="d-flex align-items-center justify-content-between mb-3">
        <div>
          <span className="fw-semibold">Transactions</span>
          {windowLabel && <span className="text-muted ms-2 small">{windowLabel}</span>}
        </div>
        <button className="btn btn-sm btn-light" onClick={onClose}>
          <iconify-icon icon="solar:close-circle-line-duotone"></iconify-icon>
        </button>
      </div>

      {loading && <div className="text-center py-3 text-muted">Loading…</div>}
      {error   && <div className="alert alert-danger py-2">{error}</div>}

      {txns && (
        <>
          {/* ── Filters ── */}
          <div className="row g-2 mb-3">
            <div className="col-md-3">
              <select
                className="form-select form-select-sm"
                value={methodFilter}
                onChange={(e) => { setMethodFilter(e.target.value); setBrandFilter(''); }}
              >
                <option value="">All payment types</option>
                {methods.map((m) => (
                  <option key={m} value={m}>{METHOD_LABELS[m] || m}</option>
                ))}
              </select>
            </div>
            {/* brand filter only meaningful for card */}
            {brands.length > 0 && (
              <div className="col-md-3">
                <select
                  className="form-select form-select-sm"
                  value={brandFilter}
                  onChange={(e) => setBrandFilter(e.target.value)}
                >
                  <option value="">All card brands</option>
                  {brands.map((b) => (
                    <option key={b} value={b}>{b}</option>
                  ))}
                </select>
              </div>
            )}
            <div className="col-auto ms-auto d-flex align-items-center gap-2">
              {(methodFilter || brandFilter) && (
                <button
                  className="btn btn-sm btn-outline-secondary"
                  onClick={() => { setMethodFilter(''); setBrandFilter(''); }}
                >
                  Clear filters
                </button>
              )}
              <span className="text-muted small">{filtered.length} transaction{filtered.length !== 1 ? 's' : ''}</span>
            </div>
          </div>

          {/* ── Method summary cards ── */}
          {Object.keys(byMethod).length > 0 && (
            <div className="row g-2 mb-3">
              {Object.entries(byMethod).map(([method, s]) => (
                <div key={method} className="col-6 col-md-auto">
                  <div className="card border-0 bg-white shadow-sm py-2 px-3">
                    <div className="text-muted small text-uppercase fw-bold">{METHOD_LABELS[method] || method}</div>
                    <div className="fw-bold">{fmtMoney(s.amount)}</div>
                    <div className="text-muted small">{s.count} txn{s.count !== 1 ? 's' : ''} · fee {fmtMoney(s.fee)}</div>
                  </div>
                </div>
              ))}
              <div className="col-6 col-md-auto">
                <div className="card border-0 bg-success-subtle py-2 px-3">
                  <div className="text-muted small text-uppercase fw-bold">Net (after fees)</div>
                  <div className="fw-bold text-success">{fmtMoney(totalNet)}</div>
                  <div className="text-muted small">{filtered.length} total · fee {fmtMoney(totalFee)}</div>
                </div>
              </div>
            </div>
          )}

          {/* ── Transaction table ── */}
          {filtered.length === 0 ? (
            <div className="text-center text-muted py-3">
              No transactions match the selected filters.
            </div>
          ) : (
            <div className="table-responsive">
              <table className="table table-sm table-hover mb-0 align-middle small bg-white rounded">
                <thead className="table-light">
                  <tr>
                    <th>Date</th>
                    <th>Invoice</th>
                    <th>Customer</th>
                    <th>Type</th>
                    <th>Card Brand</th>
                    <th>Last 4</th>
                    <th>Cardholder</th>
                    <th className="text-end">Amount</th>
                    <th className="text-end">Fee</th>
                    <th className="text-end">Net</th>
                    <th>Txn ID</th>
                    <th>Auth</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((t) => {
                    const dateVal = t.settled_at || t.received_at || t.created_at;
                    const net = Number(t.amount || 0) - Number(t.fee_amount || 0);
                    return (
                      <tr key={t.id}>
                        <td className="text-nowrap">
                          {dateVal ? new Date(dateVal).toLocaleDateString() : '—'}
                        </td>
                        <td>
                          {t.invoice_number
                            ? <a href={`/invoices/${t.invoice_id}`} className="text-decoration-none fw-semibold">{t.invoice_number}</a>
                            : '—'}
                        </td>
                        <td>
                          {t.org_name || t.contact_name || '—'}
                        </td>
                        <td>
                          {t.method === 'card'
                            ? <span className="badge bg-primary-subtle text-primary">
                                {t.card_funding ? t.card_funding.charAt(0).toUpperCase() + t.card_funding.slice(1) : 'Card'}
                              </span>
                            : <span className="badge bg-info-subtle text-info">
                                {METHOD_LABELS[t.method] || t.method}
                              </span>}
                        </td>
                        <td>{t.card_brand || (t.method !== 'card' ? '—' : <span className="text-muted">Unknown</span>)}</td>
                        <td className="font-monospace">{t.card_last4 ? `••••${t.card_last4}` : '—'}</td>
                        <td>{t.card_holder_name || '—'}</td>
                        <td className="text-end fw-semibold">{fmtMoney(t.amount)}</td>
                        <td className="text-end text-muted">{t.fee_amount ? fmtMoney(t.fee_amount) : '—'}</td>
                        <td className="text-end text-success fw-semibold">{fmtMoney(net)}</td>
                        <td className="font-monospace text-muted" style={{ maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {t.external_txn_id || '—'}
                        </td>
                        <td className="font-monospace text-muted">{t.external_auth_code || '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot className="table-light fw-bold">
                  <tr>
                    <td colSpan={7} className="text-end">Totals</td>
                    <td className="text-end">{fmtMoney(totalAmt)}</td>
                    <td className="text-end text-muted">{fmtMoney(totalFee)}</td>
                    <td className="text-end text-success">{fmtMoney(totalNet)}</td>
                    <td colSpan={2}></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function BillingReconciliationReport() {
  const [tab, setTab]             = useState('runs');
  const [data, setData]           = useState(null);
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState('');
  const [running, setRunning]     = useState(false);
  const [runMsg, setRunMsg]       = useState('');
  const [expandedRun, setExpandedRun] = useState(null);

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const r = await api.get('/reports/billing/reconciliation');
      setData(r.data);
    } catch (e) {
      setError(e.response?.data?.error || 'Failed to load reconciliation data.');
    } finally {
      setLoading(false);
    }
  }

  async function triggerRun() {
    setRunning(true);
    setRunMsg('');
    try {
      const r = await api.post('/payments/reconcile-batches');
      const res = r.data || {};
      const matched   = res.results?.reduce((a, x) => a + (x.matched   || 0), 0) ?? '?';
      const unmatched = res.results?.reduce((a, x) => a + (x.unmatched || 0), 0) ?? '?';
      setRunMsg(`Run complete — ${matched} matched, ${unmatched} unmatched.`);
      load();
    } catch (e) {
      setRunMsg(e.response?.data?.error || 'Reconciliation run failed.');
    } finally {
      setRunning(false);
    }
  }

  async function toggleResolve(mismatch) {
    try {
      await api.patch(`/reports/billing/reconciliation/mismatches/${mismatch.id}/resolve`, {
        resolved: !mismatch.resolved,
      });
      load();
    } catch (_) {}
  }

  const runs       = data?.runs       || [];
  const mismatches = data?.mismatches || [];
  const openCount  = mismatches.filter((m) => !m.resolved).length;

  function toggleRun(runId) {
    setExpandedRun((prev) => (prev === runId ? null : runId));
  }

  return (
    <div>
      <PageHeader
        title="Batch Reconciliation"
        subtitle="Gateway settlement vs. local payment records"
        actions={
          <button className="btn btn-primary" onClick={triggerRun} disabled={running}>
            {running
              ? <><span className="spinner-border spinner-border-sm me-1" />Running…</>
              : <><iconify-icon icon="solar:refresh-circle-line-duotone" class="me-1"></iconify-icon>Run Now</>}
          </button>
        }
      />

      {runMsg && (
        <div className={`alert ${runMsg.toLowerCase().includes('fail') ? 'alert-danger' : 'alert-success'} d-flex align-items-center gap-2 mb-3`}>
          <iconify-icon icon="solar:check-circle-line-duotone" class="fs-5"></iconify-icon>
          {runMsg}
        </div>
      )}
      {error && <div className="alert alert-danger mb-3">{error}</div>}

      {/* ── Tabs ── */}
      <ul className="nav nav-tabs mb-3">
        <li className="nav-item">
          <button
            className={`nav-link ${tab === 'runs' ? 'active' : ''}`}
            onClick={() => setTab('runs')}
          >
            Run History
            {runs.length > 0 && <span className="badge bg-secondary ms-2">{runs.length}</span>}
          </button>
        </li>
        <li className="nav-item">
          <button
            className={`nav-link ${tab === 'mismatches' ? 'active' : ''}`}
            onClick={() => setTab('mismatches')}
          >
            Mismatches
            {openCount > 0 && <span className="badge bg-danger ms-2">{openCount}</span>}
          </button>
        </li>
      </ul>

      {/* ── Run History ── */}
      {tab === 'runs' && (
        <div className="card">
          <div className="card-body p-0">
            {loading ? (
              <div className="p-4 text-center text-muted">Loading…</div>
            ) : runs.length === 0 ? (
              <div className="p-4 text-center text-muted">
                No reconciliation runs yet. Click <strong>Run Now</strong> to start the first one.
              </div>
            ) : (
              <div className="table-responsive">
                <table className="table table-hover mb-0 align-middle small">
                  <thead className="table-light">
                    <tr>
                      <th style={{ width: 36 }}></th>
                      <th>Started</th>
                      <th>Gateway</th>
                      <th>Window</th>
                      <th>Trigger</th>
                      <th>By</th>
                      <th className="text-center">Status</th>
                      <th className="text-end">Seen</th>
                      <th className="text-end">Matched</th>
                      <th className="text-end">Unmatched</th>
                      <th>Duration</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {runs.map((r) => {
                      const isOpen = expandedRun === r.id;
                      const dur = r.finished_at && r.started_at
                        ? `${Math.round((new Date(r.finished_at) - new Date(r.started_at)) / 1000)}s`
                        : r.status === 'running' ? 'in progress' : '—';
                      return (
                        <>
                          <tr key={r.id} className={isOpen ? 'table-active' : ''}>
                            <td className="text-center">
                              <button
                                className="btn btn-sm btn-light p-0 px-1"
                                style={{ lineHeight: 1 }}
                                onClick={() => toggleRun(r.id)}
                                title={isOpen ? 'Collapse' : 'View transactions'}
                              >
                                <iconify-icon
                                  icon={isOpen
                                    ? 'solar:alt-arrow-up-line-duotone'
                                    : 'solar:alt-arrow-down-line-duotone'}
                                ></iconify-icon>
                              </button>
                            </td>
                            <td className="text-nowrap">{new Date(r.started_at).toLocaleString()}</td>
                            <td>{formatGateway(r.gateway)}</td>
                            <td className="text-nowrap text-muted">
                              {r.window_start ? new Date(r.window_start).toLocaleDateString() : ''}
                              {' → '}
                              {r.window_end   ? new Date(r.window_end).toLocaleDateString()   : ''}
                            </td>
                            <td className="text-capitalize">{r.trigger_kind}</td>
                            <td>{r.triggered_by_name || '—'}</td>
                            <td className="text-center">
                              <span className={`badge bg-${STATUS_TONE[r.status] || 'secondary'}`}>
                                {r.status}
                              </span>
                            </td>
                            <td className="text-end">{r.txns_seen}</td>
                            <td className="text-end text-success fw-semibold">{r.txns_matched}</td>
                            <td className="text-end">
                              {Number(r.txns_unmatched) > 0
                                ? <span className="text-danger fw-semibold">{r.txns_unmatched}</span>
                                : r.txns_unmatched}
                            </td>
                            <td className="text-muted">{dur}</td>
                            <td>
                              <button
                                className={`btn btn-sm ${isOpen ? 'btn-primary' : 'btn-outline-primary'}`}
                                onClick={() => toggleRun(r.id)}
                              >
                                <iconify-icon icon="solar:list-check-line-duotone" class="me-1"></iconify-icon>
                                Transactions
                              </button>
                            </td>
                          </tr>
                          {r.status === 'failed' && r.error_message && (
                            <tr key={`${r.id}-error`}>
                              <td colSpan={12} className="border-0 pt-0">
                                <div className="alert alert-danger d-flex align-items-start gap-2 py-2 mb-0">
                                  <iconify-icon icon="solar:danger-triangle-bold-duotone" class="fs-5 flex-shrink-0"></iconify-icon>
                                  <div><strong>Run failed:</strong> {r.error_message}</div>
                                </div>
                              </td>
                            </tr>
                          )}
                          {isOpen && (
                            <tr key={`${r.id}-detail`}>
                              <td colSpan={12} className="p-0 border-0">
                                <RunTransactionsPanel runId={r.id} onClose={() => setExpandedRun(null)} />
                              </td>
                            </tr>
                          )}
                        </>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Mismatches ── */}
      {tab === 'mismatches' && (
        <div className="card">
          <div className="card-body p-0">
            {loading ? (
              <div className="p-4 text-center text-muted">Loading…</div>
            ) : mismatches.length === 0 ? (
              <div className="p-4 text-center text-muted">
                No mismatches recorded. Everything is reconciled.
              </div>
            ) : (
              <div className="table-responsive">
                <table className="table table-hover mb-0 align-middle small">
                  <thead className="table-light">
                    <tr>
                      <th>Batch Date</th>
                      <th>Gateway</th>
                      <th>Gateway Txn ID</th>
                      <th className="text-end">Gateway Amt</th>
                      <th>Local Invoice</th>
                      <th className="text-end">Local Amt</th>
                      <th>Type</th>
                      <th className="text-center">Status</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {mismatches.map((m) => (
                      <tr key={m.id} className={m.resolved ? 'opacity-50' : ''}>
                        <td>{m.batch_date}</td>
                        <td>{formatGateway(m.gateway)}</td>
                        <td className="font-monospace small">{m.gateway_txn_id || '—'}</td>
                        <td className="text-end">{fmtMoney(m.gateway_amount)}</td>
                        <td>
                          {m.invoice_number
                            ? <a href={`/invoices/${m.invoice_id}`} className="text-decoration-none">{m.invoice_number}</a>
                            : '—'}
                        </td>
                        <td className="text-end">{m.local_amount != null ? fmtMoney(m.local_amount) : '—'}</td>
                        <td>
                          <span className={`badge bg-${m.mismatch_type === 'gateway_only' ? 'warning' : m.mismatch_type === 'local_only' ? 'info' : 'danger'}-subtle text-dark`}>
                            {MISMATCH_LABELS[m.mismatch_type] || m.mismatch_type}
                          </span>
                        </td>
                        <td className="text-center">
                          {m.resolved
                            ? <span className="badge bg-success">Resolved</span>
                            : <span className="badge bg-danger">Open</span>}
                        </td>
                        <td>
                          <button
                            className={`btn btn-sm ${m.resolved ? 'btn-outline-secondary' : 'btn-outline-success'}`}
                            onClick={() => toggleResolve(m)}
                          >
                            {m.resolved ? 'Reopen' : 'Resolve'}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
