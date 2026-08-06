// =============================================================================
// Portal — Payment Methods
// Lets customers see, add, set default, and remove saved cards.
// Uses the portal-scoped vault endpoints (/api/portal/...) only — no admin
// permissions or admin API calls.
// =============================================================================
import { useEffect, useRef, useState } from 'react';
import api from '../../../api/client.js';
import { parseApiError } from '../../../utils/apiError.js';
import { useConfirm } from '../../../hooks/useConfirm.jsx';

const GATEWAY_LABEL = {
  valor:   'Valor PayTech',
  authnet: 'Authorize.Net',
};

const BRAND_ICON = {
  visa:       'solar:card-2-line-duotone',
  mastercard: 'solar:card-2-line-duotone',
  amex:       'solar:card-2-line-duotone',
  discover:   'solar:card-2-line-duotone',
};

function CardBadge({ brand }) {
  const icon = BRAND_ICON[String(brand).toLowerCase()] || 'solar:card-line-duotone';
  return <iconify-icon icon={icon} class="me-1"></iconify-icon>;
}

// ---------------------------------------------------------------------------
// Auth.net Accept.js card-save form (portal-scoped)
// Card details (last4, brand, expiry) come from the tokenize step — no
// manual input fields for those values.
// ---------------------------------------------------------------------------
function detectBrand(num) {
  const n = String(num).replace(/\D/g, '');
  if (/^4/.test(n)) return 'visa';
  if (/^5[1-5]/.test(n) || /^2[2-7]/.test(n)) return 'mastercard';
  if (/^3[47]/.test(n)) return 'amex';
  if (/^6(?:011|5)/.test(n)) return 'discover';
  return '';
}

