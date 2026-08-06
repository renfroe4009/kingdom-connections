import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import {
  ReactFlow, ReactFlowProvider, Background, Controls, MiniMap,
  addEdge, useNodesState, useEdgesState, useReactFlow,
  Handle, Position,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import api from '../../api/client.js';
import { useAuth } from '../../auth/AuthContext.jsx';

// ---------------------------------------------------------------------------
// Trigger / Action / Wait catalogs
// ---------------------------------------------------------------------------
const TRIGGERS = [
  { type: 'contact.created',    label: 'Contact Created',       icon: 'solar:user-plus-rounded-line-duotone',       color: '#7c3aed' },
  { type: 'deal.created',       label: 'Deal Created',           icon: 'solar:dollar-minimalistic-bold-duotone',     color: '#7c3aed' },
  { type: 'deal.stage_changed', label: 'Deal Stage Changed',     icon: 'solar:chart-square-line-duotone',            color: '#7c3aed' },
  { type: 'deal.won',           label: 'Deal Won',               icon: 'solar:cup-star-line-duotone',                color: '#7c3aed' },
  { type: 'deal.lost',          label: 'Deal Lost',              icon: 'solar:close-circle-line-duotone',            color: '#7c3aed' },
  { type: 'invoice.created',    label: 'Invoice Created',        icon: 'solar:document-text-line-duotone',           color: '#7c3aed' },
  { type: 'invoice.overdue',    label: 'Invoice Overdue',        icon: 'solar:bell-bing-line-duotone',               color: '#7c3aed' },
  { type: 'payment.received',   label: 'Payment Received',       icon: 'solar:card-line-duotone',                    color: '#7c3aed' },
  { type: 'donation.captured',  label: 'Donation Received',      icon: 'solar:hand-heart-line-duotone',              color: '#7c3aed' },
  { type: 'membership.started',          label: 'Membership Started',        icon: 'solar:medal-ribbons-star-line-duotone', color: '#7c3aed' },
  { type: 'membership.renewed',          label: 'Membership Renewed',        icon: 'solar:refresh-circle-line-duotone',     color: '#7c3aed' },
  { type: 'membership.renewal_upcoming', label: 'Membership Renewal Upcoming', icon: 'solar:bell-bing-line-duotone',        color: '#7c3aed' },
  { type: 'pledge.installment_upcoming', label: 'Pledge Installment Upcoming', icon: 'solar:calendar-mark-line-duotone',    color: '#7c3aed' },
  { type: 'volunteer.compliance_expiring', label: 'Volunteer Compliance Expiring', icon: 'solar:shield-warning-line-duotone', color: '#7c3aed' },
];

const ACTIONS = [
  { type: 'send_email',   label: 'Send Email',          icon: 'solar:letter-line-duotone',            color: '#2563eb' },
  { type: 'send_sms',     label: 'Send SMS',             icon: 'solar:chat-round-line-duotone',        color: '#2563eb' },
  { type: 'create_task',  label: 'Create Task',          icon: 'solar:checklist-minimalistic-line-duotone', color: '#2563eb' },
  { type: 'add_tag',      label: 'Add Tag',              icon: 'solar:tag-line-duotone',               color: '#2563eb' },
  { type: 'remove_tag',   label: 'Remove Tag',           icon: 'solar:tag-cross-line-duotone',         color: '#2563eb' },
  { type: 'add_to_list',  label: 'Add to List',          icon: 'solar:users-group-rounded-line-duotone', color: '#2563eb' },
  { type: 'update_field', label: 'Update Field',         icon: 'solar:pen-2-line-duotone',             color: '#2563eb' },
  { type: 'notify_user',  label: 'Notify User',          icon: 'solar:bell-line-duotone',              color: '#2563eb' },
  { type: 'webhook',      label: 'Webhook',              icon: 'solar:link-line-duotone',              color: '#2563eb' },
];

const WAIT_BLOCK = { type: 'wait', label: 'Wait / Delay', icon: 'solar:clock-circle-line-duotone', color: '#d97706' };

// ---------------------------------------------------------------------------
// Custom node components
// ---------------------------------------------------------------------------
function TriggerNode({ data, selected }) {
  const trigger = TRIGGERS.find((t) => t.type === data.triggerType) || {};
  return (
    <div style={{
      border: `2px solid ${selected ? '#7c3aed' : '#c4b5fd'}`,
      borderRadius: 10, background: '#faf5ff', minWidth: 180, boxShadow: selected ? '0 0 0 3px #ede9fe' : 'none',
    }}>
      <div style={{ background: '#7c3aed', borderRadius: '8px 8px 0 0', padding: '8px 12px', display: 'flex', alignItems: 'center', gap: 8, color: '#fff' }}>
        <iconify-icon icon={trigger.icon || 'solar:bolt-line-duotone'} style={{ fontSize: 16 }}></iconify-icon>
        <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>Trigger</span>
      </div>
      <div style={{ padding: '8px 12px', fontSize: 13, fontWeight: 600, color: '#1e1b4b' }}>
        {trigger.label || data.triggerType || 'Select trigger…'}
      </div>
      <Handle type="source" position={Position.Bottom} style={{ background: '#7c3aed' }} />
    </div>
  );
}

function ActionNode({ data, selected }) {
  const action = ACTIONS.find((a) => a.type === data.actionType) || {};
  return (
    <div style={{
      border: `2px solid ${selected ? '#2563eb' : '#bfdbfe'}`,
      borderRadius: 10, background: '#eff6ff', minWidth: 180, boxShadow: selected ? '0 0 0 3px #dbeafe' : 'none',
    }}>
      <Handle type="target" position={Position.Top} style={{ background: '#2563eb' }} />
      <div style={{ background: '#2563eb', borderRadius: '8px 8px 0 0', padding: '8px 12px', display: 'flex', alignItems: 'center', gap: 8, color: '#fff' }}>
        <iconify-icon icon={action.icon || 'solar:play-circle-line-duotone'} style={{ fontSize: 16 }}></iconify-icon>
        <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>Action</span>
      </div>
      <div style={{ padding: '8px 12px', fontSize: 13, fontWeight: 600, color: '#1e3a8a' }}>
        {action.label || data.actionType || 'Select action…'}
      </div>
      {data.config?.template_id && <div style={{ padding: '0 12px 8px', fontSize: 11, color: '#3b82f6' }}>Template #{data.config.template_id}</div>}
      {data.config?.message && <div style={{ padding: '0 12px 8px', fontSize: 11, color: '#3b82f6', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{data.config.message}</div>}
      <Handle type="source" position={Position.Bottom} style={{ background: '#2563eb' }} />
    </div>
  );
}

function WaitNode({ data, selected }) {
  const unitLabel = { minutes: 'min', hours: 'hr', days: 'day', weeks: 'wk' }[data.unit || 'hours'] || 'hr';
  return (
    <div style={{
      border: `2px solid ${selected ? '#d97706' : '#fde68a'}`,
      borderRadius: 10, background: '#fffbeb', minWidth: 160, boxShadow: selected ? '0 0 0 3px #fef3c7' : 'none',
    }}>
      <Handle type="target" position={Position.Top} style={{ background: '#d97706' }} />
      <div style={{ background: '#d97706', borderRadius: '8px 8px 0 0', padding: '8px 12px', display: 'flex', alignItems: 'center', gap: 8, color: '#fff' }}>
        <iconify-icon icon="solar:clock-circle-line-duotone" style={{ fontSize: 16 }}></iconify-icon>
        <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>Wait</span>
      </div>
      <div style={{ padding: '8px 12px', fontSize: 14, fontWeight: 700, color: '#78350f' }}>
        {data.delay || 1} {unitLabel}{Number(data.delay) !== 1 ? 's' : ''}
      </div>
      <Handle type="source" position={Position.Bottom} style={{ background: '#d97706' }} />
    </div>
  );
}

const nodeTypes = { triggerNode: TriggerNode, actionNode: ActionNode, waitNode: WaitNode };

// ---------------------------------------------------------------------------
// Node Inspector Panel (right sidebar)
// ---------------------------------------------------------------------------
function NodeInspector({ node, onChange, onDelete, templates, tags, lists, users }) {
  if (!node) return (
    <div className="p-3 text-center text-muted" style={{ fontSize: 13 }}>
      <iconify-icon icon="solar:cursor-line-duotone" style={{ fontSize: 32, opacity: 0.4 }}></iconify-icon>
      <p className="mt-2 mb-0">Click a block to configure it</p>
    </div>
  );

  const { type, data } = node;

  function setData(key, val) {
    onChange({ ...data, [key]: val });
  }
  function setConfig(key, val) {
    onChange({ ...data, config: { ...(data.config || {}), [key]: val } });
  }

  if (type === 'triggerNode') {
    return (
      <div className="p-3">
        <h6 className="fw-bold mb-3" style={{ color: '#7c3aed' }}>
          <iconify-icon icon="solar:bolt-line-duotone" class="me-1"></iconify-icon>
          Trigger
        </h6>
        <label className="form-label small fw-semibold">Event</label>
        <select className="form-select form-select-sm" value={data.triggerType || ''} onChange={(e) => setData('triggerType', e.target.value)}>
          <option value="">Select trigger…</option>
          {TRIGGERS.map((t) => <option key={t.type} value={t.type}>{t.label}</option>)}
        </select>

        {data.triggerType === 'deal.stage_changed' && (
          <div className="mt-2">
            <label className="form-label small fw-semibold">Stage ID filter <span className="text-muted">(optional)</span></label>
            <input
              type="number" className="form-control form-control-sm"
              placeholder="Any stage"
              value={data.config?.stage_id || ''}
              onChange={(e) => setConfig('stage_id', e.target.value ? Number(e.target.value) : undefined)}
            />
          </div>
        )}
        <DeleteBtn onDelete={onDelete} />
      </div>
    );
  }

  if (type === 'waitNode') {
    return (
      <div className="p-3">
        <h6 className="fw-bold mb-3" style={{ color: '#d97706' }}>
          <iconify-icon icon="solar:clock-circle-line-duotone" class="me-1"></iconify-icon>
          Wait / Delay
        </h6>
        <div className="row g-2">
          <div className="col-6">
            <label className="form-label small fw-semibold">Duration</label>
            <input type="number" min="1" className="form-control form-control-sm"
              value={data.delay || 1}
              onChange={(e) => setData('delay', Number(e.target.value) || 1)} />
          </div>
          <div className="col-6">
            <label className="form-label small fw-semibold">Unit</label>
            <select className="form-select form-select-sm" value={data.unit || 'hours'} onChange={(e) => setData('unit', e.target.value)}>
              <option value="minutes">Minutes</option>
              <option value="hours">Hours</option>
              <option value="days">Days</option>
              <option value="weeks">Weeks</option>
            </select>
          </div>
        </div>
        <DeleteBtn onDelete={onDelete} />
      </div>
    );
  }

  if (type === 'actionNode') {
    const cfg = data.config || {};
    return (
      <div className="p-3">
        <h6 className="fw-bold mb-3" style={{ color: '#2563eb' }}>
          <iconify-icon icon="solar:play-circle-line-duotone" class="me-1"></iconify-icon>
          Action
        </h6>
        <label className="form-label small fw-semibold">Action Type</label>
        <select className="form-select form-select-sm mb-3" value={data.actionType || ''} onChange={(e) => setData('actionType', e.target.value)}>
          <option value="">Select action…</option>
          {ACTIONS.map((a) => <option key={a.type} value={a.type}>{a.label}</option>)}
        </select>

        {data.actionType === 'send_email' && (
          <>
            <label className="form-label small fw-semibold">Email Template</label>
            <select className="form-select form-select-sm mb-2" value={cfg.template_id || ''} onChange={(e) => setConfig('template_id', Number(e.target.value) || undefined)}>
              <option value="">Select template…</option>
              {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            <label className="form-label small fw-semibold">Subject override <span className="text-muted">(optional)</span></label>
            <input className="form-control form-control-sm" value={cfg.subject_override || ''} onChange={(e) => setConfig('subject_override', e.target.value || undefined)} placeholder="Uses template subject" />
          </>
        )}

        {data.actionType === 'send_sms' && (
          <>
            <label className="form-label small fw-semibold">Message</label>
            <textarea className="form-control form-control-sm" rows={3} value={cfg.message || ''} onChange={(e) => setConfig('message', e.target.value)} placeholder="Hi {{contact.first_name}}, …" />
          </>
        )}

        {data.actionType === 'create_task' && (
          <>
            <label className="form-label small fw-semibold">Task Title</label>
            <input className="form-control form-control-sm mb-2" value={cfg.title || ''} onChange={(e) => setConfig('title', e.target.value)} placeholder="Follow up with {{contact.first_name}}" />
            <label className="form-label small fw-semibold">Due (days from now)</label>
            <input type="number" min="0" className="form-control form-control-sm mb-2" value={cfg.due_days ?? ''} onChange={(e) => setConfig('due_days', e.target.value !== '' ? Number(e.target.value) : undefined)} placeholder="e.g. 3" />
            <label className="form-label small fw-semibold">Assign to</label>
            <select className="form-select form-select-sm" value={cfg.assign_to_owner ? '__owner__' : (cfg.assigned_to || '')} onChange={(e) => {
              if (e.target.value === '__owner__') { setConfig('assign_to_owner', true); setConfig('assigned_to', undefined); }
              else { setConfig('assign_to_owner', false); setConfig('assigned_to', Number(e.target.value) || undefined); }
            }}>
              <option value="">Unassigned</option>
              <option value="__owner__">Contact owner</option>
              {users.map((u) => <option key={u.id} value={u.id}>{u.first_name} {u.last_name}</option>)}
            </select>
          </>
        )}

        {(data.actionType === 'add_tag' || data.actionType === 'remove_tag') && (
          <>
            <label className="form-label small fw-semibold">Tag</label>
            <select className="form-select form-select-sm" value={cfg.tag_id || ''} onChange={(e) => setConfig('tag_id', Number(e.target.value) || undefined)}>
              <option value="">Select tag…</option>
              {tags.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </>
        )}

        {data.actionType === 'add_to_list' && (
          <>
            <label className="form-label small fw-semibold">List</label>
            <select className="form-select form-select-sm" value={cfg.list_id || ''} onChange={(e) => setConfig('list_id', Number(e.target.value) || undefined)}>
              <option value="">Select list…</option>
              {lists.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </>
        )}

        {data.actionType === 'update_field' && (
          <>
            <label className="form-label small fw-semibold">Field</label>
            <select className="form-select form-select-sm mb-2" value={cfg.field || ''} onChange={(e) => setConfig('field', e.target.value)}>
              <option value="">Select field…</option>
              <option value="lifecycle_stage">Lifecycle Stage</option>
              <option value="status">Status</option>
              <option value="title">Title</option>
              <option value="department">Department</option>
              <option value="city">City</option>
              <option value="state">State</option>
            </select>
            <label className="form-label small fw-semibold">Value</label>
            <input className="form-control form-control-sm" value={cfg.value || ''} onChange={(e) => setConfig('value', e.target.value)} />
          </>
        )}

        {data.actionType === 'notify_user' && (
          <>
            <label className="form-label small fw-semibold">Message</label>
            <textarea className="form-control form-control-sm" rows={2} value={cfg.message || ''} onChange={(e) => setConfig('message', e.target.value)} placeholder="Deal won: {{deal.name}}" />
            <label className="form-label small fw-semibold mt-2">Notify user</label>
            <select className="form-select form-select-sm" value={cfg.user_id || ''} onChange={(e) => setConfig('user_id', Number(e.target.value) || undefined)}>
              <option value="">Any / contact owner</option>
              {users.map((u) => <option key={u.id} value={u.id}>{u.first_name} {u.last_name}</option>)}
            </select>
          </>
        )}

        {data.actionType === 'webhook' && (
          <>
            <label className="form-label small fw-semibold">URL</label>
            <input className="form-control form-control-sm mb-2" value={cfg.url || ''} onChange={(e) => setConfig('url', e.target.value)} placeholder="https://…" />
            <label className="form-label small fw-semibold">Method</label>
            <select className="form-select form-select-sm" value={cfg.method || 'POST'} onChange={(e) => setConfig('method', e.target.value)}>
              <option>POST</option><option>PUT</option><option>PATCH</option>
            </select>
          </>
        )}

        <DeleteBtn onDelete={onDelete} />
      </div>
    );
  }
  return null;
}

function DeleteBtn({ onDelete }) {
  return (
    <button className="btn btn-sm btn-outline-danger w-100 mt-3 d-flex align-items-center justify-content-center gap-1" onClick={onDelete}>
      <iconify-icon icon="solar:trash-bin-trash-line-duotone"></iconify-icon>
      Remove block
    </button>
  );
}

// ---------------------------------------------------------------------------
// Inner canvas (needs ReactFlowProvider above)
// ---------------------------------------------------------------------------
let _nodeSeq = 1;
function mkId() { return `node_${Date.now()}_${_nodeSeq++}`; }

function BuilderCanvas({ workflowId, initialData, templates, tags, lists, users }) {
  const navigate = useNavigate();
  const { screenToFlowPosition } = useReactFlow();

  const [name,        setName]        = useState(initialData?.name        || '');
  const [description, setDescription] = useState(initialData?.description || '');
  const [status,      setStatus]      = useState(initialData?.status      || 'draft');
  const [triggerType, setTriggerType] = useState(initialData?.trigger_type || '');
  const [saving,      setSaving]      = useState(false);
  const [activating,  setActivating]  = useState(false);
  const [error,       setError]       = useState('');
  const [selectedId,  setSelectedId]  = useState(null);

  const fd = initialData?.flow_definition;
  const [nodes, setNodes, onNodesChange] = useNodesState(
    (typeof fd === 'string' ? JSON.parse(fd) : fd)?.nodes || []
  );
  const [edges, setEdges, onEdgesChange] = useEdgesState(
    (typeof fd === 'string' ? JSON.parse(fd) : fd)?.edges || []
  );

  const onConnect = useCallback(
    (params) => setEdges((eds) => addEdge({ ...params, animated: true, style: { stroke: '#94a3b8', strokeWidth: 2 } }, eds)),
    [setEdges]
  );

  const selectedNode = nodes.find((n) => n.id === selectedId) || null;

  // Keep trigger_type in sync with the trigger node's data
  useEffect(() => {
    const tn = nodes.find((n) => n.type === 'triggerNode');
    if (tn?.data?.triggerType && tn.data.triggerType !== triggerType) {
      setTriggerType(tn.data.triggerType);
    }
  }, [nodes]);

  // Drag from palette → drop onto canvas
  const onDragOver = useCallback((e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }, []);

  const onDrop = useCallback((e) => {
    e.preventDefault();
    const raw = e.dataTransfer.getData('application/automation-block');
    if (!raw) return;
    const block = JSON.parse(raw);
    const position = screenToFlowPosition({ x: e.clientX, y: e.clientY });

    if (block.kind === 'trigger') {
      // Only one trigger node allowed — update existing or create
      const existingTrigger = nodes.find((n) => n.type === 'triggerNode');
      if (existingTrigger) {
        setNodes((ns) => ns.map((n) => n.id === existingTrigger.id
          ? { ...n, data: { ...n.data, triggerType: block.type } }
          : n
        ));
        setTriggerType(block.type);
        return;
      }
      const id = mkId();
      setNodes((ns) => [...ns, { id, type: 'triggerNode', position, data: { triggerType: block.type, config: {} } }]);
      setTriggerType(block.type);
    } else if (block.kind === 'action') {
      const id = mkId();
      setNodes((ns) => [...ns, { id, type: 'actionNode', position, data: { actionType: block.type, config: {} } }]);
    } else if (block.kind === 'wait') {
      const id = mkId();
      setNodes((ns) => [...ns, { id, type: 'waitNode', position, data: { delay: 1, unit: 'hours' } }]);
    }
  }, [nodes, setNodes, screenToFlowPosition]);

  function updateSelectedNodeData(newData) {
    setNodes((ns) => ns.map((n) => n.id === selectedId ? { ...n, data: newData } : n));
    // If trigger node data changed, sync triggerType
    if (selectedNode?.type === 'triggerNode' && newData.triggerType) {
      setTriggerType(newData.triggerType);
    }
  }

  function deleteSelectedNode() {
    setEdges((es) => es.filter((e) => e.source !== selectedId && e.target !== selectedId));
    setNodes((ns) => ns.filter((n) => n.id !== selectedId));
    setSelectedId(null);
  }

  async function save() {
    if (!name.trim()) { setError('Workflow name is required.'); return; }
    setSaving(true); setError('');
    const body = {
      name, description: description || null,
      trigger_type: triggerType || (nodes.find((n) => n.type === 'triggerNode')?.data?.triggerType || ''),
      flow_definition: { nodes, edges },
    };
    try {
      if (workflowId) {
        await api.put(`/automations/${workflowId}`, body);
      } else {
        const { data } = await api.post('/automations', body);
        navigate(`/admin/comms/automations/${data.id}`, { replace: true });
        return;
      }
    } catch (err) {
      setError(err.response?.data?.error || 'Save failed.');
    } finally {
      setSaving(false);
    }
  }

  async function toggleActivate() {
    // Always save first
    await save();
    setActivating(true); setError('');
    try {
      if (status === 'active') {
        await api.post(`/automations/${workflowId}/pause`);
        setStatus('paused');
      } else {
        await api.post(`/automations/${workflowId}/activate`);
        setStatus('active');
      }
    } catch (err) {
      setError(err.response?.data?.error || 'Action failed.');
    } finally {
      setActivating(false);
    }
  }

  const STATUS_TONE = { draft: 'secondary', active: 'success', paused: 'warning' };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 80px)' }}>
      {/* ── Top bar ── */}
      <div className="d-flex align-items-center gap-2 px-3 py-2 border-bottom bg-white flex-wrap" style={{ flexShrink: 0 }}>
        <Link to="/admin/comms/automations" className="btn btn-sm btn-outline-secondary d-flex align-items-center gap-1">
          <iconify-icon icon="solar:alt-arrow-left-line-duotone"></iconify-icon>
          Back
        </Link>
        <input
          className="form-control form-control-sm"
          style={{ maxWidth: 260 }}
          placeholder="Automation name…"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        {status && (
          <span className={`badge bg-${STATUS_TONE[status] || 'secondary'}-subtle text-${STATUS_TONE[status] || 'secondary'} text-capitalize`}>
            {status}
          </span>
        )}
        {error && <span className="text-danger small">{error}</span>}
        <div className="ms-auto d-flex gap-2">
          <button className="btn btn-sm btn-outline-primary d-flex align-items-center gap-1" onClick={save} disabled={saving}>
            <iconify-icon icon="solar:diskette-line-duotone"></iconify-icon>
            {saving ? 'Saving…' : 'Save'}
          </button>
          {workflowId && (
            <button
              className={`btn btn-sm d-flex align-items-center gap-1 ${status === 'active' ? 'btn-warning' : 'btn-success'}`}
              onClick={toggleActivate}
              disabled={activating}
            >
              <iconify-icon icon={status === 'active' ? 'solar:pause-circle-line-duotone' : 'solar:play-circle-line-duotone'}></iconify-icon>
              {status === 'active' ? 'Pause' : 'Activate'}
            </button>
          )}
        </div>
      </div>

      {/* ── Main three-column layout ── */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>

        {/* Left: Block Palette */}
        <div style={{ width: 200, borderRight: '1px solid #e2e8f0', overflowY: 'auto', background: '#f8fafc', flexShrink: 0 }}>
          <div style={{ padding: '10px 12px 4px', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.8, color: '#94a3b8' }}>
            Triggers
          </div>
          {TRIGGERS.map((t) => (
            <PaletteBlock key={t.type} block={{ ...t, kind: 'trigger' }} />
          ))}
          <div style={{ padding: '10px 12px 4px', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.8, color: '#94a3b8' }}>
            Actions
          </div>
          {ACTIONS.map((a) => (
            <PaletteBlock key={a.type} block={{ ...a, kind: 'action' }} />
          ))}
          <div style={{ padding: '10px 12px 4px', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.8, color: '#94a3b8' }}>
            Flow Control
          </div>
          <PaletteBlock block={{ ...WAIT_BLOCK, kind: 'wait' }} />
        </div>

        {/* Center: Canvas */}
        <div style={{ flex: 1, position: 'relative' }} onDragOver={onDragOver} onDrop={onDrop}>
          {nodes.length === 0 && (
            <div style={{
              position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center', pointerEvents: 'none', zIndex: 1,
            }}>
              <iconify-icon icon="solar:bolt-line-duotone" style={{ fontSize: 48, opacity: 0.2 }}></iconify-icon>
              <p style={{ marginTop: 12, color: '#94a3b8', fontSize: 14 }}>Drag blocks from the left panel to build your workflow</p>
            </div>
          )}
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            nodeTypes={nodeTypes}
            onNodeClick={(_, node) => setSelectedId(node.id)}
            onPaneClick={() => setSelectedId(null)}
            fitView
            deleteKeyCode="Delete"
            style={{ background: '#f1f5f9' }}
          >
            <Background color="#cbd5e1" gap={20} size={1} />
            <Controls />
            <MiniMap nodeStrokeWidth={3} zoomable pannable style={{ background: '#e2e8f0' }} />
          </ReactFlow>
        </div>

        {/* Right: Inspector */}
        <div style={{ width: 260, borderLeft: '1px solid #e2e8f0', overflowY: 'auto', background: '#fff', flexShrink: 0 }}>
          <NodeInspector
            node={selectedNode}
            onChange={updateSelectedNodeData}
            onDelete={deleteSelectedNode}
            templates={templates}
            tags={tags}
            lists={lists}
            users={users}
          />
          {!selectedNode && workflowId && (
            <div className="p-3 border-top">
              <label className="form-label small fw-semibold">Description</label>
              <textarea
                className="form-control form-control-sm"
                rows={3}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What does this automation do?"
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function PaletteBlock({ block }) {
  function onDragStart(e) {
    e.dataTransfer.setData('application/automation-block', JSON.stringify(block));
    e.dataTransfer.effectAllowed = 'move';
  }
  return (
    <div
      draggable
      onDragStart={onDragStart}
      style={{
        margin: '2px 8px', padding: '6px 10px', borderRadius: 6, cursor: 'grab',
        border: `1px solid ${block.color}22`, background: `${block.color}11`,
        display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, fontWeight: 500,
        color: block.color, userSelect: 'none',
      }}
      title={`Drag to add ${block.label}`}
    >
      <iconify-icon icon={block.icon} style={{ fontSize: 16, flexShrink: 0 }}></iconify-icon>
      <span style={{ lineHeight: 1.2 }}>{block.label}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page wrapper — loads data then renders the canvas
// ---------------------------------------------------------------------------
export default function AutomationBuilder() {
  const { id } = useParams();
  const workflowId = id ? Number(id) : null;

  const [initialData, setInitialData] = useState(null);
  const [templates,   setTemplates]   = useState([]);
  const [tags,        setTags]        = useState([]);
  const [lists,       setLists]       = useState([]);
  const [users,       setUsers]       = useState([]);
  const [ready,       setReady]       = useState(false);

  useEffect(() => {
    async function load() {
      const [tpl, tgs, lst, usr] = await Promise.all([
        api.get('/templates', { params: { type: 'email', pageSize: 200 } }).then((r) => r.data?.rows || r.data || []).catch(() => []),
        api.get('/tags').then((r) => r.data || []).catch(() => []),
        api.get('/lists').then((r) => r.data?.rows || r.data || []).catch(() => []),
        api.get('/users/assignable').then((r) => r.data || []).catch(() => []),
      ]);
      setTemplates(Array.isArray(tpl) ? tpl : []);
      setTags(Array.isArray(tgs) ? tgs : []);
      setLists(Array.isArray(lst) ? lst : []);
      setUsers(Array.isArray(usr) ? usr : []);

      if (workflowId) {
        const { data } = await api.get(`/automations/${workflowId}`);
        setInitialData(data);
      }
      setReady(true);
    }
    load();
  }, [workflowId]);

  if (!ready) return <div className="text-center py-5 text-muted">Loading…</div>;

  return (
    <ReactFlowProvider>
      <BuilderCanvas
        workflowId={workflowId}
        initialData={initialData}
        templates={templates}
        tags={tags}
        lists={lists}
        users={users}
      />
    </ReactFlowProvider>
  );
}
