// DonationCheckout — gateway-agnostic checkout widget for public, non-commerce
// money flows (donations, membership sign-up, etc. — the storefront's own
// checkout lives in client/src/pages/Checkout.jsx and is unrelated).
//
// Mirrors the branching/polling pattern already proven out in
// client/src/pages/PayInvoice.jsx: POST /payments/public/checkout/:invoiceId,
// then render whichever gateway comes back (Valor via <PassagePaymentForm>,
// Auth.net via a hidden form + iframe), so it keeps working when the active
// gateway changes (or a third one, e.g. NMI, is added later) without the
// caller needing to know which one is configured.
//
// Props:
//   invoiceId     int    — the (synthetic) invoice being paid
//   chargeAmount  number — display only, actual charge computed server-side
//   currency      string — default 'USD'
//   onSuccess     fn(result) — payment captured
//   onDeclined    fn({ message }) — Valor path declined
//   onCancel      fn()
//   contactId       int|null — donor's contact id (returned by /donations/public/checkout);
//                              required for allowSaveCard, since a saved card must be
//                              attached to someone.
//   allowSaveCard   bool     — show a "save this card" checkbox (Valor one-time
//                              charges only — recurring already vaults by necessity)
//   saveCardLabel   string   — checkbox copy

import { useEffect, useRef, useState } from 'react';
import api from '../../api/client.js';
import PassagePaymentForm from '../../components/PassagePaymentForm.jsx';

