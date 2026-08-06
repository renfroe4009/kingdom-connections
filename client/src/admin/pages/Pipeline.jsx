import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../../api/client.js';
import PageHeader from '../../components/PageHeader.jsx';
import LostReasonModal from '../components/LostReasonModal.jsx';
import { useAuth } from '../../auth/AuthContext.jsx';

export default function Pipeline() {
  const { can } = useAuth();
  const [pipelines, setPipelines] = useState([]);
  const [pipelineId, setPipelineId] = useState(null);
  const [board, setBoard] = useState(null);
  const [dragId, setDragId] = useState(null);
  const [overStage, setOverStage] = useState(null);
  const [dealCfg, setDealCfg] = useState({});
  const [lostModal, setLostModal] = useState({ show: false, pendingDealId: null, pendingStageId: null });

  useEffect(() => {
    api.get('/pipelines').then((r) => {
      setPipelines(r.data);
      const def = r.data.find((p) => p.is_default) || r.data[0];
      if (def) setPipelineId(def.id);
    });
    api.get('/settings/module/deals').then((r) => setDealCfg(r.data)).catch(() => {});
  }, []);

  async function loadBoard(pid) {
    const { data } = await api.get('/deals/kanban', { params: { pipeline_id: pid } });
    setBoard(data);
  }
  useEffect(() => { if (pipelineId) loadBoard(pipelineId); }, [pipelineId]);

  async function onDrop(stageId) {
    if (!dragId) return;
    setOverStage(null);
    const stage = board?.stages?.find((s) => s.id === stageId);
    if (dealCfg.lost_reason_required && stage?.stage_type === 'lost') {
      setLostModal({ show: true, pendingDealId: dragId, pendingStageId: stageId });
      setDragId(null);
      return;
    }
    await api.put(`/deals/${dragId}`, { stage_id: Number(stageId) });
    setDragId(null);
    loadBoard(pipelineId);
  }

  async function confirmLostReason(reason) {
    const { pendingDealId, pendingStageId } = lostModal;
    setLostModal({ show: false, pendingDealId: null, pendingStageId: null });
    await api.put(`/deals/${pendingDealId}`, { stage_id: Number(pendingStageId), lost_reason: reason });
    loadBoard(pipelineId);
  }

  const fmt = (n) => `$${Number(n || 0).toLocaleString()}`;

  return (
    <div>
      <PageHeader
        title="Pipeline"
        subtitle="Drag deals to move between stages"
        actions={
          <select className="form-select" style={{ maxWidth: 240 }} value={pipelineId || ''} onChange={(e) => setPipelineId(Number(e.target.value))}>
            {pipelines.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        }
      />

      {!board ? (
        <div className="empty-state">Loading pipeline…</div>
      ) : (
        <div className="kanban-board">
          {board.stages.map((s) => {
            const deals = s.deals || [];
            const total = s.total ?? deals.reduce((sum, d) => sum + Number(d.amount || 0), 0);
            const isOver = overStage === s.id;
            return (
              <div
                key={s.id}
                className={`kanban-column ${isOver ? 'drag-over' : ''}`}
                onDragOver={(e) => { e.preventDefault(); setOverStage(s.id); }}
                onDragLeave={() => setOverStage((cur) => (cur === s.id ? null : cur))}
                onDrop={() => onDrop(s.id)}
              >
                <div className="kanban-column-head" style={{ borderTop: `3px solid ${s.color || '#F05523'}` }}>
                  <div>
                    <div className="fw-bold">{s.name}</div>
                    <small className="text-muted">{deals.length} deals · {fmt(total)}</small>
                  </div>
                  <span className="badge bg-light text-dark">{Math.round(Number(s.probability || 0))}%</span>
                </div>
                <div className="kanban-cards">
                  {deals.map((d) => (
                    <div
                      key={d.id}
                      className="kanban-card"
                      draggable={can('deals.write')}
                      onDragStart={() => setDragId(d.id)}
                      onDragEnd={() => setDragId(null)}
                    >
                      <Link to={`/admin/deals/${d.id}`} className="fw-semibold text-decoration-none d-block">{d.name}</Link>
                      <div className="text-muted small">{d.organization_name || '—'}</div>
                      <div className="kanban-amount">{fmt(d.amount)}</div>
                      <div className="d-flex justify-content-between align-items-center mt-1">
                        <small className="text-muted">{d.owner_name || 'Unassigned'}</small>
                        <small className="text-muted">{d.expected_close_date || ''}</small>
                      </div>
                    </div>
                  ))}
                  {deals.length === 0 && <div className="text-muted small p-2">No deals in stage.</div>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <LostReasonModal
        show={lostModal.show}
        onConfirm={confirmLostReason}
        onCancel={() => { setLostModal({ show: false, pendingDealId: null, pendingStageId: null }); loadBoard(pipelineId); }}
      />
    </div>
  );
}
