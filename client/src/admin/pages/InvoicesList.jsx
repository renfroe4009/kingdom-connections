import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams, NavLink } from 'react-router-dom';
import api from '../../api/client.js';
import PageHeader from '../../components/PageHeader.jsx';
import Modal from '../../components/Modal.jsx';
import SearchableSelect from '../../components/SearchableSelect.jsx';
import FormErrorBanner from '../../components/FormErrorBanner.jsx';
import { parseApiError } from '../../utils/apiError.js';
import { useAuth } from '../../auth/AuthContext.jsx';

const STATUSES = ['draft','sent','partial','paid','overdue','void','refunded'];
const STATUS_TONE = {
  draft: 'secondary', sent: 'primary', partial: 'warning',
  paid: 'success', overdue: 'danger', void: 'dark', refunded: 'info',
};

function blankLine(sort) {
  return { description: '', quantity: 1, unit_price: 0, sort_order: sort };
}

export default function InvoicesList() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [rows, setRows] = useState([]);
  const [summary, setSummary] = useState({ total_billed: 0, total_collected: 0, total_outstanding: 0 });
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [contacts, setContacts] = useState([]);
  const [orgs, setOrgs] = useState([]);
  const [show, setShow] = useState(false);
  const [formError, setFormError] = useState('');
  const [form, setForm] = useState({
    contact_id: '', organization_id: '',
    issue_date: new Date().toISOString().slice(0, 10),
    due_date:   new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10),
    tax_rate: 0, discount_rate: 0, memo: '',
    line_items: [blankLine(0)],
  });

  async function load() {
    const { data } = await api.get('/invoices', { params: { q, status, pageSize: 100 } });
    setRows(data.rows); setSummary(data.summary);
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [q, status]);
  useEffect(() => {
    api.get('/contacts', { params: { pageSize: 500 } }).then((r) => setContacts(r.data.rows)).catch(() => {});
    api.get('/organizations', { params: { pageSize: 500 } }).then((r) => setOrgs(r.data.rows)).catch(() => {});
  }, []);

  // Deep-link entry: /invoices?new=1[&organization_id=X][&contact_id=Y] auto-opens
  // the New Invoice modal preselected. Used by the "New Invoice" buttons on
  // OrganizationDetail/ContactDetail so we don't need a separate /invoices/new
  // route. We strip the params after consuming so a refresh doesn't re-prompt.
  useEffect(() => {
    if (searchParams.get('new') !== '1') return;
    const orgId = searchParams.get('organization_id') || '';
    const contactId = searchParams.get('contact_id') || '';
    setForm((f) => ({
      ...f,
      organization_id: orgId,
      contact_id: contactId,
    }));
    setFormError('');
    setShow(true);
    const next = new URLSearchParams(searchParams);
    next.delete('new');
    next.delete('organization_id');
    next.delete('contact_id');
    setSearchParams(next, { replace: true });
    /* eslint-disable-next-line */
  }, []);

  function updateLine(i, patch) {
    const items = form.line_items.slice();
    items[i] = { ...items[i], ...patch };
    setForm({ ...form, line_items: items });
  }
  function addLine() { setForm({ ...form, line_items: [...form.line_items, blankLine(form.line_items.length)] }); }
  function removeLine(i) {
    const items = form.line_items.slice();
    items.splice(i, 1);
    setForm({ ...form, line_items: items.length ? items : [blankLine(0)] });
  }

  const subtotal = form.line_items.reduce((a, l) => a + Number(l.quantity || 0) * Number(l.unit_price || 0), 0);
  const discount = subtotal * (Number(form.discount_rate || 0) / 100);
  const tax = Math.max(0, subtotal - discount) * (Number(form.tax_rate || 0) / 100);
  const total = Math.max(0, subtotal - discount) + tax;

  async function save() {
    const payload = {
      contact_id: form.contact_id ? Number(form.contact_id) : null,
      organization_id: form.organization_id ? Number(form.organization_id) : null,
      issue_date: form.issue_date,
      due_date: form.due_date,
      tax_rate: Number(form.tax_rate || 0),
      discount_rate: Number(form.discount_rate || 0),
      memo: form.memo || null,
      line_items: form.line_items
        .filter((l) => l.description && Number(l.quantity) > 0)
        .map((l, idx) => ({
          description: l.description,
          quantity: Number(l.quantity),
          unit_price: Number(l.unit_price),
          sort_order: idx,
        })),
    };
    if (payload.line_items.length === 0) { setFormError('Add at least one line item.'); return; }
    setFormError('');
    try {
      const { data } = await api.post('/invoices', payload);
      setShow(false);
      navigate(`/admin/invoices/${data.id}`);
    } catch (err) {
      setFormError(parseApiError(err));
    }
  }

  return (
    <div>
      <PageHeader title="Invoices"
        subtitle={`Billed $${Number(summary.total_billed).toLocaleString()} · Collected $${Number(summary.total_collected).toLocaleString()} · Outstanding $${Number(summary.total_outstanding).toLocaleString()}`}
        actions={<div className="d-flex gap-2">
          <NavLink to="/admin/recurring-invoices" className="btn btn-light">
            <iconify-icon icon="solar:refresh-circle-line-duotone" class="me-1"></iconify-icon> Recurring
          </NavLink>
          {can('invoices.write') && <button className="btn btn-primary" onClick={() => { setFormError(''); setShow(true); }}>
            <iconify-icon icon="solar:add-circle-line-duotone" class="me-1"></iconify-icon> New Invoice
          </button>}
        </div>} />

      <div className="card">
        <div className="card-body">
          <div className="d-flex gap-2 mb-3">
            <input className="form-control" placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} />
            <select className="form-select" style={{ maxWidth: 200 }} value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">All statuses</option>
              {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div className="table-responsive">
            <table className="table table-hover align-middle mb-0">
              <thead>
                <tr>
                  <th>Number</th><th>Customer</th><th>Issued</th><th>Due</th>
                  <th className="text-end">Total</th><th className="text-end">Balance</th><th>Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((i) => (
                  <tr key={i.id}>
                    <td><Link to={`/admin/invoices/${i.id}`} className="fw-semibold text-decoration-none">{i.invoice_number}</Link></td>
                    <td>{i.contact_name || i.organization_name || '—'}</td>
                    <td>{i.issue_date}</td>
                    <td>{i.due_date}</td>
                    <td className="text-end fw-bold">${Number(i.total).toLocaleString()}</td>
                    <td className="text-end">${Number(i.balance_due).toLocaleString()}</td>
                    <td><span className={`badge bg-${STATUS_TONE[i.status]}-subtle text-${STATUS_TONE[i.status]}`}>{i.status}</span></td>
                  </tr>
                ))}
                {rows.length === 0 && <tr><td colSpan="7"><div className="empty-state">No invoices yet.</div></td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <Modal show={show} onClose={() => setShow(false)} title="New Invoice" size="lg"
        footer={<><button className="btn btn-light" onClick={() => setShow(false)}>Cancel</button>
                  <button className="btn btn-primary" onClick={save}>Create</button></>}>
        <FormErrorBanner error={formError} />
        <div className="row g-2">
          {/* Org-first ordering: picking the org constrains the contact list
              below. If no org is selected the contact picker shows all
              contacts (org-less direct billing). */}
          <div className="col-md-6">
            <label className="form-label">Billed organization</label>
            <SearchableSelect
              options={orgs.map((o) => ({
                value: String(o.id),
                label: o.name,
                sublabel: [o.city, o.state].filter(Boolean).join(', '),
              }))}
              value={form.organization_id ? String(form.organization_id) : ''}
              onChange={(v) => setForm({
                ...form,
                organization_id: v,
                // If the currently-picked contact belongs to a different org,
                // clear it so we don't ship a mismatched (org, contact) pair.
                contact_id: (() => {
                  if (!form.contact_id) return '';
                  const c = contacts.find((x) => String(x.id) === String(form.contact_id));
                  if (!c) return '';
                  if (!v) return form.contact_id;
                  return String(c.organization_id) === String(v) ? form.contact_id : '';
                })(),
              })}
              placeholder="Select organization…"
            />
          </div>
          <div className="col-md-6">
            <label className="form-label">Customer (contact)</label>
            <SearchableSelect
              // When an org is selected we narrow the contact list to that
              // org's people. With no org chosen we still show everyone so
              // the user can bill an individual directly.
              options={contacts
                .filter((c) => !form.organization_id || String(c.organization_id) === String(form.organization_id))
                .map((c) => ({
                  value: String(c.id),
                  label: `${c.first_name || ''} ${c.last_name || ''}`.trim() || '(no name)',
                  sublabel: c.email || c.phone || '',
                }))}
              value={form.contact_id ? String(form.contact_id) : ''}
              onChange={(v) => setForm({ ...form, contact_id: v })}
              placeholder={form.organization_id ? 'Select contact at this org…' : 'Select contact…'}
              emptyText={form.organization_id ? 'No contacts attached to this organization yet.' : 'No matches.'}
            />
          </div>
          <div className="col-md-3"><label className="form-label">Issue date</label>
            <input type="date" className="form-control" value={form.issue_date} onChange={(e) => setForm({ ...form, issue_date: e.target.value })} /></div>
          <div className="col-md-3"><label className="form-label">Due date</label>
            <input type="date" className="form-control" value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })} /></div>
          <div className="col-md-3"><label className="form-label">Tax %</label>
            <input type="number" step="0.001" className="form-control" value={form.tax_rate} onChange={(e) => setForm({ ...form, tax_rate: e.target.value })} /></div>
          <div className="col-md-3"><label className="form-label">Discount %</label>
            <input type="number" step="0.001" className="form-control" value={form.discount_rate} onChange={(e) => setForm({ ...form, discount_rate: e.target.value })} /></div>
        </div>

        <h6 className="mt-4 fw-bold text-uppercase small text-muted">Line Items</h6>
        <table className="table table-sm align-middle">
          <thead><tr><th>Description</th><th style={{ width: 90 }}>Qty</th><th style={{ width: 120 }}>Unit</th><th className="text-end" style={{ width: 120 }}>Amount</th><th></th></tr></thead>
          <tbody>
            {form.line_items.map((l, i) => (
              <tr key={i}>
                <td><input className="form-control form-control-sm" value={l.description} onChange={(e) => updateLine(i, { description: e.target.value })} /></td>
                <td><input type="number" step="0.01" className="form-control form-control-sm" value={l.quantity} onChange={(e) => updateLine(i, { quantity: e.target.value })} /></td>
                <td><input type="number" step="0.01" className="form-control form-control-sm" value={l.unit_price} onChange={(e) => updateLine(i, { unit_price: e.target.value })} /></td>
                <td className="text-end">${(Number(l.quantity || 0) * Number(l.unit_price || 0)).toFixed(2)}</td>
                <td><button type="button" className="btn btn-sm btn-light text-danger" onClick={() => removeLine(i)}><iconify-icon icon="solar:trash-bin-trash-line-duotone"></iconify-icon></button></td>
              </tr>
            ))}
          </tbody>
        </table>
        <button type="button" className="btn btn-sm btn-light" onClick={addLine}>
          <iconify-icon icon="solar:add-circle-line-duotone" class="me-1"></iconify-icon> Add line
        </button>

        <div className="mt-3 d-flex justify-content-end">
          <div style={{ minWidth: 280 }}>
            <div className="d-flex justify-content-between"><span>Subtotal</span><strong>${subtotal.toFixed(2)}</strong></div>
            <div className="d-flex justify-content-between"><span>Discount ({form.discount_rate}%)</span><strong>−${discount.toFixed(2)}</strong></div>
            <div className="d-flex justify-content-between"><span>Tax ({form.tax_rate}%)</span><strong>${tax.toFixed(2)}</strong></div>
            <hr className="my-1" />
            <div className="d-flex justify-content-between fs-5"><span>Total</span><strong>${total.toFixed(2)}</strong></div>
          </div>
        </div>

        <label className="form-label mt-3">Memo</label>
        <textarea rows={2} className="form-control" value={form.memo} onChange={(e) => setForm({ ...form, memo: e.target.value })} />
      </Modal>
    </div>
  );
}
