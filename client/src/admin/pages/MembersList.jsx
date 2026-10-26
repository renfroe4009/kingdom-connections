import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../../api/client.js';
import PageHeader from '../../components/PageHeader.jsx';
import { isOneTimeMembership } from '../../utils/membershipTerms.js';

const STATUS_TONE = { active: 'success', paused: 'warning', canceled: 'secondary', completed: 'secondary' };

function fmtMoney(n) {
  return `$${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function MembersList() {
  const [rows, setRows] = useState([]);
  const [summary, setSummary] = useState(null);
  const [tiers, setTiers] = useState([]);
  const [tierId, setTierId] = useState('');
  const [status, setStatus] = useState('');

  async function load() {
    const params = {};
    if (tierId) params.tier_id = tierId;
    if (status) params.status = status;
    const { data } = await api.get('/membership/admin', { params });
    setRows(data.rows);
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [tierId, status]);
  useEffect(() => {
    api.get('/membership/admin/summary').then((r) => setSummary(r.data)).catch(() => {});
    api.get('/membership/admin/tiers').then((r) => setTiers(r.data)).catch(() => {});
  }, []);

  return (
    <div>
      <PageHeader title="Members" subtitle="Active and past memberships"
        actions={<Link to="/admin/membership/tiers" className="btn btn-light">
          <iconify-icon icon="solar:medal-ribbons-star-line-duotone" class="me-1"></iconify-icon> Manage Tiers
        </Link>} />

      {summary && (
        <div className="row g-3 mb-3">
          <div className="col-md-3">
            <div className="card"><div className="card-body">
              <div className="text-muted small">Active Members</div>
              <div className="fs-4 fw-bold">{summary.totals.active_count}</div>
            </div></div>
          </div>
          <div className="col-md-3">
            <div className="card"><div className="card-body">
              <div className="text-muted small">Annualized Revenue (est.)</div>
              <div className="fs-4 fw-bold">{fmtMoney(summary.annualRevenue)}</div>
            </div></div>
          </div>
          <div className="col-md-6">
            <div className="card"><div className="card-body">
              <div className="text-muted small mb-1">By Tier</div>
              {summary.byTier.length ? summary.byTier.map((t) => (
                <div key={t.tier_name} className="d-flex justify-content-between small">
                  <span>{t.tier_name}</span><strong>{t.member_count} members</strong>
                </div>
              )) : <div className="text-muted small">No tiers yet.</div>}
            </div></div>
          </div>
        </div>
      )}

      <div className="card">
        <div className="card-body">
          <div className="row g-2 mb-3">
            <div className="col-md-3">
              <select className="form-select" value={tierId} onChange={(e) => setTierId(e.target.value)}>
                <option value="">All tiers</option>
                {tiers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
            <div className="col-md-3">
              <select className="form-select" value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="">All statuses</option>
                <option value="active">Active</option>
                <option value="paused">Paused</option>
                <option value="canceled">Canceled</option>
                <option value="completed">Completed</option>
              </select>
            </div>
          </div>

          <div className="table-responsive">
            <table className="table table-hover align-middle mb-0">
              <thead>
                <tr>
                  <th>Member</th>
                  <th>Tier</th>
                  <th className="text-end">Price</th>
                  <th>Status</th>
                  <th>Next Renewal</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((m) => (
                  <tr key={m.subscription_id}>
                    <td>
                      {m.contact_id
                        ? <Link to={`/admin/contacts/${m.contact_id}`}>{m.contact_name || m.contact_email}</Link>
                        : (m.organization_name || '—')}
                    </td>
                    <td>{m.tier_name}</td>
                    <td className="text-end fw-semibold">{fmtMoney(m.price)} {isOneTimeMembership(m) ? 'one-time' : `/ ${m.interval_unit}`}</td>
                    <td><span className={`badge bg-${STATUS_TONE[m.status] || 'secondary'}-subtle text-${STATUS_TONE[m.status] || 'secondary'}`}>{m.status}</span></td>
                    <td>{m.next_run_date ? `${isOneTimeMembership(m) ? 'Ends ' : ''}${new Date(m.next_run_date).toLocaleDateString()}` : '—'}</td>
                  </tr>
                ))}
                {rows.length === 0 && <tr><td colSpan="5"><div className="empty-state">No members yet.</div></td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
