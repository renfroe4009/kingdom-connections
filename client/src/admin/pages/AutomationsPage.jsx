import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import api from '../../api/client.js';
import PageHeader from '../../components/PageHeader.jsx';
import { useAuth } from '../../auth/AuthContext.jsx';
import { useConfirm } from '../../hooks/useConfirm.jsx';
import { toast } from '../../components/Toast.jsx';
import { parseApiError } from '../../utils/apiError.js';

const STATUS_TONE = { draft: 'secondary', active: 'success', paused: 'warning', archived: 'dark' };

const TRIGGER_LABELS = {
  'contact.created':    'Contact Created',
  'deal.created':       'Deal Created',
  'deal.stage_changed': 'Deal Stage Changed',
  'deal.won':           'Deal Won',
  'deal.lost':          'Deal Lost',
  'invoice.created':    'Invoice Created',
  'invoice.overdue':    'Invoice Overdue',
  'payment.received':   'Payment Received',
};

const TRIGGER_ICONS = {
  'contact.created':    'solar:user-plus-rounded-line-duotone',
  'deal.created':       'solar:dollar-minimalistic-bold-duotone',
  'deal.stage_changed': 'solar:chart-square-line-duotone',
  'deal.won':           'solar:cup-star-line-duotone',
  'deal.lost':          'solar:close-circle-line-duotone',
  'invoice.created':    'solar:document-text-line-duotone',
  'invoice.overdue':    'solar:bell-bing-line-duotone',
  'payment.received':   'solar:card-line-duotone',
};

