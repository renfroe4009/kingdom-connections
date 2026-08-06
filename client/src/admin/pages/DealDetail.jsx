import { useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import api from '../../api/client.js';
import PageHeader from '../../components/PageHeader.jsx';
import Modal from '../../components/Modal.jsx';
import AttachmentsPanel from '../components/AttachmentsPanel.jsx';
import DriveTab from '../components/DriveTab.jsx';
import ComposeMessageModal from '../components/ComposeMessageModal.jsx';
import LostReasonModal from '../components/LostReasonModal.jsx';
import { useAuth } from '../../auth/AuthContext.jsx';
import { useConfirm } from '../../hooks/useConfirm.jsx';
import { toast } from '../../components/Toast.jsx';
import { parseApiError } from '../../utils/apiError.js';

const emptyTask = { title: '', description: '', due_date: '', priority: 'normal' };

export default function DealDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { can, user } = useAuth();
  const [data, setData] = useState(null);
  const [stages, setStages] = useState([]);
  const [pipelines, setPipelines] = useState([]);
  const [orgs, setOrgs] = useState([]);
  const [users, setUsers] = useState([]);
  const [noteBody, setNoteBody] = useState('');
  const [pushing, setPushing] = useState(false);
  const [cwUrls, setCwUrls] = useState(null);
  const [cwOpp, setCwOpp] = useState(null);   // live CW opportunity data
  const [cwOppLoading, setCwOppLoading] = useState(false);
  const [msg, setMsg] = useState('');
  const [editShow, setEditShow] = useState(false);
  const [form, setForm] = useState({});
  const [composeOpen, setComposeOpen] = useState(false);
  const [composeChannel, setComposeChannel] = useState('email');
  const [dealCfg, setDealCfg] = useState({});
  const [lostModal, setLostModal] = useState({ show: false, pendingStageId: null, pendingForm: null });
  const { confirm, dialog: confirmDialog } = useConfirm();

  // Task add state
  const [quickTask, setQuickTask] = useState('');
  const [taskShow, setTaskShow] = useState(false);
  const [taskForm, setTaskForm] = useState(emptyTask);

  async function load() {
    const { data } = await api.get(`/deals/${id}`);
    setData(data);
    if (data?.deal?.pipeline_id) {
      const r = await api.get(`/pipelines/${data.deal.pipeline_id}/stages`);
      setStages(r.data);
    }
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [id]);
  useEffect(() => {
    api.get('/pipelines').then((r) => setPipelines(r.data)).catch(() => {});
    api.get('/organizations', { params: { pageSize: 200 } }).then((r) => setOrgs(r.data.rows)).catch(() => {});
    api.get('/users/assignable').then((r) => setUsers(Array.isArray(r.data) ? r.data : [])).catch(() => {});
    api.get('/settings/module/deals').then((r) => setDealCfg(r.data)).catch(() => {});
    api.get('/connectwise/active').then((r) => { if (r.data?.active) setCwUrls(r.data); }).catch(() => {});

  }, []);

  // Fetch live CW opportunity data whenever the deal's CW ID changes
  useEffect(() => {
    const cwId = data?.deal?.cw_opportunity_id;
    if (!cwId) { setCwOpp(null); return; }
    setCwOppLoading(true);
    api.get(`/connectwise/opportunities/${cwId}`)
      .then((r) => setCwOpp(r.data))
      .catch(() => setCwOpp(null))
      .finally(() => setCwOppLoading(false));
  }, [data?.deal?.cw_opportunity_id]);

  async function loadStagesFor(pid) {
    const { data } = await api.get(`/pipelines/${pid}/stages`);
    return data;
  }

  async function openEdit() {
    const d = data.deal;
    setForm({
      name: d.name || '', pipeline_id: d.pipeline_id, stage_id: d.stage_id,
      organization_id: d.organization_id ?? null,
      owner_id: d.owner_id ?? user?.id ?? null,
      amount: d.amount ?? 0,
      expected_close_date: d.expected_close_date || '',
      description: d.description || '',
    });
    setEditShow(true);
  }
  async function saveEdit() {
    if (dealCfg.lost_reason_required && isLostStage(form.stage_id)) {
      setEditShow(false);
      setLostModal({ show: true, pendingStageId: null, pendingForm: { ...form } });
      return;
    }
    const payload = {
      ...form,
      amount: Number(form.amount || 0),
      pipeline_id: Number(form.pipeline_id),
      stage_id: Number(form.stage_id),
      organization_id: form.organization_id ? Number(form.organization_id) : null,
      owner_id: form.owner_id ? Number(form.owner_id) : null,
      expected_close_date: form.expected_close_date || null,
    };
    try {
      await api.put(`/deals/${id}`, payload);
      setEditShow(false); load();
    } catch (err) {
      toast(parseApiError(err), 'error');
    }
  }
  async function remove() {
    if (!(await confirm(`Delete deal "${data.deal.name}"? This cannot be undone.`))) return;
    try {
      await api.delete(`/deals/${id}`);
      navigate('/admin/deals');
    } catch (err) {
      toast(parseApiError(err), 'error');
    }
  }

  function isLostStage(stageId) {
    return stages.some((s) => s.id === Number(stageId) && s.stage_type === 'lost');
  }

  async function changeStage(stageId) {
    if (dealCfg.lost_reason_required && isLostStage(stageId)) {
      setLostModal({ show: true, pendingStageId: stageId, pendingForm: null });
      return;
    }
    try {
      await api.put(`/deals/${id}`, { stage_id: Number(stageId) });
      load();
    } catch (err) {
      toast(parseApiError(err), 'error');
    }
  }

  async function confirmLostReason(reason) {
    const { pendingStageId, pendingForm } = lostModal;
    setLostModal({ show: false, pendingStageId: null, pendingForm: null });
    try {
      if (pendingForm) {
        // came from saveEdit
        const payload = {
          ...pendingForm,
          amount: Number(pendingForm.amount || 0),
          pipeline_id: Number(pendingForm.pipeline_id),
          stage_id: Number(pendingForm.stage_id),
          organization_id: pendingForm.organization_id ? Number(pendingForm.organization_id) : null,
          owner_id: pendingForm.owner_id ? Number(pendingForm.owner_id) : null,
          expected_close_date: pendingForm.expected_close_date || null,
          lost_reason: reason,
        };
        await api.put(`/deals/${id}`, payload);
        setEditShow(false);
      } else {
        await api.put(`/deals/${id}`, { stage_id: Number(pendingStageId), lost_reason: reason });
      }
      load();
    } catch (err) {
      toast(parseApiError(err), 'error');
    }
  }
  async function addNote() {
    if (!noteBody.trim()) return;
    try {
      await api.post('/notes', { entity_type: 'deal', entity_id: Number(id), body: noteBody });
      setNoteBody(''); load();
    } catch (err) {
      toast(parseApiError(err), 'error');
    }
  }
  async function quickAddTask() {
    const title = quickTask.trim();
    if (!title) return;
    try {
      await api.post('/tasks', {
        title,
        entity_type: 'deal',
        entity_id: Number(id),
        assigned_to: user?.id || null,
        status: 'open',
        priority: 'normal',
      });
      setQuickTask('');
      load();
    } catch (err) {
      toast(parseApiError(err), 'error');
    }
  }

  function openTaskModal() {
    setTaskForm(emptyTask);
    setTaskShow(true);
  }

  async function saveTask() {
    if (!taskForm.title.trim()) return;
    try {
      await api.post('/tasks', {
        title: taskForm.title.trim(),
        description: taskForm.description || null,
        due_date: taskForm.due_date || null,
        priority: taskForm.priority || 'normal',
        status: 'open',
        assigned_to: user?.id || null,
        entity_type: 'deal',
        entity_id: Number(id),
      });
      setTaskShow(false);
      setTaskForm(emptyTask);
      load();
    } catch (err) {
      toast(parseApiError(err), 'error');
    }
  }

  async function toggleTask(t) {
    const nextStatus = t.status === 'completed' ? 'open' : 'completed';
    try {
      await api.put(`/tasks/${t.id}`, { status: nextStatus });
      load();
    } catch (err) {
      toast(parseApiError(err), 'error');
    }
  }

  async function deleteTask(t) {
    if (!(await confirm(`Delete task "${t.title}"?`))) return;
    try {
      await api.delete(`/tasks/${t.id}`);
      load();
    } catch (err) {
      toast(parseApiError(err), 'error');
    }
  }

  async function pushCW() {
    setPushing(true); setMsg('');
    try {
      const r = await api.post(`/deals/${id}/push-to-cw`);
      setMsg(r.data?.message || 'Pushed to ConnectWise Manage.');
      load();
    } catch (e) {
      setMsg(e.response?.data?.error || 'Failed to push to ConnectWise.');
    } finally { setPushing(false); }
  }

  if (!data) return <div className="empty-state">Loading…</div>;
  const { deal, notes, activities, stage_history, tasks } = data;
  const fmt = (n) => `$${Number(n || 0).toLocaleString()}`;
  const statusColor = deal.status === 'won' ? 'success' : deal.status === 'lost' ? 'danger' : 'warning';

  return (
    <div>
      <PageHeader
        title={deal.name}
        subtitle={deal.organization_name ? `${deal.organization_name} · ${fmt(deal.amount)}` : fmt(deal.amount)}
        actions={
          <>
            <Link to="/admin/deals" className="btn btn-light">← Back</Link>
            {can('comms.write') && deal.contact_email && (
              <button className="btn btn-light ms-2" onClick={() => { setComposeChannel('email'); setComposeOpen(true); }}>
                <iconify-icon icon="solar:letter-line-duotone" class="me-1"></iconify-icon> Email
              </button>
            )}
            {can('comms.write') && (deal.contact_mobile || deal.contact_phone) && (
              <button className="btn btn-light ms-2" onClick={() => { setComposeChannel('sms'); setComposeOpen(true); }}>
                <iconify-icon icon="solar:chat-line-line-duotone" class="me-1"></iconify-icon> SMS
              </button>
            )}
            {can('deals.write') && (
              <button className="btn btn-primary ms-2" onClick={openEdit}>
                <iconify-icon icon="solar:pen-new-square-line-duotone" class="me-1"></iconify-icon> Edit
              </button>
            )}
            {can('deals.delete') && (
              <button className="btn btn-light text-danger ms-2" onClick={remove}>
                <iconify-icon icon="solar:trash-bin-trash-line-duotone" class="me-1"></iconify-icon> Delete
              </button>
            )}
            {can('deals.write') && deal.status === 'won' && (
              <button className="btn btn-primary ms-2" onClick={pushCW} disabled={pushing}>
                <iconify-icon icon="solar:upload-line-duotone" class="me-1"></iconify-icon>
                {pushing ? 'Pushing…' : (deal.cw_opportunity_id ? 'Re-push to CW' : 'Push to CW')}
              </button>
            )}
            {cwUrls && deal.cw_opportunity_id && (
              <a
                className="btn btn-outline-secondary ms-2"
                href={`${cwUrls.opportunity_url}${deal.cw_opportunity_id}`}
                target="_blank" rel="noreferrer"
                title="Open in ConnectWise"
              >
                <iconify-icon icon="solar:square-top-down-line-duotone" class="me-1"></iconify-icon> Open in CW
              </a>
            )}
          </>
        }
      />

      {msg && <div className="alert alert-info">{msg}</div>}

      <div className="row">
        <div className="col-lg-4 mb-3">
          <div className="card">
            <div className="card-body">
              <h6 className="fw-bold text-uppercase small text-muted">Details</h6>
              <dl className="row mb-0">
                <dt className="col-5">Pipeline</dt><dd className="col-7">{deal.pipeline_name}</dd>
                <dt className="col-5">Stage</dt>
                <dd className="col-7">
                  {can('deals.write') ? (
                    <select className="form-select form-select-sm" value={deal.stage_id} onChange={(e) => changeStage(e.target.value)}>
                      {stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                  ) : <span className="badge bg-primary-subtle text-primary">{deal.stage_name}</span>}
                </dd>
                <dt className="col-5">Status</dt><dd className="col-7"><span className={`badge bg-${statusColor}-subtle text-${statusColor}`}>{deal.status}</span></dd>
                <dt className="col-5">Amount</dt><dd className="col-7 fw-bold">{fmt(deal.amount)}</dd>
                <dt className="col-5">Close Date</dt><dd className="col-7">{deal.expected_close_date || '—'}</dd>
                <dt className="col-5">Won At</dt><dd className="col-7">{deal.won_at ? new Date(deal.won_at).toLocaleDateString() : '—'}</dd>
                <dt className="col-5">Owner</dt><dd className="col-7">{deal.owner_name || '—'}</dd>
                <dt className="col-5">Primary Contact</dt><dd className="col-7">{deal.primary_contact_name || '—'}</dd>
                <dt className="col-5">Organization</dt><dd className="col-7">{deal.organization_name ? <Link to={`/admin/organizations/${deal.organization_id}`}>{deal.organization_name}</Link> : '—'}</dd>
              </dl>
            </div>
          </div>

          {cwUrls && deal.cw_opportunity_id && (
            <div className="card mt-3">
              <div className="card-body">
                <div className="d-flex justify-content-between align-items-center mb-2">
                  <h6 className="fw-bold text-uppercase small text-muted mb-0">ConnectWise Opportunity</h6>
                  <a href={`${cwUrls.opportunity_url}${deal.cw_opportunity_id}`} target="_blank" rel="noreferrer"
                    className="btn btn-xs btn-outline-secondary" style={{ fontSize: 11, padding: '2px 8px' }}>
                    <iconify-icon icon="solar:square-top-down-line-duotone" class="me-1"></iconify-icon>Open in CW
                  </a>
                </div>
                {cwOppLoading && <div className="text-muted small"><span className="spinner-border spinner-border-sm me-1"></span>Loading…</div>}
                {!cwOppLoading && cwOpp && (
                  <dl className="row mb-0 small">
                    <dt className="col-5">CW ID</dt><dd className="col-7 font-monospace">#{cwOpp.id}</dd>
                    <dt className="col-5">Status</dt>
                    <dd className="col-7">
                      <span className={`badge ${cwOpp.status?.name === 'Won' ? 'bg-success-subtle text-success' : 'bg-primary-subtle text-primary'}`}>
                        {cwOpp.status?.name || '—'}
                      </span>
                    </dd>
                    <dt className="col-5">Stage</dt><dd className="col-7">{cwOpp.stage?.name || '—'}</dd>
                    <dt className="col-5">Close Date</dt><dd className="col-7">{cwOpp.expectedCloseDate ? new Date(cwOpp.expectedCloseDate).toLocaleDateString() : '—'}</dd>
                    <dt className="col-5">Sales Rep</dt><dd className="col-7">{cwOpp.primarySalesRep?.name || '—'}</dd>
                    <dt className="col-5">Company</dt><dd className="col-7">{cwOpp.company?.name || '—'}</dd>
                    <dt className="col-5">Contact</dt><dd className="col-7">{cwOpp.contact?.name || '—'}</dd>
                    <dt className="col-5">Pushed</dt><dd className="col-7">{deal.cw_pushed_at ? new Date(deal.cw_pushed_at).toLocaleString() : '—'}</dd>
                  </dl>
                )}
                {!cwOppLoading && !cwOpp && (
                  <div className="text-muted small">Could not load CW data. <span className="font-monospace">ID #{deal.cw_opportunity_id}</span></div>
                )}
              </div>
            </div>
          )}

          {deal.description && (
            <div className="card mt-3">
              <div className="card-body">
                <h6 className="fw-bold text-uppercase small text-muted">Description</h6>
                <p className="mb-0">{deal.description}</p>
              </div>
            </div>
          )}
        </div>

        <div className="col-lg-8">
          <div className="card">
            <div className="card-body">
              <h6 className="fw-bold text-uppercase small text-muted">Stage History</h6>
              {stage_history?.length ? (
                <ul className="list-unstyled mb-0">
                  {stage_history.map((h) => (
                    <li key={h.id} className="py-2 border-top d-flex justify-content-between">
                      <span>
                        {h.from_stage_name ? <><span className="badge bg-light text-dark">{h.from_stage_name}</span> → </> : ''}
                        <span className="badge bg-primary-subtle text-primary">{h.to_stage_name}</span>
                        {h.user_name && <span className="text-muted ms-2">by {h.user_name}</span>}
                      </span>
                      <small className="text-muted">{new Date(h.changed_at).toLocaleString()}</small>
                    </li>
                  ))}
                </ul>
              ) : <div className="text-muted small">No stage changes yet.</div>}
            </div>
          </div>

          <div className="card mt-3">
            <div className="card-body">
              <h6 className="fw-bold text-uppercase small text-muted">Notes</h6>
              <div className="d-flex gap-2 mb-3">
                <textarea rows={2} className="form-control" placeholder="Add a note…" value={noteBody} onChange={(e) => setNoteBody(e.target.value)} />
                <button className="btn btn-primary" onClick={addNote}>Post</button>
              </div>
              <ul className="list-unstyled mb-0">
                {notes?.map((n) => (
                  <li key={n.id} className="py-2 border-top">
                    <div className="d-flex justify-content-between">
                      <strong>{n.user_name || 'System'}</strong>
                      <small className="text-muted">{new Date(n.created_at).toLocaleString()}</small>
                    </div>
                    <div>{n.body}</div>
                  </li>
                ))}
                {(!notes || notes.length === 0) && <li className="text-muted small py-2">No notes yet.</li>}
              </ul>
            </div>
          </div>

          <div className="card mt-3">
            <div className="card-body">
              <div className="d-flex align-items-center justify-content-between mb-2">
                <h6 className="fw-bold text-uppercase small text-muted mb-0">
                  Tasks {tasks?.length ? <span className="text-muted fw-normal">({tasks.filter((t) => t.status !== 'completed').length} open)</span> : null}
                </h6>
                {can('tasks.write') && (
                  <button className="btn btn-sm btn-light" onClick={openTaskModal} title="Add a task with due date, priority, and notes">
                    <iconify-icon icon="solar:add-circle-line-duotone" class="me-1"></iconify-icon>
                    Add Task
                  </button>
                )}
              </div>

              {can('tasks.write') && (
                <div className="input-group input-group-sm mb-3">
                  <span className="input-group-text bg-white">
                    <iconify-icon icon="solar:checklist-minimalistic-line-duotone"></iconify-icon>
                  </span>
                  <input
                    type="text"
                    className="form-control"
                    placeholder="Add a quick task and press Enter…"
                    value={quickTask}
                    onChange={(e) => setQuickTask(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') quickAddTask(); }}
                  />
                  <button className="btn btn-primary" type="button" onClick={quickAddTask} disabled={!quickTask.trim()}>
                    Add
                  </button>
                </div>
              )}

              {tasks?.length ? (
                <ul className="list-unstyled mb-0">
                  {tasks.map((t) => {
                    const done = t.status === 'completed';
                    const overdue = !done && t.due_date && new Date(t.due_date) < new Date();
                    const priColor = t.priority === 'urgent' ? 'danger' : t.priority === 'high' ? 'warning' : 'secondary';
                    return (
                      <li key={t.id} className="d-flex align-items-start gap-2 py-2 border-top">
                        {can('tasks.write') ? (
                          <input
                            type="checkbox"
                            className="form-check-input mt-1"
                            checked={done}
                            onChange={() => toggleTask(t)}
                            title={done ? 'Mark as open' : 'Mark as completed'}
                          />
                        ) : (
                          <span className={`badge bg-${done ? 'success' : 'warning'}-subtle text-${done ? 'success' : 'warning'} mt-1`}>
                            {done ? 'done' : 'open'}
                          </span>
                        )}
                        <div className="flex-grow-1">
                          <div className={'fw-semibold ' + (done ? 'text-decoration-line-through text-muted' : '')}>
                            {t.title}
                          </div>
                          <small className="text-muted">
                            Due {t.due_date ? new Date(t.due_date).toLocaleDateString() : '—'} · {t.assignee_name || 'Unassigned'}
                            {t.priority && t.priority !== 'normal' && (
                              <span className={`badge bg-${priColor}-subtle text-${priColor} ms-2`}>{t.priority}</span>
                            )}
                            {overdue && <span className="badge bg-danger-subtle text-danger ms-2">overdue</span>}
                          </small>
                          {t.description && <div className="small text-muted mt-1">{t.description}</div>}
                        </div>
                        {can('tasks.write') && (
                          <button
                            type="button"
                            className="btn btn-sm btn-link text-danger p-0"
                            onClick={() => deleteTask(t)}
                            title="Delete task"
                          >
                            <iconify-icon icon="solar:trash-bin-trash-line-duotone" class="fs-5"></iconify-icon>
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              ) : <div className="text-muted small">No tasks yet. Use the quick-add above or <strong>Add Task</strong> for more detail.</div>}
            </div>
          </div>

          <AttachmentsPanel entityType="deal" entityId={Number(id)} />
          <DriveTab entityType="deal" entityId={Number(id)} />

          <div className="card mt-3">
            <div className="card-body">
              <h6 className="fw-bold text-uppercase small text-muted">Activity</h6>
              <ul className="list-unstyled mb-0">
                {activities?.map((a) => (
                  <li key={a.id} className="py-2 border-top d-flex justify-content-between">
                    <span>{a.user_name || 'System'} — <strong>{a.action}</strong> — {a.description}</span>
                    <small className="text-muted">{new Date(a.created_at).toLocaleString()}</small>
                  </li>
                ))}
                {(!activities || activities.length === 0) && <li className="text-muted small py-2">No activity yet.</li>}
              </ul>
            </div>
          </div>
        </div>
      </div>

      <Modal show={editShow} onClose={() => setEditShow(false)} title="Edit Deal" size="lg"
        footer={<><button className="btn btn-light" onClick={() => setEditShow(false)}>Cancel</button>
                  <button className="btn btn-primary" onClick={saveEdit}>Save</button></>}>
        <div className="row g-2">
          <div className="col-12"><label className="form-label">Name</label>
            <input className="form-control" value={form.name || ''} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
          <div className="col-12 col-md-6"><label className="form-label">Pipeline</label>
            <select className="form-select" value={form.pipeline_id || ''} onChange={async (e) => {
              const pid = e.target.value;
              const newStages = await loadStagesFor(pid);
              setStages(newStages);
              setForm({ ...form, pipeline_id: pid, stage_id: newStages[0]?.id });
            }}>
              {pipelines.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select></div>
          <div className="col-12 col-md-6"><label className="form-label">Stage</label>
            <select className="form-select" value={form.stage_id || ''} onChange={(e) => setForm({ ...form, stage_id: e.target.value })}>
              {stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select></div>
          <div className="col-12 col-md-6"><label className="form-label">Organization</label>
            <select className="form-select" value={form.organization_id ?? ''} onChange={(e) => setForm({ ...form, organization_id: e.target.value })}>
              <option value="">—</option>
              {orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select></div>
          <div className="col-12 col-md-6"><label className="form-label">Owner</label>
            <select className="form-select" value={form.owner_id ?? ''} onChange={(e) => setForm({ ...form, owner_id: e.target.value })}>
              <option value="">— Unassigned —</option>
              {users.map((u) => <option key={u.id} value={u.id}>{u.first_name} {u.last_name}</option>)}
            </select></div>
          <div className="col-6 col-md-3"><label className="form-label">Amount</label>
            <input type="number" className="form-control" value={form.amount || 0} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></div>
          <div className="col-6 col-md-3"><label className="form-label">Close Date</label>
            <input type="date" className="form-control" value={form.expected_close_date || ''} onChange={(e) => setForm({ ...form, expected_close_date: e.target.value })} /></div>
          <div className="col-12"><label className="form-label">Description</label>
            <textarea className="form-control" rows={3} value={form.description || ''} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
        </div>
      </Modal>

      <Modal show={taskShow} onClose={() => setTaskShow(false)} title={`New Task for ${data.deal.name}`} size="lg"
        footer={
          <>
            <button className="btn btn-light" onClick={() => setTaskShow(false)}>Cancel</button>
            <button className="btn btn-primary" onClick={saveTask} disabled={!taskForm.title.trim()}>Create Task</button>
          </>
        }
      >
        <div className="row g-2">
          <div className="col-12">
            <label className="form-label">Title</label>
            <input
              className="form-control"
              value={taskForm.title}
              onChange={(e) => setTaskForm({ ...taskForm, title: e.target.value })}
              autoFocus
            />
          </div>
          <div className="col-12 col-md-6">
            <label className="form-label">Due date</label>
            <input
              type="date"
              className="form-control"
              value={taskForm.due_date}
              onChange={(e) => setTaskForm({ ...taskForm, due_date: e.target.value })}
            />
          </div>
          <div className="col-12 col-md-6">
            <label className="form-label">Priority</label>
            <select
              className="form-select"
              value={taskForm.priority}
              onChange={(e) => setTaskForm({ ...taskForm, priority: e.target.value })}
            >
              <option value="low">Low</option>
              <option value="normal">Normal</option>
              <option value="high">High</option>
              <option value="urgent">Urgent</option>
            </select>
          </div>
          <div className="col-12">
            <label className="form-label">Description</label>
            <textarea
              className="form-control"
              rows={3}
              value={taskForm.description}
              onChange={(e) => setTaskForm({ ...taskForm, description: e.target.value })}
            />
          </div>
          <div className="col-12">
            <small className="text-muted">Task will be linked to <strong>{data.deal.name}</strong> and assigned to you.</small>
          </div>
        </div>
      </Modal>

      <LostReasonModal
        show={lostModal.show}
        onConfirm={confirmLostReason}
        onCancel={() => setLostModal({ show: false, pendingStageId: null, pendingForm: null })}
      />

      <ComposeMessageModal
        show={composeOpen}
        onClose={() => setComposeOpen(false)}
        defaults={{
          channel: composeChannel,
          to: composeChannel === 'email'
            ? (deal.contact_email || '')
            : (deal.contact_mobile || deal.contact_phone || ''),
          entity_type: 'deal',
          entity_id: Number(id),
          deal_id: Number(id),
          contact_id: deal.primary_contact_id || undefined,
          organization_id: deal.organization_id || undefined,
        }}
        onSent={() => { setComposeOpen(false); load(); }}
      />
      {confirmDialog}
    </div>
  );
}
