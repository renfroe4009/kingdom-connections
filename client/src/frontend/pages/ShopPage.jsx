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
    <div className="ns-section">
      <div className="ns-grid">
        <div className="ns-block" style={{ '--col-start': 1, '--col-span': 12 }}>
          <div className="section-heading">
            <p className="eyebrow">Resource Shop</p>
            <h2>Shop & Support the Movement</h2>
            <p>Every purchase supports Kingdom Connections&rsquo; work.</p>
          </div>

          {categories.length > 1 && (
            <div className="donate-amounts" style={{ justifyContent: 'center' }}>
              <button onClick={() => setSearchParams({})} className={`amount-pill${!categoryId ? ' amount-pill--active' : ''}`}>
                All
              </button>
              {categories.map(c => (
                <button key={c.id} onClick={() => setSearchParams({ category: c.id })} className={`amount-pill${String(categoryId) === String(c.id) ? ' amount-pill--active' : ''}`}>
                  {c.name}
                </button>
              ))}
            </div>
          )}

          {loading ? (
            <p style={{ textAlign: 'center' }}>Loading products…</p>
          ) : products.length === 0 ? (
            <p style={{ textAlign: 'center', color: 'var(--color-text-muted)' }}>No products available yet — check back soon.</p>
          ) : (
            <div className="shop-grid" style={{ '--card-cols': 3 }}>
              {products.map(p => <ProductCard key={p.id} product={p} />)}
            </div>
          )}

          <p style={{ fontSize: 'var(--text-sm)', textAlign: 'center', color: 'var(--color-text-muted)', marginTop: 'var(--space-7)' }}>
            Questions about an order? <a href="/contact">Contact us</a>.
          </p>
        </div>
      </div>
    </div>
  );
}
