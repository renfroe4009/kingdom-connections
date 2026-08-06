import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../../api/client.js';
import PageHeader from '../../components/PageHeader.jsx';

// Roster of every Volunteer-tagged contact (see server/src/services/constituents.js's
// ensureConstituentTag) with how many events they're assigned to — the
// volunteer-centric view of the same data EventDetail.jsx's Volunteers tab
// shows per-event.
export default function VolunteersList() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/volunteers/admin/roster').then(({ data }) => setRows(data)).finally(() => setLoading(false));
  }, []);

  return (
    <div>
      <PageHeader title="Volunteers" subtitle="Everyone tagged as a volunteer, and what they're assigned to" />

      <div className="card">
        <div className="card-body">
          <div className="table-responsive">
            <table className="table table-hover align-middle mb-0">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Phone</th>
                  <th className="text-end">Assignments</th>
                  <th className="text-end">Total Hours</th>
                  <th>Compliance</th>
                  <th>Last Event</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((v) => (
                  <tr key={v.id}>
                    <td className="fw-semibold"><Link to={`/admin/volunteers/${v.id}`}>{v.first_name} {v.last_name}</Link></td>
                    <td>{v.email || '—'}</td>
                    <td>{v.phone || '—'}</td>
                    <td className="text-end">{v.assignment_count}</td>
                    <td className="text-end">{Number(v.total_approved_hours).toFixed(2)}</td>
                    <td>
                      {Number(v.compliance_alert_count) > 0
                        ? <span className="badge bg-warning-subtle text-warning">{v.compliance_alert_count} needs attention</span>
                        : <span className="badge bg-success-subtle text-success">Up to date</span>}
                    </td>
                    <td>{v.last_event_at ? new Date(v.last_event_at).toLocaleDateString() : '—'}</td>
                  </tr>
                ))}
                {!loading && rows.length === 0 && (
                  <tr><td colSpan="7"><div className="empty-state">No volunteers yet — tag a contact "Volunteer," or assign one from an event's detail page.</div></td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
