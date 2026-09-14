// =============================================================================
// Public checkout page — /pay/:id
// -----------------------------------------------------------------------------
// Customers land here from the "View & Pay" link in the invoice email.
// No authentication required — scope is enforced server-side by invoice id
// (invoices the customer's email isn't attached to won't yield a balance,
// so the "Pay now" button just won't render).
// =============================================================================
import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import BrandMark from '../components/BrandMark.jsx';
import PassagePaymentForm from '../../components/PassagePaymentForm.jsx';
// Use the shared api client so VITE_API_URL is respected in production.
// No token exists on this public page so no auth header is added.
import api from '../../api/client.js';
import { useAdminTheme } from '../../hooks/useAdminTheme.js';

const STATUS_TONE = {
  draft: 'secondary', sent: 'primary', partial: 'warning',
  paid: 'success', overdue: 'danger', void: 'dark', refunded: 'info',
};

// Small inline component for the pay page's "Email Receipt" flow.
// Expands into an email field on click, sends on submit.
//
// Takes a `receiptToken` (the random per-payment hex token), NOT the payment
// id — the public receipt endpoint deliberately rejects id-based lookups so
// receipts can't be enumerated by guessing small integers.
function EmailReceiptButton({ receiptToken, defaultEmail }) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState(defaultEmail || '');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState('');

  async function send() {
    setSending(true);
    setErr('');
    try {
      await api.post(`/payments/public/receipt/by-token/${receiptToken}/email`, { to: email });
      setSent(true);
      setOpen(false);
    } catch (e) {
      setErr(e.response?.data?.error || 'Failed to send');
    } finally {
      setSending(false);
    }
  }

  if (sent) {
    return (
      <div className="alert alert-success small mb-0">
        <iconify-icon icon="solar:check-circle-line-duotone" class="me-1"></iconify-icon>
        Receipt sent to {email}.
      </div>
    );
  }
  if (!open) {
    return (
      <button className="btn btn-outline-secondary" onClick={() => setOpen(true)}>
        <iconify-icon icon="solar:letter-line-duotone" class="me-2"></iconify-icon>
        Email Receipt
      </button>
    );
  }
  return (
    <div className="text-start">
      <label className="form-label small mb-1">Send receipt to:</label>
      <div className="input-group input-group-sm">
        <input
          className="form-control"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
        />
        <button className="btn btn-primary" onClick={send} disabled={sending || !email}>
          {sending ? 'Sending…' : 'Send'}
        </button>
        <button className="btn btn-light" onClick={() => setOpen(false)} disabled={sending}>
          Cancel
        </button>
      </div>
      {err && <div className="text-danger small mt-1">{err}</div>}
    </div>
  );
}

