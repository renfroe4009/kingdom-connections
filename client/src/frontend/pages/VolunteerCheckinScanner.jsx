import { useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import api from '../../api/client.js';
import TicketScanner from '../../components/TicketScanner.jsx';

// Standalone (no site header/footer) volunteer shift check-in/out scanner —
// reached via the same per-event PIN link used for gate scanning
// (EventDetail.jsx's "Volunteer Shift Check-In Link"), just a different
// scan endpoint targeting event_volunteer_assignments instead of tickets.
// A volunteer scans their own badge once to check in, again to check out;
// actual_hours is computed server-side from the real elapsed time.
export default function VolunteerCheckinScanner() {
  const { eventId } = useParams();
  const [searchParams] = useSearchParams();
  const [pin, setPin] = useState(searchParams.get('pin') || '');
  const [pinConfirmed, setPinConfirmed] = useState(!!searchParams.get('pin'));
  const [log, setLog] = useState([]);
  const [scanning, setScanning] = useState(false);

  async function handleScan(qr_token) {
    setScanning(true);
    try {
      const { data } = await api.post(`/volunteers/public/checkin/${eventId}/scan`, { pin, qr_token });
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
        <h4>Volunteer Shift Check-In</h4>
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
      <h4 className="text-center mb-3">Volunteer Shift Check-In</h4>
      <p className="text-muted small text-center">Scan your badge to check in. Scan it again at the end of your shift to check out.</p>
      <TicketScanner onScan={handleScan} disabled={scanning} />
      <div className="mt-3">
        {log.map((entry, i) => (
          <div key={i} className={`alert py-2 mb-2 ${entry.ok ? 'alert-success' : 'alert-danger'}`}>
            <div className="fw-semibold">{entry.message}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
