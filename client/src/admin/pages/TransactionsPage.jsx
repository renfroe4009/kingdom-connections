import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../../api/client.js';
import PageHeader from '../../components/PageHeader.jsx';
import Modal from '../../components/Modal.jsx';
import FormErrorBanner from '../../components/FormErrorBanner.jsx';
import { toast } from '../../components/Toast.jsx';
import { parseApiError } from '../../utils/apiError.js';
import { formatGateway } from '../../utils/gateway.js';
import { useConfirm, usePrompt } from '../../hooks/useConfirm.jsx';
import { useAuth } from '../../auth/AuthContext.jsx';

const TXN_TONE = {
  pending: 'warning',
  authorized: 'info',
  captured: 'success',
  failed: 'danger',
  refunded: 'secondary',
  voided: 'secondary',
};

const SOURCE_TONE = {
  donation: 'success',
  order: 'primary',
  event: 'info',
  membership: 'warning',
  subscription: 'secondary',
  recurring_invoice: 'secondary',
  invoice: 'dark',
};

const fmtMoney = (n) =>
  `$${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const apiBase = (import.meta?.env?.VITE_API_BASE) || '/api';

// ---- small presentational helpers used by the page ----

function TotalCard({ label, value, subtle, tone }) {
  // Tinted card per metric; matches the rest of the app's "subtle" badge style.
  const bg   = tone ? `bg-${tone}-subtle`   : 'bg-light';
  const text = tone ? `text-${tone}` : 'text-dark';
  return (
    <div className="col-6 col-md">
      <div className={`card mb-0 ${bg} border-0`}>
        <div className="card-body py-3 px-3">
          <div className="text-muted small text-uppercase fw-bold">{label}</div>
          <div className={`fs-4 fw-bold ${text}`}>{value}</div>
          {subtle && <div className="text-muted small">{subtle}</div>}
        </div>
      </div>
    </div>
  );
}

function DatePreset({ label, days, mtd, ytd, setFrom, setTo, setPage }) {
  function apply() {
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm   = String(today.getMonth() + 1).padStart(2, '0');
    const dd   = String(today.getDate()).padStart(2, '0');
    const todayStr = `${yyyy}-${mm}-${dd}`;
    let fromStr = todayStr;
    if (mtd) {
      fromStr = `${yyyy}-${mm}-01`;
    } else if (ytd) {
      fromStr = `${yyyy}-01-01`;
    } else if (Number.isFinite(days) && days > 0) {
      const d = new Date(today);
      d.setDate(d.getDate() - days);
      fromStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }
    setFrom(fromStr);
    setTo(todayStr);
    setPage(1);
  }
  return (
    <button type="button" className="btn btn-sm btn-light" onClick={apply}>
      {label}
    </button>
  );
}

export default function TransactionsPage() {
  const { can } = useAuth();
  const { confirm, dialog: confirmDialog } = useConfirm();
  const { prompt, dialog: promptDialog } = usePrompt();
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(25);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  // filters
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [gateway, setGateway] = useState('');
  const [source, setSource] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo]     = useState('');

  // aggregates for the totals strip
  const [totals, setTotals] = useState({
    count: 0, amount: 0, fees: 0,
    captured: 0, authorized: 0, pending: 0,
    refunded: 0, voided: 0, failed: 0,
  });

  // detail modal
  const [active, setActive] = useState(null); // selected row
  const [actionBusy, setActionBusy] = useState(false);
  const [actionMsg, setActionMsg] = useState('');

  // refund modal
  const [refundFor, setRefundFor] = useState(null);
  const [refundAmount, setRefundAmount] = useState('');
  const [refundFormError, setRefundFormError] = useState('');

  async function load() {
    setLoading(true); setErr('');
    try {
      const { data } = await api.get('/payments', {
        params: {
          page, pageSize,
          q: q || undefined,
          status: status || undefined,
          gateway: gateway || undefined,
          source: source || undefined,
          from: from || undefined,
          to:   to   || undefined,
        },
      });
      setRows(data.rows || []);
      setTotal(Number(data.total || 0));
      if (data.totals) setTotals(data.totals);
    } catch (e) {
      setErr(e.response?.data?.error || 'Failed to load transactions.');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, [page, status, gateway, source, from, to]); // eslint-disable-line

  function applySearch(e) {
    e?.preventDefault();
    setPage(1);
    load();
  }

  async function refresh() {
    await load();
    if (active) {
      const fresh = (rows || []).find((r) => r.id === active.id);
      if (fresh) setActive(fresh);
    }
  }

  async function doVoid(p) {
    if (!(await confirm(`Void transaction #${p.id} for ${fmtMoney(p.amount)}? This cannot be undone.`, { danger: true }))) return;
    const reason = await prompt('Reason for void (optional):', { defaultValue: '' });
    setActionBusy(true); setActionMsg('');
    try {
      await api.post(`/payments/${p.id}/void`, { reason: reason || null });
      setActionMsg('Transaction voided.');
      await refresh();
      setActive(null);
    } catch (e) {
      setActionMsg(parseApiError(e, 'Void failed.'));
    } finally {
      setActionBusy(false);
    }
  }

  function openRefund(p) {
    setRefundFor(p);
    setRefundAmount(String(Number(p.amount || 0).toFixed(2)));
    setRefundFormError('');
  }
  async function confirmRefund() {
    if (!refundFor) return;
    const amt = Number(refundAmount);
    if (!Number.isFinite(amt) || amt <= 0) { setRefundFormError('Enter a valid refund amount.'); return; }
    if (amt > Number(refundFor.amount) + 0.001) {
      if (!(await confirm('Refund exceeds the captured amount. Continue anyway?', { danger: true }))) return;
    }
    setRefundFormError('');
    setActionBusy(true); setActionMsg('');
    try {
      await api.post(`/payments/${refundFor.id}/refund`, { amount: amt });
      setActionMsg(`Refund of ${fmtMoney(amt)} recorded.`);
      setRefundFor(null);
      setRefundAmount('');
      await refresh();
      setActive(null);
    } catch (e) {
      setActionMsg(parseApiError(e, 'Refund failed.'));
    } finally {
      setActionBusy(false);
    }
  }

  async function emailReceipt(p) {
    if (!p?.receipt_token) {
      toast('Receipt link unavailable for this payment.', 'error');
      return;
    }
    const to = await prompt('Send receipt to:', { defaultValue: '' });
    if (!to || !to.trim()) return;
    try {
      // Receipts are addressed by random token (256 bits) rather than the
      // sequential payment id — receipt URLs are publicly reachable, so an
      // id-based scheme would let an attacker enumerate other customers'
      // receipts by guessing small integers.
      await fetch(`${apiBase}/payments/public/receipt/by-token/${p.receipt_token}/email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to }),
      });
      setActionMsg(`Receipt sent to ${to}.`);
    } catch (_e) {
      setActionMsg('Receipt email failed.');
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const canWrite = can('payments.write');

  // Permitted next actions for a payment row.
  const canVoid = (p) => ['pending', 'authorized', 'captured'].includes(String(p.status).toLowerCase());
  const canRefund = (p) => ['captured', 'authorized'].includes(String(p.status).toLowerCase())
    && !p.refunded_at;

  return (
    <div>
      <PageHeader
        title="Transactions"
        subtitle="All payment activity across invoices and recurring plans" />

      {/* Filters */}
      <div className="card mb-3">
        <div className="card-body">
          <form className="row g-2 align-items-end" onSubmit={applySearch}>
            <div className="col-12 col-md-3">
              <label className="form-label small text-muted mb-1">Search</label>
              <input
                className="form-control"
                placeholder="Invoice #, txn id, last 4, customer…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </div>
            <div className="col-6 col-md-2">
              <label className="form-label small text-muted mb-1">Status</label>
              <select className="form-select" value={status} onChange={(e) => { setPage(1); setStatus(e.target.value); }}>
                <option value="">All</option>
                <option value="pending">Pending</option>
                <option value="authorized">Authorized</option>
                <option value="captured">Captured</option>
                <option value="failed">Failed</option>
                <option value="refunded">Refunded</option>
                <option value="voided">Voided</option>
              </select>
            </div>
            <div className="col-6 col-md-2">
              <label className="form-label small text-muted mb-1">Gateway</label>
              <select className="form-select" value={gateway} onChange={(e) => { setPage(1); setGateway(e.target.value); }}>
                <option value="">All</option>
                <option value="valor">Valor</option>
                <option value="authnet">Authorize.Net</option>
                <option value="manual">Manual</option>
              </select>
            </div>
            <div className="col-6 col-md-2">
              <label className="form-label small text-muted mb-1">Source</label>
              <select className="form-select" value={source} onChange={(e) => { setPage(1); setSource(e.target.value); }}>
                <option value="">All</option>
                <option value="donation">Donation</option>
                <option value="membership">Membership</option>
                <option value="event">Event</option>
                <option value="order">Order</option>
                <option value="subscription">Recurring</option>
                <option value="recurring_invoice">Recurring Invoice</option>
                <option value="invoice">Invoice</option>
              </select>
            </div>
            <div className="col-6 col-md-2">
              <label className="form-label small text-muted mb-1">From</label>
              <input
                type="date"
                className="form-control"
                value={from}
                onChange={(e) => { setPage(1); setFrom(e.target.value); }}
              />
            </div>
            <div className="col-6 col-md-2">
              <label className="form-label small text-muted mb-1">To</label>
              <input
                type="date"
                className="form-control"
                value={to}
                onChange={(e) => { setPage(1); setTo(e.target.value); }}
              />
            </div>
            <div className="col-12 col-md-auto d-grid d-md-block">
              <button type="submit" className="btn btn-primary">Apply</button>
            </div>
          </form>

          {/* Quick range presets and reset */}
          <div className="d-flex flex-wrap gap-2 mt-3">
            <DatePreset label="Today"        days={0}  setFrom={setFrom} setTo={setTo} setPage={setPage} />
            <DatePreset label="Last 7 days"  days={7}  setFrom={setFrom} setTo={setTo} setPage={setPage} />
            <DatePreset label="Last 30 days" days={30} setFrom={setFrom} setTo={setTo} setPage={setPage} />
            <DatePreset label="MTD"          mtd       setFrom={setFrom} setTo={setTo} setPage={setPage} />
            <DatePreset label="YTD"          ytd       setFrom={setFrom} setTo={setTo} setPage={setPage} />
            <button
              type="button"
              className="btn btn-sm btn-outline-secondary ms-auto"
              onClick={() => {
                setQ(''); setStatus(''); setGateway(''); setSource('');
                setFrom(''); setTo(''); setPage(1);
              }}
            >
              Reset all
            </button>
          </div>
        </div>
      </div>

      {/* Totals strip — reflects the filtered set, not just this page */}
      <div className="row g-2 mb-3">
        <TotalCard label="Transactions" value={Number(totals.count || 0).toLocaleString()} subtle="rows in filter" />
        <TotalCard label="Captured"     value={fmtMoney(totals.captured)}  tone="success" subtle="settled or due to settle" />
        <TotalCard label="Pending"      value={fmtMoney(totals.pending + totals.authorized)} tone="warning" subtle="awaiting settlement" />
        <TotalCard label="Refunded"     value={fmtMoney(totals.refunded)}  tone="secondary" />
        <TotalCard label="Processing fees" value={fmtMoney(totals.fees)}   tone="info" subtle="fees collected on these txns" />
      </div>

      {err && <div className="alert alert-danger">{err}</div>}
      {actionMsg && <div className="alert alert-info py-2">{actionMsg}</div>}

      <div className="card">
        <div className="card-body">
          <div className="table-responsive">
            <table className="table table-hover align-middle mb-0">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Source</th>
                  <th>Invoice</th>
                  <th>Customer</th>
                  <th>Gateway</th>
                  <th>Card</th>
                  <th className="text-end">Amount</th>
                  <th className="text-end">Fee</th>
                  <th>Status</th>
                  <th style={{ width: 1 }}></th>
                </tr>
              </thead>
              <tbody>
                {loading && rows.length === 0 && (
                  <tr><td colSpan="10"><div className="empty-state">Loading…</div></td></tr>
                )}
                {!loading && rows.length === 0 && (
                  <tr><td colSpan="10"><div className="empty-state">No transactions match those filters.</div></td></tr>
                )}
                {rows.map((p) => {
                  const when = p.received_at || p.created_at;
                  return (
                    <tr key={p.id} style={{ cursor: 'pointer' }} onClick={() => setActive(p)}>
                      <td>{when ? new Date(when).toLocaleString() : '—'}</td>
                      <td>
                        <span className={`badge bg-${SOURCE_TONE[p.source_module] || 'secondary'}-subtle text-${SOURCE_TONE[p.source_module] || 'secondary'}`}>
                          {p.source_module}
                        </span>
                        {p.source_link ? (
                          <div className="small">
                            <Link to={p.source_link} onClick={(e) => e.stopPropagation()}>{p.source_label}</Link>
                          </div>
                        ) : (
                          <div className="text-muted small">{p.source_label}</div>
                        )}
                      </td>
                      <td>
                        {p.invoice_number ? (
                          <Link to={`/admin/invoices/${p.invoice_id}`} onClick={(e) => e.stopPropagation()}>
                            {p.invoice_number}
                          </Link>
                        ) : '—'}
                      </td>
                      <td>{p.contact_name || p.organization_name || '—'}</td>
                      <td className="small">{formatGateway(p.gateway)}</td>
                      <td className="small text-muted">
                        {p.card_brand ? `${p.card_brand} •••• ${p.card_last4 || ''}` : '—'}
                      </td>
                      <td className="text-end fw-semibold">{fmtMoney(p.amount)}</td>
                      <td className="text-end">
                        {Number(p.fee_amount || 0) > 0 ? (
                          <>
                            {fmtMoney(p.fee_amount)}
                            {p.fee_label && (
                              <div className="text-muted small">{p.fee_label}</div>
                            )}
                          </>
                        ) : <span className="text-muted">—</span>}
                      </td>
                      <td>
                        <span className={`badge bg-${TXN_TONE[p.status] || 'secondary'}-subtle text-${TXN_TONE[p.status] || 'secondary'}`}>
                          {p.status}
                        </span>
                        {p.refund_amount && Number(p.refund_amount) > 0 && (
                          <div className="text-muted small">refund {fmtMoney(p.refund_amount)}</div>
                        )}
                      </td>
                      <td className="text-end">
                        <button
                          type="button"
                          className="btn btn-sm btn-light"
                          onClick={(e) => { e.stopPropagation(); setActive(p); }}
                        >
                          <iconify-icon icon="solar:eye-line-duotone" class="me-1"></iconify-icon>
                          View
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div className="d-flex justify-content-between align-items-center mt-3">
              <div className="text-muted small">
                Page {page} of {totalPages} · {total} transactions
              </div>
              <div className="btn-group">
                <button className="btn btn-light btn-sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>← Prev</button>
                <button className="btn btn-light btn-sm" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>Next →</button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Detail / actions modal */}
      <Modal
        show={!!active}
        onClose={() => setActive(null)}
        size="lg"
        title={active ? `Transaction #${active.id}` : 'Transaction'}
        footer={<button className="btn btn-light" onClick={() => setActive(null)}>Close</button>}
      >
        {active && (
          <>
            <div className="row mb-3">
              <div className="col-md-7">
                <dl className="row mb-0 small">
                  <dt className="col-4">Date</dt>
                  <dd className="col-8">{new Date(active.received_at || active.created_at).toLocaleString()}</dd>
                  <dt className="col-4">Source</dt>
                  <dd className="col-8">
                    {active.source_link
                      ? <Link to={active.source_link} onClick={() => setActive(null)}>{active.source_label}</Link>
                      : active.source_label}
                  </dd>
                  <dt className="col-4">Invoice</dt>
                  <dd className="col-8">
                    {active.invoice_number
                      ? <Link to={`/admin/invoices/${active.invoice_id}`} onClick={() => setActive(null)}>{active.invoice_number}</Link>
                      : '—'}
                  </dd>
                  <dt className="col-4">Customer</dt>
                  <dd className="col-8">{active.contact_name || active.organization_name || '—'}</dd>
                  <dt className="col-4">Gateway</dt>
                  <dd className="col-8 text-uppercase">{active.gateway} <span className="text-muted">({active.gateway_mode || '—'})</span></dd>
                  <dt className="col-4">Method</dt>
                  <dd className="col-8 text-capitalize">{active.method}</dd>
                  <dt className="col-4">Card</dt>
                  <dd className="col-8">
                    {active.card_brand ? `${active.card_brand} •••• ${active.card_last4 || ''}` : '—'}
                    {active.card_expiry ? <span className="text-muted ms-2">exp {active.card_expiry}</span> : null}
                  </dd>
                  <dt className="col-4">Auth Code</dt>
                  <dd className="col-8 font-monospace small">{active.external_auth_code || '—'}</dd>
                  <dt className="col-4">Txn ID</dt>
                  <dd className="col-8 font-monospace small text-break">{active.external_txn_id || '—'}</dd>
                  <dt className="col-4">Batch</dt>
                  <dd className="col-8">{active.batch_id || '—'}</dd>
                  <dt className="col-4">AVS / CVV</dt>
                  <dd className="col-8 small text-muted">{active.avs_result || '—'} / {active.cvv_result || '—'}</dd>
                  {active.processor_message && (
                    <>
                      <dt className="col-4">Processor</dt>
                      <dd className="col-8 small">{active.processor_message}</dd>
                    </>
                  )}
                </dl>
              </div>
              <div className="col-md-5">
                <div className="bg-light rounded p-3 h-100 d-flex flex-column">
                  <div className="text-muted small text-uppercase fw-bold">Amount</div>
                  <div className="fs-3 fw-bold">{fmtMoney(active.amount)}</div>
                  {active.fee_amount > 0 && (
                    <div className="small text-muted">Includes {fmtMoney(active.fee_amount)} {active.fee_label || 'fee'}</div>
                  )}
                  <div className="mt-2">
                    <span className={`badge bg-${TXN_TONE[active.status] || 'secondary'}-subtle text-${TXN_TONE[active.status] || 'secondary'}`}>
                      {active.status}
                    </span>
                  </div>
                  {active.refund_amount && Number(active.refund_amount) > 0 && (
                    <div className="text-muted small mt-2">
                      Refunded {fmtMoney(active.refund_amount)} {active.refunded_at ? `on ${new Date(active.refunded_at).toLocaleDateString()}` : ''}
                    </div>
                  )}

                  <hr className="my-3" />
                  <div className="d-grid gap-2">
                    {active.receipt_token ? (
                      <>
                        <a
                          className="btn btn-light btn-sm"
                          href={`${apiBase}/payments/public/receipt/by-token/${active.receipt_token}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          <iconify-icon icon="solar:document-line-duotone" class="me-1"></iconify-icon>
                          View receipt
                        </a>
                        <a
                          className="btn btn-light btn-sm"
                          href={`${apiBase}/payments/public/receipt/by-token/${active.receipt_token}.pdf`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          <iconify-icon icon="solar:download-line-duotone" class="me-1"></iconify-icon>
                          Download PDF
                        </a>
                      </>
                    ) : (
                      <div className="text-muted small">Receipt link unavailable for this payment.</div>
                    )}
                    <button
                      type="button"
                      className="btn btn-light btn-sm"
                      onClick={() => emailReceipt(active)}
                    >
                      <iconify-icon icon="solar:letter-line-duotone" class="me-1"></iconify-icon>
                      Email receipt
                    </button>
                    {canWrite && canVoid(active) && (
                      <button
                        type="button"
                        className="btn btn-warning btn-sm"
                        disabled={actionBusy}
                        onClick={() => doVoid(active)}
                      >
                        <iconify-icon icon="solar:close-circle-line-duotone" class="me-1"></iconify-icon>
                        Void
                      </button>
                    )}
                    {canWrite && canRefund(active) && (
                      <button
                        type="button"
                        className="btn btn-danger btn-sm"
                        disabled={actionBusy}
                        onClick={() => openRefund(active)}
                      >
                        <iconify-icon icon="solar:refresh-square-line-duotone" class="me-1"></iconify-icon>
                        Refund
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </>
        )}
      </Modal>

      {/* Refund amount modal */}
      <Modal
        show={!!refundFor}
        onClose={() => setRefundFor(null)}
        title={refundFor ? `Refund transaction #${refundFor.id}` : 'Refund'}
        footer={<>
          <button className="btn btn-light" onClick={() => setRefundFor(null)}>Cancel</button>
          <button className="btn btn-danger" disabled={actionBusy} onClick={confirmRefund}>
            {actionBusy ? 'Processing…' : 'Refund'}
          </button>
        </>}
      >
        {refundFor && (
          <div>
            <FormErrorBanner error={refundFormError} />
            <p className="mb-2">
              Captured amount: <strong>{fmtMoney(refundFor.amount)}</strong>
              {refundFor.invoice_number && <> on invoice <strong>{refundFor.invoice_number}</strong></>}
            </p>
            <label className="form-label">Refund amount</label>
            <div className="input-group">
              <span className="input-group-text">$</span>
              <input
                type="number"
                step="0.01"
                min="0"
                className="form-control"
                value={refundAmount}
                onChange={(e) => setRefundAmount(e.target.value)}
                autoFocus
              />
            </div>
            <small className="text-muted">Leave at the captured amount for a full refund, or enter a smaller value for a partial refund.</small>
          </div>
        )}
      </Modal>

      {confirmDialog}
      {promptDialog}
    </div>
  );
}
