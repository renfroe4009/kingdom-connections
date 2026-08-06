import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../../api/client.js';
import PageHeader from '../../components/PageHeader.jsx';
import Modal from '../../components/Modal.jsx';
import FormErrorBanner from '../../components/FormErrorBanner.jsx';
import { toast } from '../../components/Toast.jsx';
import { parseApiError } from '../../utils/apiError.js';
import { useConfirm } from '../../hooks/useConfirm.jsx';
import { useAuth } from '../../auth/AuthContext.jsx';

function blankFund() {
  return { id: null, kind: 'fund', name: '', slug: '', description: '', fund_code: '', sms_keyword: '', goal_amount: '', start_date: '', end_date: '', is_active: true };
}

function fmtMoney(n) {
  return `$${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function FundsList() {
  const { can } = useAuth();
  const { confirm, dialog: confirmDialog } = useConfirm();
  const [rows, setRows] = useState([]);
  const [show, setShow] = useState(false);
  const [form, setForm] = useState(blankFund());
  const [formError, setFormError] = useState('');

  async function load() {
    const { data } = await api.get('/donations/admin/funds');
    setRows(data);
  }
  useEffect(() => { load(); }, []);

  function openNew() { setForm(blankFund()); setFormError(''); setShow(true); }
  function openEdit(f) {
    setForm({
      id: f.id, kind: f.kind, name: f.name, slug: f.slug, description: f.description || '',
      fund_code: f.fund_code || '', sms_keyword: f.sms_keyword || '', goal_amount: f.goal_amount || '',
      start_date: f.start_date || '', end_date: f.end_date || '', is_active: !!f.is_active,
    });
    setFormError('');
    setShow(true);
  }

  async function save() {
    if (!form.name) { setFormError('Give this fund a name.'); return; }
    const payload = {
      kind: form.kind, name: form.name, slug: form.slug || undefined,
      description: form.description || null, fund_code: form.fund_code || null,
      sms_keyword: form.sms_keyword || null,
      goal_amount: form.goal_amount ? Number(form.goal_amount) : null,
      start_date: form.start_date || null, end_date: form.end_date || null,
      is_active: !!form.is_active,
    };
    try {
      if (form.id) await api.put(`/donations/admin/funds/${form.id}`, payload);
      else await api.post('/donations/admin/funds', payload);
      setShow(false);
      load();
    } catch (e) {
      setFormError(parseApiError(e));
    }
  }

  async function remove(f) {
    if (!(await confirm(`Delete fund "${f.name}"? Existing donations keep their history but lose this designation.`, { danger: true }))) return;
    try {
      await api.delete(`/donations/admin/funds/${f.id}`);
      load();
    } catch (e) {
      toast(parseApiError(e), 'error');
    }
  }

  return (
    <div>
      <PageHeader title="Funds & Campaigns" subtitle="Designations donors can give toward"
        actions={<>
          <Link to="/admin/donations" className="btn btn-light">← Donations</Link>
          {can('donations.write') && (
            <button className="btn btn-primary ms-2" onClick={openNew}>
              <iconify-icon icon="solar:add-circle-line-duotone" class="me-1"></iconify-icon> New Fund
            </button>
          )}
        </>} />

      <div className="card">
        <div className="card-body">
          <div className="table-responsive">
            <table className="table table-hover align-middle mb-0">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Type</th>
                  <th className="text-end">Goal</th>
                  <th>Active</th>
                  <th style={{ width: 110 }} className="text-end">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((f) => (
                  <tr key={f.id}>
                    <td className="fw-semibold">{f.name}<div className="text-muted small">/{f.slug}</div></td>
                    <td className="text-capitalize">{f.kind}</td>
                    <td className="text-end">{f.goal_amount ? fmtMoney(f.goal_amount) : '—'}</td>
                    <td>{f.is_active ? <span className="badge bg-success-subtle text-success">Active</span> : <span className="badge bg-secondary-subtle text-secondary">Inactive</span>}</td>
                    <td className="text-end">
                      {can('donations.write') && (
                        <>
                          <button className="btn btn-sm btn-light" onClick={() => openEdit(f)}>
                            <iconify-icon icon="solar:pen-line-duotone"></iconify-icon>
                          </button>
                          <button className="btn btn-sm btn-light text-danger ms-1" onClick={() => remove(f)}>
                            <iconify-icon icon="solar:trash-bin-trash-line-duotone"></iconify-icon>
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
                {rows.length === 0 && <tr><td colSpan="5"><div className="empty-state">No funds yet — create one to start accepting designated gifts.</div></td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <Modal show={show} onClose={() => setShow(false)} title={form.id ? 'Edit Fund' : 'New Fund'} size="md"
        footer={<><button className="btn btn-light" onClick={() => setShow(false)}>Cancel</button>
                  <button className="btn btn-primary" onClick={save}>Save</button></>}>
        <FormErrorBanner error={formError} />
        <div className="row g-2">
          <div className="col-md-8"><label className="form-label">Name</label>
            <input className="form-control" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Where needed most" /></div>
          <div className="col-md-4"><label className="form-label">Type</label>
            <select className="form-select" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
              <option value="fund">Fund</option>
              <option value="campaign">Campaign</option>
            </select></div>
          <div className="col-12"><label className="form-label">Slug (URL-safe, auto-generated if left blank)</label>
            <input className="form-control" value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} placeholder="where-needed-most" /></div>
          <div className="col-12"><label className="form-label">Description</label>
            <textarea className="form-control" rows="2" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
          <div className="col-md-6"><label className="form-label">Goal amount (optional)</label>
            <input type="number" step="0.01" className="form-control" value={form.goal_amount} onChange={(e) => setForm({ ...form, goal_amount: e.target.value })} /></div>
          <div className="col-md-6"><label className="form-label">Fund/GL code (optional)</label>
            <input className="form-control" value={form.fund_code} onChange={(e) => setForm({ ...form, fund_code: e.target.value })} /></div>
          <div className="col-md-6"><label className="form-label">SMS keyword (optional)</label>
            <input className="form-control" value={form.sms_keyword} placeholder="SCHOLARSHIP"
              onChange={(e) => setForm({ ...form, sms_keyword: e.target.value.toUpperCase() })} />
            <div className="form-text">Lets donors text-to-give directly to this fund, e.g. "GIVE SCHOLARSHIP". Enable Text to Give under Settings → Twilio/SMS.</div>
          </div>
          <div className="col-md-6"><label className="form-label">Start date (optional)</label>
            <input type="date" className="form-control" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} /></div>
          <div className="col-md-6"><label className="form-label">End date (optional)</label>
            <input type="date" className="form-control" value={form.end_date} onChange={(e) => setForm({ ...form, end_date: e.target.value })} /></div>
          <div className="col-12">
            <div className="form-check form-switch">
              <input className="form-check-input" type="checkbox" id="fund_active" checked={form.is_active}
                onChange={(e) => setForm({ ...form, is_active: e.target.checked })} />
              <label className="form-check-label" htmlFor="fund_active">Active (shows in the public donation picker)</label>
            </div>
          </div>
        </div>
      </Modal>

      {confirmDialog}
    </div>
  );
}
