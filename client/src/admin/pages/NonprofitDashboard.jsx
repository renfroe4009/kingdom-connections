import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../../api/client.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import { parseServerDate } from '../../utils/date.js';
import { wontRenew } from '../../utils/membershipTerms.js';

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

// A subscription's per_run_total normalized to a monthly-equivalent amount,
// so a weekly $10 gift and a yearly $520 gift both roll up into one
// comparable "recurring giving per month" figure. interval_unit is
// day|week|month|year (no quarter in this schema) — see server/src/routes/
// subscriptions.js's zod enum.
function monthlyEquivalent(row) {
  const perRun = Number(row.per_run_total || 0);
  const count = Number(row.interval_count || 1) || 1;
  const unitsPerMonth = {
    day: 30 / count,
    week: (52 / 12) / count,
    month: 1 / count,
    year: (1 / 12) / count,
  }[row.interval_unit] ?? 0;
  return perRun * unitsPerMonth;
}

export default function NonprofitDashboard() {
  const { user, can } = useAuth();
  const [donations, setDonations] = useState(null);
  const [membership, setMembership] = useState(null);
  const [upcomingEvents, setUpcomingEvents] = useState([]);
  const [pledges, setPledges] = useState([]);
  const [subscriptions, setSubscriptions] = useState([]);
  const [overdueTasks, setOverdueTasks] = useState([]);
  const [recentActivity, setRecentActivity] = useState([]);

  useEffect(() => {
    if (can('donations.read')) {
      api.get('/donations/admin/summary').then((r) => setDonations(r.data)).catch(() => {});
      api.get('/pledges').then((r) => setPledges(r.data.rows || [])).catch(() => {});
    }
    if (can('membership.read')) {
      api.get('/membership/admin/summary').then((r) => setMembership(r.data)).catch(() => {});
    }
    if (can('subscriptions.read')) {
      api.get('/subscriptions').then((r) => setSubscriptions(r.data.rows || [])).catch(() => {});
    }
    if (can('events.read')) {
      const start = new Date().toISOString().slice(0, 10);
      const end = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
      api.get('/events/admin/calendar', { params: { start, end } }).then((r) => setUpcomingEvents(r.data.slice(0, 5))).catch(() => {});
    }
    api.get('/tasks', { params: { due: 'overdue' } }).then((r) => setOverdueTasks(r.data)).catch(() => {});
    api.get('/activities', { params: { limit: 8 } }).then((r) => setRecentActivity(r.data)).catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const fmtMoney = (n) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n || 0);

  // A one-time membership is active but never bills again — not recurring giving.
  const activeSubs = subscriptions.filter((s) => s.status === 'active' && !wontRenew(s));
  const monthlyRecurringTotal = activeSubs.reduce((sum, s) => sum + monthlyEquivalent(s), 0);

  const openPledges = pledges.filter((p) => p.status !== 'completed' && p.status !== 'canceled');
  const pledgesOutstanding = openPledges.reduce((sum, p) => sum + Number(p.balance_remaining || 0), 0);

  const topTier = membership?.byTier?.[0];

  return (
    <div>
      <div className="row mt-2">
        <div className="col-12 mb-3">
          <h4 className="mb-0">Welcome back, {user?.first_name || 'there'} 👋</h4>
          <p className="text-muted fs-3 mt-1">Here's how giving and membership are trending.</p>
        </div>
      </div>

      <div className="row">
        <KpiCard icon="solar:dollar-minimalistic-bold-duotone" tint="primary"
          label="Raised This Month" value={fmtMoney(donations?.thisMonth?.total_raised)}
          sub={`${donations?.thisMonth?.gift_count || 0} gifts`} />
        <KpiCard icon="solar:medal-ribbons-star-bold-duotone" tint="success"
          label="Active Members" value={membership?.totals?.active_count ?? '—'}
          sub={topTier ? `${topTier.tier_name}: ${topTier.member_count}` : undefined} />
        <KpiCard icon="solar:refresh-circle-bold-duotone" tint="warning"
          label="Recurring Giving / mo" value={fmtMoney(monthlyRecurringTotal)}
          sub={`${activeSubs.length} active`} />
      </div>

      <div className="row">
        <KpiCard icon="solar:hand-heart-bold-duotone" tint="info"
          label="Total Raised (All-Time)" value={fmtMoney(donations?.totals?.total_raised)}
          sub={`${donations?.totals?.gift_count || 0} gifts`} />
        <KpiCard icon="solar:calendar-mark-bold-duotone" tint="secondary"
          label="Pledges Outstanding" value={fmtMoney(pledgesOutstanding)}
          sub={`${openPledges.length} pledges`} />
      </div>

      <div className="row mt-2">
        <div className="col-lg-6 mb-3">
          <div className="card h-100">
            <div className="card-body">
              <h5 className="fw-semibold mb-3">By Fund</h5>
              {!donations?.byFund?.length ? (
                <div className="empty-state">No gifts recorded yet.</div>
              ) : (
                <table className="table align-middle mb-0">
                  <thead>
                    <tr><th>Fund</th><th className="text-end">Gifts</th><th className="text-end">Raised</th></tr>
                  </thead>
                  <tbody>
                    {donations.byFund.map((f) => (
                      <tr key={f.fund_name}>
                        <td>{f.fund_name || 'Undesignated'}</td>
                        <td className="text-end">{f.gift_count}</td>
                        <td className="text-end fw-bold">{fmtMoney(f.total_raised)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>

        <div className="col-lg-6 mb-3">
          <div className="card h-100">
            <div className="card-body">
              <h5 className="fw-semibold mb-3">Membership by Tier</h5>
              {!membership?.byTier?.length ? (
                <div className="empty-state">No active tiers yet.</div>
              ) : (
                <table className="table align-middle mb-0">
                  <thead>
                    <tr><th>Tier</th><th className="text-end">Price</th><th className="text-end">Members</th></tr>
                  </thead>
                  <tbody>
                    {membership.byTier.map((t) => (
                      <tr key={t.tier_name}>
                        <td>{t.tier_name}</td>
                        <td className="text-end">{fmtMoney(t.price)}</td>
                        <td className="text-end fw-bold">{t.member_count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
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
    </div>
  );
}
