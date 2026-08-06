import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../../../api/client.js';
import Modal from '../../../components/Modal.jsx';
import { useConfirm } from '../../../hooks/useConfirm.jsx';
import { toast } from '../../../components/Toast.jsx';
import { parseApiError } from '../../../utils/apiError.js';

const STATUS_TONE = {
  active: 'success', paused: 'warning', canceled: 'danger', completed: 'secondary',
};

const TXN_TONE = {
  pending: 'warning',
  authorized: 'info',
  captured: 'success',
  failed: 'danger',
  refunded: 'secondary',
  voided: 'secondary',
};

function fmt(n) {
  return `$${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function PortalSubscriptions() {
  const [rows, setRows] = useState([]);
  const [active, setActive] = useState(null);   // currently-viewed subscription detail
  const [loading, setLoading] = useState(false);
  const [updating, setUpdating] = useState(false);
  const { confirm, dialog: confirmDialog } = useConfirm();

  function load() {
    api.get('/portal/subscriptions').then((r) => setRows(r.data.rows || [])).catch(() => {});
  }
  useEffect(() => { load(); }, []);

  async function openDetail(id) {
    setLoading(true);
    setActive({ id });
    try {
      const { data } = await api.get(`/portal/subscriptions/${id}`);
      setActive(data);
    } catch (_e) {
      setActive(null);
    } finally {
      setLoading(false);
    }
  }

  function closeDetail() {
    setActive(null);
  }

  async function setStatus(status) {
    if (status === 'canceled') {
      if (!(await confirm('Cancel this recurring plan? This can\'t be undone — you\'d need to set up a new gift to restart it.', { danger: true, confirmLabel: 'Cancel Plan' }))) return;
    }
    setUpdating(true);
    try {
      await api.put(`/portal/subscriptions/${active.subscription.id}/status`, { status });
      toast(status === 'canceled' ? 'Plan canceled.' : status === 'paused' ? 'Plan paused.' : 'Plan resumed.', 'success');
      load();
      openDetail(active.subscription.id);
    } catch (e) {
      toast(parseApiError(e), 'error');
    } finally {
      setUpdating(false);
    }
  }

  return (
    <div>
      <h3 className="fw-bolder mb-1">Subscriptions</h3>
      <p className="text-muted">Your active recurring plans.</p>

      <div className="card">
        <div className="card-body">
          <div className="table-responsive">
            <table className="table align-middle mb-0">
              <thead>
                <tr>
                  <th>Plan</th>
                  <th>Interval</th>
                  <th className="text-end">Amount</th>
                  <th className="text-end">Transactions</th>
                  <th>Next run</th>
                  <th>Status</th>
                  <th style={{ width: 110 }} className="text-end">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((s) => (
                  <tr key={s.id}>
                    <td className="fw-semibold">{s.name}</td>
                    <td>Every {s.interval_count} {s.interval_unit}(s)</td>
                    <td className="text-end fw-semibold">
                      {fmt(s.per_run_total)}
                      <div className="text-muted small fw-normal">{s.currency || 'USD'} / run</div>
                    </td>
                    <td className="text-end">
                      <span className="badge bg-light text-dark">{Number(s.payment_count || 0)}</span>
                      {Number(s.captured_total || 0) > 0 && (
                        <div className="text-success small">{fmt(s.captured_total)} captured</div>
                      )}
                    </td>
                    <td>{s.next_run_date || '—'}</td>
                    <td>
                      <span className={`badge bg-${STATUS_TONE[s.status]}-subtle text-${STATUS_TONE[s.status]}`}>
                        {s.status}
                      </span>
                    </td>
                    <td className="text-end">
                      <button type="button" className="btn btn-sm btn-light" onClick={() => openDetail(s.id)}>
                        <iconify-icon icon="solar:eye-line-duotone" class="me-1"></iconify-icon>
                        View
                      </button>
                    </td>
                  </tr>
                ))}
                {rows.length === 0 && <tr><td colSpan="7"><div className="empty-state">No subscriptions yet.</div></td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <Modal
        show={!!active}
        onClose={closeDetail}
        size="lg"
        title={active?.subscription?.name || 'Subscription'}
        footer={<>
          {active?.subscription && !['canceled', 'completed'].includes(active.subscription.status) && (
            <>
              <button className="btn btn-outline-danger" disabled={updating} onClick={() => setStatus('canceled')}>
                Cancel Plan
              </button>
              <button className="btn btn-outline-secondary" disabled={updating} onClick={() => setStatus(active.subscription.status === 'paused' ? 'active' : 'paused')}>
                {active.subscription.status === 'paused' ? 'Resume' : 'Pause'}
              </button>
            </>
          )}
          <button className="btn btn-light" onClick={closeDetail}>Close</button>
        </>}
      >
        {loading && <div className="text-muted">Loading…</div>}

        {active?.subscription && (
          <>
            <div className="row mb-3">
              <div className="col-md-6">
                <dl className="row mb-0 small">
                  <dt className="col-5">Status</dt>
                  <dd className="col-7">
                    <span className={`badge bg-${STATUS_TONE[active.subscription.status]}-subtle text-${STATUS_TONE[active.subscription.status]}`}>
                      {active.subscription.status}
                    </span>
                  </dd>
                  <dt className="col-5">Interval</dt>
                  <dd className="col-7">Every {active.subscription.interval_count} {active.subscription.interval_unit}(s)</dd>
                  <dt className="col-5">Start</dt>
                  <dd className="col-7">{active.subscription.start_date || '—'}</dd>
                  <dt className="col-5">Next run</dt>
                  <dd className="col-7">{active.subscription.next_run_date || '—'}</dd>
                  <dt className="col-5">End</dt>
                  <dd className="col-7">{active.subscription.end_date || '—'}</dd>
                </dl>
              </div>
              <div className="col-md-6">
                <div className="bg-light rounded p-3 h-100">
                  <div className="text-muted small text-uppercase fw-bold">Per run</div>
                  {(() => {
                    const items = active.items || [];
                    const subtotal = items.reduce((a, l) => a + Number(l.quantity) * Number(l.unit_price), 0);
                    const discount = subtotal * Number(active.subscription.discount_rate || 0) / 100;
                    const tax = Math.max(0, subtotal - discount) * Number(active.subscription.tax_rate || 0) / 100;
                    const total = Math.max(0, subtotal - discount) + tax;
                    return (
                      <>
                        <div className="d-flex justify-content-between"><span>Subtotal</span><span>{fmt(subtotal)}</span></div>
                        {Number(active.subscription.discount_rate) > 0 && (
                          <div className="d-flex justify-content-between"><span>Discount</span><span>−{fmt(discount)}</span></div>
                        )}
                        {Number(active.subscription.tax_rate) > 0 && (
                          <div className="d-flex justify-content-between"><span>Tax</span><span>{fmt(tax)}</span></div>
                        )}
                        <hr className="my-2" />
                        <div className="d-flex justify-content-between fs-5"><span>Total</span><strong>{fmt(total)}</strong></div>
                      </>
                    );
                  })()}
                </div>
              </div>
            </div>

            <h6 className="fw-bold text-uppercase small text-muted">Line items</h6>
            <div className="table-responsive mb-3">
              <table className="table table-sm align-middle mb-0">
                <thead>
                  <tr>
                    <th>Description</th>
                    <th className="text-end" style={{ width: 80 }}>Qty</th>
                    <th className="text-end" style={{ width: 120 }}>Unit</th>
                    <th className="text-end" style={{ width: 120 }}>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {(active.items || []).map((l) => (
                    <tr key={l.id}>
                      <td>{l.description}</td>
                      <td className="text-end">{Number(l.quantity)}</td>
                      <td className="text-end">{fmt(l.unit_price)}</td>
                      <td className="text-end fw-semibold">{fmt(Number(l.quantity) * Number(l.unit_price))}</td>
                    </tr>
                  ))}
                  {(!active.items || active.items.length === 0) && (
                    <tr><td colSpan="4" className="text-muted small">No line items.</td></tr>
                  )}
                </tbody>
              </table>
            </div>

            <h6 className="fw-bold text-uppercase small text-muted">Transactions ran for this plan</h6>
            <div className="table-responsive">
              <table className="table table-sm align-middle mb-0">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Invoice</th>
                    <th>Method</th>
                    <th>Card</th>
                    <th className="text-end">Amount</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {(active.payments || []).map((p) => {
                    const when = p.received_at || p.created_at;
                    return (
                      <tr key={p.id}>
                        <td>{when ? new Date(when).toLocaleString() : '—'}</td>
                        <td>
                          {p.invoice_number
                            ? <Link to={`/portal/invoices/${p.invoice_id}`} onClick={closeDetail}>{p.invoice_number}</Link>
                            : '—'}
                        </td>
                        <td className="text-capitalize small">{p.method}</td>
                        <td className="small text-muted">
                          {p.card_brand ? `${p.card_brand} •••• ${p.card_last4 || ''}` : '—'}
                        </td>
                        <td className="text-end fw-semibold">{fmt(p.amount)}</td>
                        <td>
                          <span className={`badge bg-${TXN_TONE[p.status] || 'secondary'}-subtle text-${TXN_TONE[p.status] || 'secondary'}`}>
                            {p.status}
                          </span>
                          {p.refund_amount && Number(p.refund_amount) > 0 && (
                            <div className="text-muted small">refund {fmt(p.refund_amount)}</div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  {(!active.payments || active.payments.length === 0) && (
                    <tr><td colSpan="6" className="text-muted small">No transactions have run for this plan yet.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Modal>
      {confirmDialog}
    </div>
  );
}
