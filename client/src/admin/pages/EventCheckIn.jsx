import { useEffect, useState, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import api from '../../api/client.js';
import PageHeader from '../../components/PageHeader.jsx';
import TicketScanner from '../../components/TicketScanner.jsx';

// Staff gate check-in — scans a ticket's QR code (or manual entry) and marks
// it checked in via the shared scan service (server/src/services/eventTickets.js).
// The same scan/void/already-used outcomes are shared with the public
// PIN-link scanner (EventCheckinScanner.jsx).
export default function EventCheckIn() {
  const { id } = useParams();
  const [summary, setSummary] = useState(null);
  const [log, setLog] = useState([]);
  const [scanning, setScanning] = useState(false);

  const loadSummary = useCallback(async () => {
    const { data } = await api.get(`/events/admin/${id}/checkin/summary`);
    setSummary(data);
  }, [id]);

  useEffect(() => { loadSummary(); }, [loadSummary]);

  async function handleScan(qr_token) {
    setScanning(true);
    try {
      const { data } = await api.post('/events/admin/checkin/scan', { qr_token, event_id: Number(id) });
      setLog(l => [{ ...data, at: new Date() }, ...l].slice(0, 20));
      loadSummary();
    } catch (e) {
      const data = e.response?.data;
      setLog(l => [{ ...(data || { message: 'Scan failed' }), ok: false, at: new Date() }, ...l].slice(0, 20));
    } finally {
      setScanning(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Gate Check-In"
        subtitle={summary ? `${summary.checked_in} of ${summary.total_tickets} tickets checked in${summary.capacity ? ` (capacity ${summary.capacity})` : ''}` : ''}
        actions={<Link to={`/admin/events/${id}`} className="btn btn-light">← Back to Event</Link>}
      />

      <div className="row">
        <div className="col-lg-6 mb-3">
          <div className="card"><div className="card-body">
            <TicketScanner onScan={handleScan} disabled={scanning} />
          </div></div>
        </div>
        <div className="col-lg-6">
          <div className="card"><div className="card-body">
            <h6 className="fw-bold text-uppercase small text-muted">Scan Log</h6>
            {log.length === 0 && <div className="empty-state">Scan a ticket to see results here.</div>}
            {log.map((entry, i) => (
              <div key={i} className={`alert py-2 mb-2 ${entry.ok ? 'alert-success' : 'alert-danger'}`}>
                <div className="fw-semibold">{entry.message}</div>
                {entry.ticket && <div className="small text-muted">{entry.ticket.event_name} — {entry.ticket.ticket_type_name}</div>}
              </div>
            ))}
          </div></div>
        </div>
      </div>
    </div>
  );
}
