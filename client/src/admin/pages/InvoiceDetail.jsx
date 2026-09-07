import { useEffect, useRef, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import api from '../../api/client.js';
import PageHeader from '../../components/PageHeader.jsx';
import Modal from '../../components/Modal.jsx';
import PassagePaymentForm from '../../components/PassagePaymentForm.jsx';
import VaultProfilesWidget from '../components/VaultProfilesWidget.jsx';
import FormErrorBanner from '../../components/FormErrorBanner.jsx';
import { toast } from '../../components/Toast.jsx';
import { parseApiError } from '../../utils/apiError.js';
import { formatGateway } from '../../utils/gateway.js';
import { useConfirm, usePrompt } from '../../hooks/useConfirm.jsx';
import { useAuth } from '../../auth/AuthContext.jsx';

const STATUS_TONE = {
  draft: 'secondary', sent: 'primary', partial: 'warning',
  paid: 'success', overdue: 'danger', void: 'dark', refunded: 'info',
};

function blankLine(sort) {
  return { description: '', quantity: 1, unit_price: 0, sort_order: sort };
}

export default function InvoiceDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { can } = useAuth();
  const { confirm, dialog: confirmDialog } = useConfirm();
  const { prompt, dialog: promptDialog } = usePrompt();
  const [data, setData] = useState(null);
  const [contacts, setContacts] = useState([]);
  const [orgs, setOrgs] = useState([]);
  const [msg, setMsg] = useState('');

  // Modals
  const [editShow, setEditShow] = useState(false);
  const [manualShow, setManualShow] = useState(false);
  const [sendShow, setSendShow] = useState(false);
  const [checkoutShow, setCheckoutShow] = useState(false);

  // Form states
  const [editForm, setEditForm] = useState(null);
  const [editFormError, setEditFormError] = useState('');
  const [manualForm, setManualForm] = useState({ amount: 0, method: 'check', note: '', external_txn_id: '' });
  const [manualFormError, setManualFormError] = useState('');
  const [sendTo, setSendTo] = useState('');

  // Checkout state
  const [checkout, setCheckout] = useState(null);
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [paymentResult, setPaymentResult] = useState(null);
  const [confirming, setConfirming] = useState(false);
  const authnetFormRef = useRef(null);

  // Vault / saved-card state
  const [vaultShow,        setVaultShow]        = useState(false);
  const [vaultProfile,     setVaultProfile]      = useState(null);  // selected vault_profile object
  const [vaultCharging,    setVaultCharging]     = useState(false);
  const [vaultResult,      setVaultResult]       = useState(null);  // { ok, error }

  async function load() {
    const { data } = await api.get(`/invoices/${id}`);
    setData(data);
    return data;
  }

  useEffect(() => { load().catch(() => {}); /* eslint-disable-next-line */ }, [id]);
  useEffect(() => {
    api.get('/contacts', { params: { pageSize: 500 } }).then((r) => setContacts(r.data.rows)).catch(() => {});
    api.get('/organizations', { params: { pageSize: 500 } }).then((r) => setOrgs(r.data.rows)).catch(() => {});
  }, []);

  // If the gateway redirected back with ?paid=1 in the URL, auto-confirm the
  // pending payment server-side, then strip the param and reload.
  useEffect(() => {
    const qs = new URLSearchParams(window.location.search);
    if (!qs.get('paid') && !qs.get('transactionId')) return;
    (async () => {
      try {
        await api.post(`/payments/public/confirm/${id}`, {
          transactionId: qs.get('transactionId') || qs.get('txnId') || null,
          amount:        qs.get('amount') ? Number(qs.get('amount')) : null,
        });
      } catch (_e) { /* ignore — poll will catch up */ }
      window.history.replaceState({}, '', `/invoices/${id}`);
      load();
    })();
    /* eslint-disable-next-line */
  }, [id]);

  // While the checkout modal is open and no error, poll for webhook-driven
  // capture so the UI flips to paid without a manual refresh.
  useEffect(() => {
    if (!checkoutShow || !checkout || checkout.error) return undefined;
    const t = setInterval(async () => {
      try {
        const { data: s } = await api.get(`/payments/public/status/${id}`);
        if (Number(s.balance_due) <= 0 || s.status === 'paid') {
          clearInterval(t);
          await load();
          setCheckoutShow(false);
          setCheckout(null);
        }
      } catch (_e) { /* keep polling */ }
    }, 4000);
    return () => clearInterval(t);
    /* eslint-disable-next-line */
  }, [checkoutShow, checkout, id]);

  if (!data) return <div className="empty-state">Loading…</div>;
  const { invoice: inv, line_items, payments, activities } = data;
  const fmt = (n) => `$${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const editable = inv.status !== 'paid' && inv.status !== 'void';

  // ---- Edit ----
  function openEdit() {
    setEditForm({
      contact_id:      inv.contact_id || '',
      organization_id: inv.organization_id || '',
      issue_date:      inv.issue_date?.slice(0, 10) || new Date().toISOString().slice(0, 10),
      due_date:        inv.due_date?.slice(0, 10) || new Date().toISOString().slice(0, 10),
      tax_rate:        Number(inv.tax_rate || 0),
      discount_rate:   Number(inv.discount_rate || 0),
      memo:            inv.memo || '',
      terms:           inv.terms || '',
      line_items: (line_items && line_items.length)
        ? line_items.map((l, i) => ({
            id: l.id,
            description: l.description,
            quantity: Number(l.quantity),
            unit_price: Number(l.unit_price),
            sort_order: l.sort_order ?? i,
          }))
        : [blankLine(0)],
    });
    setEditFormError('');
    setEditShow(true);
  }
  function updateLine(i, patch) {
    const items = editForm.line_items.slice();
    items[i] = { ...items[i], ...patch };
    setEditForm({ ...editForm, line_items: items });
  }
  function addLine() {
    setEditForm({ ...editForm, line_items: [...editForm.line_items, blankLine(editForm.line_items.length)] });
  }
  function removeLine(i) {
    const items = editForm.line_items.slice();
    items.splice(i, 1);
    setEditForm({ ...editForm, line_items: items.length ? items : [blankLine(0)] });
  }
  const editSubtotal = (editForm?.line_items || []).reduce(
    (a, l) => a + Number(l.quantity || 0) * Number(l.unit_price || 0), 0);
  const editDiscount = editSubtotal * (Number(editForm?.discount_rate || 0) / 100);
  const editTax = Math.max(0, editSubtotal - editDiscount) * (Number(editForm?.tax_rate || 0) / 100);
  const editTotal = Math.max(0, editSubtotal - editDiscount) + editTax;

  async function saveEdit() {
    const payload = {
      contact_id: editForm.contact_id ? Number(editForm.contact_id) : null,
      organization_id: editForm.organization_id ? Number(editForm.organization_id) : null,
      issue_date: editForm.issue_date,
      due_date: editForm.due_date,
      tax_rate: Number(editForm.tax_rate || 0),
      discount_rate: Number(editForm.discount_rate || 0),
      memo: editForm.memo || null,
      terms: editForm.terms || null,
      line_items: editForm.line_items
        .filter((l) => l.description && Number(l.quantity) > 0)
        .map((l, idx) => ({
          description: l.description,
          quantity: Number(l.quantity),
          unit_price: Number(l.unit_price),
          sort_order: idx,
        })),
    };
    if (payload.line_items.length === 0) { setEditFormError('Add at least one line item.'); return; }
    setEditFormError('');
    try {
      await api.put(`/invoices/${id}`, payload);
      setEditShow(false);
      load();
    } catch (err) {
      setEditFormError(parseApiError(err));
    }
  }

  // ---- Actions ----
  async function remove() {
    if (!(await confirm(
      inv.status === 'draft'
        ? `Delete draft invoice ${inv.invoice_number}? This cannot be undone.`
        : `Void invoice ${inv.invoice_number}?`,
      { danger: true, confirmLabel: inv.status === 'draft' ? 'Delete' : 'Void' }
    ))) return;
    try {
      const r = await api.delete(`/invoices/${id}`);
      if (r.data?.deleted) navigate('/admin/invoices');
      else load();
    } catch (err) {
      toast(parseApiError(err), 'error');
    }
  }

  async function doSend() {
    setMsg('');
    try {
      const r = await api.post(`/invoices/${id}/send`, sendTo ? { to: sendTo } : {});
      setMsg(`Invoice sent — customers can pay at ${r.data.payLink}`);
      setSendShow(false);
      load();
    } catch (e) {
      setMsg(parseApiError(e, 'Failed to send.'));
    }
  }

  async function doManual() {
    const amt = Number(manualForm.amount);
    if (!(amt > 0)) { setManualFormError('Enter a positive amount.'); return; }
    setManualFormError('');
    try {
      await api.post(`/invoices/${id}/manual-payment`, {
        amount: amt,
        method: manualForm.method,
        external_txn_id: manualForm.external_txn_id || null,
        note: manualForm.note || null,
      });
      setManualShow(false);
      setManualForm({ amount: 0, method: 'check', note: '', external_txn_id: '' });
      load();
    } catch (err) {
      setManualFormError(parseApiError(err));
    }
  }

  async function openCheckout() {
    setCheckout(null);
    setPaymentResult(null);
    setCheckoutLoading(true);
    setCheckoutShow(true);
    try {
      const origin = window.location.origin;
      const returnUrl = `${origin}/invoices/${id}?paid=1`;
      const { data: co } = await api.post(`/payments/public/checkout/${id}`, { returnUrl });
      setCheckout(co);
      // Auth.net uses a form POST to their gateway — submit it automatically.
      if (co.gateway === 'authnet') {
        setTimeout(() => authnetFormRef.current?.submit(), 100);
      }
    } catch (e) {
      setCheckout({ error: e.response?.data?.error || 'Failed to start checkout' });
    } finally {
      setCheckoutLoading(false);
    }
  }

  async function refundPayment(pid) {
    if (!(await confirm('Mark this payment as refunded? This updates the invoice balance locally.', { danger: true }))) return;
    try {
      await api.post(`/payments/${pid}/refund`);
      load();
    } catch (err) {
      toast(parseApiError(err), 'error');
    }
  }

  async function capturePayment(pid) {
    if (!(await confirm('Mark this pending payment as captured? Use this when the gateway confirmed payment but the webhook never reached us (e.g. localhost dev).', { danger: false, confirmLabel: 'Mark captured' }))) return;
    try {
      await api.post(`/payments/${pid}/capture`);
      load();
    } catch (e) {
      toast(parseApiError(e, 'Could not capture payment'), 'error');
    }
  }

  // Receipt URLs use the random `receipt_token` (256 bits of entropy) — never
  // the sequential `payment.id` — so customer-facing links can't be enumerated.
  // We pass the whole payment object here so we can show a clear error if the
  // backfill missed a row (`receipt_token IS NULL` shouldn't happen post-migration,
  // but guarding makes the failure mode obvious instead of silently 4xx-ing).
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
    const defaultTo = inv.contact_email || '';
    const to = await prompt('Email receipt to:', { defaultValue: defaultTo });
    if (to === null) return;
    try {
      const r = await api.post(`/payments/public/receipt/by-token/${p.receipt_token}/email`, { to: to || undefined });
      setMsg(`Receipt emailed to ${r.data.to}`);
      load();
    } catch (e) {
      setMsg(parseApiError(e, 'Failed to email receipt'));
    }
  }

  async function confirmManually() {
    setConfirming(true);
    try {
      await api.post(`/payments/public/confirm/${id}`, {});
      await load();
      setCheckoutShow(false);
      setCheckout(null);
    } catch (e) {
      toast(parseApiError(e, 'Could not confirm payment'), 'error');
    } finally {
      setConfirming(false);
    }
  }

  function closeCheckout() {
    setCheckoutShow(false);
    setCheckout(null);
    // Always reload on close — in case the customer paid and we missed the
    // webhook / polling tick.
    load();
  }

  function openVaultCharge() {
    setVaultProfile(null);
    setVaultResult(null);
    setVaultShow(true);
  }

  async function doVaultCharge() {
    if (!vaultProfile) return;
    setVaultCharging(true); setVaultResult(null);
    try {
      await api.post('/vault/charge-invoice', {
        invoice_id:       Number(id),
        vault_profile_id: vaultProfile.id,
      });
      setVaultResult({ ok: true });
      load();
    } catch (e) {
      setVaultResult({ ok: false, error: e.response?.data?.error || 'Charge failed.' });
    } finally { setVaultCharging(false); }
  }

  // ---- Render ----
  return (
    <div>
      <PageHeader
        title={`Invoice ${inv.invoice_number}`}
        subtitle={
          <span>
            <span className={`badge bg-${STATUS_TONE[inv.status]}-subtle text-${STATUS_TONE[inv.status]} me-2`}>{inv.status}</span>
            {inv.contact_name || inv.organization_name || '—'} · Due {inv.due_date}
          </span>
        }
        actions={
          <>
            <Link to="/admin/invoices" className="btn btn-light">← Back</Link>
            {editable && can('invoices.write') && (
              <button className="btn btn-primary ms-2" onClick={openEdit}>
                <iconify-icon icon="solar:pen-new-square-line-duotone" class="me-1"></iconify-icon> Edit
              </button>
            )}
            {can('invoices.send') && inv.status !== 'void' && (
              <button className="btn btn-primary ms-2" onClick={() => { setSendTo(inv.contact_email || ''); setSendShow(true); }}>
                <iconify-icon icon="solar:letter-line-duotone" class="me-1"></iconify-icon>
                {inv.status === 'draft' ? 'Send to Customer' : 'Resend'}
              </button>
            )}
            {can('payments.write') && Number(inv.balance_due) > 0 && inv.status !== 'void' && (
              <>
                <button className="btn btn-success ms-2" onClick={openCheckout}>
                  <iconify-icon icon="solar:card-line-duotone" class="me-1"></iconify-icon> Take Payment
                </button>
                <button className="btn btn-outline-success ms-2" onClick={openVaultCharge}>
                  <iconify-icon icon="solar:wallet-money-line-duotone" class="me-1"></iconify-icon> Charge Card on File
                </button>
                <button className="btn btn-light ms-2" onClick={() => { setManualForm({ ...manualForm, amount: Number(inv.balance_due) }); setManualFormError(''); setManualShow(true); }}>
                  <iconify-icon icon="solar:pen-new-square-line-duotone" class="me-1"></iconify-icon> Record Payment
                </button>
              </>
            )}
            {can('invoices.delete') && (
              <button className="btn btn-light text-danger ms-2" onClick={remove}>
                <iconify-icon icon="solar:trash-bin-trash-line-duotone" class="me-1"></iconify-icon>
                {inv.status === 'draft' ? 'Delete' : 'Void'}
              </button>
            )}
          </>
        }
      />

      {msg && <div className="alert alert-info">{msg}</div>}

      <div className="row">
        <div className="col-lg-4 mb-3">
          <div className="card">
            <div className="card-body">
              <h6 className="fw-bold text-uppercase small text-muted">Details</h6>
              <dl className="row mb-0">
                <dt className="col-5">Status</dt>
                <dd className="col-7"><span className={`badge bg-${STATUS_TONE[inv.status]}-subtle text-${STATUS_TONE[inv.status]}`}>{inv.status}</span></dd>
                <dt className="col-5">Issued</dt><dd className="col-7">{inv.issue_date}</dd>
                <dt className="col-5">Due</dt><dd className="col-7">{inv.due_date}</dd>
                <dt className="col-5">Customer</dt>
                <dd className="col-7">
                  {inv.contact_id ? <Link to={`/admin/contacts/${inv.contact_id}`}>{inv.contact_name}</Link> : '—'}
                  {inv.contact_email && <div className="small text-muted">{inv.contact_email}</div>}
                </dd>
                <dt className="col-5">Organization</dt>
                <dd className="col-7">{inv.organization_id ? <Link to={`/admin/organizations/${inv.organization_id}`}>{inv.organization_name}</Link> : '—'}</dd>
                <dt className="col-5">Owner</dt><dd className="col-7">{inv.owner_name || '—'}</dd>
                <dt className="col-5">Sent</dt><dd className="col-7">{inv.sent_at ? new Date(inv.sent_at).toLocaleString() : '—'}</dd>
                <dt className="col-5">Paid</dt><dd className="col-7">{inv.paid_at ? new Date(inv.paid_at).toLocaleString() : '—'}</dd>
              </dl>
            </div>
          </div>

          <div className="card mt-3">
            <div className="card-body">
              <h6 className="fw-bold text-uppercase small text-muted">Totals</h6>
              <div className="d-flex justify-content-between"><span>Subtotal</span><strong>{fmt(inv.subtotal)}</strong></div>
              <div className="d-flex justify-content-between"><span>Discount ({Number(inv.discount_rate || 0)}%)</span><strong>−{fmt(inv.discount_amount)}</strong></div>
              <div className="d-flex justify-content-between"><span>Tax ({Number(inv.tax_rate || 0)}%)</span><strong>{fmt(inv.tax_amount)}</strong></div>
              <hr className="my-2" />
              <div className="d-flex justify-content-between fs-5"><span>Total</span><strong>{fmt(inv.total)}</strong></div>
              <div className="d-flex justify-content-between text-success"><span>Paid</span><strong>{fmt(inv.amount_paid)}</strong></div>
              <div className="d-flex justify-content-between text-danger fs-5"><span>Balance</span><strong>{fmt(inv.balance_due)}</strong></div>
            </div>
          </div>

          {(inv.memo || inv.terms) && (
            <div className="card mt-3">
              <div className="card-body">
                {inv.memo && (<><h6 className="fw-bold text-uppercase small text-muted">Memo</h6><p>{inv.memo}</p></>)}
                {inv.terms && (<><h6 className="fw-bold text-uppercase small text-muted mt-3">Terms</h6><p className="mb-0">{inv.terms}</p></>)}
              </div>
            </div>
          )}
        </div>

        <div className="col-lg-8">
          <div className="card">
            <div className="card-body">
              <h6 className="fw-bold text-uppercase small text-muted">Line Items</h6>
              <div className="table-responsive">
                <table className="table align-middle mb-0">
                  <thead>
                    <tr>
                      <th>Description</th>
                      <th className="text-end" style={{ width: 100 }}>Qty</th>
                      <th className="text-end" style={{ width: 140 }}>Unit Price</th>
                      <th className="text-end" style={{ width: 140 }}>Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {line_items?.map((l) => (
                      <tr key={l.id}>
                        <td>{l.description}</td>
                        <td className="text-end">{Number(l.quantity)}</td>
                        <td className="text-end">{fmt(l.unit_price)}</td>
                        <td className="text-end fw-semibold">{fmt(l.amount)}</td>
                      </tr>
                    ))}
                    {(!line_items || line_items.length === 0) && <tr><td colSpan="4" className="text-muted small">No line items.</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <div className="card mt-3">
            <div className="card-body">
              <h6 className="fw-bold text-uppercase small text-muted">Payments</h6>
              {payments?.length ? (
                <div className="table-responsive">
                  <table className="table table-sm align-middle mb-0">
                    <thead>
                      <tr>
                        <th>Date</th><th>Gateway</th><th>Method</th>
                        <th className="text-end">Amount</th><th>Status</th><th>Txn</th><th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {payments.map((p) => (
                        <tr key={p.id}>
                          <td>{p.received_at ? new Date(p.received_at).toLocaleString() : new Date(p.created_at).toLocaleString()}</td>
                          <td>{formatGateway(p.gateway)}</td>
                          <td>{p.method || '—'}</td>
                          <td className="text-end fw-semibold">{fmt(p.amount)}</td>
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
                            {/* Pending payments (gateway-started but not yet captured) get a
                                'Mark captured' button — this is the localhost dev escape
                                hatch for when the gateway's IPN webhook can't reach us. */}
                            {String(p.status).toLowerCase() === 'pending' && can('payments.write') && (
                              <button
                                className="btn btn-sm btn-success me-1"
                                title="Flip this pending payment to captured"
                                onClick={() => capturePayment(p.id)}
                              >
                                <iconify-icon icon="solar:check-circle-line-duotone" class="me-1"></iconify-icon>
                                Mark captured
                              </button>
                            )}
                            {/* Receipt is available for any real transaction, even if still
                                pending settlement. The receipt template itself reflects the
                                lifecycle state (AUTHORIZED · PENDING SETTLEMENT, PAID, etc.).
                                Only dead-ends (failed/voided/refunded/cancelled) are hidden. */}
                            {p.status && !['failed','voided','refunded','cancelled'].includes(String(p.status).toLowerCase()) && (
                              <>
                                <button
                                  className="btn btn-sm btn-outline-primary me-1"
                                  title="View receipt"
                                  onClick={() => openReceiptView(p)}
                                >
                                  <iconify-icon icon="solar:document-text-line-duotone" class="me-1"></iconify-icon>
                                  Receipt
                                </button>
                                <button
                                  className="btn btn-sm btn-light me-1"
                                  title="Download PDF"
                                  onClick={() => downloadReceiptPdf(p)}
                                >
                                  <iconify-icon icon="solar:file-download-line-duotone"></iconify-icon>
                                </button>
                                <button
                                  className="btn btn-sm btn-light me-1"
                                  title="Email receipt"
                                  onClick={() => emailReceipt(p)}
                                >
                                  <iconify-icon icon="solar:letter-line-duotone"></iconify-icon>
                                </button>
                              </>
                            )}
                            {can('payments.write') && p.status && !['pending','failed','voided','refunded','cancelled'].includes(String(p.status).toLowerCase()) && (
                              <button className="btn btn-sm btn-light text-danger" onClick={() => refundPayment(p.id)}>
                                Refund
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : <div className="text-muted small">No payments recorded yet.</div>}
            </div>
          </div>

          <div className="card mt-3">
            <div className="card-body">
              <h6 className="fw-bold text-uppercase small text-muted">Activity</h6>
              <ul className="list-unstyled mb-0">
                {activities?.map((a) => (
                  <li key={a.id} className="py-2 border-top d-flex justify-content-between">
                    <span>{a.user_name || 'System'} — <strong>{a.action}</strong> — {a.description}</span>
                    <small className="text-muted">{new Date(a.created_at).toLocaleString()}</small>
                  </li>
                ))}
                {(!activities || activities.length === 0) && <li className="text-muted small py-2">No activity yet.</li>}
              </ul>
            </div>
          </div>
        </div>
      </div>

      {/* ---------------- Edit Modal ---------------- */}
      <Modal show={editShow} onClose={() => setEditShow(false)} title={`Edit ${inv.invoice_number}`} size="lg"
        footer={<><button className="btn btn-light" onClick={() => setEditShow(false)}>Cancel</button>
                  <button className="btn btn-primary" onClick={saveEdit}>Save</button></>}>
        {editForm && (
          <>
            <FormErrorBanner error={editFormError} />
            <div className="row g-2">
              <div className="col-md-6"><label className="form-label">Customer (contact)</label>
                <select className="form-select" value={editForm.contact_id} onChange={(e) => setEditForm({ ...editForm, contact_id: e.target.value })}>
                  <option value="">—</option>
                  {contacts.map((c) => <option key={c.id} value={c.id}>{c.first_name} {c.last_name} {c.email ? `· ${c.email}` : ''}</option>)}
                </select></div>
              <div className="col-md-6"><label className="form-label">Billed organization</label>
                <select className="form-select" value={editForm.organization_id} onChange={(e) => setEditForm({ ...editForm, organization_id: e.target.value })}>
                  <option value="">—</option>
                  {orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                </select></div>
              <div className="col-md-3"><label className="form-label">Issue date</label>
                <input type="date" className="form-control" value={editForm.issue_date} onChange={(e) => setEditForm({ ...editForm, issue_date: e.target.value })} /></div>
              <div className="col-md-3"><label className="form-label">Due date</label>
                <input type="date" className="form-control" value={editForm.due_date} onChange={(e) => setEditForm({ ...editForm, due_date: e.target.value })} /></div>
              <div className="col-md-3"><label className="form-label">Tax %</label>
                <input type="number" step="0.001" className="form-control" value={editForm.tax_rate} onChange={(e) => setEditForm({ ...editForm, tax_rate: e.target.value })} /></div>
              <div className="col-md-3"><label className="form-label">Discount %</label>
                <input type="number" step="0.001" className="form-control" value={editForm.discount_rate} onChange={(e) => setEditForm({ ...editForm, discount_rate: e.target.value })} /></div>
            </div>

            <h6 className="mt-4 fw-bold text-uppercase small text-muted">Line Items</h6>
            <table className="table table-sm align-middle">
              <thead><tr><th>Description</th><th style={{ width: 90 }}>Qty</th><th style={{ width: 120 }}>Unit</th><th className="text-end" style={{ width: 120 }}>Amount</th><th></th></tr></thead>
              <tbody>
                {editForm.line_items.map((l, i) => (
                  <tr key={i}>
                    <td><input className="form-control form-control-sm" value={l.description} onChange={(e) => updateLine(i, { description: e.target.value })} /></td>
                    <td><input type="number" step="0.01" className="form-control form-control-sm" value={l.quantity} onChange={(e) => updateLine(i, { quantity: e.target.value })} /></td>
                    <td><input type="number" step="0.01" className="form-control form-control-sm" value={l.unit_price} onChange={(e) => updateLine(i, { unit_price: e.target.value })} /></td>
                    <td className="text-end">${(Number(l.quantity || 0) * Number(l.unit_price || 0)).toFixed(2)}</td>
                    <td><button type="button" className="btn btn-sm btn-light text-danger" onClick={() => removeLine(i)}>
                      <iconify-icon icon="solar:trash-bin-trash-line-duotone"></iconify-icon>
                    </button></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <button type="button" className="btn btn-sm btn-light" onClick={addLine}>
              <iconify-icon icon="solar:add-circle-line-duotone" class="me-1"></iconify-icon> Add line
            </button>

            <div className="mt-3 d-flex justify-content-end">
              <div style={{ minWidth: 280 }}>
                <div className="d-flex justify-content-between"><span>Subtotal</span><strong>${editSubtotal.toFixed(2)}</strong></div>
                <div className="d-flex justify-content-between"><span>Discount ({editForm.discount_rate}%)</span><strong>−${editDiscount.toFixed(2)}</strong></div>
                <div className="d-flex justify-content-between"><span>Tax ({editForm.tax_rate}%)</span><strong>${editTax.toFixed(2)}</strong></div>
                <hr className="my-1" />
                <div className="d-flex justify-content-between fs-5"><span>Total</span><strong>${editTotal.toFixed(2)}</strong></div>
              </div>
            </div>

            <label className="form-label mt-3">Memo</label>
            <textarea rows={2} className="form-control" value={editForm.memo} onChange={(e) => setEditForm({ ...editForm, memo: e.target.value })} />
            <label className="form-label mt-3">Terms</label>
            <textarea rows={2} className="form-control" value={editForm.terms} onChange={(e) => setEditForm({ ...editForm, terms: e.target.value })} />
          </>
        )}
      </Modal>

      {/* ---------------- Send Modal ---------------- */}
      <Modal show={sendShow} onClose={() => setSendShow(false)} title="Send Invoice" size="lg"
        footer={<><button className="btn btn-light" onClick={() => setSendShow(false)}>Cancel</button>
                  <button className="btn btn-primary" onClick={doSend}>Send</button></>}>
        <p className="text-muted">We'll email the customer a link to view and pay this invoice online.</p>
        <label className="form-label">To</label>
        <input className="form-control" value={sendTo} onChange={(e) => setSendTo(e.target.value)} placeholder="customer@example.com" />
      </Modal>

      {/* ---------------- Manual Payment Modal ---------------- */}
      <Modal show={manualShow} onClose={() => setManualShow(false)} title="Record Payment" size="lg"
        footer={<><button className="btn btn-light" onClick={() => setManualShow(false)}>Cancel</button>
                  <button className="btn btn-primary" onClick={doManual}>Record</button></>}>
        <FormErrorBanner error={manualFormError} />
        <div className="row g-2">
          <div className="col-md-6"><label className="form-label">Amount</label>
            <input type="number" step="0.01" className="form-control" value={manualForm.amount}
              onChange={(e) => setManualForm({ ...manualForm, amount: e.target.value })} /></div>
          <div className="col-md-6"><label className="form-label">Method</label>
            <select className="form-select" value={manualForm.method} onChange={(e) => setManualForm({ ...manualForm, method: e.target.value })}>
              {['check','cash','wire','ach','card','other'].map((m) => <option key={m} value={m}>{m}</option>)}
            </select></div>
          <div className="col-12"><label className="form-label">Reference / Txn #</label>
            <input className="form-control" value={manualForm.external_txn_id}
              onChange={(e) => setManualForm({ ...manualForm, external_txn_id: e.target.value })} /></div>
          <div className="col-12"><label className="form-label">Note</label>
            <textarea rows={2} className="form-control" value={manualForm.note}
              onChange={(e) => setManualForm({ ...manualForm, note: e.target.value })} /></div>
        </div>
      </Modal>

      {/* ---------------- Checkout Modal (hosted iframe) ---------------- */}
      <Modal show={checkoutShow} onClose={closeCheckout} title="Take Payment" size="lg"
        footer={<button className="btn btn-light" onClick={closeCheckout}>Close</button>}>
        {checkoutLoading && <div className="text-muted">Starting secure checkout…</div>}
        {checkout?.error && <div className="alert alert-danger">{checkout.error}</div>}
        {checkout && !checkout.error && (
          <>
            <p className="small text-muted mb-2">
              Powered by <strong>{checkout.gateway === 'authnet' ? 'Authorize.Net' : 'Valor PayTech'}</strong>.
              Card data is entered directly into the gateway — it never touches this server.
            </p>

            {checkout.gateway === 'valor' && !paymentResult && (
              <PassagePaymentForm
                invoiceId={Number(id)}
                chargeAmount={checkout.charge_amount ?? data?.invoice?.balance_due}
                currency="USD"
                onSuccess={(result) => { setPaymentResult({ outcome: 'success', ...result }); load(); }}
                onDeclined={({ message }) => setPaymentResult({ outcome: 'declined', message })}
                onCancel={() => { setCheckoutShow(false); setCheckout(null); setPaymentResult(null); }}
              />
            )}

            {checkout.gateway === 'valor' && paymentResult?.outcome === 'declined' && (
              <div className="mt-2">
                <div className="alert alert-danger mb-3">
                  <strong>Payment declined</strong> — {paymentResult.message}
                </div>
                <button className="btn btn-outline-primary w-100" onClick={() => setPaymentResult(null)}>
                  Try again
                </button>
              </div>
            )}

            {checkout.gateway === 'valor' && paymentResult?.outcome === 'success' && (
              <div className="alert alert-success mb-0">
                Payment captured. Invoice updated.
              </div>
            )}

            {checkout.gateway === 'authnet' && (
              <>
                <form
                  ref={authnetFormRef}
                  method="POST"
                  action={checkout.postUrl}
                  target="authnet-iframe"
                  style={{ display: 'none' }}
                >
                  <input type="hidden" name="token" value={checkout.token} />
                </form>
                <iframe
                  name="authnet-iframe"
                  title="Authorize.Net Checkout"
                  style={{ width: '100%', height: 620, border: '1px solid #e5e7eb', borderRadius: 8 }}
                  allow="payment"
                />
              </>
            )}

            {checkout.gateway === 'authnet' && (
              <div className="alert alert-light small mt-3 mb-0 d-flex justify-content-between align-items-center">
                <span>
                  Once the customer completes payment, the gateway will notify this server via webhook
                  and the invoice balance will update automatically. Polling every 4s.
                </span>
                <button
                  className="btn btn-sm btn-outline-success ms-3"
                  onClick={confirmManually}
                  disabled={confirming}
                >
                  {confirming ? 'Confirming…' : "I've completed payment"}
                </button>
              </div>
            )}
          </>
        )}
      </Modal>

      {/* ---------------- Vault / Charge Card on File Modal ---------------- */}
      <Modal
        show={vaultShow}
        onClose={() => { setVaultShow(false); setVaultResult(null); }}
        title="Charge Card on File"
        size="lg"
        footer={
          <>
            <button className="btn btn-light" onClick={() => { setVaultShow(false); setVaultResult(null); }}>
              Close
            </button>
            {!vaultResult?.ok && (
              <button
                className="btn btn-success ms-2"
                disabled={vaultCharging || !vaultProfile}
                onClick={doVaultCharge}
              >
                {vaultCharging
                  ? <><span className="spinner-border spinner-border-sm me-2"></span>Charging…</>
                  : <>Charge {fmt(inv.balance_due)}</>}
              </button>
            )}
          </>
        }
      >
        {vaultResult?.ok ? (
          <div className="text-center py-3">
            <iconify-icon icon="solar:check-circle-bold-duotone" style={{ fontSize: 56, color: '#198754' }}></iconify-icon>
            <h5 className="mt-3 mb-1">Payment captured</h5>
            <p className="text-muted small mb-0">Invoice balance has been updated.</p>
          </div>
        ) : (
          <>
            <p className="text-muted small mb-3">
              Select a saved card on file for{' '}
              <strong>{inv.contact_name || inv.organization_name || 'this customer'}</strong>
              {' '}and charge the balance due of{' '}
              <strong>{fmt(inv.balance_due)}</strong>.
            </p>

            {vaultResult?.error && (
              <div className="alert alert-danger py-2 small mb-3">{vaultResult.error}</div>
            )}

            <VaultProfilesWidget
              contactId={inv.contact_id || null}
              organizationId={inv.organization_id || null}
              onSelectProfile={(p) => setVaultProfile(p)}
              selectedId={vaultProfile?.id || null}
              compact={false}
            />

            {vaultProfile && (
              <div className="alert alert-light py-2 small mt-3 mb-0">
                <iconify-icon icon="solar:card-line-duotone" class="me-1"></iconify-icon>
                Will charge{' '}
                <strong>
                  {vaultProfile.card_brand ? `${vaultProfile.card_brand.charAt(0).toUpperCase()}${vaultProfile.card_brand.slice(1)} ` : ''}
                  ****{vaultProfile.last4 || '????'}
                </strong>
                {' '}via <strong>{vaultProfile.gateway === 'authnet' ? 'Authorize.Net' : 'Valor PayTech'}</strong>
              </div>
            )}
          </>
        )}
      </Modal>

      {confirmDialog}
      {promptDialog}
    </div>
  );
}
