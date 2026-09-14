// PassagePaymentForm — embeds passage-pay.html in an iframe, listens for the
// PASSAGE_TOKEN postMessage, then calls /api/payments/public/charge/:invoiceId
// to charge the card inline (no redirect to Valor's hosted page).
//
// Props:
//   invoiceId     int    — the invoice being paid
//   onSuccess     fn({ status, txnId, last4, brand, amount }) — approved
//   onDeclined    fn({ message }) — declined
//   onCancel      fn()
//   chargeAmount  number — display only (actual charge computed server-side)
//   currency      string — default 'USD'

import { useEffect, useRef, useState } from 'react';
// Use the shared api client so VITE_API_URL is respected in production.
// On the public pay page there's no token so no auth header is added;
// on CRM pages the auth token is sent but public endpoints ignore it.
import api from '../api/client.js';

export default function PassagePaymentForm({
  invoiceId,
  onSuccess,
  onDeclined,
  onCancel,
  chargeAmount,
  currency = 'USD',
}) {
  const iframeRef                       = useRef(null);
  const [clientToken, setClientToken]   = useState(null);
  const [epi, setEpi]                   = useState(null);
  const [mode, setMode]                 = useState('sandbox');
  const [loading, setLoading]           = useState(true);
  const [charging, setCharging]         = useState(false);
  const [error, setError]               = useState('');
  const [iframeHeight, setIframeHeight] = useState(480);
  const [achEnabled, setAchEnabled]     = useState(false);
  const [achAuthText, setAchAuthText]   = useState('');

  // Step 1 — fetch a Passage.js clientToken from our server.
  useEffect(() => {
    let cancelled = false;
    api.get('/payments/public/client-token')
      .then(({ data }) => {
        if (cancelled) return;
        setClientToken(data.clientToken);
        setEpi(data.epi);
        setMode(data.mode || 'sandbox');
        setAchEnabled(!!data.achEnabled);
        setAchAuthText(data.achAuthorizationText || '');
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err.response?.data?.error || 'Could not load payment form. Check gateway configuration.');
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  // Step 2 — listen for postMessage from the passage-pay.html iframe.
  useEffect(() => {
    async function handleMessage(event) {
      const msg = event.data;
      if (!msg || typeof msg !== 'object') return;

      if (msg.type === 'PASSAGE_TOKEN') {
        setCharging(true);
        setError('');
        try {
          const { data } = await api.post(
            `/payments/public/charge/${invoiceId}`,
            {
              card_token:      msg.card_token,
              cardholder_name: msg.cardholder_name || null,
              last4:           msg.last4           || null,
              card_brand:      msg.card_brand      || null,
              expiry:          msg.expiry          || null,
            },
          );

          if (data.status === 'captured') {
            // Include the raw Passage.js card_token alongside the charge result so
            // a caller can optionally save it to vault_profiles via POST
            // /vault/save-card afterward (same token Valor accepts for both a
            // charge and a vault add — see donations.js's /public/recurring,
            // which uses the identical token for both calls).
            onSuccess({
              ...data,
              card_token:      msg.card_token,
              cardholder_name: msg.cardholder_name || null,
              last4:           msg.last4           || data.last4 || null,
              card_brand:      msg.card_brand       || data.brand || null,
              expiry:          msg.expiry           || null,
            });
          } else {
            // status === 'failed' or anything else
            onDeclined({ message: data.processor_message || 'Payment declined' });
          }
        } catch (chargeErr) {
          const msg = chargeErr.response?.data?.error || 'Payment could not be processed.';
          setError(msg);
        } finally {
          setCharging(false);
        }
      }

      if (msg.type === 'PASSAGE_ERROR') {
        setError(msg.error || 'Payment form error.');
        setCharging(false);
      }

      // ACH result — comes back from the server-rendered HTML page that the
      // Passage.js form POSTs to, which uses postMessage to relay the result.
      if (msg.type === 'PASSAGE_ACH_SUBMITTING') {
        setCharging(true);
        setError('');
      }

      if (msg.type === 'PASSAGE_ACH_RESULT') {
        setCharging(false);
        // ACH settles over 1-3 business days rather than approving instantly
        // — 'pending' means the debit was accepted and is processing, not
        // that anything failed (Valor's webhook confirms it later).
        if (msg.status === 'captured' || msg.status === 'pending') {
          onSuccess(msg);
        } else {
          setError(msg.error || 'ACH payment could not be processed.');
        }
      }

      if (msg.type === 'PASSAGE_HEIGHT' && msg.height > 0) {
        setIframeHeight(Math.max(480, msg.height + 16));
      }
    }

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [invoiceId, onSuccess, onDeclined]);

  // Build the iframe src once we have the token.
  // Pass invoiceId so passage-pay.html can set formAction for ACH POST, and
  // apiOrigin so that POST targets the API host — on a split client/API
  // deployment (Vercel + Railway) window.location.origin inside the iframe
  // is the CLIENT's domain, which has no such route.
  const apiOrigin = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');
  const achFormAction = achEnabled ? encodeURIComponent(`${apiOrigin}/api/payments/public/ach-charge/${invoiceId}`) : '';
  const iframeSrc = clientToken
    ? `/passage-pay.html?clientToken=${encodeURIComponent(clientToken)}&epi=${encodeURIComponent(epi || '')}&mode=${mode}&apiOrigin=${encodeURIComponent(apiOrigin)}&enableACH=${achEnabled ? '1' : '0'}&achFormAction=${achFormAction}`
    : null;

  const fmtAmount = chargeAmount != null
    ? `${currency} ${Number(chargeAmount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : null;

  return (
    <div>
      {loading && (
        <div className="text-center py-3 text-muted">
          <div className="spinner-border spinner-border-sm me-2"></div>
          Loading secure card form…
        </div>
      )}

      {error && (
        <div className="alert alert-danger py-2 small">{error}</div>
      )}

      {!loading && !error && (
        <>
          {fmtAmount && (
            <div className="mb-3 p-3 bg-light rounded d-flex justify-content-between align-items-center">
              <span className="small text-muted fw-semibold">Amount to charge</span>
              <span className="fs-5 fw-bolder" style={{ color: 'var(--brand, #1f2937)' }}>{fmtAmount}</span>
            </div>
          )}

          <div className="border rounded overflow-hidden" style={{ height: iframeHeight, position: 'relative' }}>
            {charging && (
              <div style={{
                position: 'absolute', inset: 0, background: 'rgba(255,255,255,0.85)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10,
              }}>
                <div className="text-center">
                  <div className="spinner-border text-primary mb-2"></div>
                  <div className="small text-muted">Processing payment…</div>
                </div>
              </div>
            )}
            <iframe
              ref={iframeRef}
              src={iframeSrc}
              title="Secure card entry"
              width="100%"
              height={iframeHeight}
              frameBorder="0"
              scrolling="no"
              style={{ display: 'block', border: 'none' }}
            />
          </div>

          <div className="d-flex align-items-center gap-2 mt-2">
            <iconify-icon icon="solar:shield-check-line-duotone" class="text-success fs-5"></iconify-icon>
            <span className="small text-muted">
              Card data is tokenized by Valor PayTech and never touches our servers.
            </span>
          </div>
          {achEnabled && achAuthText && (
            <p className="small text-muted mt-2 mb-0">{achAuthText}</p>
          )}
        </>
      )}

      <div className="d-flex justify-content-end mt-3">
        <button className="btn btn-light btn-sm" onClick={onCancel} disabled={charging}>
          Cancel
        </button>
      </div>
    </div>
  );
}
