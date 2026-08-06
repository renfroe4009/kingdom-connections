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

  if (loading) return <div className="text-center py-5" style={{ background: '#ffffff' }}><span className="spinner-border text-primary" /></div>;

  if (!cart.items.length) {
    return (
      <div style={{ background: '#ffffff' }}>
        <div className="text-center" style={{ maxWidth: 1600, margin: '0 auto', padding: '5rem 1.5rem' }}>
          <h1 className="heading-serif" style={{ color: 'var(--brand-primary)' }}>Your cart is empty</h1>
          <Link to="/shop" className="btn btn-primary mt-3">Continue Shopping</Link>
        </div>
      </div>
    );
  }

  return (
    <div style={{ background: '#ffffff' }}>
      <div style={{ maxWidth: 1600, margin: '0 auto', padding: '2.5rem 1.5rem 4rem' }}>
        <h1 className="heading-serif" style={{ color: 'var(--brand-primary)', marginBottom: '1.5rem' }}>Your Cart</h1>

        <div style={{ border: '1px solid #e5e7eb', borderRadius: 16, overflow: 'hidden' }}>
          {cart.items.map(item => {
            const isTicket = item.item_type === 'event_ticket';
            return (
              <div key={item.id} style={{ display: 'flex', gap: 16, alignItems: 'center', padding: '1rem', borderBottom: '1px solid #f1f3f5' }}>
                <div style={{ width: 72, height: 72, borderRadius: 8, overflow: 'hidden', background: '#f3f4f6', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  {isTicket
                    ? <i className="fa-solid fa-ticket fa-lg" style={{ color: '#9ca3af' }} />
                    : (item.image_url && <img src={resolveUrl(item.image_url)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />)}
                </div>
                <div style={{ flex: 1 }}>
                  {isTicket && <div style={{ color: '#6b7280', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{item.event_name}</div>}
                  <div style={{ fontWeight: 600 }}>{item.name}</div>
                  <div style={{ color: '#6b7280', fontSize: '0.85rem' }}>${Number(item.unit_price).toFixed(2)} each</div>
                  {isTicket && <div style={{ marginTop: 6 }}><TicketHoldCountdown item={item} /></div>}
                </div>
                <input type="number" min={1} value={item.qty} style={{ width: 64 }} className="form-control"
                  onChange={e => updateItem(item.id, Math.max(1, Number(e.target.value) || 1))} />
                <div style={{ width: 80, textAlign: 'right', fontWeight: 600 }}>${(Number(item.unit_price) * item.qty).toFixed(2)}</div>
                <button className="btn btn-sm btn-light text-danger" onClick={() => removeItem(item.id)}>×</button>
              </div>
            );
          })}
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '1.5rem' }}>
          <div style={{ minWidth: 260 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '1.15rem', fontWeight: 700, marginBottom: '1rem' }}>
              <span>Subtotal</span><span>${Number(cart.subtotal).toFixed(2)}</span>
            </div>
            <div style={{ fontSize: '0.8rem', color: '#6b7280', marginBottom: '1rem' }}>Shipping and tax calculated at checkout.</div>
            <button className="btn btn-primary w-100" style={{ background: 'var(--brand-secondary)', color: 'var(--brand-primary)', border: 'none', fontWeight: 600, padding: '0.85rem' }}
              onClick={() => navigate('/checkout')}>
              Proceed to Checkout
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
