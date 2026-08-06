import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../../api/client.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import { parseServerDate } from '../../utils/date.js';

function KpiCard({ icon, tint, label, value, sub }) {
  return (
    <div className="col-sm-6 col-xl-4 mb-3">
      <div className="card h-100">
        <div className="card-body">
          <div className="d-flex align-items-center gap-3 mb-3">
            <div className={`p-2 bg-${tint}-subtle rounded-1`}>
              <iconify-icon icon={icon} class={`fs-7 text-${tint}`}></iconify-icon>
            </div>
            <span className="fs-3 text-muted fw-semibold">{label}</span>
          </div>
          <h3 className="mb-1 fw-bolder">{value}</h3>
          {sub && <span className={`badge bg-${tint}-subtle text-${tint} fs-2`}>{sub}</span>}
        </div>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const { user, can } = useAuth();
  const [kpi, setKpi] = useState(null);
  const [leaderboard, setLeaderboard] = useState([]);
  const [overdueTasks, setOverdueTasks] = useState([]);
  const [recentActivity, setRecentActivity] = useState([]);
  const [upcomingEvents, setUpcomingEvents] = useState([]);

  useEffect(() => {
    api.get('/reports/dashboard').then((r) => setKpi(r.data)).catch(() => {});
    api.get('/reports/leaderboard').then((r) => setLeaderboard(r.data)).catch(() => {});
    api.get('/tasks', { params: { due: 'overdue' } }).then((r) => setOverdueTasks(r.data)).catch(() => {});
    api.get('/activities', { params: { limit: 8 } }).then((r) => setRecentActivity(r.data)).catch(() => {});
    if (can('events.read')) {
      const start = new Date().toISOString().slice(0, 10);
      const end = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
      api.get('/events/admin/calendar', { params: { start, end } }).then((r) => setUpcomingEvents(r.data.slice(0, 5))).catch(() => {});
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const fmtMoney = (n) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n || 0);

  return (
    <div>
      <div className="row mt-2">
        <div className="col-12 mb-3">
          <h4 className="mb-0">Welcome back, {user?.first_name || 'there'} 👋</h4>
          <p className="text-muted fs-3 mt-1">Here's what's happening across your pipeline today.</p>
        </div>
      </div>

      <div className="row">
        <KpiCard icon="solar:dollar-minimalistic-bold-duotone" tint="primary"
          label="Won (30d)" value={fmtMoney(kpi?.won_30d?.value)} sub={`${kpi?.won_30d?.count || 0} deals`} />
        <KpiCard icon="solar:chart-2-bold-duotone" tint="warning"
          label="Open Pipeline" value={fmtMoney(kpi?.open_deals?.value)} sub={`${kpi?.open_deals?.count || 0} open deals`} />
        <KpiCard icon="solar:users-group-rounded-bold-duotone" tint="success"
          label="Contacts" value={kpi?.contacts ?? '—'} sub={`${kpi?.organizations ?? 0} orgs`} />
      </div>

      <div className="row mt-2">
        <div className="col-lg-7 mb-3">
          <div className="card h-100">
            <div className="card-body">
              <h5 className="fw-semibold mb-3">Recent Activity</h5>
              {recentActivity.length === 0 && <div className="empty-state">No activity yet.</div>}
              <ul className="list-unstyled mb-0">
                {recentActivity.map((a) => (
                  <li key={a.id} className="d-flex align-items-start gap-3 py-2 border-bottom">
                    <div className="avatar-initials">{(a.user_name || '?')[0]}</div>
                    <div className="flex-fill">
                      <div className="fw-semibold">{a.user_name || 'System'} <span className="text-muted fw-normal">— {a.action}</span></div>
                      <small className="text-muted">{a.description} · {a.entity_type} #{a.entity_id}</small>
                    </div>
                    <small className="text-muted">{parseServerDate(a.created_at)?.toLocaleString()}</small>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>

        <div className="col-lg-5 mb-3">
          <div className="card h-100">
            <div className="card-body">
              <div className="d-flex justify-content-between align-items-center mb-3">
                <h5 className="fw-semibold mb-0">Overdue Tasks</h5>
                <Link to="/admin/tasks" className="text-primary small">See all</Link>
              </div>
              {overdueTasks.length === 0 ? (
                <div className="empty-state">Nothing overdue. Nice 👏</div>
              ) : (
                <ul className="list-unstyled mb-0">
                  {overdueTasks.slice(0, 6).map((t) => (
                    <li key={t.id} className="d-flex align-items-start gap-2 py-2 border-bottom">
                      <iconify-icon icon="solar:danger-triangle-line-duotone" style={{ fontSize: 20, color: '#DC2626' }}></iconify-icon>
                      <div className="flex-fill">
                        <div className="fw-semibold">{t.title}</div>
                        <small className="text-muted">Due {new Date(t.due_date).toLocaleString()} · {t.assignee_name || 'Unassigned'}</small>
                      </div>
                      <span className={`badge bg-${t.priority === 'urgent' ? 'danger' : 'warning'}-subtle text-${t.priority === 'urgent' ? 'danger' : 'warning'} fs-2`}>{t.priority}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      </div>

      {can('events.read') && (
        <div className="row mt-2">
          <div className="col-12 mb-3">
            <div className="card">
              <div className="card-body">
                <div className="d-flex justify-content-between align-items-center mb-3">
                  <h5 className="fw-semibold mb-0">Upcoming Events</h5>
                  <Link to="/admin/events/calendar" className="text-primary small">Open calendar</Link>
                </div>
                {upcomingEvents.length === 0 ? (
                  <div className="empty-state">Nothing scheduled in the next 30 days.</div>
                ) : (
                  <ul className="list-unstyled mb-0">
                    {upcomingEvents.map((e) => (
                      <li key={e.id} className="d-flex align-items-center justify-content-between py-2 border-bottom">
                        <div>
                          <Link to={`/admin/events/${e.id}`} className="fw-semibold text-decoration-none">{e.name}</Link>
                          {e.location && <div className="small text-muted">{e.location}</div>}
                        </div>
                        <div className="text-end">
                          <div className="small">{new Date(e.start_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</div>
                          <div className="small text-muted">{e.registered_count}{e.capacity ? ` / ${e.capacity}` : ''} registered</div>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="row mt-2">
        <div className="col-12 mb-3">
          <div className="card">
            <div className="card-body">
              <h5 className="fw-semibold mb-3">Sales Leaderboard (90d)</h5>
              {leaderboard.length === 0 ? (
                <div className="empty-state">No wins yet — go close some deals!</div>
              ) : (
                <table className="table align-middle mb-0">
                  <thead>
                    <tr>
                      <th>Rep</th>
                      <th className="text-end">Deals Won</th>
                      <th className="text-end">Revenue</th>
                    </tr>
                  </thead>
                  <tbody>
                    {leaderboard.map((r) => (
                      <tr key={r.id}>
                        <td><div className="d-flex align-items-center gap-2">
                          <div className="avatar-initials">{(r.name || '?')[0]}</div>
                          {r.name || '(unassigned)'}
                        </div></td>
                        <td className="text-end">{r.wins}</td>
                        <td className="text-end fw-bold">{fmtMoney(r.total_won)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
