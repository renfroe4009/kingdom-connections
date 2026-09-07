import { Link, useNavigate } from 'react-router-dom';
import { useCart } from '../context/CartContext.jsx';
import TicketHoldCountdown from '../components/TicketHoldCountdown.jsx';

// Relative /api/... image URLs are same-origin only in local dev (Vite
// proxies /api) — a split Vercel/Railway deploy needs the API origin prefixed.
const API_ORIGIN = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');
function resolveUrl(url) {
  if (!url || /^https?:\/\//.test(url)) return url;
  return `${API_ORIGIN}${url}`;
}

export default function CartPage() {
  const { cart, updateItem, removeItem, loading } = useCart();
  const navigate = useNavigate();

  if (loading) return <div className="ns-section" style={{ textAlign: 'center' }}><p>Loading…</p></div>;

  if (!cart.items.length) {
    return (
      <div className="ns-section" style={{ textAlign: 'center' }}>
        <h1 style={{ fontFamily: 'var(--font-heading)', color: 'var(--color-primary)' }}>Your cart is empty</h1>
        <Link to="/shop" className="btn btn--gold" style={{ marginTop: 'var(--space-5)' }}>Continue Shopping</Link>
      </div>
    );
  }

  return (
    <div className="ns-section">
      <div className="ns-grid">
        <div className="ns-block" style={{ '--col-start': 2, '--col-span': 10 }}>
          <h1 style={{ fontFamily: 'var(--font-heading)', color: 'var(--color-primary)', marginBottom: 'var(--space-6)' }}>Your Cart</h1>

          <div className="form-card" style={{ padding: 0 }}>
            {cart.items.map((item, i) => {
              const isTicket = item.item_type === 'event_ticket';
              return (
                <div
                  key={item.id}
                  style={{
                    display: 'flex', gap: 'var(--space-4)', alignItems: 'center', padding: 'var(--space-5)',
                    borderBottom: i < cart.items.length - 1 ? '1px solid var(--color-border)' : 'none',
                  }}
                >
                  <div style={{ width: 72, height: 72, borderRadius: 'var(--radius-sm)', overflow: 'hidden', background: 'var(--color-surface)', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {isTicket
                      ? <i className="fa-solid fa-ticket fa-lg" style={{ color: 'var(--color-text-muted)' }} />
                      : (item.image_url && <img src={resolveUrl(item.image_url)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />)}
                  </div>
                  <div style={{ flex: 1 }}>
                    {isTicket && <div style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-xs)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{item.event_name}</div>}
                    <div style={{ fontWeight: 600, color: 'var(--color-primary)' }}>{item.name}</div>
                    <div style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-sm)' }}>${Number(item.unit_price).toFixed(2)} each</div>
                    {isTicket && <div style={{ marginTop: 6 }}><TicketHoldCountdown item={item} /></div>}
                  </div>
                  <input
                    type="number" min={1} value={item.qty}
                    style={{ width: 64, padding: '0.5rem', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', background: 'var(--color-bg)', color: 'var(--color-text)' }}
                    onChange={e => updateItem(item.id, Math.max(1, Number(e.target.value) || 1))}
                  />
                  <div style={{ width: 80, textAlign: 'right', fontWeight: 600, color: 'var(--color-primary)' }}>${(Number(item.unit_price) * item.qty).toFixed(2)}</div>
                  <button
                    onClick={() => removeItem(item.id)}
                    aria-label="Remove item"
                    style={{ background: 'none', border: 'none', color: 'var(--color-text-muted)', fontSize: '1.25rem', cursor: 'pointer', lineHeight: 1 }}
                  >
                    ×
                  </button>
                </div>
              );
            })}
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 'var(--space-6)' }}>
            <div style={{ minWidth: 260 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--text-xl)', fontWeight: 700, marginBottom: 'var(--space-4)', color: 'var(--color-primary)' }}>
                <span>Subtotal</span><span>${Number(cart.subtotal).toFixed(2)}</span>
              </div>
              <div style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)', marginBottom: 'var(--space-4)' }}>Shipping and tax calculated at checkout.</div>
              <button className="btn btn--gold" style={{ width: '100%' }} onClick={() => navigate('/checkout')}>
                Proceed to Checkout
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
