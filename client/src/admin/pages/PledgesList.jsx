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

const STATUS_TONE = { active: 'success', paused: 'warning', completed: 'secondary', canceled: 'danger' };

function fmtMoney(n) {
  return `$${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function intervalLabel(count, unit) {
  return `Every ${count} ${unit}${Number(count) > 1 ? 's' : ''}`;
}

const emptyForm = {
  contact_id: '', organization_id: '', fund_id: '',
  amount_per_installment: '', interval_unit: 'month', interval_count: 1,
  start_date: new Date().toISOString().slice(0, 10),
  end_date: '', max_occurrences: '',
  auto_pay: false, gateway: '', gateway_profile_id: '',
};

export default function PledgesList() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const [rows, setRows] = useState([]);
  const [q, setQ] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [funds, setFunds] = useState([]);
  const [contacts, setContacts] = useState([]);
  const [orgs, setOrgs] = useState([]);
  const [show, setShow] = useState(false);
  const [formError, setFormError] = useState('');
  const [form, setForm] = useState(emptyForm);

  async function load() {
    const { data } = await api.get('/pledges', { params: { q, status: statusFilter || undefined } });
    setRows(data.rows);
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [q, statusFilter]);
  useEffect(() => {
    api.get('/donations/admin/funds').then((r) => setFunds(r.data)).catch(() => {});
    api.get('/contacts', { params: { pageSize: 500 } }).then((r) => setContacts(r.data.rows)).catch(() => {});
    api.get('/organizations', { params: { pageSize: 500 } }).then((r) => setOrgs(r.data.rows)).catch(() => {});
  }, []);

  function openNew() { setForm(emptyForm); setFormError(''); setShow(true); }

  async function save() {
    if (!form.contact_id && !form.organization_id) { setFormError('Select a donor (contact or organization).'); return; }
    if (!form.fund_id) { setFormError('Select a fund.'); return; }
    if (!form.amount_per_installment || Number(form.amount_per_installment) <= 0) { setFormError('Enter an installment amount.'); return; }
    setFormError('');
    const payload = {
      contact_id: form.contact_id ? Number(form.contact_id) : null,
      organization_id: form.organization_id ? Number(form.organization_id) : null,
      fund_id: Number(form.fund_id),
      amount_per_installment: Number(form.amount_per_installment),
      interval_unit: form.interval_unit,
      interval_count: Number(form.interval_count || 1),
      start_date: form.start_date,
      end_date: form.end_date || null,
      max_occurrences: form.max_occurrences ? Number(form.max_occurrences) : null,
      gateway: form.gateway || null,
      gateway_profile_id: form.gateway_profile_id || null,
    };
    try {
      const { data } = await api.post('/pledges', payload);
      setShow(false);
      navigate(`/admin/pledges/${data.id}`);
    } catch (err) {
      setFormError(parseApiError(err));
    }
  }

  return (
    <div>
      <PageHeader
        title="Pledges"
        subtitle="Donors committed to a total gift, paid over one or more installments"
        actions={can('donations.write') && (
          <button className="btn btn-primary" onClick={openNew}>
            <iconify-icon icon="solar:add-circle-line-duotone" class="me-1"></iconify-icon> New Pledge
          </button>
        )}
      />

      <div className="card">
        <div className="card-body">
          <div className="d-flex gap-2 mb-3">
            <input className="form-control" placeholder="Search by donor…" value={q} onChange={(e) => setQ(e.target.value)} />
            <select className="form-select" style={{ maxWidth: 180 }} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="">All statuses</option>
              {['active', 'paused', 'completed', 'canceled'].map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>

          <div className="table-responsive">
            <table className="table table-hover align-middle mb-0">
              <thead>
                <tr>
                  <th>Donor</th>
                  <th>Fund</th>
                  <th>Installment</th>
                  <th className="text-center">Installments</th>
                  <th className="text-end">Total pledged</th>
                  <th className="text-end">Balance remaining</th>
                  <th>Status</th>
                  <th style={{ width: 70 }}></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <Link to={`/admin/pledges/${r.id}`} className="fw-semibold text-decoration-none">
                        {r.contact_name || r.organization_name || '—'}
                      </Link>
                    </td>
                    <td className="text-muted small">{r.fund_name}</td>
                    <td className="small">{fmtMoney(r.amount_per_installment)} · {intervalLabel(r.interval_count, r.interval_unit)}</td>
                    <td className="text-center">
                      <span className="badge bg-light text-dark">{Number(r.occurrences_run || 0)}</span>
                      {r.max_occurrences && <span className="text-muted small ms-1">/ {r.max_occurrences}</span>}
                    </td>
                    <td className="text-end">{r.total_pledged != null ? fmtMoney(r.total_pledged) : <span className="text-muted">open-ended</span>}</td>
                    <td className="text-end fw-semibold">{r.balance_remaining != null ? fmtMoney(r.balance_remaining) : '—'}</td>
                    <td><span className={`badge bg-${STATUS_TONE[r.status]}-subtle text-${STATUS_TONE[r.status]}`}>{r.status}</span></td>
                    <td><Link to={`/admin/pledges/${r.id}`} className="btn btn-sm btn-light">View</Link></td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr><td colSpan="8"><div className="empty-state">No pledges yet.</div></td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <Modal show={show} onClose={() => setShow(false)} title="New Pledge" size="lg"
        footer={<>
          <button className="btn btn-light" onClick={() => setShow(false)}>Cancel</button>
          <button className="btn btn-primary" onClick={save}>Create Pledge</button>
        </>}>
        <FormErrorBanner error={formError} />
        <div className="row g-2">
          <div className="col-md-6">
            <label className="form-label">Organization</label>
            <SearchableSelect
              options={orgs.map((o) => ({ value: String(o.id), label: o.name }))}
              value={form.organization_id ? String(form.organization_id) : ''}
              onChange={(v) => setForm({ ...form, organization_id: v })}
              placeholder="Select organization…"
            />
          </div>
          <div className="col-md-6">
            <label className="form-label">Donor (contact)</label>
            <SearchableSelect
              options={contacts
                .filter((c) => !form.organization_id || String(c.organization_id) === String(form.organization_id))
                .map((c) => ({ value: String(c.id), label: `${c.first_name || ''} ${c.last_name || ''}`.trim() || '(no name)', sublabel: c.email || '' }))}
              value={form.contact_id ? String(form.contact_id) : ''}
              onChange={(v) => setForm({ ...form, contact_id: v })}
              placeholder="Select contact…"
            />
          </div>

          <div className="col-md-6 mt-1">
            <label className="form-label">Fund <span className="text-danger">*</span></label>
            <SearchableSelect
              options={funds.map((f) => ({ value: String(f.id), label: f.name }))}
              value={form.fund_id ? String(form.fund_id) : ''}
              onChange={(v) => setForm({ ...form, fund_id: v })}
              placeholder="Select fund…"
            />
          </div>
          <div className="col-md-6 mt-1">
            <label className="form-label">Installment amount <span className="text-danger">*</span></label>
            <div className="input-group">
              <span className="input-group-text">$</span>
              <input type="number" min="0.01" step="0.01" className="form-control" value={form.amount_per_installment}
                onChange={(e) => setForm({ ...form, amount_per_installment: e.target.value })} />
            </div>
          </div>

          <div className="col-12 mt-2">
            <h6 className="fw-bold text-uppercase small text-muted mb-1">Schedule</h6>
          </div>
          <div className="col-md-2">
            <label className="form-label">Every</label>
            <input type="number" min="1" className="form-control" value={form.interval_count}
              onChange={(e) => setForm({ ...form, interval_count: e.target.value })} />
          </div>
          <div className="col-md-3">
            <label className="form-label">Interval</label>
            <select className="form-select" value={form.interval_unit}
              onChange={(e) => setForm({ ...form, interval_unit: e.target.value })}>
              <option value="week">Week(s)</option>
              <option value="month">Month(s)</option>
              <option value="year">Year(s)</option>
            </select>
          </div>
          <div className="col-md-3">
            <label className="form-label">Start date</label>
            <input type="date" className="form-control" value={form.start_date}
              onChange={(e) => setForm({ ...form, start_date: e.target.value })} />
          </div>
          <div className="col-md-4">
            <label className="form-label">Number of installments</label>
            <input type="number" min="1" className="form-control" value={form.max_occurrences}
              onChange={(e) => setForm({ ...form, max_occurrences: e.target.value })} placeholder="∞" />
            <div className="form-text">Leave blank for an open-ended pledge</div>
          </div>

          <div className="col-12 mt-2">
            <h6 className="fw-bold text-uppercase small text-muted mb-1">Payment</h6>
          </div>
          <div className="col-12">
            <div className="form-check form-switch mb-2">
              <input className="form-check-input" type="checkbox" id="pledge-auto-pay"
                checked={!!form.auto_pay}
                onChange={(e) => setForm({ ...form, auto_pay: e.target.checked, gateway: '', gateway_profile_id: '' })} />
              <label className="form-check-label" htmlFor="pledge-auto-pay">
                Automatically charge a saved payment method each installment
              </label>
            </div>
            {form.auto_pay ? (
              (form.contact_id || form.organization_id) ? (
                <div className="border rounded p-3 bg-light">
                  <SavedPaymentMethods
                    contactId={form.contact_id ? Number(form.contact_id) : null}
                    organizationId={form.organization_id ? Number(form.organization_id) : null}
                    selectable
                    selectedId={form.gateway_profile_id ? Number(form.gateway_profile_id) : null}
                    onSelect={(profile) => setForm({ ...form, gateway: profile.gateway, gateway_profile_id: String(profile.id) })}
                  />
                </div>
              ) : (
                <div className="text-muted small">Select a donor above first, then choose a payment method.</div>
              )
            ) : (
              <div className="text-muted small">
                <iconify-icon icon="solar:info-circle-line-duotone" class="me-1"></iconify-icon>
                Each installment will be invoiced — the donor pays via their portal or by check/cash recorded by staff.
              </div>
            )}
          </div>
        </div>
      </Modal>
    </div>
  );
}
