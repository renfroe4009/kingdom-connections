// MembershipCheckout — vaults the card and signs up for a membership tier in
// one step. Identical Passage.js vault-save flow as DonationRecurringCheckout
// (same static passage-save-card.html iframe). Card tokenizes in-browser
// (Passage.js's tokenReceived event) and posts to /api/membership/public/signup
// directly. ACH does a real, uncontrollable browser form POST instead — it
// can't carry tierSlug/donor the way tokenReceived does, so a payment_intents
// row is created via /api/membership/public/signup-intent right before this
// iframe loads, and the ACH form POSTs straight to
// /api/payments/public/vault-ach/:intentId, which completes the whole signup
// server-side (vault the account, charge the first cycle, create the
// subscription) before relaying the result back here.
//
// Props:
//   signup     { tierSlug, donor }
//   onSuccess  fn(result)
//   onError    fn(message)
//   onCancel   fn()

import { useEffect, useState } from 'react';
import api from '../../api/client.js';

export default function MembershipCheckout({ signup, onSuccess, onError, onCancel }) {
  const [clientToken, setClientToken] = useState(null);
  const [epi, setEpi] = useState(null);
  const [mode, setMode] = useState('sandbox');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [iframeHeight, setIframeHeight] = useState(480);
  const [unavailable, setUnavailable] = useState(false);
  const [achEnabled, setAchEnabled] = useState(false);
  const [achAuthText, setAchAuthText] = useState('');
  const [intentId, setIntentId] = useState(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      api.get('/payments/public/client-token'),
      api.post('/membership/public/signup-intent', { tier_slug: signup.tierSlug, donor: signup.donor }),
    ])
      .then(([tokenRes, intentRes]) => {
        if (cancelled) return;
        setClientToken(tokenRes.data.clientToken);
        setEpi(tokenRes.data.epi);
        setMode(tokenRes.data.mode || 'sandbox');
        setAchEnabled(!!tokenRes.data.achEnabled);
        setAchAuthText(tokenRes.data.achAuthorizationText || '');
        setIntentId(intentRes.data.intentId);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setUnavailable(true);
        setLoading(false);
      });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    async function handleMessage(event) {
      const msg = event.data;
      if (!msg || typeof msg !== 'object') return;

      if (msg.type === 'PASSAGE_TOKEN') {
        setSaving(true);
        setError('');
        try {
          const { data } = await api.post('/membership/public/signup', {
            tier_slug: signup.tierSlug,
            donor: signup.donor,
            card_token: msg.card_token,
            cardholder_name: msg.cardholder_name || null,
            last4: msg.last4 || null,
            card_brand: msg.card_brand || null,
            expiry: msg.expiry || null,
          });
          onSuccess(data);
        } catch (err) {
          const m = err.response?.data?.error || 'Could not complete your membership signup.';
          setError(m);
          onError?.(m);
        } finally {
          setSaving(false);
        }
      }

      if (msg.type === 'PASSAGE_ERROR') {
        setError(msg.error || 'Payment form error.');
        setSaving(false);
      }

      // ACH result — comes back from the server-rendered HTML page that the
      // Passage.js form POSTs to (/payments/public/vault-ach/:intentId),
      // which relays via postMessage since the form navigates here.
      if (msg.type === 'PASSAGE_ACH_SUBMITTING') { setSaving(true); setError(''); }
      if (msg.type === 'PASSAGE_ACH_RESULT') {
        setSaving(false);
        // ACH settles over 1-3 business days rather than approving instantly
        // — 'pending' means the debit was accepted and is processing.
        if (msg.status === 'captured' || msg.status === 'pending') {
          onSuccess(msg);
        } else {
          const m = msg.error || 'Could not complete your membership signup.';
          setError(m);
          onError?.(m);
        }
      }

      if (msg.type === 'PASSAGE_HEIGHT' && msg.height > 0) {
        setIframeHeight(Math.max(480, msg.height + 16));
      }
    }

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signup]);

  const apiOrigin = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');
  const achFormAction = (achEnabled && intentId)
    ? encodeURIComponent(`${apiOrigin}/api/payments/public/vault-ach/${intentId}`)
    : '';
  const iframeSrc = clientToken
    ? `/passage-save-card.html?clientToken=${encodeURIComponent(clientToken)}&epi=${encodeURIComponent(epi || '')}&mode=${mode}&enableACH=${achFormAction ? '1' : '0'}&achFormAction=${achFormAction}`
    : null;

  if (unavailable) {
    return (
      <div className="alert alert-warning py-2 small">
        Online membership signup isn't available right now — please call us to join.
      </div>
    );
  }

  return (
    <div>
      {loading && (
        <div className="text-center py-3 text-muted">
          <div className="spinner-border spinner-border-sm me-2"></div>
          Loading secure card form…
        </div>
      )}

      {error && <div className="alert alert-danger py-2 small">{error}</div>}

      {!loading && (
        <>
          <div className="border rounded overflow-hidden" style={{ height: iframeHeight, position: 'relative' }}>
            {saving && (
              <div style={{
                position: 'absolute', inset: 0, background: 'rgba(255,255,255,0.85)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10,
              }}>
                <div className="text-center">
                  <div className="spinner-border text-primary mb-2"></div>
                  <div className="small text-muted">Setting up your membership…</div>
                </div>
              </div>
            )}
            <iframe
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
          {achFormAction && achAuthText && (
            <p className="small text-muted mt-2 mb-0">{achAuthText}</p>
          )}
        </>
      )}

      <div className="d-flex justify-content-end mt-3">
        <button className="btn btn-light btn-sm" onClick={onCancel} disabled={saving}>
          Cancel
        </button>
      </div>
    </div>
  );
}
