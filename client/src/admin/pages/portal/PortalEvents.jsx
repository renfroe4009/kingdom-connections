import { useEffect, useState } from 'react';
import api from '../../../api/client.js';

const STATUS_TONE = { registered: 'success', cancelled: 'secondary', waitlisted: 'warning' };

export default function PortalEvents() {
  const [rows, setRows] = useState([]);

  useEffect(() => {
    api.get('/portal/event-registrations').then((r) => setRows(r.data.rows || [])).catch(() => {});
  }, []);

  const fmt = (n) => `$${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  return (
    <div>
      <h3 className="fw-bolder mb-1">My Event Registrations</h3>
      <p className="text-muted">Events you've registered for.</p>

      <div className="card">
        <div className="card-body">
          <div className="table-responsive">
            <table className="table align-middle mb-0">
              <thead>
                <tr><th>Event</th><th>When</th><th>Ticket</th><th className="text-end">Qty</th><th>Status</th></tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td className="fw-semibold">{r.event_name}<div className="text-muted small">{r.location}</div></td>
                    <td>{new Date(r.start_at).toLocaleString()}</td>
                    <td>{r.ticket_name}{Number(r.price) > 0 ? ` (${fmt(r.price)})` : ' (Free)'}</td>
                    <td className="text-end">{r.quantity}</td>
                    <td><span className={`badge bg-${STATUS_TONE[r.status] || 'secondary'}-subtle text-${STATUS_TONE[r.status] || 'secondary'}`}>{r.status}</span></td>
                  </tr>
                ))}
                {rows.length === 0 && <tr><td colSpan="5"><div className="empty-state">No event registrations yet.</div></td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
