import { useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import api from '../../api/client.js';
import TicketScanner from '../../components/TicketScanner.jsx';

// Standalone (no site header/footer) gate scanner for day-of volunteers with
// no CRM account — reached via a per-event PIN link staff hands out
// (EventDetail.jsx's "Regenerate PIN" control). Same scan outcomes as the
// staff-authed EventCheckIn.jsx, via the shared eventTickets scan service.
export default function EventCheckinScanner() {
  const { eventId } = useParams();
  const [searchParams] = useSearchParams();
  const [pin, setPin] = useState(searchParams.get('pin') || '');
  const [pinConfirmed, setPinConfirmed] = useState(!!searchParams.get('pin'));
  const [log, setLog] = useState([]);
  const [scanning, setScanning] = useState(false);

  async function handleScan(qr_token) {
    setScanning(true);
    try {
      const { data } = await api.post(`/events/public/checkin/${eventId}/scan`, { pin, qr_token });
      setLog(l => [{ ...data, at: new Date() }, ...l].slice(0, 20));
    } catch (e) {
      const data = e.response?.data;
      if (e.response?.status === 403) {
        setPinConfirmed(false);
        setLog(l => [{ ok: false, message: 'Incorrect PIN', at: new Date() }, ...l].slice(0, 20));
      } else {
        setLog(l => [{ ...(data || { message: 'Scan failed' }), ok: false, at: new Date() }, ...l].slice(0, 20));
      }
    } finally {
      setScanning(false);
    }
  }

  if (!pinConfirmed) {
    return (
      <div style={{ maxWidth: 360, margin: '4rem auto', padding: '0 1.5rem', textAlign: 'center' }}>
        <h4>Gate Check-In</h4>
        <p className="text-muted small">Enter the check-in PIN staff gave you for this event.</p>
        <form onSubmit={e => { e.preventDefault(); if (pin.trim()) setPinConfirmed(true); }}>
          <input className="form-control text-center mb-3" style={{ fontSize: '1.5rem', letterSpacing: '0.2em' }}
            value={pin} onChange={e => setPin(e.target.value)} placeholder="PIN" autoFocus />
          <button className="btn btn-primary w-100" type="submit" disabled={!pin.trim()}>Continue</button>
        </form>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 480, margin: '2rem auto', padding: '0 1.5rem' }}>
      <h4 className="text-center mb-3">Gate Check-In</h4>
      <TicketScanner onScan={handleScan} disabled={scanning} />
      <div className="mt-3">
        {log.map((entry, i) => (
          <div key={i} className={`alert py-2 mb-2 ${entry.ok ? 'alert-success' : 'alert-danger'}`}>
            <div className="fw-semibold">{entry.message}</div>
            {entry.ticket && <div className="small text-muted">{entry.ticket.event_name} — {entry.ticket.ticket_type_name}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}
