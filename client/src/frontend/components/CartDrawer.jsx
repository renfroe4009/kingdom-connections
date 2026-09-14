import { useNavigate } from 'react-router-dom';
import { useCart } from '../context/CartContext.jsx';
import Modal from '../../components/Modal.jsx';
import TicketHoldCountdown from './TicketHoldCountdown.jsx';

const API_ORIGIN = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');
function resolveUrl(url) {
  if (!url || /^https?:\/\//.test(url)) return url;
  return `${API_ORIGIN}${url}`;
}

export default function CartDrawer() {
  const { cart, updateItem, removeItem, loading, drawerOpen, closeDrawer } = useCart();
  const navigate = useNavigate();

  function goToCheckout() {
    closeDrawer();
    navigate('/checkout');
  }

  return (
    <Modal
      show={drawerOpen}
      onClose={closeDrawer}
      title="Your Cart"
      size="md"
      footer={cart.items.length > 0 && (
        <button
          className="btn btn-primary w-100"
          style={{ background: 'var(--brand-primary, #1f2937)', color: '#ffffff', border: 'none', fontWeight: 600, padding: '0.75rem', borderRadius: 16 }}
          onClick={goToCheckout}
        >
          Proceed to Checkout
        </button>
      )}
    >
      {loading ? (
        <div className="text-center py-5"><span className="spinner-border text-primary" /></div>
      ) : !cart.items.length ? (
        <div className="text-center py-5">
          <p className="mb-3" style={{ color: 'var(--brand-primary)' }}>Your cart is empty</p>
          <button className="btn btn-outline-secondary" onClick={() => { closeDrawer(); navigate('/shop'); }}>Continue Shopping</button>
        </div>
      ) : (
        <>
          {cart.items.map(item => {
            const isTicket = item.item_type === 'event_ticket';
            return (
              <div key={item.id} style={{ display: 'flex', gap: 12, alignItems: 'center', padding: '0.75rem 0', borderBottom: '1px solid #f1f3f5' }}>
                <div style={{ width: 56, height: 56, borderRadius: 8, overflow: 'hidden', background: '#f3f4f6', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  {isTicket
                    ? <i className="fa-solid fa-ticket" style={{ color: '#9ca3af' }} />
                    : (item.image_url && <img src={resolveUrl(item.image_url)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />)}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  {isTicket && <div style={{ color: '#6b7280', fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{item.event_name}</div>}
                  <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>{item.name}</div>
                  <div style={{ color: '#6b7280', fontSize: '0.8rem' }}>${Number(item.unit_price).toFixed(2)} each</div>
                  {isTicket && <div style={{ marginTop: 4 }}><TicketHoldCountdown item={item} /></div>}
                  <input type="number" min={1} value={item.qty} style={{ width: 56, marginTop: 4 }} className="form-control form-control-sm"
                    onChange={e => updateItem(item.id, Math.max(1, Number(e.target.value) || 1))} />
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>${(Number(item.unit_price) * item.qty).toFixed(2)}</div>
                  <button className="btn btn-sm btn-light text-danger mt-1" onClick={() => removeItem(item.id)}>×</button>
                </div>
              </div>
            );
          })}

          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '1.05rem', fontWeight: 700, marginTop: '1rem' }}>
            <span>Subtotal</span><span>${Number(cart.subtotal).toFixed(2)}</span>
          </div>
          <div style={{ fontSize: '0.8rem', color: '#6b7280', marginTop: '0.25rem' }}>Shipping and tax calculated at checkout.</div>
        </>
      )}
    </Modal>
  );
}
