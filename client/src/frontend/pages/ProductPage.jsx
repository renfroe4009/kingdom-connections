import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import api from '../../api/client.js';
import PriceDisplay from '../components/PriceDisplay.jsx';
import AddToCartButton from '../components/AddToCartButton.jsx';

// Relative /api/... image URLs are same-origin only in local dev (Vite
// proxies /api) — a split Vercel/Railway deploy needs the API origin prefixed.
const API_ORIGIN = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');
function resolveUrl(url) {
  if (!url || /^https?:\/\//.test(url)) return url;
  return `${API_ORIGIN}${url}`;
}

export default function ProductPage() {
  const { slug } = useParams();
  const [product, setProduct] = useState(null);
  const [notFound, setNotFound] = useState(false);
  const [activeImg, setActiveImg] = useState(0);
  const [qty, setQty] = useState(1);

  useEffect(() => {
    setProduct(null); setNotFound(false); setActiveImg(0);
    api.get(`/products/${slug}`).then(r => setProduct(r.data)).catch(() => setNotFound(true));
  }, [slug]);

  if (notFound) return (
    <div className="ns-section" style={{ textAlign: 'center' }}>
      <h1 style={{ fontFamily: 'var(--font-heading)', color: 'var(--color-primary)' }}>Product not found</h1>
      <Link to="/shop" className="btn btn--gold" style={{ marginTop: 'var(--space-5)' }}>Back to Shop</Link>
    </div>
  );
  if (!product) return <div className="ns-section" style={{ textAlign: 'center' }}><p>Loading…</p></div>;

  const images = product.images?.length ? product.images : [{ url: product.image_url }];
  const outOfStock = product.track_inventory && product.stock_qty <= 0;

  return (
    <div className="ns-section">
      <div className="ns-grid">
        <div className="ns-block" style={{ '--col-start': 1, '--col-span': 6 }}>
          <div className="card__media card__media--square" style={{ marginBottom: 'var(--space-3)' }}>
            {images[activeImg]?.url && <img src={resolveUrl(images[activeImg].url)} alt={product.name} />}
          </div>
          {images.length > 1 && (
            <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
              {images.map((img, i) => (
                <button
                  key={i} onClick={() => setActiveImg(i)}
                  style={{ width: 64, height: 64, borderRadius: 'var(--radius-sm)', overflow: 'hidden', border: i === activeImg ? '2px solid var(--color-accent)' : '1px solid var(--color-border)', padding: 0, cursor: 'pointer' }}
                >
                  <img src={resolveUrl(img.url)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="ns-block" style={{ '--col-start': 7, '--col-span': 6 }}>
          <h1 style={{ fontFamily: 'var(--font-heading)', color: 'var(--color-primary)', fontSize: 'var(--text-3xl)' }}>{product.name}</h1>
          <div style={{ margin: 'var(--space-3) 0' }}><PriceDisplay price={product.price} comparePrice={product.compare_price} size="1.5rem" /></div>
          {product.short_desc && <p style={{ color: 'var(--color-text-muted)' }}>{product.short_desc}</p>}
          {product.description && <div style={{ color: 'var(--color-text-muted)', marginTop: 'var(--space-4)' }} dangerouslySetInnerHTML={{ __html: product.description }} />}

          <div style={{ marginTop: 'var(--space-6)', maxWidth: 320 }}>
            {outOfStock ? (
              <p className="form-note">Out of stock</p>
            ) : (
              <>
                <div className="form-field" style={{ maxWidth: 120 }}>
                  <label>Qty</label>
                  <input type="number" min={1} value={qty} onChange={e => setQty(Math.max(1, Number(e.target.value) || 1))} />
                </div>
                <AddToCartButton productId={product.id} qty={qty} />
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
