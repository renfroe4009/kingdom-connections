import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import api from '../../api/client.js';
import PageHeader from '../../components/PageHeader.jsx';
import { toast } from '../../components/Toast.jsx';
import { parseApiError } from '../../utils/apiError.js';
import { formatGateway } from '../../utils/gateway.js';
import { useConfirm, usePrompt } from '../../hooks/useConfirm.jsx';
import { useAuth } from '../../auth/AuthContext.jsx';

const STATUSES = ['pending', 'processing', 'shipped', 'delivered', 'cancelled', 'refunded'];

export default function OrderDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { can } = useAuth();
  const { confirm, dialog: confirmDialog } = useConfirm();
  const { prompt, dialog: promptDialog } = usePrompt();
  const [order, setOrder] = useState(null);
  const [status, setStatus] = useState('');
  const [tracking, setTracking] = useState('');
  const [method, setMethod] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  async function load() {
    const { data } = await api.get(`/orders/${id}`);
    setOrder(data);
    setStatus(data.status);
    setTracking(data.tracking_number || '');
    setMethod(data.shipping_method || '');
    setNotes(data.notes || '');
  }
  useEffect(() => { load(); }, [id]);

  async function saveStatus() {
    setSaving(true);
    try {
      await api.put(`/orders/${id}/status`, { status, tracking_number: tracking, shipping_method: method, notes });
      load();
    } catch (e) {
      toast(parseApiError(e), 'error');
    } finally { setSaving(false); }
  }

  async function refundPayment(pid) {
    if (!(await confirm('Mark this payment as refunded? This updates the order balance locally.', { danger: true }))) return;
    try {
      await api.post(`/payments/${pid}/refund`);
      load();
    } catch (e) {
      toast(parseApiError(e), 'error');
    }
  }

  async function capturePayment(pid) {
    if (!(await confirm('Mark this pending payment as captured?', { danger: false, confirmLabel: 'Mark captured' }))) return;
    try {
      await api.post(`/payments/${pid}/capture`);
      load();
    } catch (e) {
      toast(parseApiError(e, 'Could not capture payment'), 'error');
    }
  }

  function openReceiptView(p) {
    if (!p?.receipt_token) { toast('Receipt link unavailable for this payment.', 'error'); return; }
    window.open(`/api/payments/public/receipt/by-token/${p.receipt_token}`, '_blank', 'noopener,noreferrer');
  }
  function downloadReceiptPdf(p) {
    if (!p?.receipt_token) { toast('Receipt link unavailable for this payment.', 'error'); return; }
    window.open(`/api/payments/public/receipt/by-token/${p.receipt_token}.pdf`, '_blank', 'noopener,noreferrer');
  }
  async function emailReceipt(p) {
    if (!p?.receipt_token) { toast('Receipt link unavailable for this payment.', 'error'); return; }
    const to = await prompt('Email receipt to:', { defaultValue: order.contact_email || '' });
    if (to === null) return;
    try {
      const r = await api.post(`/payments/public/receipt/by-token/${p.receipt_token}/email`, { to: to || undefined });
      toast(`Receipt emailed to ${r.data.to}`, 'success');
    } catch (e) {
      toast(parseApiError(e, 'Failed to email receipt'), 'error');
    }
  }

  if (!order) return <div className="text-center py-5"><span className="spinner-border text-primary" /></div>;

  const customerName = order.first_name || order.last_name ? `${order.first_name || ''} ${order.last_name || ''}`.trim() : 'Guest';

  return (
    <div>
      <PageHeader title={`Order ${order.order_number}`} subtitle={new Date(order.created_at).toLocaleString()}
        actions={<button className="btn btn-light" onClick={() => navigate('/admin/orders')}>Back to Orders</button>} />

      <div className="row g-3">
        <div className="col-lg-8">
          <div className="card mb-3">
            <div className="card-body">
              <h6 className="fw-bolder mb-3">Items</h6>
              <div className="table-responsive">
                <table className="table mb-0">
                  <thead><tr><th>Item</th><th>SKU</th><th className="text-end">Qty</th><th className="text-end">Price</th><th className="text-end">Total</th></tr></thead>
                  <tbody>
                    {order.items.map(it => (
                      <tr key={it.id}>
                        <td>{it.name}</td>
                        <td className="text-muted"><code>{it.sku}</code></td>
                        <td className="text-end">{it.qty}</td>
                        <td className="text-end">${Number(it.unit_price).toFixed(2)}</td>
                        <td className="text-end">${Number(it.line_total).toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr><td colSpan="4" className="text-end text-muted">Subtotal</td><td className="text-end">${Number(order.subtotal).toFixed(2)}</td></tr>
                    <tr><td colSpan="4" className="text-end text-muted">Shipping</td><td className="text-end">${Number(order.shipping_total).toFixed(2)}</td></tr>
                    <tr><td colSpan="4" className="text-end text-muted">Tax {order.tax_exempt ? '(exempt)' : ''}</td><td className="text-end">${Number(order.tax_total).toFixed(2)}</td></tr>
                    {Number(order.discount_total) > 0 && <tr><td colSpan="4" className="text-end text-muted">Discount</td><td className="text-end">-${Number(order.discount_total).toFixed(2)}</td></tr>}
                    <tr><td colSpan="4" className="text-end fw-bolder">Total</td><td className="text-end fw-bolder">${Number(order.total).toFixed(2)}</td></tr>
                  </tfoot>
                </table>
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-body">
              <h6 className="fw-bolder mb-3">Fulfillment</h6>
              <div className="row g-2">
                <div className="col-md-4"><label className="form-label">Status</label>
                  <select className="form-select" value={status} onChange={(e) => setStatus(e.target.value)}>
                    {STATUSES.map(s => <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</option>)}
                  </select></div>
                <div className="col-md-4"><label className="form-label">Shipping Method</label>
                  <input className="form-control" value={method} onChange={(e) => setMethod(e.target.value)} /></div>
                <div className="col-md-4"><label className="form-label">Tracking Number</label>
                  <input className="form-control" value={tracking} onChange={(e) => setTracking(e.target.value)} /></div>
                <div className="col-12"><label className="form-label">Internal Notes</label>
                  <textarea className="form-control" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
                <div className="col-12">
                  <button className="btn btn-primary" onClick={saveStatus} disabled={saving}>{saving ? 'Saving…' : 'Save Fulfillment'}</button>
                </div>
              </div>
            </div>
          </div>

          <div className="card mt-3">
            <div className="card-body">
              <h6 className="fw-bold text-uppercase small text-muted">Transactions</h6>
              {order.payments?.length ? (
                <div className="table-responsive">
                  <table className="table table-sm align-middle mb-0">
                    <thead>
                      <tr>
                        <th>Date</th><th>Gateway</th><th>Method</th>
                        <th className="text-end">Amount</th><th>Status</th><th>Txn</th><th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {order.payments.map((p) => (
                        <tr key={p.id}>
                          <td>{p.received_at ? new Date(p.received_at).toLocaleString() : new Date(p.created_at).toLocaleString()}</td>
                          <td>{formatGateway(p.gateway)}</td>
                          <td>{p.method || '—'}</td>
                          <td className="text-end fw-semibold">${Number(p.amount).toFixed(2)}</td>
                          <td>
                            <span className={`badge bg-${
                              p.status === 'captured' || p.status === 'authorized' ? 'success' :
                              p.status === 'refunded' || p.status === 'voided' ? 'danger' :
                              p.status === 'failed' ? 'danger' : 'secondary'
                            }-subtle text-${
                              p.status === 'captured' || p.status === 'authorized' ? 'success' :
                              p.status === 'refunded' || p.status === 'voided' ? 'danger' :
                              p.status === 'failed' ? 'danger' : 'secondary'
                            }`}>{p.status}</span>
                          </td>
                          <td className="text-muted small">{p.external_txn_id || '—'}</td>
                          <td className="text-nowrap">
                            {String(p.status).toLowerCase() === 'pending' && can('payments.write') && (
                              <button className="btn btn-sm btn-success me-1" title="Flip this pending payment to captured" onClick={() => capturePayment(p.id)}>
                                <iconify-icon icon="solar:check-circle-line-duotone" class="me-1"></iconify-icon>
                                Mark captured
                              </button>
                            )}
                            {p.status && !['failed', 'voided', 'refunded', 'cancelled'].includes(String(p.status).toLowerCase()) && (
                              <>
                                <button className="btn btn-sm btn-outline-primary me-1" title="View receipt" onClick={() => openReceiptView(p)}>
                                  <iconify-icon icon="solar:document-text-line-duotone" class="me-1"></iconify-icon>
                                  Receipt
                                </button>
                                <button className="btn btn-sm btn-light me-1" title="Download PDF" onClick={() => downloadReceiptPdf(p)}>
                                  <iconify-icon icon="solar:file-download-line-duotone"></iconify-icon>
                                </button>
                                <button className="btn btn-sm btn-light me-1" title="Email receipt" onClick={() => emailReceipt(p)}>
                                  <iconify-icon icon="solar:letter-line-duotone"></iconify-icon>
                                </button>
                              </>
                            )}
                            {can('payments.write') && p.status && !['pending', 'failed', 'voided', 'refunded', 'cancelled'].includes(String(p.status).toLowerCase()) && (
                              <button className="btn btn-sm btn-light text-danger" onClick={() => refundPayment(p.id)}>Refund</button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : <div className="text-muted small">No transactions recorded yet.</div>}
            </div>
          </div>
        </div>

        <div className="col-lg-4">
          <div className="card mb-3">
            <div className="card-body">
              <h6 className="fw-bolder mb-3">Customer</h6>
              <div>{customerName}</div>
              <div className="text-muted">{order.contact_email || '—'}</div>
              <div className="text-muted">{order.contact_phone || ''}</div>
            </div>
          </div>
          <div className="card mb-3">
            <div className="card-body">
              <h6 className="fw-bolder mb-3">Ship To</h6>
              <div>{order.shipping_name || '—'}</div>
              <div className="text-muted">{order.shipping_line1}</div>
              {order.shipping_line2 && <div className="text-muted">{order.shipping_line2}</div>}
              <div className="text-muted">{[order.shipping_city, order.shipping_state, order.shipping_zip].filter(Boolean).join(', ')}</div>
              <div className="text-muted">{order.shipping_country}</div>
            </div>
          </div>
          {order.customer_note && (
            <div className="card">
              <div className="card-body">
                <h6 className="fw-bolder mb-2">Customer Note</h6>
                <div className="text-muted">{order.customer_note}</div>
              </div>
            </div>
          )}
        </div>
      </div>

      {confirmDialog}
      {promptDialog}
    </div>
  );
}
