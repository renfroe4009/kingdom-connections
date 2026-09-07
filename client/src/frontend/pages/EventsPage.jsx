import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../../api/client.js';

function formatDateRange(startAt, endAt) {
  const start = new Date(startAt);
  const opts = { month: 'short', day: 'numeric' };
  const startStr = start.toLocaleDateString('en-US', opts);
  if (!endAt) return startStr;
  const end = new Date(endAt);
  if (start.toDateString() === end.toDateString()) return startStr;
  return `${startStr} – ${end.toLocaleDateString('en-US', opts)}`;
}

export default function EventsPage() {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/events/public/events')
      .then((r) => setEvents(Array.isArray(r.data) ? r.data : []))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="ns-section">
      <div className="ns-grid">
        <div className="ns-block" style={{ '--col-start': 1, '--col-span': 12 }}>
          <div className="section-heading">
            <p className="eyebrow">Gather With Us</p>
            <h2>Upcoming Events</h2>
            <p>Join us in person or online — see what&rsquo;s coming up for the Kingdom Connections community.</p>
          </div>

          {loading ? (
            <p style={{ textAlign: 'center' }}>Loading events…</p>
          ) : events.length === 0 ? (
            <p style={{ textAlign: 'center' }}>No upcoming events right now — check back soon.</p>
          ) : (
            <div className="events-grid" style={{ '--card-cols': 3 }}>
              {events.map((event) => (
                <Link key={event.id} to={`/events/${event.slug}`} className="card" style={{ display: 'block', textDecoration: 'none', color: 'inherit' }}>
                  <span className="card__tag">{formatDateRange(event.start_at, event.end_at)}</span>
                  <h3>{event.name}</h3>
                  {event.location && <p>{event.location}</p>}
                  {event.description && <p>{event.description}</p>}
                  <span className="btn btn--outline-dark btn--sm" style={{ marginTop: 'var(--space-3)' }}>
                    View &amp; Register
                  </span>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
