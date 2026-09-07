import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import api from '../../api/client.js';
import { useCart } from '../context/CartContext.jsx';

function formatDateRange(startAt, endAt) {
  const opts = { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' };
  const start = new Date(startAt).toLocaleDateString('en-US', opts);
  if (!endAt) return start;
  const end = new Date(endAt).toLocaleDateString('en-US', opts);
  return start === end ? start : `${start} – ${end}`;
}

export default function EventPage() {
  const { slug } = useParams();
  const { addTicket } = useCart();
  const [event, setEvent] = useState(null);
  const [notFound, setNotFound] = useState(false);
  const [selectedTicket, setSelectedTicket] = useState('');
  const [qty, setQty] = useState(1);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setEvent(null); setNotFound(false); setError(''); setDone(false);
    api.get(`/events/public/events/${slug}`)
      .then((r) => {
        setEvent(r.data);
        setSelectedTicket(r.data.tickets?.[0]?.id ? String(r.data.tickets[0].id) : '');
      })
      .catch(() => setNotFound(true));
  }, [slug]);

  if (notFound) {
    return (
      <div className="ns-section" style={{ textAlign: 'center' }}>
        <h1>Event not found</h1>
        <Link to="/events" className="btn btn--gold" style={{ marginTop: 'var(--space-5)' }}>Back to Events</Link>
      </div>
    );
  }
  if (!event) return <div className="ns-section" style={{ textAlign: 'center' }}><p>Loading…</p></div>;

  const tickets = event.tickets || [];

  async function handleAddToCart(e) {
    e.preventDefault();
    if (!selectedTicket) { setError('Please choose a ticket type.'); return; }
    setBusy(true); setError('');
    try {
      await addTicket(Number(selectedTicket), qty);
      setDone(true);
    } catch (err) {
      setError(err.response?.data?.error || 'Could not add that ticket to your cart.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="ns-section">
      <div className="ns-grid">
        <div className="ns-block" style={{ '--col-start': 3, '--col-span': 8 }}>
          <p className="eyebrow">{formatDateRange(event.start_at, event.end_at)}</p>
          <h1 style={{ fontFamily: 'var(--font-heading)', color: 'var(--color-primary)' }}>{event.name}</h1>
          {event.location && <p style={{ color: 'var(--color-text-muted)' }}>{event.location}</p>}
          {event.description && <p style={{ marginTop: 'var(--space-4)' }}>{event.description}</p>}

          <div className="form-card" style={{ marginTop: 'var(--space-7)' }}>
            <h3 className="donate-panel__heading">Register</h3>

            {tickets.length === 0 ? (
              <p className="form-note">Registration isn&rsquo;t open for this event yet — check back soon.</p>
            ) : done ? (
              <p className="form-note">You&rsquo;re registered! Your ticket has been added to your cart — continue to checkout to finish.</p>
            ) : (
              <form onSubmit={handleAddToCart}>
                <div className="donate-amounts">
                  {tickets.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      className={`amount-pill${String(t.id) === selectedTicket ? ' amount-pill--active' : ''}`}
                      onClick={() => setSelectedTicket(String(t.id))}
                    >
                      {t.name} — {Number(t.price) > 0 ? `$${Number(t.price).toFixed(2)}` : 'Free'}
                    </button>
                  ))}
                </div>

                <div className="form-field" style={{ maxWidth: 160 }}>
                  <label htmlFor="event-qty">Quantity</label>
                  <input id="event-qty" type="number" min={1} value={qty} onChange={(e) => setQty(Math.max(1, Number(e.target.value) || 1))} />
                </div>

                {error && <div className="form-error">{error}</div>}

                <button type="submit" className="btn btn--gold" disabled={busy}>
                  {busy ? 'Adding…' : 'Add to Cart'}
                </button>
              </form>
            )}
            {done && (
              <Link to="/cart" className="btn btn--outline-dark" style={{ marginTop: 'var(--space-4)' }}>
                Go to Cart
              </Link>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
