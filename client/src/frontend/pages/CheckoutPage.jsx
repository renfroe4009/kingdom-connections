import { useEffect, useState, useCallback } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import api from '../../api/client.js';
import { useCart, CART_TOKEN_KEY } from '../context/CartContext.jsx';
import CheckoutPaymentForm from '../components/CheckoutPaymentForm.jsx';

const US_STATES = ['AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY'];

const emptyForm = {
  first_name: '', last_name: '', email: '', phone: '',
  shipping_line1: '', shipping_line2: '', shipping_city: '', shipping_state: '', shipping_zip: '',
  customer_note: '',
};

export default function CheckoutPage() {
  const { cart, loading: cartLoading, tokenHeader } = useCart();
  const navigate = useNavigate();
  const [form, setForm] = useState(emptyForm);
  const [shippingOptions, setShippingOptions] = useState([]);
  const [shippingRateId, setShippingRateId] = useState(null);
  const [totals, setTotals] = useState({ subtotal: 0, shipping: 0, tax: 0, processing_fee: 0, total: 0 });
  const [showPayment, setShowPayment] = useState(false);
  const [paymentKey, setPaymentKey] = useState(0);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [intentId, setIntentId] = useState(null);
  const [estimateReady, setEstimateReady] = useState(false);

  // ── Logged-in portal customer: prefill + saved cards ────────────────────
  const [loggedIn, setLoggedIn] = useState(false);
  const [savedCards, setSavedCards] = useState([]);
  const [cardMode, setCardMode] = useState('new'); // 'new' | 'saved'
  const [selectedCard, setSelectedCard] = useState(null);

  useEffect(() => {
    if (!localStorage.getItem('lc_token')) return;
    setLoggedIn(true);
    api.get('/portal/me').then(({ data }) => {
      if (!data?.contact) return;
      setForm((f) => ({
        ...f,
        first_name: f.first_name || data.contact.first_name || '',
        last_name: f.last_name || data.contact.last_name || '',
        email: f.email || data.contact.email || '',
        phone: f.phone || data.contact.phone || '',
      }));
    }).catch(() => {});
    api.get('/portal/payment-methods').then(({ data }) => {
      const profiles = (data.profiles || []).filter((p) => p.gateway === 'valor');
      setSavedCards(profiles);
      if (profiles.length) {
        setCardMode('saved');
        setSelectedCard(profiles.find((p) => p.is_default) || profiles[0]);
      }
    }).catch(() => {}); // not logged into the portal, or no permission — guest checkout unchanged
  }, []);
  // An all-free-ticket cart totals $0 — skip the whole payment step (there's
  // nothing to charge, and Valor would likely reject a $0 card charge anyway).
  const isFreeOrder = estimateReady && Number(totals.total) === 0;
  // Ticket-only carts (no physical products) skip shipping entirely — mirrors
  // checkout.js's server-side requires_shipping/skip-validation logic.
  const requiresShipping = cart.items.some(it => it.item_type !== 'event_ticket');

  useEffect(() => {
    if (!cartLoading && !cart.items.length) navigate('/cart', { replace: true });
  }, [cartLoading, cart.items.length, navigate]);

  const refreshEstimate = useCallback(async () => {
    if (!cart.items.length) return;
    try {
      const { data } = await api.post('/checkout/estimate', {
        session_key: localStorage.getItem(CART_TOKEN_KEY),
        shipping_state: form.shipping_state,
        shipping_country: 'US',
        shipping_rate_id: shippingRateId,
      });
      setTotals(data);
      setEstimateReady(true);
    } catch (e) { /* ignore until enough info is present */ }
  }, [cart.items.length, form.shipping_state, shippingRateId]);

  useEffect(() => { refreshEstimate(); }, [refreshEstimate]);

  useEffect(() => {
    if (!requiresShipping || !form.shipping_state) { setShippingOptions([]); return; }
    const weight_oz = cart.items.reduce((s, it) => s + Number(it.weight_oz || 0) * it.qty, 0);
    api.post('/shipping/estimate', { order_total: cart.subtotal, weight_oz }).then(r => {
      setShippingOptions(r.data);
      if (r.data.length && !shippingRateId) setShippingRateId(r.data[0].id);
    });
  }, [requiresShipping, form.shipping_state, cart.subtotal]); // eslint-disable-line react-hooks/exhaustive-deps

  function set(field, value) { setForm(f => ({ ...f, [field]: value })); }

  function reviewComplete() {
    if (!(form.first_name && form.last_name && form.email)) return false;
    if (!requiresShipping) return true;
    return form.shipping_line1 && form.shipping_city && form.shipping_state && form.shipping_zip;
  }

  async function handleToken({ card_token }) {
    setSubmitting(true);
    setError('');
    try {
      const selectedRate = shippingOptions.find(r => r.id === shippingRateId);
      const { data } = await api.post('/checkout/complete', {
        session_key: localStorage.getItem(CART_TOKEN_KEY),
        ...form,
        shipping_country: 'US',
        shipping_rate_id: shippingRateId,
        shipping_method_name: selectedRate?.name || null,
        card_token,
      });
      navigate(`/order-confirmation/${data.order_number}`);
    } catch (e) {
      setError(e.response?.data?.detail || e.response?.data?.error || 'Payment could not be processed.');
      setPaymentKey(k => k + 1); // fresh iframe — Passage tokens are one-time-use
    } finally {
      setSubmitting(false);
    }
  }

  // ACH result comes back already fully completed server-side (the raw form
  // POST landed on /checkout/public/ach-complete/:intentId, which built the
  // order and charged it in one step — there's no separate /complete call
  // to make here, just navigate to the confirmation page).
  function handleAchResult({ order_number }) {
    navigate(`/order-confirmation/${order_number}`);
  }

  async function completeFreeOrder() {
    setSubmitting(true);
    setError('');
    try {
      const { data } = await api.post('/checkout/complete', {
        session_key: localStorage.getItem(CART_TOKEN_KEY),
        ...form,
        shipping_country: 'US',
      });
      navigate(`/order-confirmation/${data.order_number}`);
    } catch (e) {
      setError(e.response?.data?.detail || e.response?.data?.error || 'Could not complete your free registration.');
    } finally {
      setSubmitting(false);
    }
  }

  async function continueToPayment() {
    // Logged in with a saved card selected — charge it directly, no Passage.js
    // iframe needed at all (mirrors PortalInvoiceView.jsx's pay-saved flow).
    if (cardMode === 'saved' && selectedCard) {
      setSubmitting(true);
      setError('');
      try {
        const selectedRate = shippingOptions.find(r => r.id === shippingRateId);
        const { data } = await api.post('/checkout/complete-saved', {
          session_key: localStorage.getItem(CART_TOKEN_KEY),
          ...form,
          shipping_country: 'US',
          shipping_rate_id: shippingRateId,
          shipping_method_name: selectedRate?.name || null,
          vault_profile_id: selectedCard.id,
        });
        navigate(`/order-confirmation/${data.order_number}`);
      } catch (e) {
        setError(e.response?.data?.detail || e.response?.data?.error || 'Payment could not be processed.');
      } finally {
        setSubmitting(false);
      }
      return;
    }

    setError('');
    try {
      const selectedRate = shippingOptions.find(r => r.id === shippingRateId);
      const { data } = await api.post('/checkout/public/intent', {
        session_key: localStorage.getItem(CART_TOKEN_KEY),
        ...form,
        shipping_country: 'US',
        shipping_rate_id: shippingRateId,
        shipping_method_name: selectedRate?.name || null,
      });
      setIntentId(data.intentId);
      setShowPayment(true);
    } catch (e) {
      setError(e.response?.data?.error || 'Could not start checkout. Please check your info and try again.');
    }
  }

  if (cartLoading) return <div className="ns-section" style={{ textAlign: 'center' }}><p>Loading…</p></div>;

  return (
    <div className="ns-section">
      <div className="ns-grid">
        <div className="ns-block" style={{ '--col-start': 1, '--col-span': 12 }}>
          <h1 style={{ fontFamily: 'var(--font-heading)', color: 'var(--color-primary)', marginBottom: 'var(--space-6)' }}>Checkout</h1>
        </div>

        <div className="ns-block" style={{ '--col-start': 1, '--col-span': 7 }}>
          {!loggedIn && (
            <div className="form-note" style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--space-3)', marginBottom: 'var(--space-4)' }}>
              <span>Have an account?</span>
              <Link to="/portal/login?redirect=/checkout" style={{ fontWeight: 600 }}>Log in to use a saved card</Link>
            </div>
          )}

          <div className="form-card" style={{ marginBottom: 'var(--space-5)' }}>
            <h3 className="donate-panel__heading">Contact</h3>
            <div className="form-row-2">
              <div className="form-field"><label>First Name</label>
                <input value={form.first_name} onChange={e => set('first_name', e.target.value)} disabled={showPayment} /></div>
              <div className="form-field"><label>Last Name</label>
                <input value={form.last_name} onChange={e => set('last_name', e.target.value)} disabled={showPayment} /></div>
              <div className="form-field"><label>Email</label>
                <input type="email" value={form.email} onChange={e => set('email', e.target.value)} disabled={showPayment} /></div>
              <div className="form-field"><label>Phone</label>
                <input value={form.phone} onChange={e => set('phone', e.target.value)} disabled={showPayment} /></div>
            </div>
          </div>

          {loggedIn && savedCards.length > 0 && !showPayment && (
            <div className="form-card" style={{ marginBottom: 'var(--space-5)' }}>
              <h3 className="donate-panel__heading">Payment Method</h3>
              <div style={{ display: 'flex', gap: 'var(--space-2)', marginBottom: 'var(--space-4)' }}>
                <button type="button" className={`btn btn--sm ${cardMode === 'saved' ? 'btn--gold' : 'btn--outline-dark'}`} onClick={() => setCardMode('saved')}>Saved card</button>
                <button type="button" className={`btn btn--sm ${cardMode === 'new' ? 'btn--gold' : 'btn--outline-dark'}`} onClick={() => setCardMode('new')}>New card</button>
              </div>
              {cardMode === 'saved' && (
                <div>
                  {savedCards.map((p) => (
                    <label key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', padding: 'var(--space-3)', marginBottom: 'var(--space-2)', cursor: 'pointer' }}>
                      <input type="radio" name="checkout_saved_card" checked={selectedCard?.id === p.id} onChange={() => setSelectedCard(p)} />
                      <span style={{ fontSize: 'var(--text-sm)' }}>
                        {p.card_brand ? `${p.card_brand.charAt(0).toUpperCase()}${p.card_brand.slice(1)} ` : ''}
                        •••• {p.last4 || '????'}
                        {p.is_default && <span style={{ color: 'var(--color-text-muted)', marginLeft: 'var(--space-2)' }}>Default</span>}
                      </span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          )}

          {requiresShipping && (
            <div className="form-card" style={{ marginBottom: 'var(--space-5)' }}>
              <h3 className="donate-panel__heading">Shipping Address</h3>
              <div className="form-field"><label>Address</label>
                <input value={form.shipping_line1} onChange={e => set('shipping_line1', e.target.value)} disabled={showPayment} /></div>
              <div className="form-field"><label>Apt / Suite <span style={{ color: 'var(--color-text-muted)' }}>(optional)</span></label>
                <input value={form.shipping_line2} onChange={e => set('shipping_line2', e.target.value)} disabled={showPayment} /></div>
              <div className="form-row-2">
                <div className="form-field"><label>City</label>
                  <input value={form.shipping_city} onChange={e => set('shipping_city', e.target.value)} disabled={showPayment} /></div>
                <div className="form-field"><label>State</label>
                  <select value={form.shipping_state} onChange={e => set('shipping_state', e.target.value)} disabled={showPayment}>
                    <option value="">—</option>
                    {US_STATES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select></div>
              </div>
              <div className="form-field" style={{ maxWidth: 160 }}><label>ZIP</label>
                <input value={form.shipping_zip} onChange={e => set('shipping_zip', e.target.value)} disabled={showPayment} /></div>
              {shippingOptions.length > 0 && (
                <div style={{ marginBottom: 'var(--space-4)' }}>
                  <label style={{ display: 'block', fontSize: 'var(--text-sm)', fontWeight: 600, marginBottom: 'var(--space-2)', color: 'var(--color-primary)' }}>Shipping Method</label>
                  {shippingOptions.map(opt => (
                    <label key={opt.id} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 'var(--space-2)' }}>
                      <input type="radio" name="shipping-rate" checked={shippingRateId === opt.id}
                        onChange={() => setShippingRateId(opt.id)} disabled={showPayment} />
                      <span>{opt.name} — {opt.cost === 0 ? 'Free' : `$${opt.cost.toFixed(2)}`}</span>
                    </label>
                  ))}
                </div>
              )}
              <div className="form-field"><label>Order Note <span style={{ color: 'var(--color-text-muted)' }}>(optional)</span></label>
                <textarea rows={2} value={form.customer_note} onChange={e => set('customer_note', e.target.value)} disabled={showPayment} /></div>
            </div>
          )}

          {!showPayment ? (
            <>
              {error && <div className="form-error">{error}</div>}
              <button className="btn btn--gold" style={{ width: '100%' }}
                disabled={!reviewComplete() || submitting || (cardMode === 'saved' && savedCards.length > 0 && !selectedCard)}
                onClick={isFreeOrder ? completeFreeOrder : continueToPayment}>
                {submitting
                  ? 'Please wait…'
                  : isFreeOrder
                    ? 'Complete Free Registration'
                    : cardMode === 'saved' && savedCards.length > 0
                      ? `Pay $${Number(totals.total).toFixed(2)}`
                      : 'Continue to Payment'}
              </button>
            </>
          ) : (
            <div className="form-card">
              <h3 className="donate-panel__heading">Payment</h3>
              {error && <div className="form-error">{error}</div>}
              {submitting
                ? <p className="form-note" style={{ textAlign: 'center' }}>Placing your order…</p>
                : <CheckoutPaymentForm key={paymentKey} intentId={intentId} onToken={handleToken} onAchResult={handleAchResult} />}
              <button className="btn btn--outline-dark btn--sm" style={{ marginTop: 'var(--space-3)' }} onClick={() => setShowPayment(false)} disabled={submitting}>Back</button>
            </div>
          )}
        </div>

        <div className="ns-block" style={{ '--col-start': 8, '--col-span': 5 }}>
          <div className="form-card" style={{ background: 'var(--color-surface)' }}>
            <h3 className="donate-panel__heading">Order Summary</h3>
            {cart.items.map(it => (
              <div key={it.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--text-sm)', marginBottom: 'var(--space-2)' }}>
                <span>{it.item_type === 'event_ticket' ? `${it.event_name} — ${it.name}` : it.name} × {it.qty}</span>
                <span>${(Number(it.unit_price) * it.qty).toFixed(2)}</span>
              </div>
            ))}
            <hr style={{ border: 0, borderTop: '1px solid var(--color-border)', margin: 'var(--space-4) 0' }} />
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--text-sm)' }}><span>Subtotal</span><span>${Number(totals.subtotal).toFixed(2)}</span></div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--text-sm)' }}><span>Shipping</span><span>${Number(totals.shipping).toFixed(2)}</span></div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--text-sm)' }}><span>Tax</span><span>${Number(totals.tax).toFixed(2)}</span></div>
            {Number(totals.processing_fee) > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--text-sm)' }}><span>{totals.fee_label || 'Processing Fee'}</span><span>${Number(totals.processing_fee).toFixed(2)}</span></div>
            )}
            <hr style={{ border: 0, borderTop: '1px solid var(--color-border)', margin: 'var(--space-4) 0' }} />
            <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, fontSize: 'var(--text-lg)', color: 'var(--color-primary)' }}><span>Total</span><span>${Number(totals.total).toFixed(2)}</span></div>
            <Link to="/cart" style={{ display: 'block', textAlign: 'center', marginTop: 'var(--space-4)', fontSize: 'var(--text-sm)' }}>Edit Cart</Link>
          </div>
        </div>
      </div>
    </div>
  );
}
