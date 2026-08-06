import { Link } from 'react-router-dom';
import PriceDisplay from './PriceDisplay.jsx';
import AddToCartButton from './AddToCartButton.jsx';

// Relative /api/... image URLs are same-origin only in local dev (Vite
// proxies /api) — a split Vercel/Railway deploy needs the API origin prefixed.
const API_ORIGIN = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');
function resolveUrl(url) {
  if (!url || /^https?:\/\//.test(url)) return url;
  return `${API_ORIGIN}${url}`;
}

export default function ProductCard({ product }) {
  return (
    <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 24, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      <Link to={`/shop/${product.slug}`} style={{ display: 'block', height: 256, background: '#f3f4f6', overflow: 'hidden' }}>
        {product.image_url
          ? <img src={resolveUrl(product.image_url)} alt={product.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          : <div style={{ width: '100%', height: '100%' }} />}
      </Link>
      <div style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', flex: 1 }}>
        <Link to={`/shop/${product.slug}`} style={{ textDecoration: 'none', color: 'inherit' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '0.75rem' }}>
            <div style={{ fontWeight: 600, fontSize: '1.05rem' }}>{product.name}</div>
            <PriceDisplay price={product.price} comparePrice={product.compare_price} size="1.05rem" />
          </div>
        </Link>
        {product.short_desc && <div style={{ fontSize: '0.8rem', color: '#6b7280', marginTop: 2 }}>{product.short_desc}</div>}
        <div style={{ marginTop: 'auto', paddingTop: 12 }}>
          <AddToCartButton productId={product.id} />
        </div>
      </div>
    </div>
  );
}
