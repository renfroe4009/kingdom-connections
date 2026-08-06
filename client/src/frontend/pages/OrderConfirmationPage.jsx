import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useCart } from '../context/CartContext.jsx';
import api from '../../api/client.js';

const API_ORIGIN = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');

export default function OrderConfirmationPage() {
  const { num } = useParams();
  const { refresh } = useCart();
  const [tickets, setTickets] = useState([]);
  const [email, setEmail] = useState(null);

  useEffect(() => { refresh(); }, [refresh]); // pick up the now-empty cart
  useEffect(() => {
    api.get(`/checkout/public/order/${num}/tickets`).then(r => setTickets(r.data)).catch(() => {});
    api.get(`/checkout/public/order/${num}`).then(r => setEmail(r.data.email)).catch(() => {});
  }, [num]);

  return (
    <div className="container text-center" style={{ padding: '5rem 0', maxWidth: 600 }}>
      <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>✓</div>
      <h1 className="heading-serif" style={{ color: 'var(--brand-primary)' }}>Thank you for your order!</h1>
      <p className="text-muted">Order confirmation <strong>{num}</strong> — a receipt has been sent to your email.</p>

      {tickets.length > 0 && (
        <div className="mt-4">
          <h5 style={{ color: 'var(--brand-primary)' }}>Your Ticket{tickets.length > 1 ? 's' : ''}</h5>
          <p className="text-muted small">Show one of these at the gate — each code is good for one admission.</p>
          <div className="d-flex flex-wrap justify-content-center gap-3 mt-3">
            {tickets.map(t => (
              <div key={t.qr_token} className="card" style={{ width: 220 }}>
                <div className="card-body text-center">
                  <img src={`${API_ORIGIN}/api/events/public/ticket/${t.qr_token}/qr.png`} alt="Ticket QR code" style={{ width: '100%', maxWidth: 180 }} />
                  <div className="fw-semibold small mt-2">{t.event_name}</div>
                  <div className="text-muted small">{t.ticket_type_name}</div>
                  <div className="text-muted mt-2" style={{ fontFamily: 'monospace', fontSize: '0.7rem', wordBreak: 'break-all', userSelect: 'all' }}>{t.qr_token}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="mt-4 pt-4" style={{ borderTop: '1px solid #e5e7eb' }}>
        <p className="text-muted small mb-2">Want to track this order alongside your full history?</p>
        <Link to={`/portal/register${email ? `?email=${encodeURIComponent(email)}` : ''}`} className="btn btn-outline-primary btn-sm">
          Create your free account
        </Link>
      </div>

      <Link to="/shop" className="btn btn-primary mt-4">Continue Shopping</Link>
    </div>
  );
}
