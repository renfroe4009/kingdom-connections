import { useCart } from '../context/CartContext.jsx';

export default function CartBadge() {
  const { itemCount, openDrawer } = useCart();
  return (
    <button type="button" onClick={openDrawer} aria-label="View cart" style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', color: 'inherit', textDecoration: 'none', padding: 8, background: 'none', border: 'none' }}>
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="9" cy="21" r="1"></circle><circle cx="20" cy="21" r="1"></circle>
        <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"></path>
      </svg>
      {itemCount > 0 && (
        <span style={{ position: 'absolute', top: 0, right: 0, background: 'var(--brand-secondary)', color: 'var(--brand-primary)', borderRadius: '50%', width: 18, height: 18, fontSize: '0.65rem', fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {itemCount}
        </span>
      )}
    </button>
  );
}
