import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../api/client.js';
import PageHeader from '../../components/PageHeader.jsx';

const STATUS_COLORS = {
  pending: 'secondary', processing: 'info', shipped: 'primary',
  delivered: 'success', cancelled: 'dark', refunded: 'warning',
};

export default function OrdersList() {
  const [rows, setRows] = useState([]);
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const navigate = useNavigate();

  async function load() {
    const params = new URLSearchParams();
    if (status) params.set('status', status);
    if (search) params.set('search', search);
    const { data } = await api.get(`/orders?${params}`);
    setRows(data);
  }
  useEffect(() => { load(); }, [status]);

  return (
    <div>
      <PageHeader title="Orders" subtitle={`${rows.length} orders`} />

      <div className="card">
        <div className="card-body">
          <div className="d-flex gap-2 mb-3 flex-wrap">
            <select className="form-select" style={{ maxWidth: 200 }} value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">All statuses</option>
              {Object.keys(STATUS_COLORS).map(s => <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</option>)}
            </select>
            <input className="form-control" style={{ maxWidth: 280 }} placeholder="Search order # or customer…" value={search}
              onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && load()} />
            <button className="btn btn-outline-secondary" onClick={load}>Search</button>
          </div>
          <div className="table-responsive">
            <table className="table table-hover align-middle mb-0">
              <thead><tr><th>Order #</th><th>Customer</th><th>Date</th><th>Total</th><th>Payment</th><th>Status</th></tr></thead>
              <tbody>
                {rows.map((o) => (
                  <tr key={o.id} style={{ cursor: 'pointer' }} onClick={() => navigate(`/admin/orders/${o.id}`)}>
                    <td className="fw-semibold">{o.order_number}</td>
                    <td>{o.first_name || o.last_name ? `${o.first_name || ''} ${o.last_name || ''}`.trim() : (o.contact_email || 'Guest')}</td>
                    <td className="text-muted">{new Date(o.created_at).toLocaleDateString()}</td>
                    <td>${Number(o.total).toFixed(2)}</td>
                    <td><span className={`badge bg-${o.payment_status === 'paid' ? 'success' : 'secondary'}-subtle text-${o.payment_status === 'paid' ? 'success' : 'secondary'}`}>{o.payment_status}</span></td>
                    <td><span className={`badge bg-${STATUS_COLORS[o.status]}-subtle text-${STATUS_COLORS[o.status]}`}>{o.status}</span></td>
                  </tr>
                ))}
                {rows.length === 0 && <tr><td colSpan="6"><div className="empty-state">No orders yet.</div></td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
