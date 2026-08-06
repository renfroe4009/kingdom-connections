import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../../api/client.js';
import PageHeader from '../../components/PageHeader.jsx';
import Modal from '../../components/Modal.jsx';
import PhoneInput from '../../components/PhoneInput.jsx';
import AddressVerifier from '../components/AddressVerifier.jsx';
import IndustrySicSelect from '../components/IndustrySicSelect.jsx';
import { useAuth } from '../../auth/AuthContext.jsx';
import { useConfirm } from '../../hooks/useConfirm.jsx';
import { isBlank } from '../../utils/validation.js';
import BulkActionBar from '../components/BulkActionBar.jsx';

const baseEmpty = {
  name: '', website: '', phone: '', industry: '', sic_code: '',
  employee_count: '', annual_revenue: '',
  address_line1: '', address_line2: '', city: '', state: '', postal_code: '', country: '',
  owner_id: null,
};

// Red asterisk for required labels
function Req() {
  return <span className="text-danger ms-1">*</span>;
}

export default function OrganizationsList() {
  const { can } = useAuth();
  const [rows, setRows]   = useState([]);
  const [total, setTotal] = useState(0);
  const [q, setQ]         = useState('');
  const [show, setShow]   = useState(false);
  const [form, setForm]   = useState(baseEmpty);
  const [editId, setEditId] = useState(null);
  const [orgCfg, setOrgCfg] = useState({});
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const { confirm, dialog: confirmDialog } = useConfirm();

  async function load() {
    const { data } = await api.get('/organizations', { params: { q, pageSize: 100 } });
    setRows(data.rows); setTotal(data.total);
    setSelectedIds(new Set());
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [q]);

  function toggleRow(id) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  function toggleAllOnPage() {
    setSelectedIds((prev) =>
      prev.size === rows.length ? new Set() : new Set(rows.map((r) => r.id))
    );
  }
  useEffect(() => {
    api.get('/settings/module/organizations')
      .then((r) => setOrgCfg(r.data))
      .catch(() => {});
  }, []);

  function emptyWithDefaults() {
    return {
      ...baseEmpty,
      country:  orgCfg.default_country  || '',
      owner_id: orgCfg.default_owner_id || null,
    };
  }

  function openNew() {
    setEditId(null);
    setForm(emptyWithDefaults());
    setFormError('');
    setShow(true);
  }
  function openEdit(o) {
    setEditId(o.id);
    setForm({
      name: o.name || '', website: o.website || '', phone: o.phone || '',
      industry: o.industry || '', sic_code: o.sic_code || '',
      employee_count: o.employee_count || '', annual_revenue: o.annual_revenue || '',
      address_line1: o.address_line1 || '', address_line2: o.address_line2 || '',
      city: o.city || '', state: o.state || '',
      postal_code: o.postal_code || '', country: o.country || '',
      owner_id: o.owner_id || null,
    });
    setFormError('');
    setShow(true);
  }

  // Client-side required-field check (mirrors server validation)
  function clientValidate() {
    if (isBlank(form.name))                                   return 'Organization name is required.';
    if (orgCfg.require_website  && !form.website.trim())      return 'Website is required.';
    if (orgCfg.require_phone    && !form.phone.trim())         return 'Phone number is required.';
    if (orgCfg.require_industry && !form.industry.trim())      return 'Industry is required.';
    if (orgCfg.require_address  && !form.address_line1.trim()) return 'Street address is required.';
    return null;
  }

  async function save() {
    const clientErr = clientValidate();
    if (clientErr) { setFormError(clientErr); return; }

    const payload = {};
    for (const [k, v] of Object.entries(form)) {
      if (v === '' || v === null || v === undefined) continue;
      payload[k] = v;
    }
    if (!payload.name) payload.name = form.name;
    if (payload.employee_count != null) payload.employee_count = Number(payload.employee_count);
    if (payload.annual_revenue  != null) payload.annual_revenue  = Number(payload.annual_revenue);

    setSaving(true);
    setFormError('');
    try {
      if (editId) await api.put(`/organizations/${editId}`, payload);
      else        await api.post('/organizations', payload);
      setShow(false); setEditId(null); setForm(baseEmpty); load();
    } catch (err) {
      const msg = err?.response?.data?.error || err?.message || 'Save failed.';
      setFormError(msg);
    } finally {
      setSaving(false);
    }
  }

  async function remove(o) {
    if (!(await confirm(`Delete ${o.name}? This cannot be undone.`))) return;
    await api.delete(`/organizations/${o.id}`);
    load();
  }

  const req = (field) => !editId && orgCfg[`require_${field}`];

  return (
    <div>
      <PageHeader title="Organizations" subtitle={`${total.toLocaleString()} total`}
        actions={can('organizations.write') && (
          <button className="btn btn-primary" onClick={openNew}>
            <iconify-icon icon="solar:add-circle-line-duotone" class="me-1"></iconify-icon> New Organization
          </button>
        )} />

      <div className="card">
        <div className="card-body">
          <div className="d-flex gap-2 mb-3">
            <input className="form-control" placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          {can('organizations.write') && (
            <BulkActionBar
              entityType="organization"
              selectedIds={selectedIds}
              onClear={() => setSelectedIds(new Set())}
              onApplied={load}
            />
          )}
          <div className="table-responsive">
            <table className="table table-hover align-middle mb-0">
              <thead>
                <tr>
                  {can('organizations.write') && (
                    <th style={{ width: 32 }}>
                      <input type="checkbox" className="form-check-input"
                        checked={rows.length > 0 && selectedIds.size === rows.length}
                        onChange={toggleAllOnPage} />
                    </th>
                  )}
                  <th>Name</th><th>Industry</th><th>Website</th><th>Phone</th><th>Location</th><th className="text-end">Contacts</th><th className="text-end">Deals</th><th className="text-end">Actions</th></tr>
              </thead>
              <tbody>
                {rows.map((o) => (
                  <tr key={o.id}>
                    {can('organizations.write') && (
                      <td>
                        <input type="checkbox" className="form-check-input"
                          checked={selectedIds.has(o.id)} onChange={() => toggleRow(o.id)} />
                      </td>
                    )}
                    <td>
                      <Link to={`/admin/organizations/${o.id}`} className="text-decoration-none fw-semibold">{o.name}</Link>
                    </td>
                    <td>{o.industry || <span className="text-muted">—</span>}
                      {o.sic_code && <div><small className="text-muted">SIC {o.sic_code}</small></div>}
                    </td>
                    <td>{o.website && <a href={o.website} target="_blank" rel="noreferrer">{o.website.replace(/^https?:\/\//, '')}</a>}</td>
                    <td>{o.phone}</td>
                    <td>{[o.city, o.state].filter(Boolean).join(', ')}</td>
                    <td className="text-end">{o.contact_count}</td>
                    <td className="text-end">{o.deal_count}</td>
                    <td className="text-end text-nowrap">
                      {can('organizations.write') && (
                        <button className="btn btn-sm btn-light me-1" onClick={() => openEdit(o)} title="Edit">
                          <iconify-icon icon="solar:pen-new-square-line-duotone"></iconify-icon>
                        </button>
                      )}
                      {can('organizations.delete') && (
                        <button className="btn btn-sm btn-light text-danger" onClick={() => remove(o)} title="Delete">
                          <iconify-icon icon="solar:trash-bin-trash-line-duotone"></iconify-icon>
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                {rows.length === 0 && <tr><td colSpan={can('organizations.write') ? 9 : 8}><div className="empty-state">No organizations found.</div></td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <Modal show={show} onClose={() => { setShow(false); setEditId(null); }}
        title={editId ? 'Edit Organization' : 'New Organization'} size="lg"
        footer={
          <>
            <button className="btn btn-light" onClick={() => { setShow(false); setEditId(null); }}>Cancel</button>
            <button className="btn btn-primary" onClick={save} disabled={saving}>
              {saving ? <><span className="spinner-border spinner-border-sm me-2" />Saving…</> : 'Save'}
            </button>
          </>
        }>

        {formError && (
          <div className="alert alert-danger d-flex align-items-center gap-2 py-2 mb-3">
            <iconify-icon icon="solar:close-circle-line-duotone" class="fs-5"></iconify-icon>
            {formError}
          </div>
        )}

        <div className="row g-2">
          <div className="col-12">
            <label className="form-label">Name<Req /></label>
            <input className="form-control" value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div className="col-md-6">
            <label className="form-label">
              Industry / SIC{req('industry') && <Req />}
            </label>
            <IndustrySicSelect industry={form.industry} sicCode={form.sic_code}
              onChange={({ industry, sic_code }) => setForm({ ...form, industry, sic_code })} />
          </div>
          <div className="col-md-6">
            <label className="form-label">
              Phone{req('phone') && <Req />}
            </label>
            <PhoneInput value={form.phone} onChange={(v) => setForm({ ...form, phone: v })} />
          </div>
          <div className="col-md-6">
            <label className="form-label">
              Website{req('website') && <Req />}
            </label>
            <input className="form-control" value={form.website}
              onChange={(e) => setForm({ ...form, website: e.target.value })} />
          </div>
          <div className="col-md-3">
            <label className="form-label">Employees</label>
            <input type="number" className="form-control" value={form.employee_count}
              onChange={(e) => setForm({ ...form, employee_count: e.target.value })} />
          </div>
          <div className="col-md-3">
            <label className="form-label">Annual Revenue</label>
            <input type="number" className="form-control" value={form.annual_revenue}
              onChange={(e) => setForm({ ...form, annual_revenue: e.target.value })} />
          </div>
        </div>
        <hr />
        <AddressVerifier
          value={{
            address_line1: form.address_line1, address_line2: form.address_line2,
            city: form.city, state: form.state,
            postal_code: form.postal_code, country: form.country,
          }}
          onChange={(a) => setForm({ ...form, ...a })}
          compact
          requiredAddress={req('address')}
        />
      </Modal>
      {confirmDialog}
    </div>
  );
}
