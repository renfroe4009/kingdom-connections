import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../../api/client.js';
import PageHeader from '../../components/PageHeader.jsx';
import Modal from '../../components/Modal.jsx';
import QuickCreateOrg from '../components/QuickCreateOrg.jsx';
import QuickCreateContact from '../components/QuickCreateContact.jsx';
import FormErrorBanner from '../../components/FormErrorBanner.jsx';
import { useAuth } from '../../auth/AuthContext.jsx';
import { useConfirm } from '../../hooks/useConfirm.jsx';
import { isBlank } from '../../utils/validation.js';
import { parseApiError } from '../../utils/apiError.js';

const empty = {
  name: '', pipeline_id: null, stage_id: null,
  organization_id: null, primary_contact_id: null, amount: 0,
  expected_close_date: '', owner_id: null, description: '',
};

// Red asterisk for required labels
function Req() {
  return <span className="text-danger ms-1">*</span>;
}

export default function DealsList() {
  const { can, user } = useAuth();
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [pipelines, setPipelines] = useState([]);
  const [stages, setStages] = useState([]);
  const [orgs, setOrgs] = useState([]);
  const [contacts, setContacts] = useState([]);
  const [users, setUsers] = useState([]);
  const [show, setShow] = useState(false);
  const [form, setForm] = useState(empty);
  const [editId, setEditId] = useState(null);
  const [showQuickOrg, setShowQuickOrg] = useState(false);
  const [showQuickContact, setShowQuickContact] = useState(false);
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const { confirm, dialog: confirmDialog } = useConfirm();

  async function load() {
    const { data } = await api.get('/deals', { params: { q, status, pageSize: 100 } });
    setRows(data.rows); setTotal(data.total);
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [q, status]);
  useEffect(() => {
    api.get('/pipelines').then(async (r) => {
      setPipelines(r.data);
      const def = r.data.find((p) => p.is_default) || r.data[0];
      if (def) {
        setForm((f) => ({ ...f, pipeline_id: def.id }));
        const { data } = await api.get(`/pipelines/${def.id}/stages`);
        setStages(data);
        setForm((f) => ({ ...f, stage_id: data[0]?.id }));
      }
    });
    api.get('/organizations', { params: { pageSize: 200 } }).then((r) => setOrgs(r.data.rows));
    api.get('/contacts', { params: { pageSize: 500 } }).then((r) => setContacts(r.data.rows)).catch(() => {});
    api.get('/users/assignable').then((r) => setUsers(Array.isArray(r.data) ? r.data : [])).catch(() => {});
  }, []);

  async function loadStages(pid) {
    const { data } = await api.get(`/pipelines/${pid}/stages`);
    setStages(data);
    return data;
  }

  function openNew() {
    setEditId(null);
    setShowQuickOrg(false);
    setShowQuickContact(false);
    setForm({ ...empty, pipeline_id: pipelines[0]?.id || null, stage_id: stages[0]?.id || null, owner_id: user?.id ?? null });
    setFormError('');
    setShow(true);
  }
  async function openEdit(d) {
    setEditId(d.id);
    const pid = d.pipeline_id;
    const stgs = await loadStages(pid);
    setForm({
      name: d.name || '',
      pipeline_id: pid,
      stage_id: d.stage_id ?? stgs[0]?.id,
      organization_id: d.organization_id ?? null,
      primary_contact_id: d.primary_contact_id ?? null,
      amount: d.amount ?? 0,
      expected_close_date: d.expected_close_date || '',
      owner_id: d.owner_id ?? null,
      description: d.description || '',
    });
    setFormError('');
    setShow(true);
  }

  // Client-side validation (mirrors server validation)
  function clientValidate() {
    if (isBlank(form.name)) return 'Deal name is required.';
    if (!isBlank(form.amount) && Number(form.amount) < 0) return 'Amount cannot be negative.';
    if (form.expected_close_date && Number.isNaN(Date.parse(form.expected_close_date))) return 'Enter a valid close date.';
    return null;
  }

  async function save() {
    const clientErr = clientValidate();
    if (clientErr) { setFormError(clientErr); return; }

    const payload = {
      ...form,
      amount: Number(form.amount || 0),
      pipeline_id: Number(form.pipeline_id),
      stage_id: Number(form.stage_id),
      organization_id: form.organization_id ? Number(form.organization_id) : null,
      primary_contact_id: form.primary_contact_id ? Number(form.primary_contact_id) : null,
      owner_id: form.owner_id ? Number(form.owner_id) : null,
      expected_close_date: form.expected_close_date || null,
    };
    setSaving(true);
    setFormError('');
    try {
      if (editId) await api.put(`/deals/${editId}`, payload);
      else await api.post('/deals', payload);
      setShow(false); setEditId(null); setForm({ ...empty, pipeline_id: form.pipeline_id, stage_id: stages[0]?.id });
      load();
    } catch (err) {
      setFormError(parseApiError(err));
    } finally {
      setSaving(false);
    }
  }

  async function remove(d) {
    if (!(await confirm(`Delete deal "${d.name}"? This cannot be undone.`))) return;
    await api.delete(`/deals/${d.id}`);
    load();
  }

  const fmt = (n) => `$${Number(n || 0).toLocaleString()}`;

  return (
    <div>
      <PageHeader title="Deals" subtitle={`${total.toLocaleString()} total`}
        actions={<>
          <Link to="/admin/pipeline" className="btn btn-light">
            <iconify-icon icon="solar:chart-2-line-duotone" class="me-1"></iconify-icon> Pipeline view
          </Link>
          {can('deals.write') && <button className="btn btn-primary" onClick={openNew}>
            <iconify-icon icon="solar:add-circle-line-duotone" class="me-1"></iconify-icon> New Deal
          </button>}
        </>} />

      <div className="card">
        <div className="card-body">
          <div className="d-flex gap-2 mb-3">
            <input className="form-control" placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} />
            <select className="form-select" style={{ maxWidth: 180 }} value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">All statuses</option>
              <option value="open">Open</option>
              <option value="won">Won</option>
              <option value="lost">Lost</option>
            </select>
          </div>
          <div className="table-responsive">
            <table className="table table-hover align-middle mb-0">
              <thead>
                <tr><th>Name</th><th>Org</th><th>Stage</th><th className="text-end">Amount</th><th>Close Date</th><th>Owner</th><th>Status</th><th className="text-end">Actions</th></tr>
              </thead>
              <tbody>
                {rows.map((d) => (
                  <tr key={d.id}>
                    <td><Link to={`/admin/deals/${d.id}`} className="fw-semibold text-decoration-none">{d.name}</Link></td>
                    <td>{d.organization_name}</td>
                    <td><span className="badge bg-primary-subtle text-primary">{d.stage_name}</span></td>
                    <td className="text-end fw-bold">{fmt(d.amount)}</td>
                    <td>{d.expected_close_date}</td>
                    <td>{d.owner_name}</td>
                    <td><span className={`badge bg-${d.status === 'won' ? 'success' : d.status === 'lost' ? 'danger' : 'warning'}-subtle text-${d.status === 'won' ? 'success' : d.status === 'lost' ? 'danger' : 'warning'}`}>{d.status}</span></td>
                    <td className="text-end text-nowrap">
                      {can('deals.write') && (
                        <button className="btn btn-sm btn-light me-1" onClick={() => openEdit(d)} title="Edit">
                          <iconify-icon icon="solar:pen-new-square-line-duotone"></iconify-icon>
                        </button>
                      )}
                      {can('deals.delete') && (
                        <button className="btn btn-sm btn-light text-danger" onClick={() => remove(d)} title="Delete">
                          <iconify-icon icon="solar:trash-bin-trash-line-duotone"></iconify-icon>
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                {rows.length === 0 && <tr><td colSpan="8"><div className="empty-state">No deals.</div></td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <Modal show={show} onClose={() => { setShow(false); setEditId(null); }} title={editId ? 'Edit Deal' : 'New Deal'} size="lg"
        footer={<><button className="btn btn-light" onClick={() => { setShow(false); setEditId(null); }}>Cancel</button>
                  <button className="btn btn-primary" onClick={save} disabled={saving}>
                    {saving ? <><span className="spinner-border spinner-border-sm me-2" />Saving…</> : 'Save'}
                  </button></>}>
        <FormErrorBanner error={formError} />
        <div className="row g-2">
          <div className="col-12"><label className="form-label">Name<Req /></label>
            <input className="form-control" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
          <div className="col-md-6"><label className="form-label">Pipeline</label>
            <select className="form-select" value={form.pipeline_id || ''} onChange={async (e) => {
              const pid = e.target.value;
              const data = await loadStages(pid);
              setForm({ ...form, pipeline_id: pid, stage_id: data[0]?.id });
            }}>
              {pipelines.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select></div>
          <div className="col-md-6"><label className="form-label">Stage</label>
            <select className="form-select" value={form.stage_id || ''} onChange={(e) => setForm({ ...form, stage_id: e.target.value })}>
              {stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select></div>
          <div className="col-md-6">
            <div className="d-flex align-items-center justify-content-between mb-1">
              <label className="form-label mb-0">Primary Contact</label>
              {!showQuickContact && (
                <button type="button" className="btn btn-link btn-sm p-0 text-primary" onClick={() => setShowQuickContact(true)}>
                  <iconify-icon icon="solar:add-circle-line-duotone" class="me-1"></iconify-icon>New
                </button>
              )}
            </div>
            <select
              className="form-select"
              value={form.primary_contact_id ?? ''}
              onChange={(e) => {
                const cid = e.target.value || null;
                const contact = contacts.find((c) => String(c.id) === String(cid));
                const updates = { primary_contact_id: cid };
                // Auto-bind org from contact if org not already set
                if (contact?.organization_id && !form.organization_id) {
                  updates.organization_id = contact.organization_id;
                }
                setForm((f) => ({ ...f, ...updates }));
              }}
            >
              <option value="">— None —</option>
              {(form.organization_id
                ? contacts.filter((c) => Number(c.organization_id) === Number(form.organization_id))
                : contacts
              ).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.first_name} {c.last_name}{c.email ? ` (${c.email})` : ''}
                </option>
              ))}
            </select>
            {showQuickContact && (
              <QuickCreateContact
                organizationId={form.organization_id ? Number(form.organization_id) : null}
                onCreated={(contact) => {
                  setContacts((prev) => [...prev, contact]);
                  setForm((f) => ({ ...f, primary_contact_id: contact.id, organization_id: contact.organization_id ?? f.organization_id }));
                  setShowQuickContact(false);
                }}
                onCancel={() => setShowQuickContact(false)}
              />
            )}
          </div>
          <div className="col-md-6">
            <div className="d-flex align-items-center justify-content-between mb-1">
              <label className="form-label mb-0">Organization</label>
              {!showQuickOrg && (
                <button type="button" className="btn btn-link btn-sm p-0 text-primary" onClick={() => setShowQuickOrg(true)}>
                  <iconify-icon icon="solar:add-circle-line-duotone" class="me-1"></iconify-icon>New
                </button>
              )}
            </div>
            <select
              className="form-select"
              value={form.organization_id ?? ''}
              onChange={(e) => {
                const oid = e.target.value || null;
                // Clear contact if it doesn't belong to the newly selected org
                const currentContact = contacts.find((c) => String(c.id) === String(form.primary_contact_id));
                const contactBelongs = !oid || !currentContact || String(currentContact.organization_id) === String(oid);
                setForm((f) => ({
                  ...f,
                  organization_id: oid,
                  primary_contact_id: contactBelongs ? f.primary_contact_id : null,
                }));
              }}
            >
              <option value="">—</option>
              {orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
            {showQuickOrg && (
              <QuickCreateOrg
                onCreated={(org) => {
                  setOrgs((prev) => [...prev, org]);
                  setForm((f) => ({ ...f, organization_id: org.id }));
                  setShowQuickOrg(false);
                }}
                onCancel={() => setShowQuickOrg(false)}
              />
            )}
          </div>
          <div className="col-md-6"><label className="form-label">Owner</label>
            <select className="form-select" value={form.owner_id ?? ''} onChange={(e) => setForm({ ...form, owner_id: e.target.value })}>
              <option value="">— Unassigned —</option>
              {users.map((u) => <option key={u.id} value={u.id}>{u.first_name} {u.last_name}</option>)}
            </select></div>
          <div className="col-md-3"><label className="form-label">Amount</label>
            <input type="number" className="form-control" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></div>
          <div className="col-md-3"><label className="form-label">Close Date</label>
            <input type="date" className="form-control" value={form.expected_close_date || ''} onChange={(e) => setForm({ ...form, expected_close_date: e.target.value })} /></div>
          <div className="col-12"><label className="form-label">Description</label>
            <textarea className="form-control" rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
        </div>
      </Modal>
      {confirmDialog}
    </div>
  );
}
