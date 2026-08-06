import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../api/client.js';
import PageHeader from '../../components/PageHeader.jsx';
import { useConfirm } from '../../hooks/useConfirm.jsx';
import { toast } from '../../components/Toast.jsx';
import { parseApiError } from '../../utils/apiError.js';

// Relative /api/... image URLs are same-origin only in local dev (Vite
// proxies /api) — a split Vercel/Railway deploy needs the API origin prefixed.
const API_ORIGIN = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');
function resolveUrl(url) {
  if (!url || /^https?:\/\//.test(url)) return url;
  return `${API_ORIGIN}${url}`;
}

export default function ProductsList() {
  const { confirm, dialog: confirmDialog } = useConfirm();
  const [rows, setRows] = useState([]);
  const [search, setSearch] = useState('');
  const navigate = useNavigate();

  async function load(q = '') {
    const { data } = await api.get(`/products/admin${q ? `?search=${encodeURIComponent(q)}` : ''}`);
    setRows(data);
  }
  useEffect(() => { load(); }, []);

  async function remove(p) {
    if (!(await confirm(`Deactivate "${p.name}"? It will be hidden from the storefront.`, { danger: true, confirmLabel: 'Deactivate' }))) return;
    try {
      await api.delete(`/products/${p.id}`);
      load(search);
    } catch (e) {
      toast(parseApiError(e), 'error');
    }
  }

  return (
    <div>
      <PageHeader title="Products" subtitle={`${rows.length} products`}
        actions={<button className="btn btn-primary" onClick={() => navigate('/admin/products/new')}>
          <iconify-icon icon="solar:add-square-line-duotone" class="me-1"></iconify-icon> New Product
        </button>} />

      <div className="card">
        <div className="card-body">
          <div className="mb-3" style={{ maxWidth: 320 }}>
            <input className="form-control" placeholder="Search name or SKU…" value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && load(search)} />
          </div>
          <div className="table-responsive">
            <table className="table table-hover align-middle mb-0">
              <thead><tr><th></th><th>Name</th><th>SKU</th><th>Category</th><th>Price</th><th>Stock</th><th>Status</th><th className="text-end">Actions</th></tr></thead>
              <tbody>
                {rows.map((p) => (
                  <tr key={p.id} style={{ cursor: 'pointer' }} onClick={() => navigate(`/admin/products/${p.id}`)}>
                    <td>
                      {p.image_url
                        ? <img src={resolveUrl(p.image_url)} alt="" style={{ width: 36, height: 36, objectFit: 'cover', borderRadius: 6 }} />
                        : <div style={{ width: 36, height: 36, borderRadius: 6, background: '#f1f3f5' }} />}
                    </td>
                    <td className="fw-semibold">{p.name}{p.is_featured ? <span className="badge bg-warning-subtle text-warning ms-2">Featured</span> : null}</td>
                    <td className="text-muted"><code>{p.sku}</code></td>
                    <td className="text-muted">{p.category_name || '—'}</td>
                    <td>
                      {p.compare_price ? <><span className="text-muted text-decoration-line-through me-1">${Number(p.compare_price).toFixed(2)}</span><span className="fw-semibold">${Number(p.price).toFixed(2)}</span></>
                        : <span>${Number(p.price).toFixed(2)}</span>}
                    </td>
                    <td className="text-muted">{p.track_inventory ? p.stock_qty : '∞'}</td>
                    <td>{p.is_active ? <span className="badge bg-success-subtle text-success">Active</span> : <span className="badge bg-secondary-subtle text-secondary">Inactive</span>}</td>
                    <td className="text-end text-nowrap" onClick={(e) => e.stopPropagation()}>
                      <button className="btn btn-sm btn-light me-1" onClick={() => navigate(`/admin/products/${p.id}`)} title="Edit">
                        <iconify-icon icon="solar:pen-new-square-line-duotone"></iconify-icon>
                      </button>
                      <button className="btn btn-sm btn-light text-danger" onClick={() => remove(p)} title="Deactivate">
                        <iconify-icon icon="solar:trash-bin-trash-line-duotone"></iconify-icon>
                      </button>
                    </td>
                  </tr>
                ))}
                {rows.length === 0 && <tr><td colSpan="8"><div className="empty-state">No products yet.</div></td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>
      {confirmDialog}
    </div>
  );
}
