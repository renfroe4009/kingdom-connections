// Shop listing — pulls live products from the store and renders them with the
// site's own card styling, so a shop section looks like the rest of the design
// rather than a bolted-on widget.

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useNode } from '@craftjs/core';
import api from '../../api/client.js';
import AddToCartButton from '../../frontend/components/AddToCartButton.jsx';
import PriceDisplay from '../../frontend/components/PriceDisplay.jsx';
import { FieldGroup, NumberField, SelectField, TextField, ToggleField } from '../fields/index.jsx';
import { IDENTITY_DEFAULTS, cssVars, cx, useDomIdentity, useIsEditing, useNodeRef } from './nodeUtils.js';

const API_ORIGIN = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');
const resolveImage = (url) => (!url || /^https?:\/\//.test(url) ? url : `${API_ORIGIN}${url}`);

export default function ProductList({ category, limit, columns, showPrice, showAddToCart, emptyText }) {
  const ref = useNodeRef();
  const editing = useIsEditing();
  const { domId, customClass } = useDomIdentity('products');
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const params = new URLSearchParams();
    if (category) params.set('category', category);
    setLoading(true);
    api
      .get(`/products${params.toString() ? `?${params}` : ''}`)
      .then(({ data }) => setProducts(Array.isArray(data) ? data : []))
      .catch(() => setProducts([]))
      .finally(() => setLoading(false));
  }, [category]);

  const visible = limit ? products.slice(0, limit) : products;

  return (
    <div ref={ref} id={domId} className={cx('bx-products', customClass)} style={cssVars({ '--bx-cards': columns })}>
      {loading && <div className="bx-editor-note">Loading products…</div>}
      {!loading && !visible.length && <div className="bx-editor-note">{emptyText}</div>}
      {visible.map((product) => {
        // Inside the canvas a react-router <Link> would try to navigate the
        // iframe, so render a plain element while editing.
        const Title = editing ? 'span' : Link;
        const titleProps = editing ? {} : { to: `/shop/${product.slug}` };
        return (
          <article className="bx-card bx-card--hover bx-product" key={product.id}>
            <Title {...titleProps} style={{ textDecoration: 'none', color: 'inherit' }}>
              {product.image_url ? (
                <img className="bx-card__media bx-product__media" src={resolveImage(product.image_url)} alt={product.name} loading="lazy" />
              ) : (
                <div className="bx-card__media" style={{ background: 'var(--bx-surface)' }} />
              )}
            </Title>
            <div className="bx-card__body">
              <Title {...titleProps} style={{ textDecoration: 'none', color: 'inherit' }}>
                <div className="bx-card__title">{product.name}</div>
              </Title>
              {product.short_desc && <div className="bx-card__text">{product.short_desc}</div>}
              <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 10 }}>
                {showPrice && (
                  <div className="bx-product__price">
                    <PriceDisplay price={product.price} comparePrice={product.compare_price} size="1.1rem" />
                  </div>
                )}
                {showAddToCart && !editing && <AddToCartButton productId={product.id} className="bx-btn" />}
                {showAddToCart && editing && <span className="bx-btn">Add to cart</span>}
              </div>
            </div>
          </article>
        );
      })}
    </div>
  );
}

function ProductListSettings() {
  const { props, actions: { setProp } } = useNode((node) => ({ props: node.data.props }));
  const p = (key) => (value) => setProp((s) => { s[key] = value; });
  const [categories, setCategories] = useState([]);

  useEffect(() => {
    api
      .get('/products/categories')
      .then(({ data }) => setCategories(Array.isArray(data) ? data : []))
      .catch(() => setCategories([]));
  }, []);

  return (
    <>
      <FieldGroup title="Products">
        <SelectField
          label="Category"
          value={props.category}
          onChange={p('category')}
          options={[{ value: '', label: 'All products' }].concat(
            categories.map((c) => ({ value: c.slug || String(c.id), label: c.name })),
          )}
        />
        <NumberField label="Maximum to show" value={props.limit} onChange={p('limit')} min={0} hint="0 shows every product." />
        <TextField label="Empty message" value={props.emptyText} onChange={p('emptyText')} />
      </FieldGroup>
      <FieldGroup title="Layout">
        <NumberField label="Columns" value={props.columns} onChange={p('columns')} min={1} max={5} />
        <ToggleField label="Show price" value={props.showPrice} onChange={p('showPrice')} />
        <ToggleField label="Show add-to-cart" value={props.showAddToCart} onChange={p('showAddToCart')} />
      </FieldGroup>
      <FieldGroup title="Identity" defaultOpen={false}>
        <TextField label="Custom ID" value={props.customId} onChange={p('customId')} />
        <TextField label="Custom CSS class" value={props.customClass} onChange={p('customClass')} />
      </FieldGroup>
    </>
  );
}

ProductList.craft = {
  displayName: 'Shop Listing',
  props: {
    ...IDENTITY_DEFAULTS,
    category: '',
    limit: 6,
    columns: 3,
    showPrice: true,
    showAddToCart: true,
    emptyText: 'No products to show yet.',
  },
  related: { settings: ProductListSettings },
};
