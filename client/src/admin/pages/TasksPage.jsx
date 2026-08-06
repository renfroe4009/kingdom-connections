import { useEffect, useState } from 'react';
import api from '../../api/client.js';
import PageHeader from '../../components/PageHeader.jsx';
import Modal from '../../components/Modal.jsx';
import FormErrorBanner from '../../components/FormErrorBanner.jsx';
import { useAuth } from '../../auth/AuthContext.jsx';
import { useConfirm } from '../../hooks/useConfirm.jsx';
import { useIntegrations } from '../context/IntegrationsContext.jsx';
import { parseApiError } from '../../utils/apiError.js';
import { isBlank } from '../../utils/validation.js';

const empty = {
  title: '', description: '', due_date: '', assignee_id: null,
  entity_type: '', entity_id: null, priority: 'normal', sync_to_calendar: false,
};

// Red asterisk for required labels
function Req() {
  return <span className="text-danger ms-1">*</span>;
}

export default function TasksPage() {
  const { can, user } = useAuth();
  const { google: googleConnected } = useIntegrations();
  const { confirm, dialog: confirmDialog } = useConfirm();
  const [rows, setRows]               = useState([]);
  const [filter, setFilter]           = useState('open');
  const [users, setUsers]             = useState([]);
  const [show, setShow]               = useState(false);
  const [form, setForm]               = useState(empty);
  const [editId, setEditId]           = useState(null);
  const [formError, setFormError]     = useState('');

  async function load() {
    const { data } = await api.get('/tasks', { params: { status: filter === 'all' ? '' : filter } });
    setRows(data);
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [filter]);
  useEffect(() => {
    api.get('/users/assignable').then((r) => setUsers(Array.isArray(r.data) ? r.data : [])).catch(() => {});
  }, []);

  function openNew() { setEditId(null); setForm(empty); setFormError(''); setShow(true); }
  function openEdit(t) {
    setEditId(t.id);
    setForm({
      title:             t.title || '',
      description:       t.description || '',
      due_date:          t.due_date ? String(t.due_date).replace(' ', 'T').slice(0, 16) : '',
      assignee_id:       t.assigned_to ?? null,
      entity_type:       t.entity_type || '',
      entity_id:         t.entity_id ?? null,
      priority:          t.priority || 'normal',
      sync_to_calendar:  !!t.sync_to_calendar,
    });
    setFormError('');
    setShow(true);
  }

  // Client-side required-field check (mirrors server validation)
  function clientValidate() {
    if (isBlank(form.title)) return 'Task title is required.';
    return null;
  }

  async function save() {
    const clientErr = clientValidate();
    if (clientErr) { setFormError(clientErr); return; }

    const payload = {
      title:            form.title,
      description:      form.description || null,
      due_date:         form.due_date || null,
      priority:         form.priority,
      assigned_to:      form.assignee_id ? Number(form.assignee_id) : (user?.id || null),
      entity_type:      form.entity_type || null,
      entity_id:        form.entity_id ? Number(form.entity_id) : null,
      sync_to_calendar: form.sync_to_calendar,
    };
    setFormError('');
    try {
      if (editId) await api.put(`/tasks/${editId}`, payload);
      else        await api.post('/tasks', payload);
      setShow(false); setEditId(null); setForm(empty); load();
    } catch (err) {
      setFormError(parseApiError(err));
    }
  }

  async function remove(t) {
    if (!(await confirm(`Delete task "${t.title}"?`))) return;
    await api.delete(`/tasks/${t.id}`);
    load();
  }

  async function toggle(t) {
    const newStatus = t.status === 'completed' ? 'open' : 'completed';
    await api.put(`/tasks/${t.id}`, { status: newStatus });
    load();
  }

  function dueBadge(t) {
    if (t.status === 'completed') return <span className="badge bg-success-subtle text-success">Done</span>;
    if (!t.due_date) return <span className="badge bg-light text-muted">No due date</span>;
    const due = new Date(t.due_date);
    const now = new Date();
    const day = 1000 * 60 * 60 * 24;
    if (due < now)         return <span className="badge bg-danger-subtle text-danger">Overdue</span>;
    if (due - now < day)   return <span className="badge bg-warning-subtle text-warning">Due today</span>;
    return <span className="badge bg-primary-subtle text-primary">{due.toLocaleDateString()}</span>;
  }

  return (
    <div>
      <PageHeader title="Tasks" subtitle={`${rows.length} tasks`}
        actions={can('tasks.write') && <button className="btn btn-primary" onClick={openNew}>
          <iconify-icon icon="solar:add-circle-line-duotone" class="me-1"></iconify-icon> New Task
        </button>} />

      <div className="card">
        <div className="card-body">
          <div className="d-flex gap-2 mb-3 flex-wrap">
            {['open', 'overdue', 'today', 'this_week', 'completed', 'all'].map((f) => (
              <button key={f} className={`btn btn-sm ${filter === f ? 'btn-primary' : 'btn-light'}`} onClick={() => setFilter(f)}>
                {f.replace('_', ' ')}
              </button>
            ))}
          </div>
          <ul className="list-unstyled mb-0">
            {rows.map((t) => (
              <li key={t.id} className="py-2 border-top d-flex justify-content-between align-items-center">
                <div className="d-flex align-items-center gap-2 flex-grow-1">
                  <input type="checkbox" className="form-check-input" checked={t.status === 'completed'} onChange={() => toggle(t)} />
                  <div>
                    <div className={`fw-semibold ${t.status === 'completed' ? 'text-decoration-line-through text-muted' : ''}`}>
                      {t.title}
                      {t.google_calendar_event_id && (
                        <iconify-icon icon="logos:google-calendar" class="ms-2" style={{ fontSize: 14 }} title="Synced to Google Calendar"></iconify-icon>
                      )}
                    </div>
                    <small className="text-muted">
                      {t.assignee_name || 'Unassigned'}
                      {t.entity_type && t.entity_id ? ` · ${t.entity_type} #${t.entity_id}` : ''}
                    </small>
                  </div>
                </div>
                <div className="d-flex align-items-center gap-2">
                  {dueBadge(t)}
                  {can('tasks.write') && (
                    <button className="btn btn-sm btn-light" onClick={() => openEdit(t)} title="Edit">
                      <iconify-icon icon="solar:pen-new-square-line-duotone"></iconify-icon>
                    </button>
                  )}
                  {can('tasks.write') && (
                    <button className="btn btn-sm btn-light text-danger" onClick={() => remove(t)} title="Delete">
                      <iconify-icon icon="solar:trash-bin-trash-line-duotone"></iconify-icon>
                    </button>
                  )}
                </div>
              </li>
            ))}
            {rows.length === 0 && <li><div className="empty-state">No tasks.</div></li>}
          </ul>
        </div>
      </div>

      <Modal show={show} onClose={() => { setShow(false); setEditId(null); }} title={editId ? 'Edit Task' : 'New Task'}
        footer={<><button className="btn btn-light" onClick={() => { setShow(false); setEditId(null); }}>Cancel</button>
                  <button className="btn btn-primary" onClick={save}>Save</button></>}>
        <FormErrorBanner error={formError} />
        <div className="row g-2">
          <div className="col-12"><label className="form-label">Title<Req /></label>
            <input className="form-control" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></div>
          <div className="col-md-6"><label className="form-label">Due date</label>
            <input type="datetime-local" className="form-control" value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })} /></div>
          <div className="col-md-6"><label className="form-label">Priority</label>
            <select className="form-select" value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>
              {['low', 'normal', 'high', 'urgent'].map((p) => <option key={p} value={p}>{p}</option>)}
            </select></div>
          <div className="col-md-6"><label className="form-label">Assignee</label>
            <select className="form-select" value={form.assignee_id || ''} onChange={(e) => setForm({ ...form, assignee_id: e.target.value })}>
              <option value="">— Me —</option>
              {users.map((u) => <option key={u.id} value={u.id}>{u.first_name} {u.last_name}</option>)}
            </select></div>
          <div className="col-md-3"><label className="form-label">Linked to</label>
            <select className="form-select" value={form.entity_type} onChange={(e) => setForm({ ...form, entity_type: e.target.value })}>
              <option value="">—</option>
              <option value="contact">Contact</option>
              <option value="organization">Organization</option>
              <option value="deal">Deal</option>
            </select></div>
          <div className="col-md-3"><label className="form-label">Entity ID</label>
            <input type="number" className="form-control" value={form.entity_id || ''} onChange={(e) => setForm({ ...form, entity_id: e.target.value })} /></div>
          <div className="col-12"><label className="form-label">Description</label>
            <textarea className="form-control" rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
          {googleConnected && (
            <div className="col-12">
              <div className="form-check">
                <input
                  type="checkbox"
                  className="form-check-input"
                  id="syncCal"
                  checked={form.sync_to_calendar}
                  onChange={(e) => setForm({ ...form, sync_to_calendar: e.target.checked })}
                />
                <label className="form-check-label d-flex align-items-center gap-1" htmlFor="syncCal">
                  <iconify-icon icon="logos:google-calendar" style={{ fontSize: 16 }}></iconify-icon>
                  Add to Google Calendar
                </label>
              </div>
              {form.sync_to_calendar && !form.due_date && (
                <div className="form-text text-warning">Set a due date to sync to Google Calendar.</div>
              )}
            </div>
          )}
        </div>
      </Modal>
      {confirmDialog}
    </div>
  );
}