export default function PayInvoice() {
  useAdminTheme();
  // Route param is now a 64-char hex payment_token for new invoices, or a
  // legacy integer id for invoices sent before the token migration.
  const { token } = useParams();
  const isHexToken = /^[a-f0-9]{64}$/i.test(token || '');
  const [data, setData] = useState(null);
  // Integer invoice id — derived from loaded data and used for all write calls.
  const invoiceId = data?.invoice?.id ?? null;
  const [error, setError] = useState('');
  const [checkout, setCheckout] = useState(null);
  const [starting, setStarting] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [confirmError, setConfirmError] = useState('');
  // paymentResult: null | { outcome: 'success', ...data } | { outcome: 'declined', message }
  const [paymentResult, setPaymentResult] = useState(null);
  const authnetFormRef = useRef(null);

  async function load() {
    try {
      // Prefer the token-based endpoint (full data); fall back to integer-id
      // endpoint for legacy pay links (contact name/email omitted server-side).
      const url = isHexToken
        ? `/payments/public/invoice/by-token/${token}`
        : `/payments/public/invoice/${token}`;
      const { data } = await api.get(url);
      setData(data);
      return data;
    } catch (e) {
      setError(e.response?.data?.error || 'Invoice not found');
      return null;
    }
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [token]);

  // If Valor (or any gateway) redirects back to this page with ?paid=1, or
  // appends its own transactionId/status params, auto-confirm the pending
  // payment server-side. Safe no-op if there's nothing pending.
  //
  // We accept the full Valor IPN-style field set here (cardBrand, cardLast4,
  // cardHolderName, cardExpiry, authCode, avsResult, cvvResult, billing_*),
  // because Valor's redirect URL after a hosted-page payment may carry any of
  // them as query params. Anything we extract here gets COALESCEd onto the
  // payment row server-side.
  useEffect(() => {
    const qs = new URLSearchParams(window.location.search);
    const marker = qs.get('paid') || qs.get('status') || qs.get('transactionId') || qs.get('uid');
    if (!marker) return;
    // Diagnostic — see what Valor actually appends to the redirect URL.
    // eslint-disable-next-line no-console
    console.log('[Valor return URL]', Object.fromEntries(qs.entries()));

    // Helper: pick the first non-empty value across multiple field names.
    const pick = (...keys) => {
      for (const k of keys) {
        const v = qs.get(k);
        if (v !== null && v !== undefined && v !== '') return v;
      }
      return null;
    };
    // Build the billing snapshot only if any address piece showed up.
    const ba = pick('billing_address', 'billingAddress', 'address');
    const bc = pick('billing_city',    'billingCity',    'city');
    const bs = pick('billing_state',   'billingState',   'state');
    const bz = pick('billing_zip',     'billingZip',     'zip', 'postal_code');
    const bC = pick('billing_country', 'billingCountry', 'country');
    const billingAddress = (ba || bc || bs || bz || bC)
      ? { address: ba, city: bc, state: bs, zip: bz, country: bC }
      : null;

    (async () => {
      try {
        await api.post(`/payments/public/confirm/${invoiceId}`, {
          transactionId: pick('transactionId', 'txnId', 'transaction_id', 'id'),
          amount:        pick('amount', 'authorizedAmount') ? Number(pick('amount', 'authorizedAmount')) : null,
          last4:         pick('last4', 'cardLast4', 'cardNumberLast4'),
          brand:         pick('brand', 'cardBrand', 'cardType'),
          authCode:      pick('authCode', 'auth_code', 'approvalCode'),
          cardHolderName:pick('cardHolderName', 'cardHolder', 'customer_name'),
          cardExpiry:    pick('cardExpiry', 'expiry', 'expirationDate'),
          avsResult:     pick('avsResult', 'avs_result', 'avsResponse'),
          cvvResult:     pick('cvvResult', 'cvv_result', 'cvvResponse'),
          processorCode: pick('responseCode', 'response_code', 'code'),
          message:       pick('message', 'responseMessage', 'statusMessage'),
          billingAddress,
        });
      } catch (_e) { /* swallow — poll will catch up */ }
      window.history.replaceState({}, '', `/pay/${token}`);
      load();
    })();
    /* eslint-disable-next-line */
  }, [invoiceId]);

  // Auth.net Accept Hosted IFrame Communicator listener.
  //
  // Auth.net's hosted form delivers the transaction result via postMessage.
  // The flow:
  //   parent (this page) → Auth.net iframe → hidden communicator iframe
  //     (loads /authnet-iframe-communicator.html, same-origin)
  //     → bubbles back up to this listener via window.parent.parent.postMessage
  //
  // The bubbled payload looks like:
  //   "action=transactResponse&response=%7B%22transId%22%3A...%7D"
  // ...or sometimes a JSON object with the same fields. We handle both.
  //
  // On a successful response we POST to /public/confirm with the real txnId,
  // card brand, last4, auth code, AVS/CVV — so the payment row gets fully
  // populated even when the IPN webhook can't reach our server (localhost
  // dev). Idempotent: server-side confirm is a no-op if already captured.
  useEffect(() => {
    if (checkout?.gateway !== 'authnet') return undefined;

    function parsePayload(data) {
      // Object shape (some Auth.net configurations).
      if (data && typeof data === 'object' && !Array.isArray(data)) {
        const action = data.action || data.event;
        const response = data.response || data.responseBody || data;
        return { action, response };
      }
      // String shape: "action=...&response=<urlencoded JSON>"
      if (typeof data === 'string') {
        try {
          const params = new URLSearchParams(data);
          const action = params.get('action');
          const respRaw = params.get('response');
          let response = null;
          if (respRaw) {
            try { response = JSON.parse(respRaw); } catch (_e) { response = null; }
          }
          return { action, response };
        } catch (_e) { return { action: null, response: null }; }
      }
      return { action: null, response: null };
    }

    const onMsg = async (e) => {
      // Auth.net's Accept Hosted iframe lives on either accept.authorize.net or
      // test.authorize.net; the bubbled message comes from our SAME origin
      // (the communicator HTML). We accept any origin string match for the
      // forwarded payload — the structure is what we validate.
      const { action, response } = parsePayload(e.data);
      if (!action) return;

      if (action === 'transactResponse' && response) {
        const accountNumber = String(response.accountNumber || '');
        const last4 = accountNumber ? accountNumber.replace(/\D/g, '').slice(-4) : null;
        try {
          await api.post(`/payments/public/confirm/${invoiceId}`, {
            transactionId: response.transId || null,
            amount:        response.totalAmount ? Number(response.totalAmount) : null,
            last4,
            brand:         response.accountType || null,
            authCode:      response.authorization || null,
            cardHolder:    [response.firstName, response.lastName].filter(Boolean).join(' ') || null,
            cardExpiry:    response.expirationDate || null,
            avsResult:     response.avsResultCode || null,
            cvvResult:     response.cvvResultCode || null,
            processorCode: response.responseCode || null,
            message:       response.messages?.[0]?.description
                            || response.messages?.message?.[0]?.description
                            || null,
          });
        } catch (_e) { /* status poll will catch up */ }
        load();
      } else if (action === 'cancel') {
        setCheckout(null);
      } else if (action === 'resizeWindow') {
        // Auth.net sometimes asks the parent to resize. We use a fixed-height
        // iframe so this is a no-op — but parsing it prevents it from being
        // mistaken for a transactResponse on weak parsers.
      }
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
    /* eslint-disable-next-line */
  }, [checkout, invoiceId]);

  // Valor hosted-page postMessage listener.
  //
  // Valor's iframe posts a message to the parent on completion. Shape varies
  // by API revision — sometimes an object {event:'transaction_complete',
  // data:{...}}, sometimes the data fields at the top level, sometimes a
  // URLSearchParams-style string. We accept all of them and look for the
  // markers (transactionId + an "approved/captured" status).
  //
  // Why this exists: Valor's IPN webhook can't reach localhost in dev, and
  // the redirect/callback URL in iframe mode often doesn't append the txn id
  // as query params. Without this listener, the only way a payment becomes
  // "captured" is the manual fallback button, which has no txn data → empty
  // payment row → backfill needed. With this listener, the txn id and card
  // details land on the payment row at the moment the customer pays.
  useEffect(() => {
    if (checkout?.gateway !== 'valor') return undefined;

    function asObject(data) {
      if (!data) return null;
      if (typeof data === 'object' && !Array.isArray(data)) return data;
      if (typeof data === 'string') {
        // Try JSON first, then URLSearchParams.
        try { return JSON.parse(data); } catch (_e) { /* not JSON */ }
        try {
          const o = {};
          new URLSearchParams(data).forEach((v, k) => { o[k] = v; });
          return Object.keys(o).length ? o : null;
        } catch (_e) { return null; }
      }
      return null;
    }

    const onMsg = async (e) => {
      // ===== DIAGNOSTIC LOGGING =====
      // Log EVERY message we receive while a Valor checkout is open so we can
      // see what Valor actually posts and tune the filter. Remove once stable.
      // eslint-disable-next-line no-console
      console.log('[Valor postMessage]', {
        origin: e.origin,
        type:   typeof e.data,
        data:   e.data,
      });

      const o = asObject(e.data);
      if (!o) {
        // eslint-disable-next-line no-console
        console.log('[Valor postMessage] not parsable as object/json/qs — ignoring');
        return;
      }
      // Pull out a candidate inner payload — Valor sometimes wraps as
      // { event/type, data: {...} }.
      const d = o.data && typeof o.data === 'object' ? o.data : o;
      const txnId = d.transactionId || d.txnId || d.transaction_id || d.id;
      const statusStr = String(d.status || d.result || d.transactionStatus || o.event || o.type || '').toLowerCase();
      const looksApproved = /approv|captur|success|complet/.test(statusStr);

      // eslint-disable-next-line no-console
      console.log('[Valor postMessage] parsed', {
        outerKeys:   Object.keys(o),
        innerKeys:   Object.keys(d),
        txnId,
        statusStr,
        looksApproved,
        willConfirm: !!(txnId || looksApproved),
      });

      // Filter out noise (resize messages, dev-tools, react devtools, etc.)
      // We require either a transaction id OR an explicit success marker.
      if (!txnId && !looksApproved) return;

      const body = {
        transactionId: txnId || null,
        amount:        d.amount ? Number(d.amount) : (d.authorizedAmount ? Number(d.authorizedAmount) : null),
        last4:         d.cardLast4 || d.last4 || d.cardNumberLast4 || null,
        brand:         d.cardBrand || d.brand || d.cardType || null,
        authCode:      d.authCode || d.auth_code || d.approvalCode || null,
        cardExpiry:    d.cardExpiry || d.expiry || d.expirationDate || null,
        cardHolder:    d.cardHolder || d.cardHolderName || d.customer_name || null,
        avsResult:     d.avsResult || d.avs_result || d.avsResponse || null,
        cvvResult:     d.cvvResult || d.cvv_result || d.cvvResponse || null,
        processorCode: d.responseCode || d.code || null,
        message:       d.message || d.responseMessage || d.statusMessage || null,
      };
      // eslint-disable-next-line no-console
      console.log('[Valor postMessage] POST /public/confirm body', body);

      try {
        await api.post(`/payments/public/confirm/${invoiceId}`, body);
        // eslint-disable-next-line no-console
        console.log('[Valor postMessage] confirm OK');
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[Valor postMessage] confirm FAILED', err?.response?.data || err?.message);
      }
      load();
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
    /* eslint-disable-next-line */
  }, [checkout, invoiceId]);

  // Poll while a checkout is in flight — covers both webhook-driven capture
  // (prod/tunnel) and the URL-param return above. Stops once paid.
  useEffect(() => {
    if (!checkout || checkout.error) return undefined;
    const t = setInterval(async () => {
      try {
        const { data: s } = await api.get(`/payments/public/status/${invoiceId}`);
        if (Number(s.balance_due) <= 0 || s.status === 'paid') {
          clearInterval(t);
          load();
        }
      } catch (_e) { /* keep polling */ }
    }, 4000);
    return () => clearInterval(t);
    /* eslint-disable-next-line */
  }, [checkout, invoiceId]);

  async function startCheckout() {
    setStarting(true);
    setCheckout(null);
    try {
      const origin = window.location.origin;
      const returnUrl = `${origin}/pay/${token}?paid=1`;
      const { data: co } = await api.post(`/payments/public/checkout/${invoiceId}`, { returnUrl });
      setCheckout(co);
      if (co.gateway === 'authnet') {
        setTimeout(() => authnetFormRef.current?.submit(), 100);
      }
    } catch (e) {
      setCheckout({ error: e.response?.data?.error || 'Failed to start checkout' });
    } finally {
      setStarting(false);
    }
  }

  async function confirmManually() {
    setConfirming(true);
    setConfirmError('');
    try {
      await api.post(`/payments/public/confirm/${invoiceId}`, {});
      await load();
      setCheckout(null);
    } catch (e) {
      setConfirmError(e.response?.data?.error || 'Could not confirm payment');
    } finally {
      setConfirming(false);
    }
  }

  if (error) {
    return (
      <div className="min-vh-100 d-flex align-items-center justify-content-center bg-light">
        <div className="card shadow-sm" style={{ maxWidth: 480 }}>
          <div className="card-body text-center p-5">
            <iconify-icon icon="solar:danger-triangle-line-duotone" style={{ fontSize: 48, color: '#dc3545' }}></iconify-icon>
            <h4 className="mt-3">We couldn't find that invoice</h4>
            <p className="text-muted mb-0">{error}</p>
          </div>
        </div>
      </div>
    );
  }

  if (!data) {
    return <div className="min-vh-100 d-flex align-items-center justify-content-center">Loading…</div>;
  }

  const { invoice: inv, line_items, latest_payment } = data;
  const fmt = (n) => `$${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const paid = inv.status === 'paid' || Number(inv.balance_due) <= 0;

  return (
    <div className="min-vh-100" style={{ background: '#FAF5F0' }}>
      <div className="container py-4" style={{ maxWidth: 1100 }}>
        <header className="d-flex align-items-center justify-content-between mb-4">
          <BrandMark size="md" />
          <span className={`badge bg-${STATUS_TONE[inv.status]}-subtle text-${STATUS_TONE[inv.status]} fs-6`}>{inv.status}</span>
        </header>

        <div className="row g-4">
          <div className="col-12 col-md-7">
            <div className="card shadow-sm">
              <div className="card-body p-4">
                <div className="d-flex justify-content-between align-items-start mb-3">
                  <div>
                    <h3 className="mb-0 fw-bolder">Invoice {inv.invoice_number}</h3>
                    <div className="text-muted">
                      Issued {inv.issue_date} · Due {inv.due_date}
                    </div>
                  </div>
                  <div className="text-end">
                    <div className="small text-muted">Amount due</div>
                    <div className="fs-3 fw-bolder" style={{ color: 'var(--brand, #1f2937)' }}>{fmt(inv.balance_due)}</div>
                  </div>
                </div>

                {(inv.contact_name || inv.organization_name) && (
                  <div className="mb-3">
                    <div className="small text-muted">Billed to</div>
                    <div className="fw-semibold">{inv.contact_name || inv.organization_name}</div>
                    {inv.contact_email && <div className="small text-muted">{inv.contact_email}</div>}
                  </div>
                )}

                <div className="table-responsive">
                  <table className="table align-middle">
                    <thead>
                      <tr>
                        <th>Description</th>
                        <th className="text-end">Qty</th>
                        <th className="text-end">Unit</th>
                        <th className="text-end">Amount</th>
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
                    </tbody>
                  </table>
                </div>

                <div className="d-flex justify-content-end">
                  <div style={{ width: '100%', maxWidth: 320 }}>
                    <div className="d-flex justify-content-between"><span>Subtotal</span><strong>{fmt(inv.subtotal)}</strong></div>
                    {Number(inv.discount_amount) > 0 && (
                      <div className="d-flex justify-content-between"><span>Discount</span><strong>−{fmt(inv.discount_amount)}</strong></div>
                    )}
                    {Number(inv.tax_amount) > 0 && (
                      <div className="d-flex justify-content-between"><span>Tax ({Number(inv.tax_rate)}%)</span><strong>{fmt(inv.tax_amount)}</strong></div>
                    )}
                    <hr className="my-2" />
                    <div className="d-flex justify-content-between fs-5"><span>Total</span><strong>{fmt(inv.total)}</strong></div>
                    {Number(inv.amount_paid) > 0 && (
                      <div className="d-flex justify-content-between text-success"><span>Paid</span><strong>{fmt(inv.amount_paid)}</strong></div>
                    )}
                    <div className="d-flex justify-content-between fs-5 fw-bolder" style={{ color: paid ? '#198754' : 'var(--brand, #1f2937)' }}>
                      <span>Balance Due</span><strong>{fmt(inv.balance_due)}</strong>
                    </div>
                  </div>
                </div>

                {inv.memo && (
                  <div className="alert alert-light mt-4 mb-0 small">
                    <strong>Note:</strong> {inv.memo}
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="col-12 col-md-5">
            <div className="card shadow-sm sticky-top" style={{ top: 16 }}>
              <div className="card-body p-4">
                {paid ? (
                  <div className="text-center py-3">
                    <iconify-icon icon="solar:check-circle-bold-duotone" style={{ fontSize: 64, color: '#198754' }}></iconify-icon>
                    <h4 className="mt-3 mb-1">Paid in full</h4>
                    <p className="text-muted">Thank you — your payment has been received.</p>
                    {latest_payment?.receipt_token && (
                      <div className="d-grid gap-2 mt-4">
                        <a
                          href={`/api/payments/public/receipt/by-token/${latest_payment.receipt_token}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="btn btn-outline-primary"
                        >
                          <iconify-icon icon="solar:document-text-line-duotone" class="me-2"></iconify-icon>
                          View Receipt
                        </a>
                        <a
                          href={`/api/payments/public/receipt/by-token/${latest_payment.receipt_token}.pdf`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="btn btn-outline-secondary"
                        >
                          <iconify-icon icon="solar:file-download-line-duotone" class="me-2"></iconify-icon>
                          Download PDF
                        </a>
                        <EmailReceiptButton receiptToken={latest_payment.receipt_token} defaultEmail={inv.contact_email || ''} />
                      </div>
                    )}
                  </div>
                ) : (
                  <>
                    <h5 className="fw-bolder mb-2">Pay this invoice</h5>
                    <p className="text-muted small">
                      Pay securely with your credit card. Your card information is entered directly
                      into our payment processor — it never touches our server.
                    </p>

                    {!checkout && !starting && (
                      <button className="btn btn-lg w-100" style={{ background: 'var(--secondary, #4b5563)', color: 'var(--brand, #1f2937)' }} onClick={startCheckout}>
                        <iconify-icon icon="solar:card-line-duotone" class="me-2"></iconify-icon>
                        Pay {fmt(inv.balance_due)}
                      </button>
                    )}

                    {starting && <div className="text-center text-muted py-3">Starting secure checkout…</div>}

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

                        {checkout.gateway === 'valor' && !paymentResult && (
                          <PassagePaymentForm
                            invoiceId={invoiceId}
                            chargeAmount={checkout.charge_amount ?? inv.balance_due}
                            currency="USD"
                            onSuccess={(result) => {
                              setPaymentResult({ outcome: 'success', ...result });
                              load();
                            }}
                            onDeclined={({ message }) => {
                              setPaymentResult({ outcome: 'declined', message });
                            }}
                            onCancel={() => setCheckout(null)}
                          />
                        )}

                        {checkout.gateway === 'valor' && paymentResult?.outcome === 'declined' && (
                          <div className="mt-2">
                            <div className="alert alert-danger d-flex align-items-start gap-2 mb-3">
                              <iconify-icon icon="solar:danger-triangle-line-duotone" class="fs-5 flex-shrink-0 mt-1"></iconify-icon>
                              <div>
                                <div className="fw-semibold">Payment declined</div>
                                <div className="small">{paymentResult.message}</div>
                              </div>
                            </div>
                            <button
                              className="btn btn-outline-primary w-100"
                              onClick={() => setPaymentResult(null)}
                            >
                              Try again
                            </button>
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
                              style={{ width: '100%', minHeight: 640, border: '1px solid #e5e7eb', borderRadius: 8 }}
                              allow="payment"
                            />
                          </>
                        )}

                        {/* Fallback confirm — needed on localhost where the gateway's
                            IPN webhook can't reach back to us. Harmless in prod:
                            the polling loop will have already flipped the invoice
                            to paid by the time anyone clicks this. */}
                        <div className="mt-3 pt-3 border-top">
                          <div className="small text-muted mb-2">
                            After completing payment in the form above, click below if this
                            page doesn't update on its own.
                          </div>
                          <button
                            className="btn btn-outline-success w-100"
                            onClick={confirmManually}
                            disabled={confirming}
                          >
                            {confirming ? 'Confirming…' : "I've completed payment"}
                          </button>
                          {confirmError && (
                            <div className="alert alert-danger mt-2 mb-0 small">{confirmError}</div>
                          )}
                        </div>
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
    </div>
  );
}
