// =============================================================================
// VaultCardSaveForm — admin card tokenization + vault save.
//
// Flow:
//   Step 1 — Enter card via gateway form (Passage.js iframe or Accept.js fields)
//   Step 2 — Gateway tokenizes; last4 / brand / expiry come from the response.
//            The entry form hides and a read-only card chip appears.
//   Step 3 — User adds optional nickname / sets default / clicks Save.
//
// Card metadata (last4, brand, expiry) is NEVER collected via manual inputs —
// it always comes from the gateway tokenization response.
// =============================================================================
import { useEffect, useRef, useState } from 'react';
import api from '../../api/client.js';

// Detect brand from the leading digits of a card number string.
function detectBrand(num) {
  const n = String(num).replace(/\D/g, '');
  if (/^4/.test(n))                          return 'visa';
  if (/^5[1-5]/.test(n) || /^2[2-7]/.test(n)) return 'mastercard';
  if (/^3[47]/.test(n))                      return 'amex';
  if (/^6(?:011|5)/.test(n))                 return 'discover';
  return '';
}

// Read-only pill shown after successful tokenization.
function TokenizedCard({ last4, brand, expiry, onReset }) {
  const label = [
    brand ? brand.charAt(0).toUpperCase() + brand.slice(1) : 'Card',
    last4 ? `**** ${last4}` : '',
    expiry ? `· exp ${expiry}` : '',
  ].filter(Boolean).join(' ');

  return (
    <div className="d-flex align-items-center justify-content-between border rounded px-3 py-2 mb-3 bg-light">
      <div className="d-flex align-items-center gap-2">
        <iconify-icon icon="solar:card-line-duotone" style={{ fontSize: 22, color: 'var(--secondary)' }}></iconify-icon>
        <span className="fw-semibold small">{label}</span>
        <span className="badge bg-success-subtle text-success small">Tokenized</span>
      </div>
      <button type="button" className="btn btn-sm btn-link text-muted p-0" onClick={onReset} title="Re-enter card">
        Change
      </button>
    </div>
  );
}

