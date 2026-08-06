import { useEffect, useState } from 'react';
import api from '../../api/client.js';
import PageHeader from '../../components/PageHeader.jsx';
import Modal from '../../components/Modal.jsx';
import { useConfirm } from '../../hooks/useConfirm.jsx';
import { toast } from '../../components/Toast.jsx';
import { parseApiError } from '../../utils/apiError.js';

const empty = { name: '', description: '', parent_id: '', sort_order: 0, is_active: true };

export default function CategoriesPage() {
  const [rows, setRows] = useState([]);
  const [show, setShow] = useState(false);
  const [form, setForm] = useState(empty);
  const [editId, setEditId] = useState(null);
  const { confirm, dialog: confirmDialog } = useConfirm();

  async function load() {
    const { data } = await api.get('/products/categories?all=1');
    setRows(data);
  }
  useEffect(() => { load(); }, []);

  function openNew() { setEditId(null); setForm(empty); setShow(true); }
  function openEdit(c) {
    setEditId(c.id);
    setForm({
      name: c.name || '', description: c.description || '',
      parent_id: c.parent_id || '', sort_order: c.sort_order || 0, is_active: !!c.is_active,
    });
    setShow(true);
  }

  async function save() {
    const payload = { ...form, parent_id: form.parent_id ? Number(form.parent_id) : null, sort_order: Number(form.sort_order) || 0 };
    try {
      if (editId) await api.put(`/products/categories/${editId}`, payload);
      else await api.post('/products/categories', payload);
      setShow(false); setEditId(null); setForm(empty); load();
    } catch (e) {
      toast(parseApiError(e, 'Save failed'), 'error');
    }
  }

  async function remove(c) {
    if (!(await confirm(`Delete category "${c.name}"? Products in it will become uncategorized.`))) return;
    try {
      await api.delete(`/products/categories/${c.id}`);
      load();
    } catch (e) {
      toast(parseApiError(e, 'Delete failed'), 'error');
    }
  }

  function parentName(id) {
    return rows.find(r => r.id === id)?.name || '—';
  }

  return (
    <div>
      <PageHeader title="Product Categories" subtitle={`${rows.length} categories`}
        actions={<button className="btn btn-primary" onClick={openNew}>
          <iconify-icon icon="solar:folder-with-files-line-duotone" class="me-1"></iconify-icon> New Category
        </button>} />

      <div className="card">
        <div className="card-body">
          <div className="table-responsive">
            <table className="table table-hover align-middle mb-0">
              <thead><tr><th>Name</th><th>Parent</th><th>Status</th><th className="text-end">Actions</th></tr></thead>
              <tbody>
                {rows.map((c) => (
                  <tr key={c.id}>
                    <td className="fw-semibold">{c.name}</td>
                    <td className="text-muted">{c.parent_id ? parentName(c.parent_id) : '—'}</td>
                    <td>{c.is_active ? <span className="badge bg-success-subtle text-success">Active</span> : <span className="badge bg-secondary-subtle text-secondary">Inactive</span>}</td>
                    <td className="text-end text-nowrap">
                      <button className="btn btn-sm btn-light me-1" onClick={() => openEdit(c)} title="Edit">
                        <iconify-icon icon="solar:pen-new-square-line-duotone"></iconify-icon>
                      </button>
                      <button className="btn btn-sm btn-light text-danger" onClick={() => remove(c)} title="Delete">
                        <iconify-icon icon="solar:trash-bin-trash-line-duotone"></iconify-icon>
                      </button>
                    </td>
                  </tr>
                ))}
                {rows.length === 0 && <tr><td colSpan="4"><div className="empty-state">No categories yet.</div></td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <Modal show={show} onClose={() => { setShow(false); setEditId(null); }} title={editId ? 'Edit Category' : 'New Category'}
        footer={<><button className="btn btn-light" onClick={() => { setShow(false); setEditId(null); }}>Cancel</button>
                  <button className="btn btn-primary" onClick={save}>Save</button></>}>
        <div className="row g-2">
          <div className="col-md-8"><label className="form-label">Name</label>
            <input className="form-control" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
          <div className="col-md-4"><label className="form-label">Sort Order</label>
            <input type="number" className="form-control" value={form.sort_order} onChange={(e) => setForm({ ...form, sort_order: e.target.value })} /></div>
          <div className="col-md-8"><label className="form-label">Parent Category</label>
            <select className="form-select" value={form.parent_id} onChange={(e) => setForm({ ...form, parent_id: e.target.value })}>
              <option value="">None (top level)</option>
              {rows.filter(r => r.id !== editId).map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </div>
          <div className="col-md-4 d-flex align-items-end">
            <div className="form-check form-switch">
              <input className="form-check-input" type="checkbox" checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} id="cat-active" />
              <label className="form-check-label" htmlFor="cat-active">Active</label>
            </div>
          </div>
          <div className="col-12"><label className="form-label">Description</label>
            <textarea className="form-control" rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
        </div>
      </Modal>

      {confirmDialog}
    </div>
  );
}
