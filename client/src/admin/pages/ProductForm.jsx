import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import api from '../../api/client.js';
import PageHeader from '../../components/PageHeader.jsx';
import MediaPickerModal from '../../components/MediaPickerModal.jsx';

// Relative /api/... image URLs are same-origin only in local dev (Vite
// proxies /api) — a split Vercel/Railway deploy needs the API origin prefixed.
const API_ORIGIN = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');
function resolveUrl(url) {
  if (!url || /^https?:\/\//.test(url)) return url;
  return `${API_ORIGIN}${url}`;
}

const empty = {
  sku: '', name: '', slug: '', description: '', short_desc: '', category_id: '',
  price: '', compare_price: '', cost: '', weight_oz: '', taxable: true,
  track_inventory: false, stock_qty: 0, is_active: true, is_featured: false,
  sort_order: 0, meta_title: '', meta_desc: '',
};

export default function ProductForm() {
  const { id } = useParams();
  const isNew = !id;
  const navigate = useNavigate();
  const [form, setForm] = useState(empty);
  const [categories, setCategories] = useState([]);
  const [images, setImages] = useState([]);
  const [showPicker, setShowPicker] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get('/products/categories?all=1').then(r => setCategories(r.data));
    if (!isNew) {
      api.get(`/products/admin/${id}`).then(r => {
        const p = r.data;
        setForm({
          sku: p.sku || '', name: p.name || '', slug: p.slug || '', description: p.description || '',
          short_desc: p.short_desc || '', category_id: p.category_id || '', price: p.price ?? '',
          compare_price: p.compare_price ?? '', cost: p.cost ?? '', weight_oz: p.weight_oz ?? '',
          taxable: !!p.taxable, track_inventory: !!p.track_inventory, stock_qty: p.stock_qty || 0,
          is_active: !!p.is_active, is_featured: !!p.is_featured, sort_order: p.sort_order || 0,
          meta_title: p.meta_title || '', meta_desc: p.meta_desc || '',
        });
        setImages(p.images || []);
      });
    }
  }, [id]);

  function set(field, value) { setForm(f => ({ ...f, [field]: value })); }

  function numOrNull(v) { return v === '' || v === null || v === undefined ? null : Number(v); }

  async function save() {
    setSaving(true);
    try {
      const payload = {
        ...form,
        price: Number(form.price) || 0,
        compare_price: numOrNull(form.compare_price),
        cost: numOrNull(form.cost),
        weight_oz: numOrNull(form.weight_oz),
        category_id: form.category_id ? Number(form.category_id) : null,
        stock_qty: Number(form.stock_qty) || 0,
        sort_order: Number(form.sort_order) || 0,
      };
      if (isNew) {
        const { data } = await api.post('/products', payload);
        navigate(`/admin/products/${data.id}`, { replace: true });
      } else {
        await api.put(`/products/${id}`, payload);
      }
    } finally {
      setSaving(false);
    }
  }

  async function addImages(files) {
    const list = Array.isArray(files) ? files : [files];
    for (const f of list) {
      const { data } = await api.post(`/products/${id}/images`, { url: f.file_url, alt_text: f.original_name });
      setImages(prev => [...prev, { id: data.id, url: f.file_url, alt_text: f.original_name, is_primary: prev.length === 0 ? 1 : 0 }]);
    }
  }

  async function removeImage(imgId) {
    await api.delete(`/products/${id}/images/${imgId}`);
    setImages(prev => prev.filter(i => i.id !== imgId));
  }

  async function makePrimary(imgId) {
    await api.put(`/products/${id}/images/${imgId}/primary`);
    setImages(prev => prev.map(i => ({ ...i, is_primary: i.id === imgId ? 1 : 0 })));
  }

  return (
    <div>
      <PageHeader title={isNew ? 'New Product' : `Edit Product — ${form.name}`}
        actions={<>
          <button className="btn btn-light" onClick={() => navigate('/admin/products')}>Cancel</button>
          <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
        </>} />

      <div className="row g-3">
        <div className="col-lg-8">
          <div className="card mb-3">
            <div className="card-body">
              <div className="row g-2">
                <div className="col-md-8"><label className="form-label">Name</label>
                  <input className="form-control" value={form.name} onChange={(e) => set('name', e.target.value)} /></div>
                <div className="col-md-4"><label className="form-label">SKU</label>
                  <input className="form-control" value={form.sku} onChange={(e) => set('sku', e.target.value)} /></div>
                <div className="col-md-6"><label className="form-label">Slug <span className="text-muted">(auto if blank)</span></label>
                  <input className="form-control" value={form.slug} onChange={(e) => set('slug', e.target.value)} placeholder={form.name?.toLowerCase().replace(/[^a-z0-9]+/g, '-')} /></div>
                <div className="col-md-6"><label className="form-label">Category</label>
                  <select className="form-select" value={form.category_id} onChange={(e) => set('category_id', e.target.value)}>
                    <option value="">Uncategorized</option>
                    {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select></div>
                <div className="col-12"><label className="form-label">Short Description</label>
                  <textarea className="form-control" rows={2} value={form.short_desc} onChange={(e) => set('short_desc', e.target.value)} /></div>
                <div className="col-12"><label className="form-label">Description</label>
                  <textarea className="form-control" rows={6} value={form.description} onChange={(e) => set('description', e.target.value)} /></div>
              </div>
            </div>
          </div>

          <div className="card mb-3">
            <div className="card-body">
              <h6 className="fw-bolder mb-3">Images</h6>
              <div className="d-flex flex-wrap gap-2 mb-2">
                {images.map(img => (
                  <div key={img.id} style={{ position: 'relative', width: 100, height: 100 }}>
                    <img src={resolveUrl(img.url)} alt={img.alt_text} style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 8, border: img.is_primary ? '3px solid var(--bs-primary)' : '1px solid #dee2e6' }} />
                    <button className="btn btn-sm btn-light" style={{ position: 'absolute', top: 2, right: 2, padding: '0 4px' }} onClick={() => removeImage(img.id)} title="Remove">×</button>
                    {!img.is_primary && (
                      <button className="btn btn-sm btn-light" style={{ position: 'absolute', bottom: 2, left: 2, fontSize: 10, padding: '1px 6px' }} onClick={() => makePrimary(img.id)}>Set primary</button>
                    )}
                  </div>
                ))}
              </div>
              {isNew
                ? <div className="text-muted fs-3">Save the product first to add images.</div>
                : <button className="btn btn-sm btn-outline-primary" onClick={() => setShowPicker(true)}>+ Add Images</button>}
            </div>
          </div>

          <div className="card">
            <div className="card-body">
              <h6 className="fw-bolder mb-3">SEO</h6>
              <div className="row g-2">
                <div className="col-md-6"><label className="form-label">Meta Title</label>
                  <input className="form-control" value={form.meta_title} onChange={(e) => set('meta_title', e.target.value)} /></div>
                <div className="col-md-6"><label className="form-label">Meta Description</label>
                  <input className="form-control" value={form.meta_desc} onChange={(e) => set('meta_desc', e.target.value)} /></div>
              </div>
            </div>
          </div>
        </div>

        <div className="col-lg-4">
          <div className="card mb-3">
            <div className="card-body">
              <h6 className="fw-bolder mb-3">Pricing</h6>
              <div className="row g-2">
                <div className="col-6"><label className="form-label">Price</label>
                  <div className="input-group"><span className="input-group-text">$</span>
                    <input type="number" step="0.01" className="form-control" value={form.price} onChange={(e) => set('price', e.target.value)} /></div></div>
                <div className="col-6"><label className="form-label">Compare-at</label>
                  <div className="input-group"><span className="input-group-text">$</span>
                    <input type="number" step="0.01" className="form-control" value={form.compare_price} onChange={(e) => set('compare_price', e.target.value)} /></div></div>
                <div className="col-6"><label className="form-label">Cost</label>
                  <div className="input-group"><span className="input-group-text">$</span>
                    <input type="number" step="0.01" className="form-control" value={form.cost} onChange={(e) => set('cost', e.target.value)} /></div></div>
                <div className="col-6"><label className="form-label">Weight (oz)</label>
                  <input type="number" step="0.1" className="form-control" value={form.weight_oz} onChange={(e) => set('weight_oz', e.target.value)} /></div>
                <div className="col-12 form-check form-switch mt-2">
                  <input className="form-check-input" type="checkbox" checked={form.taxable} onChange={(e) => set('taxable', e.target.checked)} id="p-taxable" />
                  <label className="form-check-label" htmlFor="p-taxable">Taxable</label>
                </div>
              </div>
            </div>
          </div>

          <div className="card mb-3">
            <div className="card-body">
              <h6 className="fw-bolder mb-3">Inventory</h6>
              <div className="form-check form-switch mb-2">
                <input className="form-check-input" type="checkbox" checked={form.track_inventory} onChange={(e) => set('track_inventory', e.target.checked)} id="p-track" />
                <label className="form-check-label" htmlFor="p-track">Track inventory</label>
              </div>
              {form.track_inventory && (
                <div><label className="form-label">Stock Qty</label>
                  <input type="number" className="form-control" value={form.stock_qty} onChange={(e) => set('stock_qty', e.target.value)} /></div>
              )}
            </div>
          </div>

          <div className="card">
            <div className="card-body">
              <h6 className="fw-bolder mb-3">Status</h6>
              <div className="form-check form-switch mb-2">
                <input className="form-check-input" type="checkbox" checked={form.is_active} onChange={(e) => set('is_active', e.target.checked)} id="p-active" />
                <label className="form-check-label" htmlFor="p-active">Active (visible in storefront)</label>
              </div>
              <div className="form-check form-switch mb-2">
                <input className="form-check-input" type="checkbox" checked={form.is_featured} onChange={(e) => set('is_featured', e.target.checked)} id="p-featured" />
                <label className="form-check-label" htmlFor="p-featured">Featured</label>
              </div>
              <label className="form-label mt-2">Sort Order</label>
              <input type="number" className="form-control" value={form.sort_order} onChange={(e) => set('sort_order', e.target.value)} />
            </div>
          </div>
        </div>
      </div>

      <MediaPickerModal show={showPicker} multi onSelect={addImages} onClose={() => setShowPicker(false)} />
    </div>
  );
}