export default function VaultCardSaveForm({ contactId, organizationId, onSaved, onCancel }) {
  const [gw,            setGw]           = useState(null);  // 'valor' | 'authnet'
  const [gwLoading,     setGwLoading]    = useState(true);
  const [error,         setError]        = useState('');
  const [saving,        setSaving]       = useState(false);

  // Valor
  const [clientToken,   setClientToken]  = useState(null);
  const [epi,           setEpi]          = useState(null);
  const [valMode,       setValMode]      = useState('sandbox');

  // Auth.net
  const [authLoginId,   setAuthLoginId]  = useState('');
  const [authClientKey, setAuthClientKey]= useState('');
  const [authMode,      setAuthMode]     = useState('sandbox');
  const [tokenizing,    setTokenizing]   = useState(false);

  // Card fields (Auth.net entry — local refs, never stored as state)
  const cardNumRef  = useRef(null);
  const expRef      = useRef(null);
  const cvvRef      = useRef(null);

  // Post-tokenization state (both gateways)
  const [tokenized, setTokenized] = useState(null);
  // tokenized = { card_token?, opaque_data?, last4, brand, expiry }

  // Nickname / metadata
  const [cardholder, setCardholder] = useState('');
  const [nickname,   setNickname]   = useState('');
  const [isDefault,  setIsDefault]  = useState(false);

  // ACH — Valor only (see PassageCardForm.jsx for the full explanation of
  // why a payment_intents row has to exist before this iframe loads).
  const [achEnabled, setAchEnabled] = useState(false);
  const [achAuthText, setAchAuthText] = useState('');
  const [intentId, setIntentId] = useState(null);

  // ── Step 1: detect gateway ─────────────────────────────────────────────────
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const [{ data }, { data: intentData }] = await Promise.all([
          api.get('/vault/client-token'),
          api.post('/vault/intent', { contact_id: contactId || null, organization_id: organizationId || null }),
        ]);
        if (!mounted) return;
        setGw('valor');
        setClientToken(data.clientToken);
        setEpi(data.epi);
        setValMode(data.mode || 'sandbox');
        setAchEnabled(!!data.achEnabled);
        setAchAuthText(data.achAuthorizationText || '');
        setIntentId(intentData.intentId);
      } catch (_) {
        // Valor not active — check for authnet via settings
        try {
          const { data: s } = await api.get('/settings/payment-gateway');
          if (!mounted) return;
          const active = (s.gateways || []).find((g) => g.is_active && g.is_default)
                      || (s.gateways || []).find((g) => g.is_active);
          if (active?.gateway === 'authnet') {
            setGw('authnet');
            setAuthLoginId(active.api_login_id || '');
            setAuthClientKey(active.client_key  || '');
            setAuthMode(active.mode || 'sandbox');
          } else {
            setError('No active payment gateway configured. Configure one in Settings → Integrations.');
          }
        } catch (e2) {
          if (mounted) setError(e2.response?.data?.error || 'Could not load gateway config.');
        }
      } finally {
        if (mounted) setGwLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, []);

  // ── Step 2a: Valor — listen for PASSAGE_TOKEN ──────────────────────────────
  useEffect(() => {
    if (gw !== 'valor') return;
    function handle(event) {
      const msg = event.data;
      if (!msg || typeof msg !== 'object') return;
      if (msg.type === 'PASSAGE_TOKEN') {
        setTokenized({
          card_token: msg.card_token,
          last4:      msg.last4      || '',
          brand:      msg.card_brand || '',
          expiry:     msg.expiry     || '',
        });
        setError('');
      }
      if (msg.type === 'PASSAGE_ERROR') {
        setError(msg.error || 'Card form error.');
      }
      // ACH — completes server-side in one shot (see header comment), so
      // there's no separate tokenize-then-Save step the way card has.
      if (msg.type === 'PASSAGE_ACH_SUBMITTING') { setSaving(true); setError(''); }
      if (msg.type === 'PASSAGE_ACH_RESULT') {
        setSaving(false);
        if (msg.status === 'captured') onSaved();
        else setError(msg.error || 'Failed to save payment method.');
      }
    }
    window.addEventListener('message', handle);
    return () => window.removeEventListener('message', handle);
  }, [gw, onSaved]);

  // ── Step 2b: Auth.net — load Accept.js script ─────────────────────────────
  useEffect(() => {
    if (gw !== 'authnet') return;
    const src = authMode === 'live'
      ? 'https://js.authorize.net/v1/Accept.js'
      : 'https://jstest.authorize.net/v1/Accept.js';
    if (!document.getElementById('authnet-accept-js')) {
      const s = document.createElement('script');
      s.id = 'authnet-accept-js'; s.src = src; s.charset = 'utf-8';
      document.head.appendChild(s);
    }
  }, [gw, authMode]);

  function tokenizeAuthnet() {
    if (!window.Accept) { setError('Accept.js not loaded yet — please wait a moment.'); return; }
    const rawNum = cardNumRef.current?.value?.replace(/\D/g, '') || '';
    const rawExp = expRef.current?.value  || '';
    const rawCvv = cvvRef.current?.value  || '';

    if (!rawNum || rawNum.length < 13) { setError('Enter a valid card number.'); return; }
    if (!rawExp.includes('/'))         { setError('Enter expiry as MM/YY.'); return; }
    if (!rawCvv)                       { setError('Enter the CVV.'); return; }

    // Capture display values BEFORE Accept.js clears the DOM fields
    const capturedLast4  = rawNum.slice(-4);
    const capturedBrand  = detectBrand(rawNum);
    const [mo, yr]       = rawExp.split('/');
    const capturedExpiry = mo && yr ? `${mo.padStart(2,'0')}/${yr.slice(-2)}` : rawExp;

    setTokenizing(true); setError('');
    window.Accept.dispatchData(
      {
        authData: { apiLoginID: authLoginId, clientKey: authClientKey },
        cardData: {
          cardNumber: rawNum,
          month:      mo?.padStart(2, '0') || '',
          year:       yr?.length === 2 ? `20${yr}` : yr || '',
          cardCode:   rawCvv,
        },
      },
      (response) => {
        setTokenizing(false);
        if (response.messages.resultCode === 'Error') {
          setError(response.messages.message.map((m) => m.text).join(' '));
        } else {
          setTokenized({
            opaque_data: response.opaqueData,
            last4:       capturedLast4,
            brand:       capturedBrand,
            expiry:      capturedExpiry,
          });
        }
      }
    );
  }

  // ── Step 3: Save ───────────────────────────────────────────────────────────
  async function handleSave() {
    if (!tokenized) { setError('Tokenize the card first.'); return; }
    setSaving(true); setError('');
    try {
      const body = {
        gateway:         gw,
        cardholder_name: cardholder || null,
        last4:           tokenized.last4  || null,
        card_brand:      tokenized.brand  || null,
        expiry:          tokenized.expiry || null,
        nickname:        nickname         || null,
        is_default:      isDefault,
        contact_id:      contactId        || null,
        organization_id: organizationId   || null,
      };
      if (gw === 'valor')   body.card_token          = tokenized.card_token;
      if (gw === 'authnet') body.authnet_opaque_data = JSON.stringify(tokenized.opaque_data);

      await api.post('/vault/save-card', body);
      onSaved();
    } catch (e) {
      setError(e.response?.data?.error || 'Failed to save card');
    } finally { setSaving(false); }
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  if (gwLoading) {
    return (
      <div className="text-muted small py-3 text-center">
        <span className="spinner-border spinner-border-sm me-2"></span>
        Loading payment form…
      </div>
    );
  }
  if (!gw) {
    return <div className="alert alert-warning py-2 small">{error}</div>;
  }

  const apiOrigin = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');
  const achFormAction = (achEnabled && intentId)
    ? encodeURIComponent(`${apiOrigin}/api/payments/public/vault-ach/${intentId}`)
    : '';
  const iframeSrc = gw === 'valor' && clientToken
    ? `/passage-save-card.html?clientToken=${encodeURIComponent(clientToken)}&epi=${encodeURIComponent(epi || '')}&mode=${valMode}&enableACH=${achFormAction ? '1' : '0'}&achFormAction=${achFormAction}`
    : null;

  return (
    <div>
      {/* Cardholder name — always shown */}
      <div className="mb-3">
        <label className="form-label fw-semibold small">Cardholder name <span className="text-muted fw-normal">(optional)</span></label>
        <input
          type="text"
          className="form-control"
          placeholder="Name on card"
          value={cardholder}
          onChange={(e) => setCardholder(e.target.value)}
        />
      </div>

      {/* ── Valor: Passage.js iframe (hidden once tokenized) ── */}
      {gw === 'valor' && !tokenized && (
        iframeSrc ? (
          <div className="border rounded overflow-hidden mb-3" style={{ height: 400 }}>
            <iframe
              src={iframeSrc}
              title="Secure card entry"
              width="100%" height={400}
              frameBorder="0" scrolling="no"
              style={{ display: 'block', border: 'none' }}
            />
          </div>
        ) : (
          <div className="text-muted small py-3 text-center">
            <span className="spinner-border spinner-border-sm me-2"></span>Loading card form…
          </div>
        )
      )}
      {gw === 'valor' && !tokenized && achFormAction && achAuthText && (
        <p className="small text-muted mb-3">{achAuthText}</p>
      )}

      {/* ── Auth.net: Accept.js fields (hidden once tokenized) ── */}
      {gw === 'authnet' && !tokenized && (
        <div className="border rounded p-3 mb-3">
          <div className="row g-2">
            <div className="col-12">
              <label className="form-label small">Card number</label>
              <input ref={cardNumRef} type="tel" className="form-control" placeholder="•••• •••• •••• ••••" maxLength={19} />
            </div>
            <div className="col-6">
              <label className="form-label small">Expiry (MM/YY)</label>
              <input ref={expRef} type="text" className="form-control" placeholder="MM/YY" maxLength={5} />
            </div>
            <div className="col-6">
              <label className="form-label small">CVV</label>
              <input ref={cvvRef} type="tel" className="form-control" placeholder="•••" maxLength={4} />
            </div>
          </div>
          <button
            type="button"
            className="btn btn-sm btn-outline-primary mt-3"
            disabled={tokenizing}
            onClick={tokenizeAuthnet}
          >
            {tokenizing
              ? <><span className="spinner-border spinner-border-sm me-2"></span>Tokenizing…</>
              : 'Tokenize card'}
          </button>
          <div className="text-muted mt-2" style={{ fontSize: 11 }}>
            <iconify-icon icon="solar:shield-check-line-duotone" class="me-1"></iconify-icon>
            Card data is encrypted by Authorize.Net Accept.js — it never touches this server.
          </div>
        </div>
      )}

      {/* ── Post-tokenization: read-only card chip ── */}
      {tokenized && (
        <TokenizedCard
          last4={tokenized.last4}
          brand={tokenized.brand}
          expiry={tokenized.expiry}
          onReset={() => setTokenized(null)}
        />
      )}

      {/* Nickname + default — shown once tokenized */}
      {tokenized && (
        <>
          <div className="mb-3">
            <label className="form-label small">Nickname <span className="text-muted">(optional)</span></label>
            <input
              type="text"
              className="form-control"
              placeholder="e.g. Company Visa"
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
            />
          </div>
          <div className="form-check mb-3">
            <input
              type="checkbox" className="form-check-input"
              id="vault-save-default"
              checked={isDefault}
              onChange={(e) => setIsDefault(e.target.checked)}
            />
            <label className="form-check-label small" htmlFor="vault-save-default">
              Set as default payment method
            </label>
          </div>
        </>
      )}

      {error && <div className="alert alert-danger py-2 small mt-2">{error}</div>}

      <div className="d-flex gap-2 mt-3">
        {tokenized && (
          <button className="btn btn-primary btn-sm" disabled={saving} onClick={handleSave}>
            {saving
              ? <><span className="spinner-border spinner-border-sm me-2"></span>Saving…</>
              : 'Save card'}
          </button>
        )}
        <button className="btn btn-light btn-sm" onClick={onCancel} disabled={saving}>Cancel</button>
      </div>

      <div className="text-muted mt-2" style={{ fontSize: 11 }}>
        <iconify-icon icon="solar:lock-keyhole-line-duotone" class="me-1"></iconify-icon>
        PCI SAQ-A compliant · tokenized by {gw === 'valor' ? 'Valor PayTech' : 'Authorize.Net'}
      </div>
    </div>
  );
}
