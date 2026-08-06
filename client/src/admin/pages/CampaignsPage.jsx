import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../../api/client.js';
import PageHeader from '../../components/PageHeader.jsx';

/**
 * CampaignsPage — index view for the Email Workflow module.
 *
 * Lists every campaign with its type, audience, lifecycle status and a
 * pending-sends count so admins can spot a stuck queue at a glance. Drilling
 * in lands on CampaignDetail (read + manage); the New Campaign button routes
 * to CampaignComposer.
 *
 * Phase 1a only surfaces blast + recurring; the table still shows drip /
 * triggered rows if the API has them so 1b doesn't need a UI shuffle.
 */

const TYPE_LABELS = {
  blast: 'One-shot blast',
  recurring: 'Recurring',
  drip: 'Drip sequence',
  triggered: 'Event-triggered',
};

const STATUS_BADGES = {
  draft:     'bg-light text-muted',
  scheduled: 'bg-info-subtle text-info',
  active:    'bg-success-subtle text-success',
  paused:    'bg-warning-subtle text-warning',
  completed: 'bg-secondary-subtle text-secondary',
  cancelled: 'bg-danger-subtle text-danger',
};

const AUDIENCE_LABELS = {
  list: 'List',
  segment: 'Segment',
  contacts: 'Specific contacts',
  all: 'All contacts',
};

function fmtDate(s) {
  if (!s) return '—';
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleString();
}

export default function CampaignsPage() {
  const [rows, setRows] = useState([]);
  const [filter, setFilter] = useState('all'); // all | active | scheduled | draft | paused | completed
  const [err, setErr] = useState('');

  async function load() {
    try {
      const { data } = await api.get('/campaigns');
      setRows(data || []);
    } catch (e) { setErr(e.response?.data?.error || e.message); }
  }
  useEffect(() => { load(); }, []);

  const visible = rows.filter((r) => filter === 'all' ? true : r.status === filter);
  const counts = rows.reduce((acc, r) => { acc[r.status] = (acc[r.status] || 0) + 1; return acc; }, {});

  return (
    <div>
      <PageHeader
        title="Campaigns"
        subtitle={`${rows.length} campaign${rows.length === 1 ? '' : 's'} — schedule blasts, drip sequences, and recurring sends`}
        actions={(
          <Link to="/admin/comms/campaigns/new" className="btn btn-primary">
            <iconify-icon icon="solar:add-circle-line-duotone" class="me-1"></iconify-icon>
            New Campaign
          </Link>
        )}
      />

      {err && <div className="alert alert-danger">{err}</div>}

      <ul className="nav nav-pills mb-3 gap-1">
        {['all','draft','scheduled','active','paused','completed'].map((s) => (
          <li className="nav-item" key={s}>
            <button className={`nav-link text-capitalize ${filter === s ? 'active' : ''}`} onClick={() => setFilter(s)}>
              {s}
              {s !== 'all' && counts[s] ? <span className="badge bg-light text-dark ms-2">{counts[s]}</span> : null}
            </button>
          </li>
        ))}
      </ul>

      <div className="card">
        <div className="card-body">
          <div className="table-responsive">
            <table className="table table-hover align-middle mb-0">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Type</th>
                  <th>Audience</th>
                  <th>Status</th>
                  <th className="text-end">Pending</th>
                  <th className="text-end">Sent so far</th>
                  <th>Last run</th>
                  <th>Created by</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <Link to={`/admin/comms/campaigns/${r.id}`} className="fw-semibold text-decoration-none">
                        {r.name}
                      </Link>
                      {r.description && <div className="small text-muted">{r.description}</div>}
                    </td>
                    <td><span className="badge bg-light text-dark">{TYPE_LABELS[r.type] || r.type}</span></td>
                    <td className="text-muted">{AUDIENCE_LABELS[r.audience_type] || r.audience_type}</td>
                    <td>
                      <span className={`badge ${STATUS_BADGES[r.status] || 'bg-light text-dark'} text-capitalize`}>
                        {r.status}
                      </span>
                    </td>
                    <td className="text-end">{r.pending_sends || 0}</td>
                    <td className="text-end">{r.total_enrolled || 0}</td>
                    <td className="text-muted">{fmtDate(r.last_run_at)}</td>
                    <td className="text-muted">{r.created_by_name || '—'}</td>
                  </tr>
                ))}
                {visible.length === 0 && (
                  <tr><td colSpan="8"><div className="empty-state">
                    {rows.length === 0
                      ? 'No campaigns yet — create one to schedule your first email blast.'
                      : `No campaigns match the "${filter}" filter.`}
                  </div></td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
