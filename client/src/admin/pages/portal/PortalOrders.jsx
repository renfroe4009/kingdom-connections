import { useEffect, useState } from 'react';
import api from '../../../api/client.js';

const STATUS_TONE = { pending: 'warning', processing: 'info', shipped: 'primary', delivered: 'success', cancelled: 'secondary', refunded: 'secondary' };

export default function PortalOrders() {
  const [rows, setRows] = useState([]);

  useEffect(() => {
    api.get('/portal/orders').then((r) => setRows(r.data.rows || [])).catch(() => {});
  }, []);

  const fmt = (n) => `$${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  return (
    <div>
      <h3 className="fw-bolder mb-1">My Orders</h3>
      <p className="text-muted">Shop purchase history.</p>

      <div className="card">
        <div className="card-body">
          <div className="table-responsive">
            <table className="table align-middle mb-0">
              <thead>
                <tr><th>Order</th><th>Placed</th><th className="text-end">Total</th><th>Status</th><th>Payment</th><th>Tracking</th></tr>
              </thead>
              <tbody>
                {rows.map((o) => (
                  <tr key={o.id}>
                    <td className="fw-semibold">{o.order_number}</td>
                    <td>{new Date(o.created_at).toLocaleDateString()}</td>
                    <td className="text-end">{fmt(o.total)}</td>
                    <td><span className={`badge bg-${STATUS_TONE[o.status] || 'secondary'}-subtle text-${STATUS_TONE[o.status] || 'secondary'}`}>{o.status}</span></td>
                    <td className="text-capitalize">{o.payment_status}</td>
                    <td>{o.tracking_number || '—'}</td>
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
