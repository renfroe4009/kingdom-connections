import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import api from '../../api/client.js';
import PageHeader from '../../components/PageHeader.jsx';
import Modal from '../../components/Modal.jsx';
import SearchableSelect from '../../components/SearchableSelect.jsx';
import SavedPaymentMethods from '../components/SavedPaymentMethods.jsx';
import FormErrorBanner from '../../components/FormErrorBanner.jsx';
import { parseApiError } from '../../utils/apiError.js';
import { useAuth } from '../../auth/AuthContext.jsx';

const STATUS_TONE = {
  active: 'success', paused: 'warning', completed: 'secondary', canceled: 'danger',
};

function blankItem(sort) {
  return { description: '', quantity: 1, unit_price: 0, sort_order: sort };
}

function fmtMoney(n) {
  return `$${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function intervalLabel(count, unit) {
  return `Every ${count} ${unit}${Number(count) > 1 ? 's' : ''}`;
}

export default function RecurringInvoicesList() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const [rows, setRows] = useState([]);
  const [q, setQ] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [contacts, setContacts] = useState([]);
  const [orgs, setOrgs] = useState([]);
  const [show, setShow] = useState(false);
  const [formError, setFormError] = useState('');
  const [form, setForm] = useState({
    name: '',
    contact_id: '', organization_id: '',
    interval_unit: 'month', interval_count: 1,
    start_date: new Date().toISOString().slice(0, 10),
    end_date: '',
    max_occurrences: '',
    due_days: 14,
    tax_rate: 0, discount_rate: 0,
    auto_pay: false,
    gateway: '',
    gateway_profile_id: '',
    memo: '',
    terms: '',
    items: [blankItem(0)],
  });

  async function load() {
    const { data } = await api.get('/recurring-invoices', { params: { q, status: statusFilter || undefined } });
    setRows(data.rows);
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [q, statusFilter]);
  useEffect(() => {
    api.get('/contacts', { params: { pageSize: 500 } }).then((r) => setContacts(r.data.rows)).catch(() => {});
    api.get('/organizations', { params: { pageSize: 500 } }).then((r) => setOrgs(r.data.rows)).catch(() => {});
  }, []);

  function updateItem(i, patch) {
    const items = form.items.slice();
    items[i] = { ...items[i], ...patch };
    setForm({ ...form, items });
  }
  function addItem() { setForm({ ...form, items: [...form.items, blankItem(form.items.length)] }); }
  function removeItem(i) {
    const items = form.items.slice();
    items.splice(i, 1);
    setForm({ ...form, items: items.length ? items : [blankItem(0)] });
  }

  const subtotal = form.items.reduce((a, l) => a + Number(l.quantity || 0) * Number(l.unit_price || 0), 0);
  const discount = subtotal * (Number(form.discount_rate || 0) / 100);
  const tax = Math.max(0, subtotal - discount) * (Number(form.tax_rate || 0) / 100);
  const total = Math.max(0, subtotal - discount) + tax;

  async function save() {
    if (!form.name.trim()) { setFormError('Give this recurring invoice a name.'); return; }
    const items = form.items
      .filter((l) => l.description && Number(l.quantity) > 0)
      .map((l, idx) => ({
        description: l.description,
        quantity: Number(l.quantity),
        unit_price: Number(l.unit_price),
        sort_order: idx,
      }));
    if (items.length === 0) { setFormError('Add at least one line item.'); return; }
    setFormError('');
    const payload = {
      name: form.name,
      contact_id: form.contact_id ? Number(form.contact_id) : null,
      organization_id: form.organization_id ? Number(form.organization_id) : null,
      interval_unit: form.interval_unit,
      interval_count: Number(form.interval_count || 1),
      start_date: form.start_date,
      end_date: form.end_date || null,
      max_occurrences: form.max_occurrences ? Number(form.max_occurrences) : null,
      due_days: Number(form.due_days || 14),
      tax_rate: Number(form.tax_rate || 0),
      discount_rate: Number(form.discount_rate || 0),
      auto_pay: !!form.auto_pay,
      gateway: form.gateway || null,
      gateway_profile_id: form.gateway_profile_id || null,
      memo: form.memo || null,
      terms: form.terms || null,
      items,
    };
    try {
      const { data } = await api.post('/recurring-invoices', payload);
      setShow(false);
      navigate(`/admin/recurring-invoices/${data.id}`);
    } catch (err) {
      setFormError(parseApiError(err));
    }
  }

  function resetForm() {
    setForm({
      name: '', contact_id: '', organization_id: '',
      interval_unit: 'month', interval_count: 1,
      start_date: new Date().toISOString().slice(0, 10),
      end_date: '', max_occurrences: '', due_days: 14,
      tax_rate: 0, discount_rate: 0,
      auto_pay: false, gateway: '', gateway_profile_id: '',
      memo: '', terms: '',
      items: [blankItem(0)],
    });
    setFormError('');
  }

  return (
    <div>
      <PageHeader
        title="Recurring Invoices"
        subtitle="Auto-generate invoices on a weekly, monthly, or annual schedule"
        actions={can('invoices.write') && (
          <button className="btn btn-primary" onClick={() => { resetForm(); setShow(true); }}>
            <iconify-icon icon="solar:add-circle-line-duotone" class="me-1"></iconify-icon> New Recurring Invoice
          </button>
        )}
      />

      <div className="mb-3 d-flex gap-2 align-items-center">
        <Link to="/admin/invoices" className="btn btn-light btn-sm">← All Invoices</Link>
        <Link to="/admin/subscriptions" className="btn btn-light btn-sm">Subscriptions</Link>
      </div>

      <div className="card">
        <div className="card-body">
          <div className="d-flex gap-2 mb-3">
            <input name="ri-search" className="form-control" placeholder="Search by name or customer…"
              value={q} onChange={(e) => setQ(e.target.value)} />
            <select name="ri-status-filter" className="form-select" style={{ maxWidth: 180 }}
              value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="">All statuses</option>
              {['active','paused','completed','canceled'].map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>

          <div className="table-responsive">
            <table className="table table-hover align-middle mb-0">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Customer</th>
                  <th>Interval</th>
                  <th className="text-end">Per run</th>
                  <th className="text-center">Occurrences</th>
                  <th>Next Run</th>
                  <th>Auto-pay</th>
                  <th>Status</th>
                  <th style={{ width: 80 }}></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <Link to={`/admin/recurring-invoices/${r.id}`} className="fw-semibold text-decoration-none">
                        {r.name}
                      </Link>
                    </td>
                    <td className="text-muted small">{r.contact_name || r.organization_name || '—'}</td>
                    <td className="small">{intervalLabel(r.interval_count, r.interval_unit)}</td>
                    <td className="text-end fw-semibold">{fmtMoney(r.per_run_total)}</td>
                    <td className="text-center">
                      <span className="badge bg-light text-dark">{Number(r.occurrences_run || 0)}</span>
                      {r.max_occurrences && (
                        <span className="text-muted small ms-1">/ {r.max_occurrences}</span>
                      )}
                    </td>
                    <td className="small">{r.next_run_date || '—'}</td>
                    <td>
                      {r.auto_pay
                        ? <span className="badge bg-success-subtle text-success">
                            <iconify-icon icon="solar:card-line-duotone" class="me-1"></iconify-icon>
                            {r.gateway || 'on'}
                          </span>
                        : <span className="text-muted small">Email only</span>}
                    </td>
                    <td>
                      <span className={`badge bg-${STATUS_TONE[r.status]}-subtle text-${STATUS_TONE[r.status]}`}>
                        {r.status}
                      </span>
                    </td>
                    <td>
                      <Link to={`/admin/recurring-invoices/${r.id}`} className="btn btn-sm btn-light">View</Link>
                    </td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr><td colSpan="9">
                    <div className="empty-state">No recurring invoices yet.</div>
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* ── Create Modal ── */}
      <Modal show={show} onClose={() => setShow(false)} title="New Recurring Invoice" size="lg"
        footer={<>
          <button className="btn btn-light" onClick={() => setShow(false)}>Cancel</button>
          <button className="btn btn-primary" onClick={save}>Create</button>
        </>}>

        <FormErrorBanner error={formError} />
        <div className="row g-2">
          <div className="col-12">
            <label htmlFor="ri-name" className="form-label">Name <span className="text-danger">*</span></label>
            <input id="ri-name" name="ri-name" className="form-control" value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Monthly retainer — Acme Corp" />
          </div>

          <div className="col-md-6">
            <label className="form-label">Billed organization</label>
            <SearchableSelect
              options={orgs.map((o) => ({ value: String(o.id), label: o.name, sublabel: [o.city, o.state].filter(Boolean).join(', ') }))}
              value={form.organization_id ? String(form.organization_id) : ''}
              onChange={(v) => setForm({ ...form, organization_id: v })}
              placeholder="Select organization…"
            />
          </div>
          <div className="col-md-6">
            <label className="form-label">Customer (contact)</label>
            <SearchableSelect
              options={contacts
                .filter((c) => !form.organization_id || String(c.organization_id) === String(form.organization_id))
                .map((c) => ({ value: String(c.id), label: `${c.first_name || ''} ${c.last_name || ''}`.trim() || '(no name)', sublabel: c.email || '' }))}
              value={form.contact_id ? String(form.contact_id) : ''}
              onChange={(v) => setForm({ ...form, contact_id: v })}
              placeholder="Select contact…"
            />
          </div>

          {/* Schedule */}
          <div className="col-12 mt-1">
            <h6 className="fw-bold text-uppercase small text-muted mb-1">Schedule</h6>
          </div>
          <div className="col-md-2">
            <label htmlFor="ri-interval-count" className="form-label">Every</label>
            <input id="ri-interval-count" name="ri-interval-count" type="number" min="1" className="form-control" value={form.interval_count}
              onChange={(e) => setForm({ ...form, interval_count: e.target.value })} />
          </div>
          <div className="col-md-2">
            <label htmlFor="ri-interval-unit" className="form-label">Interval</label>
            <select id="ri-interval-unit" name="ri-interval-unit" className="form-select" value={form.interval_unit}
              onChange={(e) => setForm({ ...form, interval_unit: e.target.value })}>
              <option value="week">Week(s)</option>
              <option value="month">Month(s)</option>
              <option value="year">Year(s)</option>
            </select>
          </div>
          <div className="col-md-2">
            <label htmlFor="ri-start-date" className="form-label">Start date</label>
            <input id="ri-start-date" name="ri-start-date" type="date" className="form-control" value={form.start_date}
              onChange={(e) => setForm({ ...form, start_date: e.target.value })} />
          </div>
          <div className="col-md-2">
            <label htmlFor="ri-end-date" className="form-label">End date</label>
            <input id="ri-end-date" name="ri-end-date" type="date" className="form-control" value={form.end_date}
              onChange={(e) => setForm({ ...form, end_date: e.target.value })}
              placeholder="optional" />
          </div>
          <div className="col-md-2">
            <label htmlFor="ri-max-occurrences" className="form-label">Max occurrences</label>
            <input id="ri-max-occurrences" name="ri-max-occurrences" type="number" min="1" className="form-control" value={form.max_occurrences}
              onChange={(e) => setForm({ ...form, max_occurrences: e.target.value })}
              placeholder="∞" />
            <div className="form-text">Leave blank for unlimited</div>
          </div>
          <div className="col-md-2">
            <label htmlFor="ri-due-days" className="form-label">Due days</label>
            <input id="ri-due-days" name="ri-due-days" type="number" min="0" className="form-control" value={form.due_days}
              onChange={(e) => setForm({ ...form, due_days: e.target.value })} />
            <div className="form-text">Days after issue</div>
          </div>

          {/* Rates */}
          <div className="col-md-3">
            <label htmlFor="ri-tax-rate" className="form-label">Tax %</label>
            <input id="ri-tax-rate" name="ri-tax-rate" type="number" step="0.001" className="form-control" value={form.tax_rate}
              onChange={(e) => setForm({ ...form, tax_rate: e.target.value })} />
          </div>
          <div className="col-md-3">
            <label htmlFor="ri-discount-rate" className="form-label">Discount %</label>
            <input id="ri-discount-rate" name="ri-discount-rate" type="number" step="0.001" className="form-control" value={form.discount_rate}
              onChange={(e) => setForm({ ...form, discount_rate: e.target.value })} />
          </div>

          {/* Auto-pay */}
          <div className="col-12 mt-1">
            <h6 className="fw-bold text-uppercase small text-muted mb-1">Auto-pay</h6>
          </div>
          <div className="col-12">
            <div className="form-check form-switch mb-2">
              <input className="form-check-input" type="checkbox" id="auto_pay"
                checked={!!form.auto_pay}
                onChange={(e) => setForm({ ...form, auto_pay: e.target.checked })} />
              <label className="form-check-label" htmlFor="auto_pay">
                Automatically charge payment method on file each run
              </label>
            </div>
            {form.auto_pay && (
              <div className="border rounded p-3 bg-light">
                {(form.contact_id || form.organization_id) ? (
                  <>
                    <div className="small fw-semibold mb-2">Select payment method to charge:</div>
                    <SavedPaymentMethods
                      contactId={form.contact_id ? Number(form.contact_id) : null}
                      organizationId={form.organization_id ? Number(form.organization_id) : null}
                      selectable
                      selectedId={form.gateway_profile_id ? Number(form.gateway_profile_id) : null}
                      onSelect={(profile) => setForm({
                        ...form,
                        gateway:            profile.gateway,
                        gateway_profile_id: String(profile.id),
                      })}
                    />
                    {form.gateway_profile_id && (
                      <div className="text-muted small mt-1">
                        Profile #{form.gateway_profile_id} selected · gateway: {form.gateway || '—'}
                      </div>
                    )}
                  </>
                ) : (
                  <div className="text-muted small">
                    <iconify-icon icon="solar:info-circle-line-duotone" class="me-1"></iconify-icon>
                    Select a customer or organization above first, then choose a payment method.
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Line items */}
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
            {form.items.map((l, i) => (
              <tr key={i}>
                <td><input name={`ri-item-desc-${i}`} className="form-control form-control-sm" value={l.description}
                  onChange={(e) => updateItem(i, { description: e.target.value })} /></td>
                <td><input name={`ri-item-qty-${i}`} type="number" step="0.01" className="form-control form-control-sm" value={l.quantity}
                  onChange={(e) => updateItem(i, { quantity: e.target.value })} /></td>
                <td><input name={`ri-item-price-${i}`} type="number" step="0.01" className="form-control form-control-sm" value={l.unit_price}
                  onChange={(e) => updateItem(i, { unit_price: e.target.value })} /></td>
                <td className="text-end">${(Number(l.quantity || 0) * Number(l.unit_price || 0)).toFixed(2)}</td>
                <td><button type="button" className="btn btn-sm btn-light text-danger" onClick={() => removeItem(i)}>
                  <iconify-icon icon="solar:trash-bin-trash-line-duotone"></iconify-icon>
                </button></td>
              </tr>
            ))}
          </tbody>
        </table>
        <button type="button" className="btn btn-sm btn-light" onClick={addItem}>
          <iconify-icon icon="solar:add-circle-line-duotone" class="me-1"></iconify-icon> Add line
        </button>

        <div className="mt-3 d-flex justify-content-end">
          <div style={{ minWidth: 280 }}>
            <div className="d-flex justify-content-between"><span>Subtotal</span><strong>${subtotal.toFixed(2)}</strong></div>
            <div className="d-flex justify-content-between"><span>Discount ({form.discount_rate}%)</span><strong>−${discount.toFixed(2)}</strong></div>
            <div className="d-flex justify-content-between"><span>Tax ({form.tax_rate}%)</span><strong>${tax.toFixed(2)}</strong></div>
            <hr className="my-1" />
            <div className="d-flex justify-content-between fs-5"><span>Per run</span><strong>${total.toFixed(2)}</strong></div>
          </div>
        </div>

        <div className="row g-2 mt-1">
          <div className="col-md-6">
            <label htmlFor="ri-memo" className="form-label">Memo</label>
            <textarea id="ri-memo" name="ri-memo" rows={2} className="form-control" value={form.memo}
              onChange={(e) => setForm({ ...form, memo: e.target.value })} />
          </div>
          <div className="col-md-6">
            <label htmlFor="ri-terms" className="form-label">Terms</label>
            <textarea id="ri-terms" name="ri-terms" rows={2} className="form-control" value={form.terms}
              onChange={(e) => setForm({ ...form, terms: e.target.value })} />
          </div>
        </div>
      </Modal>
    </div>
  );
}
