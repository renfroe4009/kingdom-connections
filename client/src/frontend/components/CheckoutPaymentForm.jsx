// CheckoutPaymentForm — reuses the generic /passage-pay.html iframe (same one
// the billing module's PassagePaymentForm uses) but talks to the commerce
// checkout endpoints instead of the invoice ones. Card and ACH complete
// differently: card tokenizes in-browser (Passage.js's tokenReceived event),
// so we hand the token back to the parent (CheckoutPage) to POST to
// /checkout/complete alongside the shipping/contact fields. ACH does a real,
// uncontrollable browser form POST straight to /checkout/public/ach-complete/:intentId
// instead — the parent's checkout fields were already saved server-side as a
// payment_intents row (via /checkout/public/intent) before this iframe ever
// loaded, since Passage's ACH sub-form only ever submits its own bank fields.
//
// Props:
//   intentId    int|null — payment_intents id from /checkout/public/intent
//   onToken     fn({ card_token, ... }) — card path
//   onAchResult fn({ status, order_number, ... }) — ACH path (order/charge
//               already completed server-side by the time this fires)
//   disabled    bool
import { useEffect, useState } from 'react';
import api from '../../api/client.js';

export default function CheckoutPaymentForm({ intentId, onToken, onAchResult, disabled }) {
  const [clientToken, setClientToken] = useState(null);
  const [epi, setEpi] = useState(null);
  const [mode, setMode] = useState('sandbox');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [iframeHeight, setIframeHeight] = useState(480);
  const [achEnabled, setAchEnabled] = useState(false);
  const [achAuthText, setAchAuthText] = useState('');
  const [achProcessing, setAchProcessing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api.get('/checkout/client-token')
      .then(({ data }) => {
        if (cancelled) return;
        setClientToken(data.clientToken);
        setEpi(data.epi);
        setMode(data.mode || 'sandbox');
        setAchEnabled(!!data.achEnabled);
        setAchAuthText(data.achAuthorizationText || '');
      })
      .catch((err) => setError(err.response?.data?.error || 'Could not load payment form.'))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    function handleMessage(event) {
      const msg = event.data;
      if (!msg || typeof msg !== 'object') return;
      if (msg.type === 'PASSAGE_TOKEN') {
        onToken({
          card_token: msg.card_token,
          cardholder_name: msg.cardholder_name || null,
          last4: msg.last4 || null,
          card_brand: msg.card_brand || null,
        });
      }
      if (msg.type === 'PASSAGE_ERROR') { setError(msg.error || 'Payment form error.'); setAchProcessing(false); }
      if (msg.type === 'PASSAGE_HEIGHT' && msg.height > 0) setIframeHeight(Math.max(480, msg.height + 16));

      // ACH result — comes back from the server-rendered HTML page that the
      // Passage.js form POSTs to (/checkout/public/ach-complete/:intentId),
      // which uses postMessage to relay the result since the form navigates
      // the iframe there.
      if (msg.type === 'PASSAGE_ACH_SUBMITTING') { setAchProcessing(true); setError(''); }
      if (msg.type === 'PASSAGE_ACH_RESULT') {
        setAchProcessing(false);
        // ACH settles over 1-3 business days rather than approving instantly
        // — 'pending' means the debit was accepted and is processing, not
        // that anything failed.
        if (msg.status === 'captured' || msg.status === 'pending') {
          onAchResult?.(msg);
        } else {
          setError(msg.error || 'ACH payment could not be processed.');
        }
      }
    }
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [onToken, onAchResult]);

  const apiOrigin = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');
  // ACH only makes sense once a payment_intents row exists to complete
  // against (see the header comment) — if the parent hasn't created one yet,
  // fall back to card-only exactly like before.
  const achFormAction = (achEnabled && intentId)
    ? encodeURIComponent(`${apiOrigin}/api/checkout/public/ach-complete/${intentId}`)
    : '';
  const iframeSrc = clientToken
    ? `/passage-pay.html?clientToken=${encodeURIComponent(clientToken)}&epi=${encodeURIComponent(epi || '')}&mode=${mode}&apiOrigin=${encodeURIComponent(apiOrigin)}&enableACH=${achFormAction ? '1' : '0'}&achFormAction=${achFormAction}`
    : null;

  if (loading) return <div className="text-center py-3 text-muted"><span className="spinner-border spinner-border-sm me-2" />Loading secure card form…</div>;
  if (error) return <div className="alert alert-danger py-2 small">{error}</div>;

  return (
    <div>
      <div className="border rounded overflow-hidden" style={{ height: iframeHeight, position: 'relative', opacity: disabled ? 0.5 : 1, pointerEvents: disabled ? 'none' : 'auto' }}>
        {achProcessing && (
          <div style={{
            position: 'absolute', inset: 0, background: 'rgba(255,255,255,0.85)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10,
          }}>
            <div className="text-center">
              <div className="spinner-border text-primary mb-2"></div>
              <div className="small text-muted">Processing ACH payment…</div>
            </div>
          </div>
        )}
        <iframe src={iframeSrc} title="Secure card entry" width="100%" height={iframeHeight} frameBorder="0" scrolling="no" style={{ display: 'block', border: 'none' }} />
      </div>
      <div className="d-flex align-items-center gap-2 mt-2">
        <iconify-icon icon="solar:shield-check-line-duotone" class="text-success fs-5"></iconify-icon>
        <span className="small text-muted">Card data is tokenized by Valor PayTech and never touches our servers.</span>
      </div>
      {achFormAction && achAuthText && (
        <p className="small text-muted mt-2 mb-0">{achAuthText}</p>
      )}
    </div>
  );
}
