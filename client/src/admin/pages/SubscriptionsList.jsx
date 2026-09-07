import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import api from '../../api/client.js';
import PageHeader from '../../components/PageHeader.jsx';
import Modal from '../../components/Modal.jsx';
import FormErrorBanner from '../../components/FormErrorBanner.jsx';
import SavedPaymentMethods from '../components/SavedPaymentMethods.jsx';
import { parseApiError } from '../../utils/apiError.js';
import { useAuth } from '../../auth/AuthContext.jsx';

const STATUS_TONE = {
  active: 'success', paused: 'warning', canceled: 'danger', completed: 'secondary',
};

function fmtMoney(n) {
  return `$${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function blankItem(sort) {
  return { description: '', quantity: 1, unit_price: 0, sort_order: sort };
}

export default function SubscriptionsList() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const [rows, setRows] = useState([]);
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
    tax_rate: 0, discount_rate: 0,
    gateway: 'none',
    auto_charge: false,
    gateway_profile_id: '',
    items: [blankItem(0)],
  });

  async function load() {
    const { data } = await api.get('/subscriptions');
    setRows(data.rows);
  }
  useEffect(() => { load(); }, []);
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

  // Client-side required-field check (mirrors server validation)
  function clientValidate(payload) {
    if (!payload.name) return 'Give this recurring plan a name.';
    if (payload.items.length === 0) return 'Add at least one line item.';
    if (payload.auto_charge && !payload.gateway_profile_id) {
      return 'Select a saved payment method to auto-charge, or turn off auto-charge.';
    }
    return null;
  }

  async function save() {
    const payload = {
      name: form.name,
      contact_id: form.contact_id ? Number(form.contact_id) : null,
      organization_id: form.organization_id ? Number(form.organization_id) : null,
      interval_unit: form.interval_unit,
      interval_count: Number(form.interval_count || 1),
      start_date: form.start_date,
      end_date: form.end_date || null,
      tax_rate: Number(form.tax_rate || 0),
      discount_rate: Number(form.discount_rate || 0),
      gateway: form.gateway,
      auto_charge: !!form.auto_charge,
      gateway_profile_id: form.auto_charge && form.gateway_profile_id ? form.gateway_profile_id : null,
      items: form.items
        .filter((l) => l.description && Number(l.quantity) > 0)
        .map((l, idx) => ({
          description: l.description,
          quantity: Number(l.quantity),
          unit_price: Number(l.unit_price),
          sort_order: idx,
        })),
    };

    const clientErr = clientValidate(payload);
    if (clientErr) { setFormError(clientErr); return; }
    setFormError('');

    try {
      const { data } = await api.post('/subscriptions', payload);
      setShow(false);
      navigate(`/admin/subscriptions/${data.id}`);
    } catch (err) {
      setFormError(parseApiError(err));
    }
  }

  return (
    <div>
      <PageHeader title="Recurring" subtitle="Recurring billing plans"
        actions={can('subscriptions.write') && <button className="btn btn-primary" onClick={() => { setFormError(''); setShow(true); }}>
          <iconify-icon icon="solar:add-circle-line-duotone" class="me-1"></iconify-icon> New Recurring Plan
        </button>} />

      <div className="card">
        <div className="card-body">
          <div className="table-responsive">
            <table className="table table-hover align-middle mb-0">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Customer</th>
                  <th>Interval</th>
                  <th className="text-end">Amount / run</th>
                  <th className="text-end">Txns</th>
                  <th>Next Run</th>
                  <th>Status</th>
                  <th style={{ width: 110 }} className="text-end">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((s) => (
                  <tr key={s.id}>
                    <td>
                      <Link to={`/admin/subscriptions/${s.id}`} className="fw-semibold text-decoration-none">{s.name}</Link>
                    </td>
                    <td>{s.contact_name || s.organization_name || '—'}</td>
                    <td>Every {s.interval_count} {s.interval_unit}{s.interval_count > 1 ? 's' : ''}</td>
                    <td className="text-end fw-semibold">
                      {fmtMoney(s.per_run_total)}
                      <div className="text-muted small fw-normal">{s.currency || 'USD'}</div>
                    </td>
                    <td className="text-end">
                      <span className="badge bg-light text-dark">{Number(s.payment_count || 0)}</span>
                      {Number(s.captured_total || 0) > 0 && (
                        <div className="text-success small">{fmtMoney(s.captured_total)} captured</div>
                      )}
                    </td>
                    <td>{s.next_run_date || '—'}</td>
                    <td><span className={`badge bg-${STATUS_TONE[s.status]}-subtle text-${STATUS_TONE[s.status]}`}>{s.status}</span></td>
                    <td className="text-end">
                      <Link to={`/admin/subscriptions/${s.id}`} className="btn btn-sm btn-light">
                        <iconify-icon icon="solar:eye-line-duotone" class="me-1"></iconify-icon>
                        View
                      </Link>
                    </td>
                  </tr>
                ))}
                {rows.length === 0 && <tr><td colSpan="8"><div className="empty-state">No recurring plans yet.</div></td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <Modal show={show} onClose={() => setShow(false)} title="New Recurring Plan" size="lg"
        footer={<><button className="btn btn-light" onClick={() => setShow(false)}>Cancel</button>
                  <button className="btn btn-primary" onClick={save}>Create</button></>}>
        <FormErrorBanner error={formError} />
        <div className="row g-2">
          <div className="col-12"><label className="form-label">Name</label>
            <input className="form-control" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Managed services — Acme Corp" /></div>
          <div className="col-md-6"><label className="form-label">Customer (contact)</label>
            <select className="form-select" value={form.contact_id} onChange={(e) => setForm({ ...form, contact_id: e.target.value })}>
              <option value="">—</option>
              {contacts.map((c) => <option key={c.id} value={c.id}>{c.first_name} {c.last_name}</option>)}
            </select></div>
          <div className="col-md-6"><label className="form-label">Organization</label>
            <select className="form-select" value={form.organization_id} onChange={(e) => setForm({ ...form, organization_id: e.target.value })}>
              <option value="">—</option>
              {orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select></div>
          <div className="col-md-3"><label className="form-label">Every</label>
            <input type="number" min="1" className="form-control" value={form.interval_count} onChange={(e) => setForm({ ...form, interval_count: e.target.value })} /></div>
          <div className="col-md-3"><label className="form-label">Interval</label>
            <select className="form-select" value={form.interval_unit} onChange={(e) => setForm({ ...form, interval_unit: e.target.value })}>
              {['day','week','month','year'].map((u) => <option key={u} value={u}>{u}(s)</option>)}
            </select></div>
          <div className="col-md-3"><label className="form-label">Start date</label>
            <input type="date" className="form-control" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} /></div>
          <div className="col-md-3"><label className="form-label">End date (optional)</label>
            <input type="date" className="form-control" value={form.end_date} onChange={(e) => setForm({ ...form, end_date: e.target.value })} /></div>
          <div className="col-md-3"><label className="form-label">Tax %</label>
            <input type="number" step="0.001" className="form-control" value={form.tax_rate} onChange={(e) => setForm({ ...form, tax_rate: e.target.value })} /></div>
          <div className="col-md-3"><label className="form-label">Discount %</label>
            <input type="number" step="0.001" className="form-control" value={form.discount_rate} onChange={(e) => setForm({ ...form, discount_rate: e.target.value })} /></div>
          <div className="col-12 mt-1">
            <h6 className="fw-bold text-uppercase small text-muted mb-1">Auto-charge</h6>
          </div>
          <div className="col-12">
            <div className="form-check form-switch mb-2">
              <input className="form-check-input" type="checkbox" id="new_sub_auto_charge"
                checked={!!form.auto_charge}
                onChange={(e) => setForm({ ...form, auto_charge: e.target.checked, gateway: e.target.checked ? form.gateway : 'none' })} />
              <label className="form-check-label" htmlFor="new_sub_auto_charge">
                Automatically charge a saved card or bank account (eCheck) each run
              </label>
            </div>
            {form.auto_charge && (
              <div className="border rounded p-3 bg-light">
                {!(form.contact_id || form.organization_id) ? (
                  <div className="text-muted small">Pick a customer above to choose a saved payment method.</div>
                ) : (
                  <>
                    <div className="small fw-semibold mb-2">Select payment method to charge:</div>
                    <SavedPaymentMethods
                      contactId={form.contact_id ? Number(form.contact_id) : null}
                      organizationId={form.organization_id ? Number(form.organization_id) : null}
                      selectable
                      selectedId={form.gateway_profile_id ? Number(form.gateway_profile_id) : null}
                      onSelect={(profile) => setForm({
                        ...form,
                        gateway: profile.gateway,
                        gateway_profile_id: String(profile.id),
                      })}
                    />
                  </>
                )}
              </div>
            )}
          </div>
        </div>

        <h6 className="mt-4 fw-bold text-uppercase small text-muted">Line Items</h6>
        <table className="table table-sm align-middle">
          <thead><tr><th>Description</th><th style={{ width: 90 }}>Qty</th><th style={{ width: 120 }}>Unit</th><th className="text-end" style={{ width: 120 }}>Amount</th><th></th></tr></thead>
          <tbody>
            {form.items.map((l, i) => (
              <tr key={i}>
                <td><input className="form-control form-control-sm" value={l.description} onChange={(e) => updateItem(i, { description: e.target.value })} /></td>
                <td><input type="number" step="0.01" className="form-control form-control-sm" value={l.quantity} onChange={(e) => updateItem(i, { quantity: e.target.value })} /></td>
                <td><input type="number" step="0.01" className="form-control form-control-sm" value={l.unit_price} onChange={(e) => updateItem(i, { unit_price: e.target.value })} /></td>
                <td className="text-end">${(Number(l.quantity || 0) * Number(l.unit_price || 0)).toFixed(2)}</td>
                <td><button type="button" className="btn btn-sm btn-light text-danger" onClick={() => removeItem(i)}><iconify-icon icon="solar:trash-bin-trash-line-duotone"></iconify-icon></button></td>
              </tr>
            ))}
          </tbody>
        </table>
        <button type="button" className="btn btn-sm btn-light" onClick={addItem}>
          <iconify-icon icon="solar:add-circle-line-duotone" class="me-1"></iconify-icon> Add line
        </button>
      </Modal>
    </div>
  );
}
