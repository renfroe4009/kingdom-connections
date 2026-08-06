import { useEffect, useState } from 'react';
import api from '../../api/client.js';
import PageHeader from '../../components/PageHeader.jsx';
import Modal from '../../components/Modal.jsx';
import { useAuth } from '../../auth/AuthContext.jsx';
import { useConfirm } from '../../hooks/useConfirm.jsx';
import { toast } from '../../components/Toast.jsx';
import { parseApiError } from '../../utils/apiError.js';

const emptyPipe = { name: '', description: '', is_default: false };
const emptyStage = { name: '', color: '#F05523', probability: 25, stage_type: 'open', display_order: 0 };

export default function PipelinesPage() {
  const { can } = useAuth();
  const { confirm, dialog: confirmDialog } = useConfirm();
  const [pipelines, setPipelines] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [activeTab, setActiveTab] = useState('stages'); // 'stages' | 'access'
  const [stages, setStages] = useState([]);
  const [pipeShow, setPipeShow] = useState(false);
  const [pipeForm, setPipeForm] = useState(emptyPipe);
  const [pipeEditId, setPipeEditId] = useState(null);
  const [stageShow, setStageShow] = useState(false);
  const [stageForm, setStageForm] = useState(emptyStage);
  const [stageEditId, setStageEditId] = useState(null);

  // Pipeline access state
  const [accessUsers, setAccessUsers] = useState([]);   // {id, first_name, last_name, email, has_access}
  const [accessSaving, setAccessSaving] = useState(false);

  // pipelines.access → can see the page and manage agent access
  // pipelines.manage → can also create/edit/delete pipelines and stages (admin only)
  const canManageAccess = can('pipelines.access');

  async function loadPipelines() {
    const { data } = await api.get('/pipelines');
    setPipelines(data);
    if (!selectedId && data.length) setSelectedId(data[0].id);
  }
  useEffect(() => { loadPipelines(); /* eslint-disable-next-line */ }, []);

  useEffect(() => {
    if (!selectedId) return;
    api.get(`/pipelines/${selectedId}/stages`).then((r) => setStages(r.data));
    if (canManageAccess) {
      api.get(`/pipelines/${selectedId}/users`).then((r) => setAccessUsers(r.data)).catch(() => {});
    }
    /* eslint-disable-next-line */
  }, [selectedId]);

  function selectPipeline(id) {
    setSelectedId(id);
    setActiveTab('stages');
  }

  // Pipeline CRUD
  function openNewPipe() { setPipeEditId(null); setPipeForm(emptyPipe); setPipeShow(true); }
  function openEditPipe(p) {
    setPipeEditId(p.id);
    setPipeForm({ name: p.name || '', description: p.description || '', is_default: !!p.is_default });
    setPipeShow(true);
  }
  async function savePipe() {
    try {
      if (pipeEditId) await api.put(`/pipelines/${pipeEditId}`, pipeForm);
      else await api.post('/pipelines', pipeForm);
      setPipeShow(false); setPipeEditId(null); loadPipelines();
    } catch (e) {
      toast(parseApiError(e), 'error');
    }
  }
  async function removePipe(p) {
    if (!(await confirm(`Delete pipeline "${p.name}"? All stages and linked deals will fail without a pipeline.`, { danger: true }))) return;
    try {
      await api.delete(`/pipelines/${p.id}`);
      if (selectedId === p.id) setSelectedId(null);
      loadPipelines();
    } catch (e) {
      toast(parseApiError(e), 'error');
    }
  }

  // Stage CRUD
  function openNewStage() {
    setStageEditId(null);
    setStageForm({ ...emptyStage, display_order: stages.length });
    setStageShow(true);
  }
  function openEditStage(s) {
    setStageEditId(s.id);
    setStageForm({
      name: s.name || '', color: s.color || '#F05523',
      probability: Number(s.probability || 0),
      stage_type: s.stage_type || 'open',
      display_order: s.display_order || 0,
    });
    setStageShow(true);
  }
  async function saveStage() {
    try {
      const payload = { ...stageForm, probability: Number(stageForm.probability), display_order: Number(stageForm.display_order) };
      if (stageEditId) await api.put(`/pipelines/${selectedId}/stages/${stageEditId}`, payload);
      else await api.post(`/pipelines/${selectedId}/stages`, payload);
      setStageShow(false); setStageEditId(null);
      const { data } = await api.get(`/pipelines/${selectedId}/stages`);
      setStages(data);
    } catch (e) {
      toast(parseApiError(e), 'error');
    }
  }
  async function removeStage(s) {
    if (!(await confirm(`Delete stage "${s.name}"? Deals currently in this stage will need to be moved first.`, { danger: true }))) return;
    try {
      await api.delete(`/pipelines/${selectedId}/stages/${s.id}`);
      const { data } = await api.get(`/pipelines/${selectedId}/stages`);
      setStages(data);
    } catch (e) {
      toast(parseApiError(e), 'error');
    }
  }

  // Access management
  function toggleAccess(uid) {
    setAccessUsers((prev) =>
      prev.map((u) => u.id === uid ? { ...u, has_access: u.has_access ? 0 : 1 } : u)
    );
  }

  async function saveAccess() {
    setAccessSaving(true);
    try {
      const granted = accessUsers.filter((u) => u.has_access).map((u) => u.id);
      await api.put(`/pipelines/${selectedId}/users`, { user_ids: granted });
      // Reload to confirm server state
      const { data } = await api.get(`/pipelines/${selectedId}/users`);
      setAccessUsers(data);
    } catch (e) {
      toast(parseApiError(e), 'error');
    } finally {
      setAccessSaving(false);
    }
  }

  const selected = pipelines.find((p) => p.id === selectedId);

  return (
    <div>
      <PageHeader title="Pipelines" subtitle={`${pipelines.length} pipeline${pipelines.length === 1 ? '' : 's'}`}
        actions={can('pipelines.manage') && <button className="btn btn-primary" onClick={openNewPipe}>
          <iconify-icon icon="solar:add-circle-line-duotone" class="me-1"></iconify-icon> New Pipeline
        </button>} />

      <div className="row">
        {/* Pipeline list */}
        <div className="col-md-4 mb-3">
          <div className="card">
            <div className="card-body">
              <h6 className="fw-bold text-uppercase small text-muted mb-3">Pipelines</h6>
              <ul className="list-unstyled mb-0">
                {pipelines.map((p) => (
                  <li key={p.id} className={`py-2 border-top d-flex justify-content-between align-items-center ${p.id === selectedId ? 'fw-bold' : ''}`}>
                    <button className="btn btn-link text-decoration-none p-0 text-start" onClick={() => selectPipeline(p.id)}>
                      {p.name} {p.is_default ? <span className="badge bg-primary-subtle text-primary ms-1">default</span> : null}
                    </button>
                    {can('pipelines.manage') && (
                      <div>
                        <button className="btn btn-sm btn-light me-1" onClick={() => openEditPipe(p)} title="Edit">
                          <iconify-icon icon="solar:pen-new-square-line-duotone"></iconify-icon>
                        </button>
                        <button className="btn btn-sm btn-light text-danger" onClick={() => removePipe(p)} title="Delete">
                          <iconify-icon icon="solar:trash-bin-trash-line-duotone"></iconify-icon>
                        </button>
                      </div>
                    )}
                  </li>
                ))}
                {pipelines.length === 0 && <li className="text-muted py-2">No pipelines.</li>}
              </ul>
            </div>
          </div>
        </div>

        {/* Right panel: tabs for Stages / Access */}
        <div className="col-md-8 mb-3">
          <div className="card">
            <div className="card-body">
              <div className="d-flex justify-content-between align-items-center mb-3">
                <div>
                  <h6 className="fw-bold text-uppercase small text-muted mb-1">
                    {selected ? selected.name : 'Select a pipeline'}
                  </h6>
                  {selectedId && canManageAccess && (
                    <ul className="nav nav-tabs nav-tabs-sm">
                      <li className="nav-item">
                        <button className={`nav-link py-1 px-3 ${activeTab === 'stages' ? 'active' : ''}`} onClick={() => setActiveTab('stages')}>Stages</button>
                      </li>
                      <li className="nav-item">
                        <button className={`nav-link py-1 px-3 ${activeTab === 'access' ? 'active' : ''}`} onClick={() => setActiveTab('access')}>
                          <iconify-icon icon="solar:users-group-two-rounded-line-duotone" class="me-1"></iconify-icon>
                          User Access
                        </button>
                      </li>
                    </ul>
                  )}
                </div>
                {selectedId && activeTab === 'stages' && can('pipelines.manage') && (
                  <button className="btn btn-sm btn-primary" onClick={openNewStage}>
                    <iconify-icon icon="solar:add-circle-line-duotone" class="me-1"></iconify-icon> Add Stage
                  </button>
                )}
                {selectedId && activeTab === 'access' && (
                  <button className="btn btn-sm btn-primary" onClick={saveAccess} disabled={accessSaving}>
                    {accessSaving
                      ? <><span className="spinner-border spinner-border-sm me-1" />Saving…</>
                      : <><iconify-icon icon="solar:diskette-line-duotone" class="me-1"></iconify-icon>Save Access</>}
                  </button>
                )}
              </div>

              {/* Stages tab */}
              {(!selectedId || activeTab === 'stages') && (
                <div className="table-responsive">
                  <table className="table table-hover align-middle mb-0">
                    <thead><tr><th>#</th><th>Name</th><th>Probability</th><th>Type</th><th>Color</th><th className="text-end">Actions</th></tr></thead>
                    <tbody>
                      {stages.map((s) => (
                        <tr key={s.id}>
                          <td>{s.display_order}</td>
                          <td className="fw-semibold">{s.name}</td>
                          <td>{Math.round(Number(s.probability || 0))}%</td>
                          <td><span className="badge bg-primary-subtle text-primary">{s.stage_type}</span></td>
                          <td><span style={{ display: 'inline-block', width: 14, height: 14, background: s.color, borderRadius: 3, marginRight: 6, verticalAlign: 'middle' }}></span><code>{s.color}</code></td>
                          <td className="text-end text-nowrap">
                            {can('pipelines.manage') && (<>
                              <button className="btn btn-sm btn-light me-1" onClick={() => openEditStage(s)} title="Edit">
                                <iconify-icon icon="solar:pen-new-square-line-duotone"></iconify-icon>
                              </button>
                              <button className="btn btn-sm btn-light text-danger" onClick={() => removeStage(s)} title="Delete">
                                <iconify-icon icon="solar:trash-bin-trash-line-duotone"></iconify-icon>
                              </button>
                            </>)}
                          </td>
                        </tr>
                      ))}
                      {!selectedId && <tr><td colSpan="6"><div className="empty-state">Select a pipeline on the left.</div></td></tr>}
                      {selectedId && stages.length === 0 && <tr><td colSpan="6"><div className="empty-state">No stages. Add one to get started.</div></td></tr>}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Access tab */}
              {selectedId && activeTab === 'access' && (
                <div>
                  <p className="text-muted small mb-3">
                    Toggle which sales agents can access the <strong>{selected?.name}</strong> pipeline.
                    Admins and managers always have full access and are not listed here.
                  </p>
                  {accessUsers.length === 0 && (
                    <div className="empty-state">No assignable users found.</div>
                  )}
                  <ul className="list-unstyled mb-0">
                    {accessUsers.map((u) => (
                      <li key={u.id} className="py-2 border-top d-flex justify-content-between align-items-center">
                        <div>
                          <div className="fw-semibold">{u.first_name} {u.last_name}</div>
                          <small className="text-muted">{u.email}</small>
                        </div>
                        <div className="form-check form-switch mb-0">
                          <input
                            type="checkbox"
                            className="form-check-input"
                            role="switch"
                            checked={!!u.has_access}
                            onChange={() => toggleAccess(u.id)}
                            id={`access-${u.id}`}
                          />
                          <label className="form-check-label" htmlFor={`access-${u.id}`}>
                            {u.has_access ? <span className="text-success">Access</span> : <span className="text-muted">No access</span>}
                          </label>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Pipeline modal */}
      <Modal show={pipeShow} onClose={() => { setPipeShow(false); setPipeEditId(null); }} title={pipeEditId ? 'Edit Pipeline' : 'New Pipeline'}
        footer={<><button className="btn btn-light" onClick={() => { setPipeShow(false); setPipeEditId(null); }}>Cancel</button>
                  <button className="btn btn-primary" onClick={savePipe}>Save</button></>}>
        <div className="row g-2">
          <div className="col-12"><label className="form-label">Name</label>
            <input className="form-control" value={pipeForm.name} onChange={(e) => setPipeForm({ ...pipeForm, name: e.target.value })} /></div>
          <div className="col-12"><label className="form-label">Description</label>
            <textarea className="form-control" rows={2} value={pipeForm.description} onChange={(e) => setPipeForm({ ...pipeForm, description: e.target.value })} /></div>
          <div className="col-12">
            <div className="form-check mt-2">
              <input type="checkbox" className="form-check-input" id="pipeDefault" checked={!!pipeForm.is_default} onChange={(e) => setPipeForm({ ...pipeForm, is_default: e.target.checked })} />
              <label className="form-check-label" htmlFor="pipeDefault">Default pipeline (used for new deals)</label>
            </div>
          </div>
        </div>
      </Modal>

      {/* Stage modal */}
      <Modal show={stageShow} onClose={() => { setStageShow(false); setStageEditId(null); }} title={stageEditId ? 'Edit Stage' : 'New Stage'}
        footer={<><button className="btn btn-light" onClick={() => { setStageShow(false); setStageEditId(null); }}>Cancel</button>
                  <button className="btn btn-primary" onClick={saveStage}>Save</button></>}>
        <div className="row g-2">
          <div className="col-md-8"><label className="form-label">Name</label>
            <input className="form-control" value={stageForm.name} onChange={(e) => setStageForm({ ...stageForm, name: e.target.value })} /></div>
          <div className="col-md-4"><label className="form-label">Color</label>
            <input type="color" className="form-control form-control-color" value={stageForm.color} onChange={(e) => setStageForm({ ...stageForm, color: e.target.value })} /></div>
          <div className="col-md-4"><label className="form-label">Probability (%)</label>
            <input type="number" className="form-control" value={stageForm.probability} onChange={(e) => setStageForm({ ...stageForm, probability: e.target.value })} min="0" max="100" /></div>
          <div className="col-md-4"><label className="form-label">Stage type</label>
            <select className="form-select" value={stageForm.stage_type} onChange={(e) => setStageForm({ ...stageForm, stage_type: e.target.value })}>
              <option value="open">Open</option>
              <option value="won">Won</option>
              <option value="lost">Lost</option>
            </select></div>
          <div className="col-md-4"><label className="form-label">Display order</label>
            <input type="number" className="form-control" value={stageForm.display_order} onChange={(e) => setStageForm({ ...stageForm, display_order: e.target.value })} /></div>
        </div>
      </Modal>
      {confirmDialog}
    </div>
  );
}
