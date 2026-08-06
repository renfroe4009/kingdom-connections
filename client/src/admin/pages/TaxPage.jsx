import { useEffect, useState } from 'react';
import api from '../../api/client.js';
import PageHeader from '../../components/PageHeader.jsx';
import Modal from '../../components/Modal.jsx';
import { useConfirm } from '../../hooks/useConfirm.jsx';
import { toast } from '../../components/Toast.jsx';
import { parseApiError } from '../../utils/apiError.js';

const empty = { name: '', country: 'US', state: '', rate_pct: '', is_active: true };

export default function TaxPage() {
  const { confirm, dialog: confirmDialog } = useConfirm();
  const [rows, setRows] = useState([]);
  const [show, setShow] = useState(false);
  const [form, setForm] = useState(empty);
  const [editId, setEditId] = useState(null);

  async function load() {
    const { data } = await api.get('/tax/rates');
    setRows(data);
  }
  useEffect(() => { load(); }, []);

  function openNew() { setEditId(null); setForm(empty); setShow(true); }
  function openEdit(r) {
    setEditId(r.id);
    setForm({ name: r.name, country: r.country, state: r.state || '', rate_pct: r.rate_pct, is_active: !!r.is_active });
    setShow(true);
  }
  async function save() {
    try {
      const payload = { ...form, rate_pct: Number(form.rate_pct) || 0, state: form.state || null };
      if (editId) await api.put(`/tax/rates/${editId}`, payload);
      else await api.post('/tax/rates', payload);
      setShow(false); load();
    } catch (e) {
      toast(parseApiError(e), 'error');
    }
  }
  async function remove(r) {
    if (!(await confirm(`Delete tax rate "${r.name}"?`, { danger: true }))) return;
    try {
      await api.delete(`/tax/rates/${r.id}`); load();
    } catch (e) {
      toast(parseApiError(e), 'error');
    }
  }

  return (
    <div>
      <PageHeader title="Tax Rates" subtitle={`${rows.length} rates`}
        actions={<button className="btn btn-primary" onClick={openNew}>+ New Rate</button>} />
      <div className="card">
        <div className="card-body">
          <div className="table-responsive">
            <table className="table table-hover align-middle mb-0">
              <thead><tr><th>Name</th><th>Country</th><th>State</th><th>Rate</th><th>Status</th><th className="text-end">Actions</th></tr></thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.id}>
                    <td className="fw-semibold">{r.name}</td>
                    <td>{r.country}</td>
                    <td>{r.state || 'All'}</td>
                    <td>{Number(r.rate_pct).toFixed(4)}%</td>
                    <td>{r.is_active ? <span className="badge bg-success-subtle text-success">Active</span> : <span className="badge bg-secondary-subtle text-secondary">Inactive</span>}</td>
                    <td className="text-end text-nowrap">
                      <button className="btn btn-sm btn-light me-1" onClick={() => openEdit(r)}>Edit</button>
                      <button className="btn btn-sm btn-light text-danger" onClick={() => remove(r)}>Delete</button>
                    </td>
                  </tr>
                ))}
                {rows.length === 0 && <tr><td colSpan="6"><div className="empty-state">No tax rates yet.</div></td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <Modal show={show} onClose={() => setShow(false)} title={editId ? 'Edit Tax Rate' : 'New Tax Rate'}
        footer={<><button className="btn btn-light" onClick={() => setShow(false)}>Cancel</button>
                  <button className="btn btn-primary" onClick={save}>Save</button></>}>
        <div className="row g-2">
          <div className="col-12"><label className="form-label">Name</label>
            <input className="form-control" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
          <div className="col-md-4"><label className="form-label">Country</label>
            <input className="form-control" maxLength={2} value={form.country} onChange={(e) => setForm({ ...form, country: e.target.value.toUpperCase() })} /></div>
          <div className="col-md-4"><label className="form-label">State <span className="text-muted">(blank = all)</span></label>
            <input className="form-control" maxLength={2} value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value.toUpperCase() })} /></div>
          <div className="col-md-4"><label className="form-label">Rate (%)</label>
            <input type="number" step="0.0001" className="form-control" value={form.rate_pct} onChange={(e) => setForm({ ...form, rate_pct: e.target.value })} /></div>
          <div className="col-12 form-check form-switch">
            <input className="form-check-input" type="checkbox" checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} id="tax-active" />
            <label className="form-check-label" htmlFor="tax-active">Active</label>
          </div>
        </div>
      </Modal>
      {confirmDialog}
    </div>
  );
}
