import { useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import api from '../../api/client.js';
import PageHeader from '../../components/PageHeader.jsx';
import Modal from '../../components/Modal.jsx';
import FormErrorBanner from '../../components/FormErrorBanner.jsx';
import SavedPaymentMethods from '../components/SavedPaymentMethods.jsx';
import { toast } from '../../components/Toast.jsx';
import { parseApiError } from '../../utils/apiError.js';
import { formatGateway } from '../../utils/gateway.js';
import { useConfirm } from '../../hooks/useConfirm.jsx';
import { useAuth } from '../../auth/AuthContext.jsx';
import { isOneTimeMembership, wontRenew } from '../../utils/membershipTerms.js';

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

export default function SubscriptionDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { can } = useAuth();
  const { confirm, dialog: confirmDialog } = useConfirm();
  const [data, setData] = useState(null);
  const [running, setRunning] = useState(false);
  const [msg, setMsg] = useState('');
  const [showEdit, setShowEdit] = useState(false);
  const [editForm, setEditForm] = useState(null);
  const [editError, setEditError] = useState('');

  async function load() {
    const { data } = await api.get(`/subscriptions/${id}`);
    setData(data);
  }
  useEffect(() => { load().catch(() => {}); }, [id]);

  function openEdit() {
    setEditForm({
      name: sub.name,
      interval_unit: sub.interval_unit,
      interval_count: sub.interval_count,
      end_date: sub.end_date || '',
      tax_rate: sub.tax_rate,
      discount_rate: sub.discount_rate,
      auto_charge: !!sub.auto_charge,
      gateway: sub.gateway,
      gateway_profile_id: sub.gateway_profile_id || '',
    });
    setEditError('');
    setShowEdit(true);
  }

  async function saveEdit() {
    if (editForm.auto_charge && !editForm.gateway_profile_id) {
      setEditError('Select a saved payment method to auto-charge, or turn off auto-charge.');
      return;
    }
    try {
      await api.put(`/subscriptions/${id}`, {
        name: editForm.name,
        interval_unit: editForm.interval_unit,
        interval_count: Number(editForm.interval_count || 1),
        end_date: editForm.end_date || null,
        tax_rate: Number(editForm.tax_rate || 0),
        discount_rate: Number(editForm.discount_rate || 0),
        auto_charge: !!editForm.auto_charge,
        gateway: editForm.auto_charge ? editForm.gateway : 'none',
        gateway_profile_id: editForm.auto_charge && editForm.gateway_profile_id ? editForm.gateway_profile_id : null,
      });
      setShowEdit(false);
      load();
    } catch (e) {
      setEditError(parseApiError(e));
    }
  }

  if (!data) return <div className="empty-state">Loading…</div>;
  const { subscription: sub, items, invoices, payments = [] } = data;
  const capturedTotal = payments
    .filter((p) => p.status === 'captured')
    .reduce((a, p) => a + Number(p.amount || 0), 0);
  const subtotal = items.reduce((a, l) => a + Number(l.quantity) * Number(l.unit_price), 0);
  const discount = subtotal * Number(sub.discount_rate || 0) / 100;
  const tax = Math.max(0, subtotal - discount) * Number(sub.tax_rate || 0) / 100;
  const total = Math.max(0, subtotal - discount) + tax;
  const fmt = (n) => `$${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  async function setStatus(s) {
    try {
      await api.put(`/subscriptions/${id}/status`, { status: s });
      load();
    } catch (e) {
      toast(parseApiError(e), 'error');
    }
  }
  async function runNow() {
    setRunning(true); setMsg('');
    try {
      const r = await api.post(`/subscriptions/${id}/run-now`);
      // runSubscription answers 200 with ok:false when it didn't bill — e.g. a
      // one-time membership mid-year ("Nothing to bill — this plan ends …").
      setMsg(r.data.ok
        ? `Invoice ${r.data.invoice_number || `#${r.data.invoiceId}`} generated.`
        : (r.data.reason || r.data.error || `Nothing was billed — this plan is ${r.data.status}.`));
      load();
    } catch (e) {
      setMsg(parseApiError(e, 'Run failed.'));
    } finally { setRunning(false); }
  }
  async function remove() {
    if (!(await confirm(`Delete recurring plan "${sub.name}"? All line items will be removed.`, { danger: true }))) return;
    try {
      await api.delete(`/subscriptions/${id}`);
      navigate('/admin/subscriptions');
    } catch (e) {
      toast(parseApiError(e), 'error');
    }
  }

  return (
    <div>
      <PageHeader
        title={sub.name}
        subtitle={<span>
          {wontRenew(sub)
            ? `${isOneTimeMembership(sub) ? 'One-time membership' : `Every ${sub.interval_count} ${sub.interval_unit}(s)`} · Ends ${sub.end_date}`
            : `Every ${sub.interval_count} ${sub.interval_unit}(s) · Next run ${sub.next_run_date || '—'}`}
          <span className={`badge bg-${STATUS_TONE[sub.status]}-subtle text-${STATUS_TONE[sub.status]} ms-2`}>{sub.status}</span>
        </span>}
        actions={<>
          <Link to="/admin/subscriptions" className="btn btn-light">← Back</Link>
          {can('subscriptions.write') && (
            <>
              {['active', 'paused'].includes(sub.status) && (
                <button className="btn btn-light ms-2" onClick={openEdit}>
                  <iconify-icon icon="solar:pen-line-duotone" class="me-1"></iconify-icon> Edit
                </button>
              )}
              {sub.status === 'active' && (
                <button className="btn btn-primary ms-2" onClick={runNow} disabled={running}>
                  <iconify-icon icon="solar:play-line-duotone" class="me-1"></iconify-icon>
                  {running ? 'Running…' : 'Run now'}
                </button>
              )}
              {sub.status === 'active'
                ? <button className="btn btn-light ms-2" onClick={() => setStatus('paused')}>Pause</button>
                : sub.status === 'paused'
                  ? <button className="btn btn-light ms-2" onClick={() => setStatus('active')}>Resume</button>
                  : null}
              {sub.status !== 'canceled' && (
                <button className="btn btn-light text-warning ms-2" onClick={() => setStatus('canceled')}>Cancel</button>
              )}
              <button className="btn btn-light text-danger ms-2" onClick={remove}>
                <iconify-icon icon="solar:trash-bin-trash-line-duotone" class="me-1"></iconify-icon> Delete
              </button>
            </>
          )}
        </>}
      />

      {msg && <div className="alert alert-info">{msg}</div>}

      <div className="row">
        <div className="col-lg-4 mb-3">
          <div className="card">
            <div className="card-body">
              <h6 className="fw-bold text-uppercase small text-muted">Details</h6>
              <dl className="row mb-0">
                <dt className="col-5">Currency</dt><dd className="col-7">{sub.currency}</dd>
                <dt className="col-5">Start</dt><dd className="col-7">{sub.start_date}</dd>
                <dt className="col-5">End</dt><dd className="col-7">{sub.end_date || '—'}</dd>
                <dt className="col-5">Auto-charge</dt><dd className="col-7">{sub.auto_charge ? 'Yes' : 'No'}</dd>
                <dt className="col-5">Gateway</dt><dd className="col-7">{formatGateway(sub.gateway)}</dd>
                <dt className="col-5">Tax / Discount</dt>
                <dd className="col-7">{Number(sub.tax_rate)}% / {Number(sub.discount_rate)}%</dd>
              </dl>
            </div>
          </div>

          <div className="card mt-3">
            <div className="card-body">
              <h6 className="fw-bold text-uppercase small text-muted">Per-period total</h6>
              <div className="d-flex justify-content-between"><span>Subtotal</span><strong>{fmt(subtotal)}</strong></div>
              <div className="d-flex justify-content-between"><span>Discount</span><strong>−{fmt(discount)}</strong></div>
              <div className="d-flex justify-content-between"><span>Tax</span><strong>{fmt(tax)}</strong></div>
              <hr className="my-2" />
              <div className="d-flex justify-content-between fs-5"><span>Per run</span><strong>{fmt(total)}</strong></div>
            </div>
          </div>
        </div>

        <div className="col-lg-8">
          <div className="card">
            <div className="card-body">
              <h6 className="fw-bold text-uppercase small text-muted">Line Items</h6>
              <div className="table-responsive">
                <table className="table align-middle mb-0">
                  <thead>
                    <tr>
                      <th>Description</th>
                      <th className="text-end" style={{ width: 100 }}>Qty</th>
                      <th className="text-end" style={{ width: 140 }}>Unit Price</th>
                      <th className="text-end" style={{ width: 140 }}>Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((l) => (
                      <tr key={l.id}>
                        <td>{l.description}</td>
                        <td className="text-end">{Number(l.quantity)}</td>
                        <td className="text-end">{fmt(l.unit_price)}</td>
                        <td className="text-end fw-semibold">{fmt(Number(l.quantity) * Number(l.unit_price))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <div className="card mt-3">
            <div className="card-body">
              <h6 className="fw-bold text-uppercase small text-muted">Invoices generated</h6>
              {invoices?.length ? (
                <div className="table-responsive">
                  <table className="table table-sm align-middle mb-0">
                    <thead>
                      <tr><th>Number</th><th>Issued</th><th className="text-end">Total</th><th className="text-end">Balance</th><th>Status</th></tr>
                    </thead>
                    <tbody>
                      {invoices.map((i) => (
                        <tr key={i.id}>
                          <td><Link to={`/admin/invoices/${i.id}`}>{i.invoice_number}</Link></td>
                          <td>{i.issue_date}</td>
                          <td className="text-end">{fmt(i.total)}</td>
                          <td className="text-end">{fmt(i.balance_due)}</td>
                          <td><span className="badge bg-primary-subtle text-primary">{i.status}</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : <div className="text-muted small">No invoices generated yet.</div>}
            </div>
          </div>

          <div className="card mt-3">
            <div className="card-body">
              <div className="d-flex justify-content-between align-items-center mb-2">
                <h6 className="fw-bold text-uppercase small text-muted mb-0">Transactions ran for this plan</h6>
                {capturedTotal > 0 && (
                  <span className="badge bg-success-subtle text-success">
                    {fmt(capturedTotal)} captured
                  </span>
                )}
              </div>
              {payments.length ? (
                <div className="table-responsive">
                  <table className="table table-sm align-middle mb-0">
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Invoice</th>
                        <th>Gateway</th>
                        <th>Method</th>
                        <th>Card</th>
                        <th className="text-end">Amount</th>
                        <th>Status</th>
                        <th>Txn ID</th>
                      </tr>
                    </thead>
                    <tbody>
                      {payments.map((p) => {
                        const when = p.received_at || p.created_at;
                        return (
                          <tr key={p.id}>
                            <td>{when ? new Date(when).toLocaleString() : '—'}</td>
                            <td>
                              {p.invoice_number
                                ? <Link to={`/admin/invoices/${p.invoice_id}`}>{p.invoice_number}</Link>
                                : '—'}
                            </td>
                            <td className="small">{formatGateway(p.gateway)}</td>
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
                            <td className="font-monospace small text-muted">{p.external_txn_id || '—'}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : <div className="text-muted small">No transactions have run for this recurring plan yet.</div>}
            </div>
          </div>
        </div>
      </div>

      <Modal show={showEdit} onClose={() => setShowEdit(false)} title="Edit Recurring Plan" size="lg"
        footer={<><button className="btn btn-light" onClick={() => setShowEdit(false)}>Cancel</button>
                  <button className="btn btn-primary" onClick={saveEdit}>Save</button></>}>
        {editForm && (
          <>
            <FormErrorBanner error={editError} />
            <div className="row g-2">
              <div className="col-12"><label className="form-label">Name</label>
                <input className="form-control" value={editForm.name}
                  onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} /></div>
              <div className="col-md-3"><label className="form-label">Every</label>
                <input type="number" min="1" className="form-control" value={editForm.interval_count}
                  onChange={(e) => setEditForm({ ...editForm, interval_count: e.target.value })} /></div>
              <div className="col-md-3"><label className="form-label">Interval</label>
                <select className="form-select" value={editForm.interval_unit}
                  onChange={(e) => setEditForm({ ...editForm, interval_unit: e.target.value })}>
                  {['day', 'week', 'month', 'year'].map((u) => <option key={u} value={u}>{u}(s)</option>)}
                </select></div>
              <div className="col-md-3"><label className="form-label">End date (optional)</label>
                <input type="date" className="form-control" value={editForm.end_date}
                  onChange={(e) => setEditForm({ ...editForm, end_date: e.target.value })} /></div>
              <div className="col-md-3"><label className="form-label">Tax %</label>
                <input type="number" step="0.001" className="form-control" value={editForm.tax_rate}
                  onChange={(e) => setEditForm({ ...editForm, tax_rate: e.target.value })} /></div>
              <div className="col-md-3"><label className="form-label">Discount %</label>
                <input type="number" step="0.001" className="form-control" value={editForm.discount_rate}
                  onChange={(e) => setEditForm({ ...editForm, discount_rate: e.target.value })} /></div>

              <div className="col-12 mt-1">
                <h6 className="fw-bold text-uppercase small text-muted mb-1">Auto-charge</h6>
              </div>
              <div className="col-12">
                <div className="form-check form-switch mb-2">
                  <input className="form-check-input" type="checkbox" id="edit_sub_auto_charge"
                    checked={!!editForm.auto_charge}
                    onChange={(e) => setEditForm({ ...editForm, auto_charge: e.target.checked })} />
                  <label className="form-check-label" htmlFor="edit_sub_auto_charge">
                    Automatically charge a saved card or bank account (eCheck) each run
                  </label>
                </div>
                {editForm.auto_charge && (
                  <div className="border rounded p-3 bg-light">
                    <div className="small fw-semibold mb-2">Select payment method to charge:</div>
                    <SavedPaymentMethods
                      contactId={sub.contact_id ? Number(sub.contact_id) : null}
                      organizationId={sub.organization_id ? Number(sub.organization_id) : null}
                      selectable
                      selectedId={editForm.gateway_profile_id ? Number(editForm.gateway_profile_id) : null}
                      onSelect={(profile) => setEditForm({
                        ...editForm,
                        gateway: profile.gateway,
                        gateway_profile_id: String(profile.id),
                      })}
                    />
                    {editForm.gateway_profile_id && (
                      <div className="text-muted small mt-1">
                        Profile #{editForm.gateway_profile_id} selected · gateway: {editForm.gateway || '—'}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </Modal>

      {confirmDialog}
    </div>
  );
}
