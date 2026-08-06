import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import api from '../../api/client.js';
import PageHeader from '../../components/PageHeader.jsx';
import { useConfirm } from '../../hooks/useConfirm.jsx';
import { toast } from '../../components/Toast.jsx';
import { parseApiError } from '../../utils/apiError.js';

/**
 * CampaignDetail — read + manage view for a single campaign.
 *
 * Lives at /comms/campaigns/:id. Shows configuration at a glance, the
 * pending/sent/failed counts from the queue, lifecycle action buttons
 * (start / pause / resume / cancel / send-now), and a paged list of
 * the underlying email_scheduled_sends rows so admins can troubleshoot
 * delivery issues.
 *
 * The detail page polls send counts every 10s while a campaign is in
 * an active state — that's cheap (one indexed COUNT) and gives admins
 * live feedback as a wave drains, without us having to wire up SSE.
 */

const STATUS_BADGES = {
  draft:     'bg-light text-muted',
  scheduled: 'bg-info-subtle text-info',
  active:    'bg-success-subtle text-success',
  paused:    'bg-warning-subtle text-warning',
  completed: 'bg-secondary-subtle text-secondary',
  cancelled: 'bg-danger-subtle text-danger',
};

const SEND_STATUS_BADGES = {
  pending:   'bg-light text-dark',
  sending:   'bg-info-subtle text-info',
  sent:      'bg-success-subtle text-success',
  failed:    'bg-danger-subtle text-danger',
  cancelled: 'bg-secondary-subtle text-secondary',
};

function fmtDate(s) {
  if (!s) return '—';
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleString();
}

