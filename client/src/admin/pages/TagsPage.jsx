import { useEffect, useState } from 'react';
import api from '../../api/client.js';
import PageHeader from '../../components/PageHeader.jsx';
import Modal from '../../components/Modal.jsx';
import { useConfirm } from '../../hooks/useConfirm.jsx';
import { toast } from '../../components/Toast.jsx';
import { parseApiError } from '../../utils/apiError.js';

const empty = { name: '', color: '#F05523', description: '' };

export default function TagsPage() {
  const [rows, setRows] = useState([]);
  const [show, setShow] = useState(false);
  const [form, setForm] = useState(empty);
  const [editId, setEditId] = useState(null);
  const { confirm, dialog: confirmDialog } = useConfirm();

  async function load() {
    const { data } = await api.get('/tags');
    setRows(data);
  }
  useEffect(() => { load(); }, []);

  function openNew() { setEditId(null); setForm(empty); setShow(true); }
  function openEdit(t) {
    setEditId(t.id);
    setForm({ name: t.name || '', color: t.color || '#F05523', description: t.description || '' });
    setShow(true);
  }

  async function save() {
    try {
      if (editId) await api.put(`/tags/${editId}`, form);
      else await api.post('/tags', form);
      setShow(false); setEditId(null); setForm(empty); load();
    } catch (e) {
      toast(parseApiError(e, 'Save failed'), 'error');
    }
  }

  async function remove(t) {
    if (!(await confirm(`Delete tag "${t.name}"?`))) return;
    try {
      await api.delete(`/tags/${t.id}`);
      load();
    } catch (e) {
      toast(parseApiError(e, 'Delete failed'), 'error');
    }
  }

  return (
    <div>
      <PageHeader title="Tags" subtitle={`${rows.length} tags`}
        actions={<button className="btn btn-primary" onClick={openNew}>
          <iconify-icon icon="solar:tag-line-duotone" class="me-1"></iconify-icon> New Tag
        </button>} />

      <div className="card">
        <div className="card-body">
          <div className="table-responsive">
            <table className="table table-hover align-middle mb-0">
              <thead><tr><th>Preview</th><th>Name</th><th>Description</th><th>Color</th><th className="text-end">Actions</th></tr></thead>
              <tbody>
                {rows.map((t) => (
                  <tr key={t.id}>
                    <td><span className="tag-chip" style={{ background: t.color }}>{t.name}</span></td>
                    <td className="fw-semibold">{t.name}</td>
                    <td className="text-muted">{t.description || '—'}</td>
                    <td><code>{t.color}</code></td>
                    <td className="text-end text-nowrap">
                      <button className="btn btn-sm btn-light me-1" onClick={() => openEdit(t)} title="Edit">
                        <iconify-icon icon="solar:pen-new-square-line-duotone"></iconify-icon>
                      </button>
                      <button className="btn btn-sm btn-light text-danger" onClick={() => remove(t)} title="Delete">
                        <iconify-icon icon="solar:trash-bin-trash-line-duotone"></iconify-icon>
                      </button>
                    </td>
                  </tr>
                ))}
                {rows.length === 0 && <tr><td colSpan="5"><div className="empty-state">No tags yet.</div></td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <Modal show={show} onClose={() => { setShow(false); setEditId(null); }} title={editId ? 'Edit Tag' : 'New Tag'}
        footer={<><button className="btn btn-light" onClick={() => { setShow(false); setEditId(null); }}>Cancel</button>
                  <button className="btn btn-primary" onClick={save}>Save</button></>}>
        <div className="row g-2">
          <div className="col-md-8"><label className="form-label">Name</label>
            <input className="form-control" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
          <div className="col-md-4"><label className="form-label">Color</label>
            <input type="color" className="form-control form-control-color" value={form.color} onChange={(e) => setForm({ ...form, color: e.target.value })} /></div>
          <div className="col-12"><label className="form-label">Description</label>
            <textarea className="form-control" rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
        </div>
      </Modal>

      {confirmDialog}
    </div>
  );
}
