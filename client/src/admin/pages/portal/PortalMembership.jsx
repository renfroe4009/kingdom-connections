import { useEffect, useState } from 'react';
import api from '../../../api/client.js';

const STATUS_TONE = { active: 'success', paused: 'warning', canceled: 'secondary', completed: 'secondary' };

export default function PortalMembership() {
  const [rows, setRows] = useState([]);

  useEffect(() => {
    api.get('/portal/membership').then((r) => setRows(r.data.rows || [])).catch(() => {});
  }, []);

  const fmt = (n) => `$${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  return (
    <div>
      <h3 className="fw-bolder mb-1">My Membership</h3>
      <p className="text-muted">Your membership tier, benefits, and renewal date.</p>

      {rows.length === 0 && (
        <div className="card"><div className="card-body"><div className="empty-state">No membership on file.</div></div></div>
      )}

      {rows.map((m) => {
        let benefits = [];
        try { benefits = typeof m.benefits_json === 'string' ? JSON.parse(m.benefits_json) : (m.benefits_json || []); } catch { /* ignore */ }
        return (
          <div className="card mb-3" key={m.subscription_id}>
            <div className="card-body">
              <div className="d-flex justify-content-between align-items-start">
                <div>
                  <h5 className="fw-bold mb-1">{m.tier_name}</h5>
                  <span className={`badge bg-${STATUS_TONE[m.status] || 'secondary'}-subtle text-${STATUS_TONE[m.status] || 'secondary'}`}>{m.status}</span>
                </div>
                <div className="text-end">
                  <div className="fs-4 fw-bold">{fmt(m.price)}</div>
                  <div className="text-muted small">per {m.interval_count > 1 ? `${m.interval_count} ` : ''}{m.interval_unit}{m.interval_count > 1 ? 's' : ''}</div>
                </div>
              </div>
              {m.description && <p className="text-muted small mt-2 mb-2">{m.description}</p>}
              {m.status === 'active' && m.next_run_date && (
                <div className="small text-muted mb-2">Renews on {new Date(m.next_run_date).toLocaleDateString()}</div>
              )}
              {benefits.length > 0 && (
                <ul className="small mb-0 ps-3">
                  {benefits.map((b, i) => <li key={i}>{b}</li>)}
                </ul>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
