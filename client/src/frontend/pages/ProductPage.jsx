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
    <div className="container text-center" style={{ padding: '5rem 0' }}>
      <h1>Product not found</h1>
      <Link to="/shop" className="btn btn-primary mt-3">Back to Shop</Link>
    </div>
  );
  if (!product) return <div className="text-center py-5"><span className="spinner-border text-primary" /></div>;

  const images = product.images?.length ? product.images : [{ url: product.image_url }];
  const outOfStock = product.track_inventory && product.stock_qty <= 0;

  return (
    <div className="container" style={{ paddingTop: '2.5rem', paddingBottom: '4rem' }}>
      <div className="row g-4">
        <div className="col-lg-6">
          <div style={{ height: 420, borderRadius: 24, overflow: 'hidden', background: '#f3f4f6', marginBottom: 12 }}>
            {images[activeImg]?.url && <img src={resolveUrl(images[activeImg].url)} alt={product.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
          </div>
          {images.length > 1 && (
            <div style={{ display: 'flex', gap: 8 }}>
              {images.map((img, i) => (
                <button key={i} onClick={() => setActiveImg(i)} style={{ width: 64, height: 64, borderRadius: 8, overflow: 'hidden', border: i === activeImg ? '2px solid var(--brand-primary)' : '1px solid #e5e7eb', padding: 0, cursor: 'pointer' }}>
                  <img src={resolveUrl(img.url)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="col-lg-6">
          <h1 className="heading-serif" style={{ color: 'var(--brand-primary)', fontSize: '2rem', letterSpacing: '-1px' }}>{product.name}</h1>
          <div style={{ marginBottom: '1rem' }}><PriceDisplay price={product.price} comparePrice={product.compare_price} size="1.5rem" /></div>
          {product.short_desc && <p style={{ color: '#4b5563' }}>{product.short_desc}</p>}
          {product.description && <div style={{ color: '#4b5563', marginTop: '1rem' }} dangerouslySetInnerHTML={{ __html: product.description }} />}

          <div style={{ marginTop: '1.5rem', maxWidth: 320 }}>
            {outOfStock ? (
              <div className="alert alert-secondary">Out of stock</div>
            ) : (
              <>
                <div className="d-flex align-items-center gap-2 mb-3">
                  <label className="form-label mb-0">Qty</label>
                  <input type="number" min={1} className="form-control" style={{ width: 80 }} value={qty} onChange={e => setQty(Math.max(1, Number(e.target.value) || 1))} />
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