function AuthnetCardSaveForm({ loginId, clientKey, mode, onSaved, onCancel }) {
  const cardNumRef = useRef(null);
  const expRef     = useRef(null);
  const cvvRef     = useRef(null);

  const [tokenized,  setTokenized]  = useState(null); // { opaque_data, last4, brand, expiry }
  const [tokenizing, setTokenizing] = useState(false);
  const [cardholder, setCardholder] = useState('');
  const [nickname,   setNickname]   = useState('');
  const [isDefault,  setIsDefault]  = useState(false);
  const [saving,     setSaving]     = useState(false);
  const [error,      setError]      = useState('');

  useEffect(() => {
    const src = mode === 'live'
      ? 'https://js.authorize.net/v1/Accept.js'
      : 'https://jstest.authorize.net/v1/Accept.js';
    if (!document.getElementById('authnet-accept-js')) {
      const s = document.createElement('script');
      s.id = 'authnet-accept-js'; s.src = src; s.charset = 'utf-8';
      document.head.appendChild(s);
    }
  }, [mode]);

  function tokenize() {
    if (!window.Accept) { setError('Accept.js not loaded yet — try again in a moment.'); return; }
    const rawNum = cardNumRef.current?.value?.replace(/\D/g, '') || '';
    const rawExp = expRef.current?.value || '';
    const rawCvv = cvvRef.current?.value || '';
    if (!rawNum || rawNum.length < 13) { setError('Enter a valid card number.'); return; }
    if (!rawExp.includes('/'))         { setError('Enter expiry as MM/YY.'); return; }
    if (!rawCvv)                       { setError('Enter the CVV.'); return; }

    const capturedLast4  = rawNum.slice(-4);
    const capturedBrand  = detectBrand(rawNum);
    const [mo, yr]       = rawExp.split('/');
    const capturedExpiry = mo && yr ? `${mo.padStart(2,'0')}/${yr.slice(-2)}` : rawExp;

    setTokenizing(true); setError('');
    window.Accept.dispatchData(
      {
        authData: { apiLoginID: loginId, clientKey },
        cardData: {
          cardNumber: rawNum,
          month:      mo?.padStart(2,'0') || '',
          year:       yr?.length === 2 ? `20${yr}` : yr || '',
          cardCode:   rawCvv,
        },
      },
      (response) => {
        setTokenizing(false);
        if (response.messages.resultCode === 'Error') {
          setError(response.messages.message.map((m) => m.text).join(' '));
        } else {
          setTokenized({ opaque_data: response.opaqueData, last4: capturedLast4, brand: capturedBrand, expiry: capturedExpiry });
        }
      }
    );
  }

  async function handleSave() {
    if (!tokenized) { setError('Tokenize your card first.'); return; }
    setSaving(true); setError('');
    try {
      await api.post('/portal/payment-methods/save-card', {
        gateway: 'authnet',
        authnet_opaque_data: JSON.stringify(tokenized.opaque_data),
        cardholder_name: cardholder || null,
        last4:           tokenized.last4  || null,
        card_brand:      tokenized.brand  || null,
        expiry:          tokenized.expiry || null,
        nickname:        nickname         || null,
        is_default:      isDefault,
      });
      onSaved();
    } catch (e) {
      setError(parseApiError(e, 'Failed to save card'));
    } finally { setSaving(false); }
  }

  return (
    <div>
      <div className="mb-3">
        <label className="form-label fw-semibold small">Cardholder name</label>
        <input type="text" className="form-control" placeholder="Name on card" value={cardholder} onChange={(e) => setCardholder(e.target.value)} />
      </div>

      {/* Card entry — hidden once tokenized */}
      {!tokenized && (
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
          <button type="button" className="btn btn-sm btn-outline-secondary mt-3" disabled={tokenizing} onClick={tokenize}>
            {tokenizing ? <><span className="spinner-border spinner-border-sm me-2"></span>Tokenizing…</> : 'Tokenize card'}
          </button>
        </div>
      )}

      {/* Read-only chip after tokenization */}
      {tokenized && (
        <div className="d-flex align-items-center justify-content-between border rounded px-3 py-2 mb-3 bg-light">
          <div className="d-flex align-items-center gap-2">
            <iconify-icon icon="solar:card-line-duotone" style={{ fontSize: 20, color: 'var(--secondary, #C9A227)' }}></iconify-icon>
            <span className="fw-semibold small">
              {tokenized.brand ? `${tokenized.brand.charAt(0).toUpperCase()}${tokenized.brand.slice(1)} ` : ''}
              **** {tokenized.last4}
              {tokenized.expiry ? ` · exp ${tokenized.expiry}` : ''}
            </span>
            <span className="badge bg-success-subtle text-success" style={{ fontSize: 10 }}>Tokenized</span>
          </div>
          <button type="button" className="btn btn-sm btn-link text-muted p-0" onClick={() => setTokenized(null)}>Change</button>
        </div>
      )}

      {/* Nickname + default — shown after tokenization */}
      {tokenized && (
        <>
          <div className="mb-3">
            <label className="form-label fw-semibold small">Nickname (optional)</label>
            <input type="text" className="form-control" placeholder="e.g. Company Visa" value={nickname} onChange={(e) => setNickname(e.target.value)} />
          </div>
          <div className="form-check mb-3">
            <input type="checkbox" className="form-check-input" id="an-is-default" checked={isDefault} onChange={(e) => setIsDefault(e.target.checked)} />
            <label className="form-check-label small" htmlFor="an-is-default">Set as default payment method</label>
          </div>
        </>
      )}

      {error && <div className="alert alert-danger py-2 small">{error}</div>}
      <div className="d-flex gap-2 mt-3">
        {tokenized && (
          <button className="btn btn-primary" disabled={saving} onClick={handleSave}
            style={{ background: 'var(--secondary, #C9A227)', borderColor: 'var(--secondary, #C9A227)', color: 'var(--brand, #0A1F3D)' }}>
            {saving ? <><span className="spinner-border spinner-border-sm me-2"></span>Saving…</> : 'Save card'}
          </button>
        )}
        <button className="btn btn-light" onClick={onCancel} disabled={saving}>Cancel</button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Inline Valor card-save form
// Embeds the same /passage-save-card.html iframe used by the admin vault
// widget (client/src/components/PassageCardForm.jsx) — Passage.js loads
// inside that isolated frame and posts back a PASSAGE_TOKEN message, rather
// than loading the SDK directly into the portal page. Uses the portal-scoped
// /api/portal/vault/client-token and /api/portal/payment-methods/save-card
// endpoints so no admin permission is needed.
//
// ACH does a real, uncontrollable browser form POST instead of card's
// tokenReceived event — a payment_intents row is created via
// /api/portal/vault/intent right when this form loads (so nickname/is_default
// only reliably apply to a card save, same caveat as the admin widget), and
// the ACH form POSTs straight to /api/payments/public/vault-ach/:intentId,
// which vaults the account server-side before relaying the result back here.
// ---------------------------------------------------------------------------
function PassageCardSaveForm({ onSaved, onCancel }) {
  const [clientToken, setClientToken] = useState(null);
  const [epi, setEpi]                 = useState(null);
  const [mode, setMode]               = useState('sandbox');
  const [iframeHeight, setIframeHeight] = useState(480);

  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState('');
  const [saving,   setSaving]   = useState(false);
  const [tokenData, setTokenData] = useState(null); // { card_token, last4, card_brand, expiry }
  const [achEnabled, setAchEnabled] = useState(false);
  const [achAuthText, setAchAuthText] = useState('');
  const [intentId, setIntentId] = useState(null);

  // Card form fields (collected on our side before the Passage iframe fires)
  const [cardholder, setCardholder] = useState('');
  const [nickname,   setNickname]   = useState('');
  const [isDefault,  setIsDefault]  = useState(false);

  // Fetch a Passage.js clientToken from the portal-scoped endpoint, and
  // create the vault intent ACH needs. Tokens are single-use, so "Change"
  // (below) calls this again for a fresh one rather than reusing the
  // already-consumed iframe.
  function fetchToken() {
    let cancelled = false;
    setLoading(true); setError('');
    Promise.all([
      api.get('/portal/vault/client-token'),
      api.post('/portal/vault/intent', { nickname: nickname || null, is_default: isDefault }),
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
      .catch((e) => {
        if (cancelled) return;
        setError(parseApiError(e, 'Could not load payment form. Check gateway configuration.'));
        setLoading(false);
      });
    return () => { cancelled = true; };
  }
  useEffect(fetchToken, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Listen for postMessage from the passage-save-card.html iframe.
  useEffect(() => {
    function handleMessage(event) {
      const msg = event.data;
      if (!msg || typeof msg !== 'object') return;

      if (msg.type === 'PASSAGE_TOKEN') {
        setTokenData({
          card_token: msg.card_token,
          last4:      msg.last4      || '',
          card_brand: msg.card_brand || '',
          expiry:     msg.expiry     || '',
        });
        if (msg.cardholder_name) setCardholder(msg.cardholder_name);
      }
      if (msg.type === 'PASSAGE_ERROR') {
        setError(msg.error || 'Payment form error.');
      }
      // ACH result — comes back from the server-rendered HTML page that the
      // Passage.js form POSTs to (/payments/public/vault-ach/:intentId),
      // which relays via postMessage since the form navigates here.
      if (msg.type === 'PASSAGE_ACH_SUBMITTING') { setError(''); }
      if (msg.type === 'PASSAGE_ACH_RESULT') {
        if (msg.status === 'captured') onSaved();
        else setError(msg.error || 'Failed to save payment method.');
      }
      if (msg.type === 'PASSAGE_HEIGHT' && msg.height > 0) {
        setIframeHeight(Math.max(480, msg.height + 16));
      }
    }
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [onSaved]);

  const apiOrigin = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');
  const achFormAction = (achEnabled && intentId)
    ? encodeURIComponent(`${apiOrigin}/api/payments/public/vault-ach/${intentId}`)
    : '';
  const iframeSrc = clientToken
    ? `/passage-save-card.html?clientToken=${encodeURIComponent(clientToken)}&epi=${encodeURIComponent(epi || '')}&mode=${mode}&enableACH=${achFormAction ? '1' : '0'}&achFormAction=${achFormAction}`
    : null;

  async function handleSave() {
    if (!tokenData?.card_token) {
      setError('Please enter and confirm your card details first.');
      return;
    }
    setSaving(true); setError('');
    try {
      await api.post('/portal/payment-methods/save-card', {
        card_token:      tokenData.card_token,
        cardholder_name: cardholder || undefined,
        last4:           tokenData.last4      || undefined,
        card_brand:      tokenData.card_brand || undefined,
        expiry:          tokenData.expiry     || undefined,
        nickname:        nickname  || undefined,
        is_default:      isDefault,
      });
      onSaved();
    } catch (e) {
      setError(parseApiError(e, e.message || 'Failed to save card'));
    } finally { setSaving(false); }
  }

  return (
    <div>
      <div className="mb-3">
        <label className="form-label fw-semibold small">Cardholder name</label>
        <input
          type="text"
          className="form-control"
          placeholder="Name on card"
          value={cardholder}
          onChange={(e) => setCardholder(e.target.value)}
        />
      </div>

      {/* Passage.js form — hidden once tokenized */}
      {!tokenData && (
        <>
          {loading && (
            <div className="text-muted small py-3 text-center">
              <div className="spinner-border spinner-border-sm me-2"></div>
              Loading secure card form…
            </div>
          )}
          {!loading && iframeSrc && (
            <div className="border rounded overflow-hidden mb-2" style={{ height: iframeHeight }}>
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
          )}
          {achFormAction && achAuthText && (
            <p className="small text-muted mb-2">{achAuthText}</p>
          )}
        </>
      )}

      {/* Read-only chip after tokenization */}
      {tokenData && (
        <>
          <div className="d-flex align-items-center justify-content-between border rounded px-3 py-2 mb-3 bg-light">
            <div className="d-flex align-items-center gap-2">
              <iconify-icon icon="solar:card-line-duotone" style={{ fontSize: 20, color: 'var(--secondary, #C9A227)' }}></iconify-icon>
              <span className="fw-semibold small">
                {tokenData.card_brand ? `${tokenData.card_brand.charAt(0).toUpperCase()}${tokenData.card_brand.slice(1)} ` : ''}
                **** {tokenData.last4}
                {tokenData.expiry ? ` · exp ${tokenData.expiry}` : ''}
              </span>
              <span className="badge bg-success-subtle text-success" style={{ fontSize: 10 }}>Tokenized</span>
            </div>
            <button type="button" className="btn btn-sm btn-link text-muted p-0"
              onClick={() => { setTokenData(null); setClientToken(null); fetchToken(); }}>
              Change
            </button>
          </div>

          <div className="mb-3">
            <label className="form-label fw-semibold small">Nickname (optional)</label>
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
              type="checkbox"
              className="form-check-input"
              id="pm-is-default"
              checked={isDefault}
              onChange={(e) => setIsDefault(e.target.checked)}
            />
            <label className="form-check-label small" htmlFor="pm-is-default">Set as default payment method</label>
          </div>
        </>
      )}

      {error && <div className="alert alert-danger py-2 small">{error}</div>}

      <div className="d-flex gap-2 mt-3">
        {tokenData && (
          <button
            className="btn btn-primary"
            disabled={saving}
            onClick={handleSave}
            style={{ background: 'var(--secondary, #C9A227)', borderColor: 'var(--secondary, #C9A227)', color: 'var(--brand, #0A1F3D)' }}
          >
            {saving ? <><span className="spinner-border spinner-border-sm me-2"></span>Saving…</> : 'Save card'}
          </button>
        )}
        <button className="btn btn-light" onClick={onCancel} disabled={saving}>Cancel</button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------
export default function PortalPaymentMethods() {
  const { confirm, dialog: confirmDialog } = useConfirm();
  const [profiles, setProfiles] = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState('');
  const [showAdd,  setShowAdd]  = useState(false);
  const [actionError, setActionError] = useState('');
  const [busy, setBusy] = useState(null); // id of profile being acted on

  // Active gateway info (loaded once)
  const [activeGw, setActiveGw] = useState(null); // { gateway, mode, epi?, authnet_login_id?, authnet_client_key? }

  async function load() {
    setLoading(true); setError('');
    try {
      const [pmRes, gwRes] = await Promise.all([
        api.get('/portal/payment-methods'),
        api.get('/portal/vault/active-gateway').catch(() => null),
      ]);
      setProfiles(pmRes.data.profiles || []);
      if (gwRes?.data) setActiveGw(gwRes.data);
    } catch (e) {
      setError(parseApiError(e, 'Failed to load payment methods'));
    } finally { setLoading(false); }
  }

  useEffect(() => { load(); }, []);

  async function setDefault(id) {
    setBusy(id); setActionError('');
    try {
      await api.put(`/portal/payment-methods/${id}/default`);
      await load();
    } catch (e) {
      setActionError(parseApiError(e, 'Failed to update default'));
    } finally { setBusy(null); }
  }

  async function removeCard(id, last4) {
    if (!(await confirm(`Remove card ending in ${last4 || '????'}? This cannot be undone.`, { danger: true }))) return;
    setBusy(id); setActionError('');
    try {
      await api.delete(`/portal/payment-methods/${id}`);
      await load();
    } catch (e) {
      setActionError(parseApiError(e, 'Failed to remove card'));
    } finally { setBusy(null); }
  }

  function handleSaved() {
    setShowAdd(false);
    load();
  }

  return (
    <div>
      <div className="d-flex align-items-center justify-content-between mb-3">
        <h4 className="mb-0 fw-bolder">Payment Methods</h4>
        {!showAdd && (
          <button
            className="btn btn-sm"
            style={{ background: 'var(--secondary, #C9A227)', color: 'var(--brand, #0A1F3D)' }}
            onClick={() => { setShowAdd(true); setActionError(''); }}
          >
            <iconify-icon icon="solar:add-square-line-duotone" class="me-1"></iconify-icon>
            Add card
          </button>
        )}
      </div>

      {error && <div className="alert alert-danger">{error}</div>}
      {actionError && <div className="alert alert-danger py-2 small">{actionError}</div>}

      {/* Add card panel */}
      {showAdd && (
        <div className="card mb-4">
          <div className="card-body">
            <h6 className="fw-bold mb-3">
              <iconify-icon icon="solar:card-line-duotone" class="me-1"></iconify-icon>
              Add a new card
            </h6>
            {activeGw?.gateway === 'authnet' ? (
              <AuthnetCardSaveForm
                loginId={activeGw.authnet_login_id}
                clientKey={activeGw.authnet_client_key}
                mode={activeGw.mode}
                onSaved={handleSaved}
                onCancel={() => setShowAdd(false)}
              />
            ) : (
              <PassageCardSaveForm onSaved={handleSaved} onCancel={() => setShowAdd(false)} />
            )}
          </div>
        </div>
      )}

      {loading && !profiles.length && (
        <div className="text-muted small py-4 text-center">
          <div className="spinner-border spinner-border-sm me-2"></div>
          Loading…
        </div>
      )}

      {!loading && !profiles.length && !showAdd && (
        <div className="card">
          <div className="card-body text-center py-5">
            <iconify-icon icon="solar:card-line-duotone" style={{ fontSize: 48, color: '#ccc' }}></iconify-icon>
            <h5 className="mt-3 mb-1 text-muted">No saved payment methods</h5>
            <p className="text-muted small mb-3">
              Save a card to pay invoices faster, or to enable automatic billing on subscriptions.
            </p>
            <button
              className="btn"
              style={{ background: 'var(--secondary, #C9A227)', color: 'var(--brand, #0A1F3D)' }}
              onClick={() => setShowAdd(true)}
            >
              <iconify-icon icon="solar:add-square-line-duotone" class="me-1"></iconify-icon>
              Add a card
            </button>
          </div>
        </div>
      )}

      {profiles.length > 0 && (
        <div className="d-flex flex-column gap-3">
          {profiles.map((p) => (
            <div
              key={p.id}
              className={`card ${p.is_default ? 'border-warning' : ''}`}
            >
              <div className="card-body d-flex align-items-center justify-content-between flex-wrap gap-2">
                <div className="d-flex align-items-center gap-3">
                  <div
                    className="rounded-2 d-flex align-items-center justify-content-center"
                    style={{ width: 44, height: 44, background: '#F7F0EB', fontSize: 22 }}
                  >
                    <iconify-icon icon="solar:card-line-duotone" style={{ color: 'var(--secondary, #C9A227)' }}></iconify-icon>
                  </div>
                  <div>
                    <div className="fw-semibold">
                      <CardBadge brand={p.card_brand} />
                      {p.card_brand ? `${p.card_brand.charAt(0).toUpperCase()}${p.card_brand.slice(1)} ` : ''}
                      ****&nbsp;{p.last4 || '????'}
                      {p.nickname && (
                        <span className="text-muted fw-normal ms-2 small">"{p.nickname}"</span>
                      )}
                    </div>
                    <div className="text-muted small">
                      {p.expiry ? `Expires ${p.expiry}` : ''}
                      {p.expiry && p.cardholder_name ? ' · ' : ''}
                      {p.cardholder_name || ''}
                      {(p.expiry || p.cardholder_name) ? ' · ' : ''}
                      {GATEWAY_LABEL[p.gateway] || p.gateway}
                    </div>
                  </div>
                </div>

                <div className="d-flex align-items-center gap-2 flex-wrap">
                  {p.is_default ? (
                    <span className="badge bg-warning text-dark">
                      <iconify-icon icon="solar:star-bold" class="me-1"></iconify-icon>
                      Default
                    </span>
                  ) : (
                    <button
                      className="btn btn-sm btn-outline-secondary"
                      disabled={busy === p.id}
                      onClick={() => setDefault(p.id)}
                    >
                      {busy === p.id
                        ? <span className="spinner-border spinner-border-sm"></span>
                        : 'Set default'}
                    </button>
                  )}
                  <button
                    className="btn btn-sm btn-outline-danger"
                    disabled={busy === p.id}
                    onClick={() => removeCard(p.id, p.last4)}
                    title="Remove card"
                  >
                    {busy === p.id
                      ? <span className="spinner-border spinner-border-sm"></span>
                      : <iconify-icon icon="solar:trash-bin-minimalistic-line-duotone"></iconify-icon>}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="text-muted small mt-4 text-center">
        <iconify-icon icon="solar:lock-keyhole-line-duotone" class="me-1"></iconify-icon>
        Card details are tokenized and never stored on our servers · PCI SAQ-A compliant
      </div>

      {confirmDialog}
    </div>
  );
}
