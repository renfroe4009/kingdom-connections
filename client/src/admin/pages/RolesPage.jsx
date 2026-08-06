import { useEffect, useState } from 'react';
import api from '../../api/client.js';
import PageHeader from '../../components/PageHeader.jsx';
import Modal from '../../components/Modal.jsx';
import { useConfirm } from '../../hooks/useConfirm.jsx';
import { toast } from '../../components/Toast.jsx';
import { parseApiError } from '../../utils/apiError.js';

const empty = { name: '', description: '', permission_ids: [] };

export default function RolesPage() {
  const { confirm, dialog: confirmDialog } = useConfirm();
  const [rows, setRows] = useState([]);
  const [perms, setPerms] = useState([]);
  const [show, setShow] = useState(false);
  const [form, setForm] = useState(empty);
  const [editId, setEditId] = useState(null);

  async function load() {
    const [r, p] = await Promise.all([api.get('/roles'), api.get('/roles/meta/permissions')]);
    setRows(r.data); setPerms(p.data);
  }
  useEffect(() => { load(); }, []);

  function openNew() { setEditId(null); setForm(empty); setShow(true); }
  function openEdit(r) {
    setEditId(r.id);
    setForm({
      name: r.name,
      description: r.description || '',
      permission_ids: (r.permissions || []).map((p) => p.id),
    });
    setShow(true);
  }

  async function save() {
    try {
      const payload = { ...form, permission_ids: form.permission_ids.map(Number) };
      if (editId) await api.put(`/roles/${editId}`, payload);
      else await api.post('/roles', payload);
      setShow(false); setForm(empty); setEditId(null); load();
    } catch (e) {
      toast(parseApiError(e), 'error');
    }
  }

  async function remove(r) {
    if (r.is_system) { toast('System roles cannot be deleted.', 'error'); return; }
    if (!(await confirm(`Delete role "${r.name}"? Users currently assigned will lose this role.`, { danger: true }))) return;
    try {
      await api.delete(`/roles/${r.id}`);
      load();
    } catch (e) {
      toast(parseApiError(e), 'error');
    }
  }

  function togglePerm(pid) {
    setForm((f) => {
      const has = f.permission_ids.includes(pid);
      return { ...f, permission_ids: has ? f.permission_ids.filter((x) => x !== pid) : [...f.permission_ids, pid] };
    });
  }

  function toggleGroup(items) {
    setForm((f) => {
      const ids = items.map((p) => p.id);
      const allOn = ids.every((id) => f.permission_ids.includes(id));
      const next = allOn
        ? f.permission_ids.filter((id) => !ids.includes(id))
        : [...new Set([...f.permission_ids, ...ids])];
      return { ...f, permission_ids: next };
    });
  }

  // Group permissions by resource (prefix before the first dot)
  const RESOURCE_ORDER = ['contacts', 'organizations', 'deals', 'pipelines', 'tasks', 'notes', 'reports', 'import', 'cw', 'users', 'roles', 'settings'];
  const RESOURCE_LABELS = {
    contacts: 'Contacts', organizations: 'Organizations', deals: 'Deals',
    pipelines: 'Pipelines', tasks: 'Tasks', notes: 'Notes',
    reports: 'Reports', import: 'Import', cw: 'ConnectWise',
    users: 'Users', roles: 'Roles', settings: 'Settings',
  };
  const grouped = perms.reduce((acc, p) => {
    const res = p.key.split('.')[0];
    (acc[res] = acc[res] || []).push(p);
    return acc;
  }, {});
  const orderedGroups = [
    ...RESOURCE_ORDER.filter((r) => grouped[r]).map((r) => [r, grouped[r]]),
    ...Object.entries(grouped).filter(([r]) => !RESOURCE_ORDER.includes(r)),
  ];

  return (
    <div>
      <PageHeader title="Roles & Permissions" subtitle={`${rows.length} roles · ${perms.length} permissions`}
        actions={<button className="btn btn-primary" onClick={openNew}>
          <iconify-icon icon="solar:shield-user-line-duotone" class="me-1"></iconify-icon> New Role
        </button>} />

      <div className="row">
        {rows.map((r) => (
          <div key={r.id} className="col-md-6 col-lg-4 mb-3">
            <div className="card h-100">
              <div className="card-body">
                <div className="d-flex justify-content-between align-items-start">
                  <div>
                    <h5 className="mb-1">{r.name}</h5>
                    <small className="text-muted">{r.description || 'No description'}</small>
                  </div>
                  {r.is_system ? <span className="badge bg-info-subtle text-info">System</span> : null}
                </div>
                <div className="mt-3">
                  <div className="small text-muted mb-1">
                    {(r.permissions || []).length} permissions · {r.user_count || 0} user{r.user_count === 1 ? '' : 's'}
                  </div>
                  <div className="d-flex flex-wrap gap-1">
                    {(r.permissions || []).slice(0, 8).map((p) => (
                      <span key={p.id} className="badge bg-light text-dark">{p.key}</span>
                    ))}
                    {(r.permissions || []).length > 8 && <span className="badge bg-light text-muted">+{r.permissions.length - 8}</span>}
                  </div>
                </div>
                <div className="mt-3 d-flex gap-2">
                  <button className="btn btn-sm btn-light" onClick={() => openEdit(r)}>Edit</button>
                  {!r.is_system && <button className="btn btn-sm btn-light text-danger" onClick={() => remove(r)}>Delete</button>}
                </div>
              </div>
            </div>
          </div>
        ))}
        {rows.length === 0 && <div className="col-12"><div className="empty-state">No roles.</div></div>}
      </div>

      <Modal show={show} onClose={() => setShow(false)} title={editId ? 'Edit Role' : 'New Role'} size="lg"
        footer={<><button className="btn btn-light" onClick={() => setShow(false)}>Cancel</button>
                  <button className="btn btn-primary" onClick={save}>Save</button></>}>
        <div className="row g-2 mb-3">
          <div className="col-md-4"><label className="form-label">Name</label>
            <input className="form-control" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
          <div className="col-md-8"><label className="form-label">Description</label>
            <input className="form-control" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
        </div>
        <h6 className="fw-bold text-uppercase small text-muted mb-2">Permissions</h6>
        <div className="small text-muted mb-3">
          {form.permission_ids.length} of {perms.length} selected
        </div>
        {orderedGroups.map(([res, items]) => {
          const allOn = items.every((p) => form.permission_ids.includes(p.id));
          return (
            <div key={res} className="mb-3 pb-2 border-bottom">
              <div className="d-flex justify-content-between align-items-center mb-2">
                <div className="fw-semibold">{RESOURCE_LABELS[res] || res}</div>
                <button type="button" className="btn btn-sm btn-link text-decoration-none p-0" onClick={() => toggleGroup(items)}>
                  {allOn ? 'Clear all' : 'Select all'}
                </button>
              </div>
              <div className="d-flex flex-wrap gap-2">
                {items.map((p) => (
                  <label key={p.id} className={`btn btn-sm ${form.permission_ids.includes(p.id) ? 'btn-primary' : 'btn-light'}`} title={p.description || p.key}>
                    <input type="checkbox" hidden checked={form.permission_ids.includes(p.id)} onChange={() => togglePerm(p.id)} />
                    {p.key.split('.')[1] || p.key}
                  </label>
                ))}
              </div>
            </div>
          );
        })}
      </Modal>
      {confirmDialog}
    </div>
  );
}
