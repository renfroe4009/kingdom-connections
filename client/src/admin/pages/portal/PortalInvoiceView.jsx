// =============================================================================
// Portal invoice view — logged-in customers see + pay their invoice here.
// Uses /api/portal/invoices/:id (scoped by the user's linked contact/org).
// Checkout uses the same public /api/payments/public/checkout/:invoiceId flow.
// =============================================================================
import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import api from '../../../api/client.js';
import PassagePaymentForm from '../../../components/PassagePaymentForm.jsx';

const GATEWAY_LABEL = {
  valor:   'Valor PayTech',
  authnet: 'Authorize.Net',
};

const STATUS_TONE = {
  draft: 'secondary', sent: 'primary', partial: 'warning',
  paid: 'success', overdue: 'danger', void: 'dark', refunded: 'info',
};

export default function PortalInvoiceView() {
  const { id } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [checkout, setCheckout] = useState(null);
  const [starting, setStarting] = useState(false);
  const [payResult, setPayResult] = useState(null);
  const authnetFormRef = useRef(null);

  // Saved-card charge state
  const [savedProfiles, setSavedProfiles]         = useState(null); // null = not loaded
  const [selectedProfile, setSelectedProfile]     = useState('');
  const [savedCardCharging, setSavedCardCharging] = useState(false);
  const [savedCardResult, setSavedCardResult]     = useState(null); // { ok, error }

  async function load() {
    try {
      const { data } = await api.get(`/portal/invoices/${id}`);
      setData(data);
    } catch (e) {
      setError(e.response?.data?.error || 'Invoice not found');
    }
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [id]);

  async function loadSavedProfiles() {
    if (savedProfiles !== null) return; // already loaded
    try {
      const { data: d } = await api.get('/portal/payment-methods');
      setSavedProfiles(d.profiles || []);
      if (d.profiles?.length) {
        const def = d.profiles.find((p) => p.is_default) || d.profiles[0];
        setSelectedProfile(String(def.id));
      }
    } catch (_) {
      setSavedProfiles([]);
    }
  }

  async function chargeWithSavedCard() {
    if (!selectedProfile) return;
    setSavedCardCharging(true); setSavedCardResult(null);
    try {
      await api.post(`/portal/invoices/${id}/pay-saved`, {
        vault_profile_id: Number(selectedProfile),
      });
      setSavedCardResult({ ok: true });
      load(); // refresh invoice data
    } catch (e) {
      const msg = e.response?.data?.error || 'Charge failed. Please try again.';
      setSavedCardResult({ ok: false, error: msg });
    } finally { setSavedCardCharging(false); }
  }

  async function startCheckout() {
    setStarting(true); setCheckout(null);
    try {
      const origin = window.location.origin;
      const returnUrl = `${origin}/portal/invoices/${id}?paid=1`;
      const { data: co } = await api.post(`/payments/public/checkout/${id}`, { returnUrl });
      setCheckout(co);
      if (co.gateway === 'authnet') setTimeout(() => authnetFormRef.current?.submit(), 100);
    } catch (e) {
      setCheckout({ error: e.response?.data?.error || 'Failed to start checkout' });
    } finally { setStarting(false); }
  }

  if (error) return <div className="alert alert-danger">{error}</div>;
  if (!data) return <div className="empty-state">Loading…</div>;

  const { invoice: inv, line_items, payments } = data;
  const fmt = (n) => `$${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const paid = inv.status === 'paid' || Number(inv.balance_due) <= 0;

  return (
    <div>
      <Link to="/portal/invoices" className="btn btn-sm btn-light mb-3">← Back to invoices</Link>

      <div className="row g-4">
        <div className="col-lg-7">
          <div className="card">
            <div className="card-body">
              <div className="d-flex justify-content-between align-items-start mb-3">
                <div>
                  <h3 className="mb-0 fw-bolder">Invoice {inv.invoice_number}</h3>
                  <div className="text-muted">Issued {inv.issue_date} · Due {inv.due_date}</div>
                </div>
                <span className={`badge bg-${STATUS_TONE[inv.status]}-subtle text-${STATUS_TONE[inv.status]} fs-6`}>{inv.status}</span>
              </div>

              <div className="table-responsive">
                <table className="table align-middle">
                  <thead>
                    <tr>
                      <th>Description</th>
                      <th className="text-end" style={{ width: 80 }}>Qty</th>
                      <th className="text-end" style={{ width: 120 }}>Unit</th>
                      <th className="text-end" style={{ width: 120 }}>Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {line_items.map((l) => (
                      <tr key={l.id}>
                        <td>{l.description}</td>
                        <td className="text-end">{Number(l.quantity)}</td>
                        <td className="text-end">{fmt(l.unit_price)}</td>
                        <td className="text-end fw-semibold">{fmt(l.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="d-flex justify-content-end">
                <div style={{ minWidth: 280 }}>
                  <div className="d-flex justify-content-between"><span>Subtotal</span><strong>{fmt(inv.subtotal)}</strong></div>
                  {Number(inv.discount_amount) > 0 && <div className="d-flex justify-content-between"><span>Discount</span><strong>−{fmt(inv.discount_amount)}</strong></div>}
                  {Number(inv.tax_amount) > 0 && <div className="d-flex justify-content-between"><span>Tax</span><strong>{fmt(inv.tax_amount)}</strong></div>}
                  <hr className="my-2" />
                  <div className="d-flex justify-content-between fs-5"><span>Total</span><strong>{fmt(inv.total)}</strong></div>
                  {Number(inv.amount_paid) > 0 && <div className="d-flex justify-content-between text-success"><span>Paid</span><strong>{fmt(inv.amount_paid)}</strong></div>}
                  <div className="d-flex justify-content-between fs-5 fw-bolder" style={{ color: paid ? '#198754' : 'var(--brand, #1f2937)' }}>
                    <span>Balance</span><strong>{fmt(inv.balance_due)}</strong>
                  </div>
                </div>
              </div>

              {inv.memo && <div className="alert alert-light mt-3 mb-0 small"><strong>Note:</strong> {inv.memo}</div>}
            </div>
          </div>

          {payments?.length > 0 && (
            <div className="card mt-3">
              <div className="card-body">
                <h6 className="fw-bold text-uppercase small text-muted">Payment history</h6>
                <div className="table-responsive">
                  <table className="table table-sm align-middle mb-0">
                    <thead><tr><th>Date</th><th>Method</th><th className="text-end">Amount</th><th>Status</th></tr></thead>
                    <tbody>
                      {payments.map((p) => (
                        <tr key={p.id}>
                          <td>{p.received_at ? new Date(p.received_at).toLocaleDateString() : '—'}</td>
                          <td>{p.method || '—'}</td>
                          <td className="text-end">{fmt(p.amount)}</td>
                          <td><span className="badge bg-success-subtle text-success">{p.status}</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="col-lg-5">
          <div className="card sticky-top" style={{ top: 16 }}>
            <div className="card-body">
              {paid ? (
                <div className="text-center py-3">
                  <iconify-icon icon="solar:check-circle-bold-duotone" style={{ fontSize: 64, color: '#198754' }}></iconify-icon>
                  <h4 className="mt-3 mb-1">Paid in full</h4>
                  <p className="text-muted mb-0">Thanks — we received your payment.</p>
                </div>
              ) : (
                <>
                  <h5 className="fw-bolder mb-2">Pay this invoice</h5>
                  <p className="text-muted small">
                    Secure hosted checkout — your card information goes directly to our payment processor.
                  </p>
                  {!checkout && !starting && (
                    <>
                      <button className="btn btn-lg w-100" style={{ background: 'var(--secondary, #4b5563)', color: 'var(--brand, #1f2937)' }} onClick={startCheckout}>
                        <iconify-icon icon="solar:card-line-duotone" class="me-2"></iconify-icon>
                        Pay {fmt(inv.balance_due)}
                      </button>

                      {/* Use saved card section */}
                      <div className="mt-3">
                        {savedProfiles === null && (
                          <button
                            className="btn btn-sm btn-outline-secondary w-100"
                            onClick={loadSavedProfiles}
                          >
                            <iconify-icon icon="solar:wallet-line-duotone" class="me-1"></iconify-icon>
                            Use a saved card
                          </button>
                        )}

                        {savedProfiles !== null && savedProfiles.length === 0 && (
                          <p className="text-muted small text-center mb-0">
                            No saved cards.{' '}
                            <a href="/portal/payment-methods" className="text-decoration-none" style={{ color: 'var(--brand, #1f2937)' }}>Add one</a> to pay faster next time.
                          </p>
                        )}

                        {savedProfiles !== null && savedProfiles.length > 0 && (
                          <div className="border rounded-2 p-3 bg-light">
                            <div className="small fw-semibold mb-2 text-muted">Charge a saved card</div>

                            {savedCardResult?.ok && (
                              <div className="alert alert-success py-2 small mb-2">
                                <iconify-icon icon="solar:check-circle-bold-duotone" class="me-1"></iconify-icon>
                                Payment captured successfully!
                              </div>
                            )}
                            {savedCardResult?.error && (
                              <div className="alert alert-danger py-2 small mb-2">{savedCardResult.error}</div>
                            )}

                            <select
                              className="form-select form-select-sm mb-2"
                              value={selectedProfile}
                              onChange={(e) => setSelectedProfile(e.target.value)}
                            >
                              {savedProfiles.map((p) => (
                                <option key={p.id} value={String(p.id)}>
                                  {p.card_brand ? `${p.card_brand.charAt(0).toUpperCase()}${p.card_brand.slice(1)} ` : ''}
                                  ****{p.last4 || '????'}
                                  {p.expiry ? ` (exp ${p.expiry})` : ''}
                                  {p.nickname ? ` — ${p.nickname}` : ''}
                                  {p.is_default ? ' ★' : ''}
                                  {' · '}{GATEWAY_LABEL[p.gateway] || p.gateway}
                                </option>
                              ))}
                            </select>

                            <button
                              className="btn btn-sm w-100"
                              style={{ background: 'var(--secondary, #4b5563)', color: 'var(--brand, #1f2937)' }}
                              disabled={savedCardCharging || !selectedProfile}
                              onClick={chargeWithSavedCard}
                            >
                              {savedCardCharging
                                ? <><span className="spinner-border spinner-border-sm me-2"></span>Processing…</>
                                : <>Charge {fmt(inv.balance_due)} now</>}
                            </button>
                          </div>
                        )}
                      </div>
                    </>
                  )}
                  {starting && <div className="text-muted">Starting secure checkout…</div>}
                  {checkout?.error && <div className="alert alert-danger">{checkout.error}</div>}
                  {checkout && !checkout.error && (
                    <div className="mt-2">
                      <div className="small text-muted mb-2">
                        Secured by <strong>{checkout.gateway === 'authnet' ? 'Authorize.Net' : 'Valor PayTech'}</strong>
                      </div>
                      {checkout.fee && (
                        <div className="alert alert-warning small mb-2">
                          <div className="d-flex justify-content-between">
                            <span>{checkout.fee.label}</span>
                            <strong>+{fmt(checkout.fee.amount)}</strong>
                          </div>
                          <div className="d-flex justify-content-between">
                            <span>You will be charged</span>
                            <strong>{fmt(checkout.charge_amount)}</strong>
                          </div>
                          {checkout.fee.disclosure && (
                            <div className="mt-1 text-muted">{checkout.fee.disclosure}</div>
                          )}
                        </div>
                      )}
                      {checkout.gateway === 'valor' && (
                        <>
                          {payResult?.declined && (
                            <div className="alert alert-danger py-2 small mb-2">{payResult.message}</div>
                          )}
                          <PassagePaymentForm
                            invoiceId={Number(id)}
                            chargeAmount={checkout.charge_amount}
                            currency={inv.currency || 'USD'}
                            onSuccess={() => { setCheckout(null); setPayResult(null); load(); }}
                            onDeclined={({ message }) => setPayResult({ declined: true, message })}
                            onCancel={() => { setCheckout(null); setPayResult(null); }}
                          />
                        </>
                      )}
                      {checkout.gateway === 'authnet' && (
                        <>
                          <form ref={authnetFormRef} method="POST" action={checkout.postUrl} target="authnet-iframe" style={{ display: 'none' }}>
                            <input type="hidden" name="token" value={checkout.token} />
                          </form>
                          <iframe name="authnet-iframe" title="Authorize.Net Checkout"
                            style={{ width: '100%', height: 620, border: '1px solid #e5e7eb', borderRadius: 8 }}
                            allow="payment" />
                        </>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
          <div className="text-center mt-3 small text-muted">
            <iconify-icon icon="solar:lock-keyhole-line-duotone" class="me-1"></iconify-icon>
            Secure SSL-encrypted payment · PCI SAQ-A compliant
          </div>
        </div>
      </div>
    </div>
  );
}