export default function AutomationsPage() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const [rows, setRows]   = useState([]);
  const [q, setQ]         = useState('');
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(null);
  const { confirm, dialog: confirmDialog } = useConfirm();

  async function load() {
    setLoading(true);
    try {
      const { data } = await api.get('/automations', { params: { q: q || undefined, status: status || undefined } });
      setRows(data);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [q, status]);

  async function toggleStatus(row) {
    try {
      if (row.status === 'active') {
        await api.post(`/automations/${row.id}/pause`);
      } else {
        await api.post(`/automations/${row.id}/activate`);
      }
      load();
    } catch (err) {
      toast(parseApiError(err), 'error');
    }
  }

  async function doDelete(id) {
    if (!(await confirm('Archive this automation? It will stop running.'))) return;
    setDeleting(id);
    try {
      await api.delete(`/automations/${id}`);
      load();
    } catch (err) {
      toast(parseApiError(err), 'error');
    } finally {
      setDeleting(null);
    }
  }

  const STATUS_TABS = ['', 'active', 'paused', 'draft'];

  return (
    <>
      <PageHeader
        title="Automations"
        subtitle="Visual drag-and-drop workflows triggered by CRM events"
        actions={can('automations.write') && (
          <Link to="/admin/comms/automations/new" className="btn btn-primary d-flex align-items-center gap-2">
            <iconify-icon icon="solar:add-circle-line-duotone" class="fs-5"></iconify-icon>
            New Automation
          </Link>
        )}
      />

      {/* Filter bar */}
      <div className="card mb-3">
        <div className="card-body p-2 d-flex align-items-center gap-3 flex-wrap">
          <div className="input-group" style={{ maxWidth: 280 }}>
            <span className="input-group-text bg-transparent border-end-0">
              <iconify-icon icon="solar:magnifer-line-duotone"></iconify-icon>
            </span>
            <input
              className="form-control border-start-0"
              placeholder="Search automations…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          <div className="d-flex gap-1 flex-wrap">
            {STATUS_TABS.map((s) => (
              <button
                key={s}
                className={`btn btn-sm ${status === s ? 'btn-primary' : 'btn-outline-secondary'}`}
                onClick={() => setStatus(s)}
              >
                {s ? s.charAt(0).toUpperCase() + s.slice(1) : 'All'}
              </button>
            ))}
          </div>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-5 text-muted">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="card">
          <div className="card-body text-center py-5">
            <iconify-icon icon="solar:bolt-line-duotone" style={{ fontSize: 48, opacity: 0.3 }}></iconify-icon>
            <p className="text-muted mt-3 mb-1">No automations yet.</p>
            {can('automations.write') && (
              <Link to="/admin/comms/automations/new" className="btn btn-primary mt-2">
                Create your first automation
              </Link>
            )}
          </div>
        </div>
      ) : (
        <div className="row g-3">
          {rows.map((row) => (
            <div key={row.id} className="col-12 col-xl-6">
              <div className="card h-100 shadow-sm hover-card">
                <div className="card-body">
                  <div className="d-flex align-items-start justify-content-between gap-2">
                    <div className="d-flex align-items-center gap-2 flex-grow-1 min-w-0">
                      <div className="rounded-2 p-2 bg-primary-subtle d-flex">
                        <iconify-icon
                          icon={TRIGGER_ICONS[row.trigger_type] || 'solar:bolt-line-duotone'}
                          style={{ fontSize: 22, color: 'var(--secondary)' }}
                        ></iconify-icon>
                      </div>
                      <div className="min-w-0">
                        <h6 className="mb-0 text-truncate fw-semibold">{row.name}</h6>
                        <small className="text-muted">
                          {TRIGGER_LABELS[row.trigger_type] || row.trigger_type}
                        </small>
                      </div>
                    </div>
                    <span className={`badge bg-${STATUS_TONE[row.status] || 'secondary'}-subtle text-${STATUS_TONE[row.status] || 'secondary'} text-capitalize flex-shrink-0`}>
                      {row.status}
                    </span>
                  </div>

                  {row.description && (
                    <p className="text-muted small mt-2 mb-0 text-truncate">{row.description}</p>
                  )}

                  <div className="d-flex gap-3 mt-3 text-muted small">
                    <span title="Total runs">
                      <iconify-icon icon="solar:play-circle-line-duotone" class="me-1"></iconify-icon>
                      {row.run_count} runs
                    </span>
                    <span title="Active enrollments">
                      <iconify-icon icon="solar:user-rounded-line-duotone" class="me-1"></iconify-icon>
                      {row.active_enrollments} active
                    </span>
                    {row.last_triggered_at && (
                      <span title="Last triggered">
                        <iconify-icon icon="solar:clock-circle-line-duotone" class="me-1"></iconify-icon>
                        {new Date(row.last_triggered_at).toLocaleDateString()}
                      </span>
                    )}
                  </div>
                </div>

                {can('automations.write') && (
                  <div className="card-footer d-flex gap-2 p-2 bg-transparent border-top">
                    <Link
                      to={`/admin/comms/automations/${row.id}`}
                      className="btn btn-sm btn-outline-primary d-flex align-items-center gap-1 flex-grow-1 justify-content-center"
                    >
                      <iconify-icon icon="solar:pen-2-line-duotone" class="fs-6"></iconify-icon>
                      Edit
                    </Link>
                    <button
                      className={`btn btn-sm ${row.status === 'active' ? 'btn-outline-warning' : 'btn-outline-success'} d-flex align-items-center gap-1 flex-grow-1 justify-content-center`}
                      onClick={() => toggleStatus(row)}
                    >
                      <iconify-icon
                        icon={row.status === 'active' ? 'solar:pause-circle-line-duotone' : 'solar:play-circle-line-duotone'}
                        class="fs-6"
                      ></iconify-icon>
                      {row.status === 'active' ? 'Pause' : 'Activate'}
                    </button>
                    <button
                      className="btn btn-sm btn-outline-danger d-flex align-items-center gap-1"
                      onClick={() => doDelete(row.id)}
                      disabled={deleting === row.id}
                    >
                      <iconify-icon icon="solar:trash-bin-trash-line-duotone" class="fs-6"></iconify-icon>
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
      {confirmDialog}
    </>
  );
}
