import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import api from '../../api/client.js';
import ProductCard from '../components/ProductCard.jsx';

export default function ShopPage() {
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchParams, setSearchParams] = useSearchParams();
  const categoryId = searchParams.get('category') || '';

  useEffect(() => {
    api.get('/products/categories').then(r => setCategories(r.data));
  }, []);

  useEffect(() => {
    setLoading(true);
    const params = categoryId ? `?category_id=${categoryId}` : '';
    api.get(`/products${params}`).then(r => setProducts(r.data)).finally(() => setLoading(false));
  }, [categoryId]);

  return (
    <div className="container" style={{ paddingTop: '2.5rem', paddingBottom: '4rem' }}>
      <div style={{ marginBottom: '2rem', display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
        <div>
          <div style={{ color: 'var(--brand-secondary)', textTransform: 'uppercase', fontSize: '0.75rem', letterSpacing: '2.5px', fontWeight: 600 }}>Official Merchandise</div>
          <h1 className="heading-serif" style={{ color: 'var(--brand-primary)', fontSize: 'clamp(2.25rem,5vw,3rem)', letterSpacing: '-1.5px', marginTop: 4 }}>Shop &amp; Show Your Support</h1>
        </div>
        <div className="d-none d-md-block" style={{ textAlign: 'right', fontSize: '0.75rem', color: '#6b7280' }}>All proceeds benefit<br />Ventura County deputies &amp; programs</div>
      </div>

      {categories.length > 1 && (
        <div style={{ display: 'flex', gap: 8, marginBottom: '2rem', flexWrap: 'wrap' }}>
          <button onClick={() => setSearchParams({})}
            style={{ padding: '6px 16px', borderRadius: 999, border: '1px solid #e5e7eb', background: !categoryId ? 'var(--brand-primary)' : '#fff', color: !categoryId ? '#fff' : '#333', cursor: 'pointer', fontSize: '0.85rem' }}>
            All
          </button>
          {categories.map(c => (
            <button key={c.id} onClick={() => setSearchParams({ category: c.id })}
              style={{ padding: '6px 16px', borderRadius: 999, border: '1px solid #e5e7eb', background: String(categoryId) === String(c.id) ? 'var(--brand-primary)' : '#fff', color: String(categoryId) === String(c.id) ? '#fff' : '#333', cursor: 'pointer', fontSize: '0.85rem' }}>
              {c.name}
            </button>
          ))}
        </div>
      )}

      {loading ? (
        <div className="text-center py-5"><span className="spinner-border text-primary" /></div>
      ) : products.length === 0 ? (
        <div className="text-center text-muted py-5">No products available yet — check back soon.</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '1.5rem' }}>
          {products.map(p => <ProductCard key={p.id} product={p} />)}
        </div>
      )}

      <div style={{ fontSize: '0.75rem', textAlign: 'center', color: '#6b7280', marginTop: '2.5rem' }}>
        Questions about sizing or bulk orders for your business? <a href="/contact" style={{ textDecoration: 'underline' }}>Contact us</a>.
      </div>
    </div>
  );
}
