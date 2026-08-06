import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import api from '../../api/client.js';

// Standalone (no site header/footer) printable volunteer badge — staff open
// this ahead of an event and print/hand it to the volunteer. The QR code is
// scanned at the Volunteer Shift Check-In Link to check in/out of the shift.
export default function VolunteerBadge() {
  const { qrToken } = useParams();
  const [badge, setBadge] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get(`/volunteers/public/badge/${qrToken}`)
      .then((r) => setBadge(r.data))
      .catch(() => setError('Badge not found.'));
  }, [qrToken]);

  if (error) return <div style={{ maxWidth: 360, margin: '4rem auto', textAlign: 'center' }}>{error}</div>;
  if (!badge) return <div style={{ maxWidth: 360, margin: '4rem auto', textAlign: 'center' }}>Loading…</div>;

  return (
    <div style={{ maxWidth: 360, margin: '2rem auto', padding: '0 1.5rem', textAlign: 'center' }}>
      <div className="border rounded-4 shadow-sm p-4">
        <div className="text-uppercase text-muted small fw-semibold mb-1">Volunteer Badge</div>
        <h4 className="mb-1">{badge.contact_name}</h4>
        <div className="text-muted mb-1">{badge.event_name}</div>
        {badge.role && <div className="small text-muted mb-3">{badge.role}</div>}
        <img
          src={`${api.defaults.baseURL}/volunteers/public/badge/${qrToken}/qr.png`}
          alt="Check-in QR code"
          style={{ width: 220, height: 220 }}
        />
        <p className="text-muted small mt-3 mb-0">
          Scan this code at the volunteer check-in station to start and end your shift.
        </p>
      </div>
    </div>
  );
}
