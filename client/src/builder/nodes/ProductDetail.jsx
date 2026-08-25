// A single product, placed on any page — for a landing page built around one
// item rather than the full shop grid.

import { useEffect, useState } from 'react';
import { useNode } from '@craftjs/core';
import api from '../../api/client.js';
import AddToCartButton from '../../frontend/components/AddToCartButton.jsx';
import PriceDisplay from '../../frontend/components/PriceDisplay.jsx';
import { FieldGroup, SelectField, TextField, ToggleField } from '../fields/index.jsx';
import { cx, useDomIdentity, useIsEditing, useNodeRef, IDENTITY_DEFAULTS } from './nodeUtils.js';

const API_ORIGIN = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');
const resolveImage = (url) => (!url || /^https?:\/\//.test(url) ? url : `${API_ORIGIN}${url}`);

export default function ProductDetail({ slug, showImage, showDescription, showPrice, showAddToCart }) {
  const ref = useNodeRef();
  const editing = useIsEditing();
  const { domId, customClass } = useDomIdentity('product');
  const [product, setProduct] = useState(null);
  const [state, setState] = useState('idle');

  useEffect(() => {
    if (!slug) return;
    setState('loading');
    api
      .get(`/products/${slug}`)
      .then(({ data }) => { setProduct(data); setState('ready'); })
      .catch(() => setState('missing'));
  }, [slug]);

  if (!slug) return <div ref={ref} id={domId} className="bx-editor-note">Choose a product in the settings panel</div>;
  if (state === 'loading') return <div ref={ref} id={domId} className="bx-editor-note">Loading…</div>;
  if (state === 'missing' || !product) {
    return <div ref={ref} id={domId} className="bx-editor-note">Product “{slug}” was not found.</div>;
  }

  return (
    <div ref={ref} id={domId} className={cx('bx-row', customClass)} style={{ '--bx-row-gap': '32px' }}>
      {showImage && (
        <div className="bx-col" style={{ '--bx-col-span': 6, '--bx-col-span-sm': 12 }}>
          {product.image_url ? (
            <img className="bx-image" src={resolveImage(product.image_url)} alt={product.name} loading="lazy" style={{ borderRadius: 'var(--bx-radius)' }} />
          ) : (
            <div className="bx-editor-note">No image</div>
          )}
        </div>
      )}
      <div className="bx-col" style={{ '--bx-col-span': showImage ? 6 : 12, '--bx-col-span-sm': 12, '--bx-col-justify': 'center' }}>
        <h2 className="bx-heading" style={{ '--bx-heading-size': '2rem' }}>{product.name}</h2>
        {showPrice && (
          <div className="bx-product__price">
            <PriceDisplay price={product.price} comparePrice={product.compare_price} size="1.4rem" />
          </div>
        )}
        {showDescription && (product.description || product.short_desc) && (
          <div className="bx-text" dangerouslySetInnerHTML={{ __html: product.description || product.short_desc }} />
        )}
        {showAddToCart && (editing
          ? <span className="bx-btn" style={{ alignSelf: 'flex-start' }}>Add to cart</span>
          : <AddToCartButton productId={product.id} className="bx-btn" />)}
      </div>
    </div>
  );
}

function ProductDetailSettings() {
  const { props, actions: { setProp } } = useNode((node) => ({ props: node.data.props }));
  const p = (key) => (value) => setProp((s) => { s[key] = value; });
  const [products, setProducts] = useState([]);

  useEffect(() => {
    api.get('/products').then(({ data }) => setProducts(Array.isArray(data) ? data : [])).catch(() => setProducts([]));
  }, []);

  return (
    <>
      <FieldGroup title="Product">
        <SelectField
          label="Which product"
          value={props.slug}
          onChange={p('slug')}
          options={[{ value: '', label: 'Choose a product…' }].concat(
            products.map((item) => ({ value: item.slug, label: item.name })),
          )}
        />
      </FieldGroup>
      <FieldGroup title="Show">
        <ToggleField label="Image" value={props.showImage} onChange={p('showImage')} />
        <ToggleField label="Price" value={props.showPrice} onChange={p('showPrice')} />
        <ToggleField label="Description" value={props.showDescription} onChange={p('showDescription')} />
        <ToggleField label="Add to cart" value={props.showAddToCart} onChange={p('showAddToCart')} />
      </FieldGroup>
      <FieldGroup title="Identity" defaultOpen={false}>
        <TextField label="Custom ID" value={props.customId} onChange={p('customId')} />
        <TextField label="Custom CSS class" value={props.customClass} onChange={p('customClass')} />
      </FieldGroup>
    </>
  );
}

ProductDetail.craft = {
  displayName: 'Product Detail',
  props: { ...IDENTITY_DEFAULTS, slug: '', showImage: true, showPrice: true, showDescription: true, showAddToCart: true },
  related: { settings: ProductDetailSettings },
};
