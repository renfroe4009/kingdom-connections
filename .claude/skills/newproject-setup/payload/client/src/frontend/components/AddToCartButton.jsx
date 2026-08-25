import { useState } from 'react';
import { useCart } from '../context/CartContext.jsx';

export default function AddToCartButton({ productId, qty = 1, style, className, children }) {
  const { addItem } = useCart();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');

  async function handleClick() {
    setBusy(true); setError('');
    try {
      await addItem(productId, qty);
      setDone(true);
      setTimeout(() => setDone(false), 1500);
    } catch (e) {
      setError(e.response?.data?.error || 'Could not add to cart');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <button
        onClick={handleClick}
        onMouseEnter={e => { if (!done) e.currentTarget.style.background = '#000000'; }}
        onMouseLeave={e => { if (!done) e.currentTarget.style.background = 'var(--brand-primary, #0A1F3D)'; }}
        disabled={busy}
        className={className}
        style={{
          background: done ? '#16a34a' : 'var(--brand-primary, #0A1F3D)', color: '#ffffff', border: 'none',
          padding: '0.75rem 1.5rem', borderRadius: 16, fontWeight: 600, fontSize: '0.9rem',
          cursor: busy ? 'default' : 'pointer', transition: 'background 0.2s', width: '100%',
          ...style,
        }}
      >
        {busy ? 'Adding…' : done ? 'Added ✓' : (children || 'Add to Cart')}
      </button>
      {error && <div style={{ color: '#dc2626', fontSize: '0.8rem', marginTop: 6 }}>{error}</div>}
    </div>
  );
}
