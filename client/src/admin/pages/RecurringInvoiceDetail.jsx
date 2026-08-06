import { useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import api from '../../api/client.js';
import PageHeader from '../../components/PageHeader.jsx';
import Modal from '../../components/Modal.jsx';
import SearchableSelect from '../../components/SearchableSelect.jsx';
import SavedPaymentMethods from '../components/SavedPaymentMethods.jsx';
import FormErrorBanner from '../../components/FormErrorBanner.jsx';
import { toast } from '../../components/Toast.jsx';
import { parseApiError } from '../../utils/apiError.js';
import { useConfirm } from '../../hooks/useConfirm.jsx';
import { useAuth } from '../../auth/AuthContext.jsx';

const STATUS_TONE = {
  active: 'success', paused: 'warning', completed: 'secondary', canceled: 'danger',
};
const INV_STATUS_TONE = {
  draft: 'secondary', sent: 'primary', partial: 'warning',
  paid: 'success', overdue: 'danger', void: 'dark', refunded: 'info',
};
const TXN_TONE = {
  pending: 'warning', authorized: 'info', captured: 'success',
  failed: 'danger', refunded: 'secondary', voided: 'secondary',
};

function fmtMoney(n) {
  return `$${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function blankItem(sort) {
  return { description: '', quantity: 1, unit_price: 0, sort_order: sort };
}

export default function RecurringInvoiceDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { can } = useAuth();
  const { confirm, dialog: confirmDialog } = useConfirm();
  const [data, setData] = useState(null);
  const [running, setRunning] = useState(false);
  const [msg, setMsg] = useState('');
  const [editShow, setEditShow] = useState(false);
  const [editForm, setEditForm] = useState(null);
  const [editFormError, setEditFormError] = useState('');
  const [contacts, setContacts] = useState([]);
  const [orgs, setOrgs] = useState([]);

  async function load() {
    const { data: d } = await api.get(`/recurring-invoices/${id}`);
    setData(d);
  }
  useEffect(() => { load().catch(() => {}); /* eslint-disable-next-line */ }, [id]);
  useEffect(() => {
    api.get('/contacts', { params: { pageSize: 500 } }).then((r) => setContacts(r.data.rows)).catch(() => {});
    api.get('/organizations', { params: { pageSize: 500 } }).then((r) => setOrgs(r.data.rows)).catch(() => {});
  }, []);

  if (!data) return <div className="empty-state">Loading…</div>;

  const { recurring_invoice: ri, items, invoices = [], payments = [] } = data;

  const subtotal = items.reduce((a, l) => a + Number(l.quantity) * Number(l.unit_price), 0);
  const discount = subtotal * Number(ri.discount_rate || 0) / 100;
  const tax = Math.max(0, subtotal - discount) * Number(ri.tax_rate || 0) / 100;
  const total = Math.max(0, subtotal - discount) + tax;
  const capturedTotal = payments.filter((p) => p.status === 'captured').reduce((a, p) => a + Number(p.amount || 0), 0);
  const totalBilled = invoices.reduce((a, i) => a + Number(i.total || 0), 0);
  const totalOutstanding = invoices.reduce((a, i) => a + Number(i.balance_due || 0), 0);

  async function runNow() {
    setRunning(true); setMsg('');
    try {
      const r = await api.post(`/recurring-invoices/${id}/run-now`);
      setMsg(`Invoice ${r.data.invoice_number || `#${r.data.invoiceId}`} generated ($${Number(r.data.total || 0).toFixed(2)}).`);
      load();
    } catch (e) {
      setMsg(parseApiError(e, 'Run failed.'));
    } finally { setRunning(false); }
  }

  async function setStatus(action) {
    try {
      await api.post(`/recurring-invoices/${id}/${action}`);
      load();
    } catch (e) {
      toast(parseApiError(e), 'error');
    }
  }

  async function remove() {
    if (!(await confirm(`Delete recurring invoice "${ri.name}"?`, { danger: true }))) return;
    try {
      await api.delete(`/recurring-invoices/${id}`);
      navigate('/admin/recurring-invoices');
    } catch (e) {
      toast(parseApiError(e), 'error');
    }
  }

  function openEdit() {
    setEditForm({
      name: ri.name,
      contact_id: ri.contact_id ? String(ri.contact_id) : '',
      organization_id: ri.organization_id ? String(ri.organization_id) : '',
      interval_unit: ri.interval_unit,
      interval_count: ri.interval_count,
      start_date: ri.start_date,
      next_run_date: ri.next_run_date,
      end_date: ri.end_date || '',
      max_occurrences: ri.max_occurrences || '',
      due_days: ri.due_days ?? 14,
      tax_rate: ri.tax_rate,
      discount_rate: ri.discount_rate,
      auto_pay: !!ri.auto_pay,
      gateway: ri.gateway || '',
      gateway_profile_id: ri.gateway_profile_id || '',
      memo: ri.memo || '',
      terms: ri.terms || '',
      items: items.map((l) => ({ ...l })),
    });
    setEditFormError('');
    setEditShow(true);
  }

  function updateEditItem(i, patch) {
    const arr = editForm.items.slice();
    arr[i] = { ...arr[i], ...patch };
    setEditForm({ ...editForm, items: arr });
  }
  function addEditItem() {
    setEditForm({ ...editForm, items: [...editForm.items, blankItem(editForm.items.length)] });
  }
  function removeEditItem(i) {
    const arr = editForm.items.slice();
    arr.splice(i, 1);
    setEditForm({ ...editForm, items: arr.length ? arr : [blankItem(0)] });
  }

  async function saveEdit() {
    const editItems = editForm.items
      .filter((l) => l.description && Number(l.quantity) > 0)
      .map((l, idx) => ({
        description: l.description,
        quantity: Number(l.quantity),
        unit_price: Number(l.unit_price),
        sort_order: idx,
      }));
    if (editItems.length === 0) { setEditFormError('Add at least one line item.'); return; }
    setEditFormError('');
    const payload = {
      name: editForm.name,
      contact_id: editForm.contact_id ? Number(editForm.contact_id) : null,
      organization_id: editForm.organization_id ? Number(editForm.organization_id) : null,
      interval_unit: editForm.interval_unit,
      interval_count: Number(editForm.interval_count || 1),
      start_date: editForm.start_date,
      next_run_date: editForm.next_run_date,
      end_date: editForm.end_date || null,
      max_occurrences: editForm.max_occurrences ? Number(editForm.max_occurrences) : null,
      due_days: Number(editForm.due_days || 14),
      tax_rate: Number(editForm.tax_rate || 0),
      discount_rate: Number(editForm.discount_rate || 0),
      auto_pay: !!editForm.auto_pay,
      gateway: editForm.gateway || null,
      gateway_profile_id: editForm.gateway_profile_id || null,
      memo: editForm.memo || null,
      terms: editForm.terms || null,
      items: editItems,
    };
    try {
      await api.put(`/recurring-invoices/${id}`, payload);
      setEditShow(false);
      load();
    } catch (err) {
      setEditFormError(parseApiError(err));
    }
  }

  const isActive = ri.status === 'active';
  const isPaused = ri.status === 'paused';
  const isEditable = ri.status !== 'canceled';

  return (
    <div>
      <PageHeader
        title={ri.name}
        subtitle={
          <span>
            Every {ri.interval_count} {ri.interval_unit}(s) · Next run {ri.next_run_date || '—'}
            {ri.max_occurrences && (
              <span className="ms-2 text-muted small">
                {ri.occurrences_run} / {ri.max_occurrences} occurrences
              </span>
            )}
            <span className={`badge bg-${STATUS_TONE[ri.status]}-subtle text-${STATUS_TONE[ri.status]} ms-2`}>
              {ri.status}
            </span>
          </span>
        }
        actions={<>
          <Link to="/admin/recurring-invoices" className="btn btn-light">← Back</Link>
          {can('invoices.write') && (
            <>
              {isActive && (
                <button className="btn btn-primary ms-2" onClick={runNow} disabled={running}>
                  <iconify-icon icon="solar:play-line-duotone" class="me-1"></iconify-icon>
                  {running ? 'Running…' : 'Run now'}
                </button>
              )}
              {isEditable && (
                <button className="btn btn-light ms-2" onClick={openEdit}>
                  <iconify-icon icon="solar:pen-line-duotone" class="me-1"></iconify-icon> Edit
                </button>
              )}
              {isActive && (
                <button className="btn btn-light ms-2" onClick={() => setStatus('pause')}>Pause</button>
              )}
              {isPaused && (
                <button className="btn btn-success ms-2" onClick={() => setStatus('resume')}>Resume</button>
              )}
              {(isActive || isPaused) && (
                <button className="btn btn-light text-warning ms-2" onClick={() => setStatus('cancel')}>Cancel</button>
              )}
              <button className="btn btn-light text-danger ms-2" onClick={remove}>
                <iconify-icon icon="solar:trash-bin-trash-line-duotone" class="me-1"></iconify-icon> Delete
              </button>
            </>
          )}
        </>}
      />

      {msg && <div className="alert alert-info alert-dismissible">
        {msg}
        <button type="button" className="btn-close" onClick={() => setMsg('')}></button>
      </div>}

      <div className="row">
        <div className="col-lg-4 mb-3">
          {/* Details */}
          <div className="card mb-3">
            <div className="card-body">
              <h6 className="fw-bold text-uppercase small text-muted">Details</h6>
              <dl className="row mb-0 small">
                <dt className="col-5">Customer</dt>
                <dd className="col-7">{ri.contact_name || ri.organization_name || '—'}</dd>
                <dt className="col-5">Currency</dt>
                <dd className="col-7">{ri.currency}</dd>
                <dt className="col-5">Start</dt>
                <dd className="col-7">{ri.start_date}</dd>
                {ri.end_date && <><dt className="col-5">End</dt><dd className="col-7">{ri.end_date}</dd></>}
                <dt className="col-5">Occurrences</dt>
                <dd className="col-7">
                  {Number(ri.occurrences_run || 0)}
                  {ri.max_occurrences ? ` of ${ri.max_occurrences}` : ' (unlimited)'}
                </dd>
                <dt className="col-5">Due days</dt>
                <dd className="col-7">{ri.due_days} days after issue</dd>
                <dt className="col-5">Tax / Disc</dt>
                <dd className="col-7">{Number(ri.tax_rate)}% / {Number(ri.discount_rate)}%</dd>
                <dt className="col-5">Auto-pay</dt>
                <dd className="col-7">
                  {ri.auto_pay
                    ? <span className="badge bg-success-subtle text-success">
                        <iconify-icon icon="solar:card-line-duotone" class="me-1"></iconify-icon>
                        {ri.gateway || 'enabled'}
                      </span>
                    : <span className="text-muted">Off</span>}
                </dd>
              </dl>
            </div>
          </div>

          {/* Per-run totals */}
          <div className="card mb-3">
            <div className="card-body">
              <h6 className="fw-bold text-uppercase small text-muted">Per-run total</h6>
              <div className="d-flex justify-content-between small"><span>Subtotal</span><strong>{fmtMoney(subtotal)}</strong></div>
              <div className="d-flex justify-content-between small"><span>Discount</span><strong>−{fmtMoney(discount)}</strong></div>
              <div className="d-flex justify-content-between small"><span>Tax</span><strong>{fmtMoney(tax)}</strong></div>
              <hr className="my-2" />
              <div className="d-flex justify-content-between fs-6"><span>Per run</span><strong>{fmtMoney(total)}</strong></div>
            </div>
          </div>

          {/* Series summary */}
          <div className="card mb-3">
            <div className="card-body">
              <h6 className="fw-bold text-uppercase small text-muted">Series totals</h6>
              <div className="d-flex justify-content-between small"><span>Total billed</span><strong>{fmtMoney(totalBilled)}</strong></div>
              <div className="d-flex justify-content-between small"><span>Total collected</span><strong className="text-success">{fmtMoney(capturedTotal)}</strong></div>
              <div className="d-flex justify-content-between small"><span>Outstanding</span><strong className={totalOutstanding > 0 ? 'text-warning' : ''}>{fmtMoney(totalOutstanding)}</strong></div>
            </div>
          </div>

          {/* Saved payment methods */}
          {(ri.contact_id || ri.organization_id) && (
            <div className="card">
              <div className="card-body">
                <h6 className="fw-bold text-uppercase small text-muted mb-2">Payment Methods on File</h6>
                <SavedPaymentMethods
                  contactId={ri.contact_id}
                  organizationId={ri.organization_id}
                />
              </div>
            </div>
          )}
        </div>

        <div className="col-lg-8">
          {/* Line items */}
          <div className="card mb-3">
            <div className="card-body">
              <h6 className="fw-bold text-uppercase small text-muted">Line Items (template)</h6>
              <table className="table align-middle mb-0 small">
                <thead>
                  <tr>
                    <th>Description</th>
                    <th className="text-end" style={{ width: 80 }}>Qty</th>
                    <th className="text-end" style={{ width: 120 }}>Unit price</th>
                    <th className="text-end" style={{ width: 120 }}>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((l) => (
                    <tr key={l.id}>
                      <td>{l.description}</td>
                      <td className="text-end">{Number(l.quantity)}</td>
                      <td className="text-end">{fmtMoney(l.unit_price)}</td>
                      <td className="text-end fw-semibold">{fmtMoney(Number(l.quantity) * Number(l.unit_price))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Generated invoices */}
          <div className="card mb-3">
            <div className="card-body">
              <h6 className="fw-bold text-uppercase small text-muted">Invoices generated</h6>
              {invoices.length ? (
                <div className="table-responsive">
                  <table className="table table-sm align-middle mb-0 small">
                    <thead>
                      <tr>
                        <th>Number</th><th>Issued</th><th>Due</th>
                        <th className="text-end">Total</th><th className="text-end">Balance</th><th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {invoices.map((inv) => (
                        <tr key={inv.id}>
                          <td><Link to={`/admin/invoices/${inv.id}`} className="fw-semibold">{inv.invoice_number}</Link></td>
                          <td>{inv.issue_date}</td>
                          <td>{inv.due_date}</td>
                          <td className="text-end">{fmtMoney(inv.total)}</td>
                          <td className="text-end">{fmtMoney(inv.balance_due)}</td>
                          <td>
                            <span className={`badge bg-${INV_STATUS_TONE[inv.status] || 'secondary'}-subtle text-${INV_STATUS_TONE[inv.status] || 'secondary'}`}>
                              {inv.status}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : <div className="text-muted small">No invoices generated yet.</div>}
            </div>
          </div>

          {/* Payment transactions */}
          <div className="card">
            <div className="card-body">
              <div className="d-flex justify-content-between align-items-center mb-2">
                <h6 className="fw-bold text-uppercase small text-muted mb-0">Transactions</h6>
                {capturedTotal > 0 && (
                  <span className="badge bg-success-subtle text-success">{fmtMoney(capturedTotal)} captured</span>
                )}
              </div>
              {payments.length ? (
                <div className="table-responsive">
                  <table className="table table-sm align-middle mb-0 small">
                    <thead>
                      <tr>
                        <th>Date</th><th>Invoice</th><th>Gateway</th><th>Card</th>
                        <th className="text-end">Amount</th><th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {payments.map((p) => (
                        <tr key={p.id}>
                          <td>{p.received_at ? new Date(p.received_at).toLocaleDateString() : '—'}</td>
                          <td>
                            {p.invoice_number
                              ? <Link to={`/admin/invoices/${p.invoice_id}`}>{p.invoice_number}</Link>
                              : '—'}
                          </td>
                          <td className="text-uppercase">{p.gateway}</td>
                          <td className="text-muted">
                            {p.card_brand ? `${p.card_brand} ••••${p.card_last4 || ''}` : p.method || '—'}
                          </td>
                          <td className="text-end fw-semibold">{fmtMoney(p.amount)}</td>
                          <td>
                            <span className={`badge bg-${TXN_TONE[p.status] || 'secondary'}-subtle text-${TXN_TONE[p.status] || 'secondary'}`}>
                              {p.status}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : <div className="text-muted small">No transactions yet.</div>}
            </div>
          </div>
        </div>
      </div>

      {/* ── Edit Modal ── */}
      {editForm && (
        <Modal show={editShow} onClose={() => setEditShow(false)} title={`Edit — ${ri.name}`} size="lg"
          footer={<>
            <button className="btn btn-light" onClick={() => setEditShow(false)}>Cancel</button>
            <button className="btn btn-primary" onClick={saveEdit}>Save changes</button>
          </>}>

          <FormErrorBanner error={editFormError} />
          <div className="row g-2">
            <div className="col-12">
              <label htmlFor="edit-name" className="form-label">Name</label>
              <input id="edit-name" name="edit-name" className="form-control" value={editForm.name}
                onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} />
            </div>
            <div className="col-md-6">
              <label className="form-label">Billed organization</label>
              <SearchableSelect
                options={orgs.map((o) => ({ value: String(o.id), label: o.name }))}
                value={editForm.organization_id ? String(editForm.organization_id) : ''}
                onChange={(v) => setEditForm({ ...editForm, organization_id: v })}
                placeholder="Select organization…"
              />
            </div>
            <div className="col-md-6">
              <label className="form-label">Customer (contact)</label>
              <SearchableSelect
                options={contacts
                  .filter((c) => !editForm.organization_id || String(c.organization_id) === String(editForm.organization_id))
                  .map((c) => ({ value: String(c.id), label: `${c.first_name || ''} ${c.last_name || ''}`.trim() || '(no name)' }))}
                value={editForm.contact_id ? String(editForm.contact_id) : ''}
                onChange={(v) => setEditForm({ ...editForm, contact_id: v })}
                placeholder="Select contact…"
              />
            </div>

            <div className="col-12 mt-1">
              <h6 className="fw-bold text-uppercase small text-muted mb-1">Schedule</h6>
            </div>
            <div className="col-md-2">
              <label htmlFor="edit-interval-count" className="form-label">Every</label>
              <input id="edit-interval-count" name="edit-interval-count" type="number" min="1" className="form-control" value={editForm.interval_count}
                onChange={(e) => setEditForm({ ...editForm, interval_count: e.target.value })} />
            </div>
            <div className="col-md-2">
              <label htmlFor="edit-interval-unit" className="form-label">Interval</label>
              <select id="edit-interval-unit" name="edit-interval-unit" className="form-select" value={editForm.interval_unit}
                onChange={(e) => setEditForm({ ...editForm, interval_unit: e.target.value })}>
                <option value="week">Week(s)</option>
                <option value="month">Month(s)</option>
                <option value="year">Year(s)</option>
              </select>
            </div>
            <div className="col-md-2">
              <label htmlFor="edit-next-run" className="form-label">Next run</label>
              <input id="edit-next-run" name="edit-next-run" type="date" className="form-control" value={editForm.next_run_date}
                onChange={(e) => setEditForm({ ...editForm, next_run_date: e.target.value })} />
            </div>
            <div className="col-md-2">
              <label htmlFor="edit-end-date" className="form-label">End date</label>
              <input id="edit-end-date" name="edit-end-date" type="date" className="form-control" value={editForm.end_date}
                onChange={(e) => setEditForm({ ...editForm, end_date: e.target.value })} />
            </div>
            <div className="col-md-2">
              <label htmlFor="edit-max-occurrences" className="form-label">Max occurrences</label>
              <input id="edit-max-occurrences" name="edit-max-occurrences" type="number" min="1" className="form-control" value={editForm.max_occurrences}
                onChange={(e) => setEditForm({ ...editForm, max_occurrences: e.target.value })} />
            </div>
            <div className="col-md-2">
              <label htmlFor="edit-due-days" className="form-label">Due days</label>
              <input id="edit-due-days" name="edit-due-days" type="number" min="0" className="form-control" value={editForm.due_days}
                onChange={(e) => setEditForm({ ...editForm, due_days: e.target.value })} />
            </div>

            <div className="col-md-3">
              <label htmlFor="edit-tax-rate" className="form-label">Tax %</label>
              <input id="edit-tax-rate" name="edit-tax-rate" type="number" step="0.001" className="form-control" value={editForm.tax_rate}
                onChange={(e) => setEditForm({ ...editForm, tax_rate: e.target.value })} />
            </div>
            <div className="col-md-3">
              <label htmlFor="edit-discount-rate" className="form-label">Discount %</label>
              <input id="edit-discount-rate" name="edit-discount-rate" type="number" step="0.001" className="form-control" value={editForm.discount_rate}
                onChange={(e) => setEditForm({ ...editForm, discount_rate: e.target.value })} />
            </div>

            <div className="col-12 mt-1">
              <h6 className="fw-bold text-uppercase small text-muted mb-1">Auto-pay</h6>
            </div>
            <div className="col-12">
              <div className="form-check form-switch mb-2">
                <input className="form-check-input" type="checkbox" id="ep_auto_pay"
                  checked={!!editForm.auto_pay}
                  onChange={(e) => setEditForm({ ...editForm, auto_pay: e.target.checked })} />
                <label className="form-check-label" htmlFor="ep_auto_pay">
                  Automatically charge payment method on file each run
                </label>
              </div>
              {editForm.auto_pay && (
                <div className="border rounded p-3 bg-light">
                  <div className="small fw-semibold mb-2">Select payment method to charge:</div>
                  <SavedPaymentMethods
                    contactId={editForm.contact_id ? Number(editForm.contact_id) : null}
                    organizationId={editForm.organization_id ? Number(editForm.organization_id) : null}
                    selectable
                    selectedId={editForm.gateway_profile_id ? Number(editForm.gateway_profile_id) : null}
                    onSelect={(profile) => setEditForm({
                      ...editForm,
                      gateway:            profile.gateway,
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

          <h6 className="mt-4 fw-bold text-uppercase small text-muted">Line Items</h6>
          <table className="table table-sm align-middle">
            <thead>
              <tr>
                <th>Description</th>
                <th style={{ width: 90 }}>Qty</th>
                <th style={{ width: 120 }}>Unit price</th>
                <th className="text-end" style={{ width: 120 }}>Amount</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {editForm.items.map((l, i) => (
                <tr key={i}>
                  <td><input name={`edit-item-desc-${i}`} className="form-control form-control-sm" value={l.description}
                    onChange={(e) => updateEditItem(i, { description: e.target.value })} /></td>
                  <td><input name={`edit-item-qty-${i}`} type="number" step="0.01" className="form-control form-control-sm" value={l.quantity}
                    onChange={(e) => updateEditItem(i, { quantity: e.target.value })} /></td>
                  <td><input name={`edit-item-price-${i}`} type="number" step="0.01" className="form-control form-control-sm" value={l.unit_price}
                    onChange={(e) => updateEditItem(i, { unit_price: e.target.value })} /></td>
                  <td className="text-end">${(Number(l.quantity || 0) * Number(l.unit_price || 0)).toFixed(2)}</td>
                  <td><button type="button" className="btn btn-sm btn-light text-danger" onClick={() => removeEditItem(i)}>
                    <iconify-icon icon="solar:trash-bin-trash-line-duotone"></iconify-icon>
                  </button></td>
                </tr>
              ))}
            </tbody>
          </table>
          <button type="button" className="btn btn-sm btn-light" onClick={addEditItem}>
            <iconify-icon icon="solar:add-circle-line-duotone" class="me-1"></iconify-icon> Add line
          </button>

          <div className="row g-2 mt-2">
            <div className="col-md-6">
              <label htmlFor="edit-memo" className="form-label">Memo</label>
              <textarea id="edit-memo" name="edit-memo" rows={2} className="form-control" value={editForm.memo}
                onChange={(e) => setEditForm({ ...editForm, memo: e.target.value })} />
            </div>
            <div className="col-md-6">
              <label htmlFor="edit-terms" className="form-label">Terms</label>
              <textarea id="edit-terms" name="edit-terms" rows={2} className="form-control" value={editForm.terms}
                onChange={(e) => setEditForm({ ...editForm, terms: e.target.value })} />
            </div>
          </div>
        </Modal>
      )}

      {confirmDialog}
    </div>
  );
}
