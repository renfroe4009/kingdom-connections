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
    <div className="ns-section" style={{ textAlign: 'center' }}>
      <div className="ns-grid">
        <div className="ns-block" style={{ '--col-start': 3, '--col-span': 8 }}>
          <div style={{ fontSize: '3rem', marginBottom: 'var(--space-4)', color: 'var(--color-accent)' }}>✓</div>
          <h1 style={{ fontFamily: 'var(--font-heading)', color: 'var(--color-primary)' }}>Thank you for your order!</h1>
          <p style={{ color: 'var(--color-text-muted)' }}>Order confirmation <strong>{num}</strong> — a receipt has been sent to your email.</p>

          {tickets.length > 0 && (
            <div style={{ marginTop: 'var(--space-7)' }}>
              <h3 className="donate-panel__heading">Your Ticket{tickets.length > 1 ? 's' : ''}</h3>
              <p className="form-note">Show one of these at the gate — each code is good for one admission.</p>
              <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 'var(--space-4)', marginTop: 'var(--space-4)' }}>
                {tickets.map(t => (
                  <div key={t.qr_token} className="card" style={{ width: 220 }}>
                    <img src={`${API_ORIGIN}/api/events/public/ticket/${t.qr_token}/qr.png`} alt="Ticket QR code" style={{ width: '100%', maxWidth: 180 }} />
                    <div style={{ fontWeight: 600, fontSize: 'var(--text-sm)', marginTop: 'var(--space-2)' }}>{t.event_name}</div>
                    <div style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-sm)' }}>{t.ticket_type_name}</div>
                    <div style={{ color: 'var(--color-text-muted)', marginTop: 'var(--space-2)', fontFamily: 'monospace', fontSize: '0.7rem', wordBreak: 'break-all', userSelect: 'all' }}>{t.qr_token}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div style={{ marginTop: 'var(--space-7)', paddingTop: 'var(--space-6)', borderTop: '1px solid var(--color-border)' }}>
            <p className="form-note">Want to track this order alongside your full history?</p>
            <Link to={`/portal/register${email ? `?email=${encodeURIComponent(email)}` : ''}`} className="btn btn--outline-dark btn--sm">
              Create your free account
            </Link>
          </div>

          <Link to="/shop" className="btn btn--gold" style={{ marginTop: 'var(--space-6)' }}>Continue Shopping</Link>
        </div>
      </div>
    </div>
  );
}
