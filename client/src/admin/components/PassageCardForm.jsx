// PassageCardForm — embeds passage-save-card.html in an iframe, listens for
// the PASSAGE_TOKEN postMessage, then calls /api/vault/save-card to store the
// vault profile.  Calls onSaved({ profile }) when complete, onCancel to close.
//
// ACH does a real, uncontrollable browser form POST instead of card's
// tokenReceived event — it can't carry contactId/organizationId/nickname the
// way tokenReceived lets us hand them off directly. A payment_intents row is
// created via POST /api/vault/intent right when this component loads (so the
// nickname typed in below only reliably applies to a card save — an ACH save
// completes off whatever nickname was in the intent at that moment), and the
// ACH form POSTs straight to /api/payments/public/vault-ach/:intentId, which
// vaults the account server-side before relaying the result back here.
//
// Props:
//   contactId      int | null
//   organizationId int | null
//   onSaved        fn({ id, gateway, last4, card_brand, cardholder_name })
//   onCancel       fn()
//   defaultNickname string (optional)

import { useEffect, useRef, useState } from 'react';
import api from '../../api/client.js';

export default function PassageCardForm({ contactId, organizationId, onSaved, onCancel, defaultNickname }) {
  const iframeRef = useRef(null);
  const [clientToken, setClientToken] = useState(null);
  const [epi, setEpi] = useState(null);
  const [mode, setMode] = useState('sandbox');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [nickname, setNickname] = useState(defaultNickname || '');
  const [iframeHeight, setIframeHeight] = useState(480);
  const [achEnabled, setAchEnabled] = useState(false);
  const [achAuthText, setAchAuthText] = useState('');
  const [intentId, setIntentId] = useState(null);

  // Step 1 — fetch a Passage.js clientToken from our server, and (in
  // parallel) create the payment_intents row the ACH path needs.
  useEffect(() => {
    let cancelled = false;
    Promise.all([
      api.get('/vault/client-token', { params: { gateway: 'valor' } }),
      api.post('/vault/intent', { contact_id: contactId || null, organization_id: organizationId || null, nickname: nickname || null }),
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
      .catch((err) => {
        if (cancelled) return;
        setError(err.response?.data?.error || 'Could not load payment form. Check gateway configuration.');
        setLoading(false);
      });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Step 2 — listen for postMessage from the passage-save-card.html iframe.
  useEffect(() => {
    async function handleMessage(event) {
      const msg = event.data;
      if (!msg || typeof msg !== 'object') return;

      if (msg.type === 'PASSAGE_TOKEN') {
        setSaving(true);
        setError('');
        try {
          const { data } = await api.post('/vault/save-card', {
            gateway:         'valor',
            card_token:      msg.card_token,
            cardholder_name: msg.cardholder_name || null,
            last4:           msg.last4           || null,
            card_brand:      msg.card_brand      || null,
            expiry:          msg.expiry          || null,
            payment_method:  msg.payment_method  || 'card',
            contact_id:      contactId      || null,
            organization_id: organizationId || null,
            nickname:        nickname        || null,
            is_default:      false,
          });
          onSaved(data);
        } catch (saveErr) {
          setError(saveErr.response?.data?.error || 'Failed to save payment method.');
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
        if (msg.status === 'captured') {
          onSaved(msg);
        } else {
          setError(msg.error || 'Failed to save payment method.');
        }
      }

      if (msg.type === 'PASSAGE_HEIGHT' && msg.height > 0) {
        setIframeHeight(Math.max(480, msg.height + 16));
      }
    }

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [contactId, organizationId, nickname, onSaved]);

  // Build the iframe src once we have the token.
  const apiOrigin = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');
  const achFormAction = (achEnabled && intentId)
    ? encodeURIComponent(`${apiOrigin}/api/payments/public/vault-ach/${intentId}`)
    : '';
  const iframeSrc = clientToken
    ? `/passage-save-card.html?clientToken=${encodeURIComponent(clientToken)}&epi=${encodeURIComponent(epi || '')}&mode=${mode}&enableACH=${achFormAction ? '1' : '0'}&achFormAction=${achFormAction}`
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
          <div className="mb-3">
            <label htmlFor="vault-nickname" className="form-label small fw-semibold">Nickname (optional)</label>
            <input
              id="vault-nickname"
              name="vault-nickname"
              className="form-control form-control-sm"
              placeholder="e.g. Corp Visa, Personal Amex"
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
            />
            <div className="form-text">Helps identify this card in the list.</div>
          </div>

          <div className="border rounded overflow-hidden" style={{ height: iframeHeight, position: 'relative' }}>
            {saving && (
              <div style={{
                position: 'absolute', inset: 0, background: 'rgba(255,255,255,0.85)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10,
              }}>
                <div className="text-center">
                  <div className="spinner-border text-primary mb-2"></div>
                  <div className="small text-muted">Saving payment method…</div>
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