export default function DonationCheckout({
  invoiceId,
  chargeAmount,
  currency = 'USD',
  onSuccess,
  onDeclined,
  onCancel,
  contactId = null,
  allowSaveCard = false,
  saveCardLabel = 'Save this card for future gifts',
}) {
  const [checkout, setChecking] = useState(null);
  const [starting, setStarting] = useState(true);
  const [saveCard, setSaveCard] = useState(false);
  const authnetFormRef = useRef(null);

  // If the visitor is logged into the donor portal (lc_token present), offer
  // their saved cards instead of a blank card form. Uses the portal's own
  // scoped routes (/portal/payment-methods, /portal/invoices/:id/pay-saved)
  // rather than the staff-only /vault/* routes — a donor never has
  // payments.write, but the portal role does have payments.read and these
  // routes self-scope to the logged-in user's own contact/org.
  const [portalCards, setPortalCards] = useState([]);
  const [portalMode, setPortalMode] = useState('new'); // 'new' | 'saved'
  const [selectedPortalCard, setSelectedPortalCard] = useState(null);
  const [portalCharging, setPortalCharging] = useState(false);
  const [portalError, setPortalError] = useState('');

  useEffect(() => {
    if (!localStorage.getItem('lc_token')) return;
    let cancelled = false;
    api.get('/portal/payment-methods')
      .then(({ data }) => {
        if (cancelled) return;
        const profiles = data.profiles || [];
        setPortalCards(profiles);
        if (profiles.length) {
          setPortalMode('saved');
          setSelectedPortalCard(profiles.find((p) => p.is_default) || profiles[0]);
        }
      })
      .catch(() => {}); // not logged into the portal, or no permission — fall back to card entry
    return () => { cancelled = true; };
  }, []);

  async function chargeSavedPortalCard() {
    if (!selectedPortalCard) return;
    setPortalCharging(true);
    setPortalError('');
    try {
      const { data } = await api.post(`/portal/invoices/${invoiceId}/pay-saved`, {
        vault_profile_id: selectedPortalCard.id,
      });
      onSuccess?.(data);
    } catch (e) {
      setPortalError(e.response?.data?.error || 'Charge failed.');
    } finally {
      setPortalCharging(false);
    }
  }

  async function handleValorSuccess(result) {
    // Uses the public, invoice-scoped /donations/public/save-card/:id route —
    // not /api/vault/save-card, which requires staff auth an anonymous donor
    // never has. Safe because the server verifies a captured payment already
    // exists on this invoice before saving anything (see donations.js).
    if (allowSaveCard && saveCard && result?.card_token) {
      try {
        await api.post(`/donations/public/save-card/${invoiceId}`, {
          card_token: result.card_token,
          cardholder_name: result.cardholder_name || null,
          last4: result.last4 || null,
          card_brand: result.card_brand || null,
          expiry: result.expiry || null,
        });
      } catch (_e) { /* non-fatal — the donation itself already succeeded */ }
    }
    onSuccess?.(result);
  }

  // Kick off checkout once — resolves which gateway is active.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setStarting(true);
      try {
        const { data: co } = await api.post(`/payments/public/checkout/${invoiceId}`, {});
        if (cancelled) return;
        setChecking(co);
        if (co.gateway === 'authnet') {
          setTimeout(() => authnetFormRef.current?.submit(), 100);
        }
      } catch (e) {
        if (!cancelled) setChecking({ error: e.response?.data?.error || 'Failed to start checkout' });
      } finally {
        if (!cancelled) setStarting(false);
      }
    })();
    return () => { cancelled = true; };
  }, [invoiceId]);

  // Auth.net completion — the hosted iframe bubbles a postMessage via the
  // static /authnet-iframe-communicator.html page (see gateways.js).
  useEffect(() => {
    if (checkout?.gateway !== 'authnet') return undefined;
    function parsePayload(data) {
      if (data && typeof data === 'object') return data;
      if (typeof data !== 'string') return {};
      try {
        const params = new URLSearchParams(data);
        const response = params.get('response');
        return { action: params.get('action'), response: response ? JSON.parse(decodeURIComponent(response)) : null };
      } catch { return {}; }
    }
    const onMsg = async (e) => {
      const { action, response } = parsePayload(e.data);
      if (!action) return;
      if (action === 'transactResponse' && response) {
        try {
          const { data } = await api.post(`/payments/public/confirm/${invoiceId}`, {
            transactionId: response.transId || null,
            amount: response.totalAmount ? Number(response.totalAmount) : null,
            last4: response.accountNumber ? String(response.accountNumber).replace(/\D/g, '').slice(-4) : null,
            brand: response.accountType || null,
            authCode: response.authorization || null,
            message: response.messages?.[0]?.description || null,
          });
          onSuccess?.(data);
        } catch (err) {
          onDeclined?.({ message: err.response?.data?.error || 'Payment could not be confirmed.' });
        }
      } else if (action === 'cancel') {
        onCancel?.();
      }
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, [checkout, invoiceId, onSuccess, onDeclined, onCancel]);

  // Poll for webhook-driven capture (Auth.net production flow).
  useEffect(() => {
    if (!checkout || checkout.error || checkout.gateway !== 'authnet') return undefined;
    const t = setInterval(async () => {
      try {
        const { data: s } = await api.get(`/payments/public/status/${invoiceId}`);
        if (Number(s.balance_due) <= 0 || s.status === 'paid') {
          clearInterval(t);
          onSuccess?.(s);
        }
      } catch { /* keep polling */ }
    }, 4000);
    return () => clearInterval(t);
  }, [checkout, invoiceId, onSuccess]);

  if (starting) {
    return (
      <div className="text-center py-3 text-muted">
        <div className="spinner-border spinner-border-sm me-2"></div>
        Preparing secure checkout…
      </div>
    );
  }

  if (checkout?.error) {
    return <div className="alert alert-danger py-2 small">{checkout.error}</div>;
  }

  const showPortalToggle = portalCards.length > 0;

  return (
    <div>
      {showPortalToggle && (
        <div style={{ display: 'flex', gap: 8, marginBottom: '1rem' }}>
          <button type="button" onClick={() => setPortalMode('saved')}
            style={{ flex: 1, padding: '0.5rem', borderRadius: 10, border: '1px solid #dde1e7', background: portalMode === 'saved' ? '#0A1F3D' : 'transparent', color: portalMode === 'saved' ? '#fff' : 'inherit', cursor: 'pointer', fontWeight: 600, fontSize: '0.85rem' }}>
            Saved card
          </button>
          <button type="button" onClick={() => setPortalMode('new')}
            style={{ flex: 1, padding: '0.5rem', borderRadius: 10, border: '1px solid #dde1e7', background: portalMode === 'new' ? '#0A1F3D' : 'transparent', color: portalMode === 'new' ? '#fff' : 'inherit', cursor: 'pointer', fontWeight: 600, fontSize: '0.85rem' }}>
            New card
          </button>
        </div>
      )}

      {showPortalToggle && portalMode === 'saved' ? (
        <div>
          {portalCards.map((p) => (
            <label key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0.6rem 0.75rem', border: '1px solid #dde1e7', borderRadius: 12, marginBottom: 6, cursor: 'pointer', background: selectedPortalCard?.id === p.id ? 'rgba(10,31,61,0.06)' : 'transparent' }}>
              <input type="radio" name="portal_saved_card" checked={selectedPortalCard?.id === p.id} onChange={() => setSelectedPortalCard(p)} />
              <span style={{ fontSize: '0.9rem' }}>
                {p.card_brand ? `${p.card_brand.charAt(0).toUpperCase()}${p.card_brand.slice(1)} ` : ''}
                •••• {p.last4 || '????'}
                {p.is_default && <span style={{ marginLeft: 8, fontSize: '0.75rem', color: '#9ca3af' }}>Default</span>}
              </span>
            </label>
          ))}
          {portalError && <p style={{ color: '#b42318', fontSize: '0.85rem', margin: '0.5rem 0' }}>{portalError}</p>}
          <button type="button" disabled={!selectedPortalCard || portalCharging} onClick={chargeSavedPortalCard}
            style={{ width: '100%', padding: '0.85rem', borderRadius: 16, border: 'none', background: '#C9A227', color: '#0A1F3D', fontWeight: 700, cursor: 'pointer', opacity: portalCharging ? 0.7 : 1 }}>
            {portalCharging ? 'Charging…' : `Charge $${Number(checkout?.charge_amount ?? chargeAmount ?? 0).toFixed(2)}`}
          </button>
        </div>
      ) : checkout?.gateway === 'valor' ? (
        <div>
          <PassagePaymentForm
            invoiceId={invoiceId}
            chargeAmount={checkout.charge_amount ?? chargeAmount}
            currency={currency}
            onSuccess={handleValorSuccess}
            onDeclined={onDeclined}
            onCancel={onCancel}
          />
          {allowSaveCard && contactId && (
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem', marginTop: '0.5rem' }}>
              <input type="checkbox" checked={saveCard} onChange={(e) => setSaveCard(e.target.checked)} />
              {saveCardLabel}
            </label>
          )}
        </div>
      ) : checkout?.gateway === 'authnet' ? (
        <>
          <form
            ref={authnetFormRef}
            method="POST"
            action={checkout.postUrl}
            target="donation-authnet-iframe"
            style={{ display: 'none' }}
          >
            <input type="hidden" name="token" value={checkout.token} />
          </form>
          <iframe
            name="donation-authnet-iframe"
            title="Secure payment"
            style={{ width: '100%', minHeight: 560, border: '1px solid #e5e5e5', borderRadius: 8 }}
            allow="payment"
          />
        </>
      ) : null}
    </div>
  );
}