export default function CampaignDetail() {
  const { id } = useParams();
  const nav = useNavigate();

  const [c, setC] = useState(null);
  const [sends, setSends] = useState([]);
  const [sendFilter, setSendFilter] = useState('all');
  const [audCount, setAudCount] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const { confirm, dialog: confirmDialog } = useConfirm();

  async function load() {
    try {
      const { data } = await api.get(`/campaigns/${id}`);
      setC(data);
    } catch (e) { setErr(e.response?.data?.error || e.message); }
  }
  async function loadSends() {
    try {
      const params = sendFilter === 'all' ? {} : { status: sendFilter };
      const { data } = await api.get(`/campaigns/${id}/sends`, { params: { ...params, limit: 100 } });
      setSends(data || []);
    } catch (_e) { /* not fatal */ }
  }
  async function loadAudience() {
    try {
      const { data } = await api.get(`/campaigns/${id}/preview-audience`);
      setAudCount(data.count);
    } catch (_e) { /* not fatal */ }
  }

  useEffect(() => {
    load(); loadSends(); loadAudience();
    // Live-ish refresh while a campaign is working.
    const t = setInterval(() => {
      // Cheap to just always reload; the server compute is one indexed COUNT.
      load(); loadSends();
    }, 10_000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => { loadSends(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [sendFilter]);

  async function action(path, message, danger = true) {
    if (message && !(await confirm(message, { danger }))) return;
    setBusy(true); setErr('');
    try {
      const { data } = await api.post(`/campaigns/${id}/${path}`);
      // Surface send-now / start results in a toast so admins aren't left
      // wondering whether a wave actually went out. The server returns
      // counts post-drain.
      if (path === 'send-now') {
        const lines = [`Enqueued ${data.enqueued ?? 0} recipient${data.enqueued === 1 ? '' : 's'}.`];
        if (typeof data.sent    === 'number') lines.push(`Sent: ${data.sent}`);
        if (typeof data.failed  === 'number' && data.failed)  lines.push(`Failed: ${data.failed}`);
        if (typeof data.pending === 'number' && data.pending) lines.push(`Still pending: ${data.pending}`);
        if (data.drain_error) lines.push(`Drainer error: ${data.drain_error}`);
        toast(lines.join(' '));
      } else if (path === 'start' && typeof data?.enqueued === 'number') {
        toast(`Scheduled ${data.enqueued} recipient${data.enqueued === 1 ? '' : 's'}.`);
      }
      await load(); await loadSends();
    } catch (e) {
      const msg = parseApiError(e, e.message || `${path} failed`);
      setErr(msg);
      toast(msg, 'error');
    } finally { setBusy(false); }
  }

  async function remove() {
    if (!(await confirm('Delete this campaign and all its scheduled sends? This cannot be undone.', { danger: true }))) return;
    setBusy(true); setErr('');
    try {
      await api.delete(`/campaigns/${id}`);
      nav('/admin/comms/campaigns');
    } catch (e) {
      const msg = parseApiError(e, e.message || 'Delete failed');
      setErr(msg);
      toast(msg, 'error');
      setBusy(false);
    }
  }

  if (err && !c) return <div className="alert alert-danger m-3">{err}</div>;
  if (!c) return <div className="p-3 text-muted">Loading…</div>;

  // Action buttons depend on lifecycle state.
  const isBlast = c.type === 'blast';
  const canStart  = c.status === 'draft';
  const canPause  = c.status === 'scheduled' || c.status === 'active';
  const canResume = c.status === 'paused';
  const canCancel = ['draft','scheduled','active','paused'].includes(c.status);
  const canSendNow = (isBlast || c.type === 'recurring')
    && ['draft','scheduled','active','paused'].includes(c.status);

  const step0 = (c.steps || [])[0] || {};

  return (
    <div>
      <PageHeader
        title={c.name}
        subtitle={`Campaign #${c.id} · ${c.type}`}
        actions={(
          <>
            <Link to="/admin/comms/campaigns" className="btn btn-light me-2">
              <iconify-icon icon="solar:arrow-left-line-duotone" class="me-1"></iconify-icon> Back
            </Link>
            <Link to={`/admin/comms/campaigns/${id}/edit`} className="btn btn-light">
              <iconify-icon icon="solar:pen-new-square-line-duotone" class="me-1"></iconify-icon> Edit
            </Link>
          </>
        )}
      />

      {err && <div className="alert alert-danger">{err}</div>}

      <div className="row g-3">
        <div className="col-lg-8">
          {/* ---- Status + counts ---- */}
          <div className="card mb-3">
            <div className="card-body">
              <div className="d-flex align-items-center justify-content-between mb-3">
                <div>
                  <span className={`badge ${STATUS_BADGES[c.status]} text-capitalize me-2`}>{c.status}</span>
                  {c.last_run_at && <span className="text-muted small">Last run {fmtDate(c.last_run_at)}</span>}
                </div>
                <div className="d-flex gap-2">
                  {canStart && (
                    <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => action('start')}>
                      <iconify-icon icon="solar:play-line-duotone" class="me-1"></iconify-icon>
                      {isBlast ? 'Schedule' : 'Activate'}
                    </button>
                  )}
                  {canSendNow && (
                    <button className="btn btn-success btn-sm" disabled={busy}
                      onClick={() => action('send-now', 'Send this wave right now?', true)}>
                      <iconify-icon icon="solar:rocket-2-bold-duotone" class="me-1"></iconify-icon>
                      Send now
                    </button>
                  )}
                  {canPause && (
                    <button className="btn btn-warning btn-sm" disabled={busy} onClick={() => action('pause', 'Pause this campaign?', false)}>
                      <iconify-icon icon="solar:pause-line-duotone" class="me-1"></iconify-icon> Pause
                    </button>
                  )}
                  {canResume && (
                    <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => action('resume')}>
                      <iconify-icon icon="solar:play-line-duotone" class="me-1"></iconify-icon> Resume
                    </button>
                  )}
                  {canCancel && (
                    <button className="btn btn-outline-danger btn-sm" disabled={busy} onClick={() => action('cancel', 'Cancel this campaign?', true)}>
                      <iconify-icon icon="solar:close-circle-line-duotone" class="me-1"></iconify-icon> Cancel
                    </button>
                  )}
                  <button className="btn btn-outline-danger btn-sm" disabled={busy} onClick={remove} title="Delete">
                    <iconify-icon icon="solar:trash-bin-trash-line-duotone"></iconify-icon>
                  </button>
                </div>
              </div>

              <div className="row text-center">
                {[
                  { k: 'pending',   label: 'Pending',   color: 'text-secondary' },
                  { k: 'sending',   label: 'Sending',   color: 'text-info' },
                  { k: 'sent',      label: 'Sent',      color: 'text-success' },
                  { k: 'failed',    label: 'Failed',    color: 'text-danger' },
                  { k: 'cancelled', label: 'Cancelled', color: 'text-muted' },
                ].map((s) => (
                  <div className="col" key={s.k}>
                    <div className={`fs-3 fw-bold ${s.color}`}>{c.send_counts?.[s.k] ?? 0}</div>
                    <div className="text-muted small">{s.label}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* ---- Send queue ---- */}
          <div className="card">
            <div className="card-body">
              <div className="d-flex align-items-center justify-content-between mb-2">
                <h5 className="mb-0">Send queue</h5>
                <select className="form-select form-select-sm" style={{ maxWidth: 180 }}
                  value={sendFilter} onChange={(e) => setSendFilter(e.target.value)}>
                  <option value="all">All statuses</option>
                  <option value="pending">Pending</option>
                  <option value="sending">Sending</option>
                  <option value="sent">Sent</option>
                  <option value="failed">Failed</option>
                  <option value="cancelled">Cancelled</option>
                </select>
              </div>
              <div className="table-responsive">
                <table className="table table-sm table-hover align-middle mb-0">
                  <thead>
                    <tr>
                      <th>Recipient</th>
                      <th>Email</th>
                      <th>Scheduled for</th>
                      <th>Status</th>
                      <th className="text-end">Attempts</th>
                      <th>Sent at</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sends.map((s) => (
                      <tr key={s.id}>
                        <td>{s.contact_id
                          ? <Link to={`/admin/contacts/${s.contact_id}`}>{s.contact_name || `#${s.contact_id}`}</Link>
                          : <span className="text-muted">—</span>}
                        </td>
                        <td className="text-muted">{s.to_email}</td>
                        <td className="text-muted">{fmtDate(s.scheduled_for)}</td>
                        <td>
                          <span className={`badge ${SEND_STATUS_BADGES[s.status] || 'bg-light'} text-capitalize`}>
                            {s.status}
                          </span>
                          {s.last_error && <div className="text-danger small">{s.last_error}</div>}
                        </td>
                        <td className="text-end">{s.attempts}</td>
                        <td className="text-muted">{fmtDate(s.sent_at)}</td>
                      </tr>
                    ))}
                    {sends.length === 0 && (
                      <tr><td colSpan="6"><div className="empty-state">
                        No sends yet — scheduled and recurring campaigns materialize the queue when they fire.
                      </div></td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>

        {/* ---- Sidebar config summary ---- */}
        <div className="col-lg-4">
          <div className="card mb-3">
            <div className="card-body">
              <h5 className="mb-3">Configuration</h5>
              <dl className="row mb-0 small">
                <dt className="col-5 text-muted">Type</dt>
                <dd className="col-7 text-capitalize">{c.type}</dd>

                <dt className="col-5 text-muted">Audience</dt>
                <dd className="col-7 text-capitalize">{c.audience_type.replace('_', ' ')}</dd>

                {c.audience_type === 'list' && c.audience_config?.list_id && (
                  <>
                    <dt className="col-5 text-muted">List ID</dt>
                    <dd className="col-7">#{c.audience_config.list_id}</dd>
                  </>
                )}
                {c.audience_type === 'contacts' && (
                  <>
                    <dt className="col-5 text-muted">Contacts</dt>
                    <dd className="col-7">{c.audience_config?.contact_ids?.length || 0}</dd>
                  </>
                )}

                <dt className="col-5 text-muted">Recipients now</dt>
                <dd className="col-7"><strong>{audCount ?? '—'}</strong></dd>

                {c.type === 'blast' && (
                  <>
                    <dt className="col-5 text-muted">Send at</dt>
                    <dd className="col-7">{fmtDate(c.schedule_config?.send_at)}</dd>
                  </>
                )}
                {c.type === 'recurring' && (
                  <>
                    <dt className="col-5 text-muted">Cron</dt>
                    <dd className="col-7"><code className="small">{c.schedule_config?.cron}</code></dd>
                  </>
                )}

                <dt className="col-5 text-muted">Timezone</dt>
                <dd className="col-7">{c.schedule_config?.timezone || 'UTC'}</dd>

                <dt className="col-5 text-muted">Template</dt>
                <dd className="col-7">{step0.template_name || '—'}</dd>

                <dt className="col-5 text-muted">Created</dt>
                <dd className="col-7 text-muted">{fmtDate(c.created_at)}</dd>
              </dl>
            </div>
          </div>
        </div>
      </div>
      {confirmDialog}
    </div>
  );
}
