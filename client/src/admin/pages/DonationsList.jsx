import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../../api/client.js';
import PageHeader from '../../components/PageHeader.jsx';
import Modal from '../../components/Modal.jsx';
import SearchableSelect from '../../components/SearchableSelect.jsx';
import FormErrorBanner from '../../components/FormErrorBanner.jsx';
import PassagePaymentForm from '../../components/PassagePaymentForm.jsx';
import VaultProfilesWidget from '../components/VaultProfilesWidget.jsx';
import { parseApiError } from '../../utils/apiError.js';
import { useAuth } from '../../auth/AuthContext.jsx';

const STATUS_TONE = {
  pending: 'warning', authorized: 'info', captured: 'success',
  failed: 'danger', refunded: 'secondary', voided: 'secondary',
};

const MATCH_TONE = { eligible: 'info', submitted: 'warning', matched: 'success', denied: 'secondary' };
const MATCH_LABEL = { eligible: 'Eligible', submitted: 'Submitted', matched: 'Matched', denied: 'Denied' };

function fmtMoney(n) {
  return `$${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function blankManualGift() {
  return {
    donor_type: 'contact', contact_id: '', organization_id: '',
    fund_id: '', amount: '', method: 'check',
    is_in_kind: false, in_kind_description: '', quid_pro_quo_value: '',
    dedication_note: '', is_anonymous: false, received_at: new Date().toISOString().slice(0, 10),
    soft_credit_contact_id: '',
  };
}

export default function DonationsList() {
  const { can } = useAuth();
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [summary, setSummary] = useState(null);
  const [funds, setFunds] = useState([]);
  const [fundId, setFundId] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [page, setPage] = useState(1);
  const pageSize = 50;

  const [contacts, setContacts] = useState([]);
  const [orgs, setOrgs] = useState([]);
  const [showRecord, setShowRecord] = useState(false);
  const [gift, setGift] = useState(blankManualGift());
  const [giftError, setGiftError] = useState('');
  const [saving, setSaving] = useState(false);

  // Charge-now (card/ACH) sub-flow: 'form' collects gift details, 'checkout'
  // runs the same gateway-agnostic invoice checkout InvoiceDetail's "Take
  // Payment" button uses, against a pending invoice created just for this gift.
  const [chargeStep, setChargeStep] = useState('form');
  const [chargeInvoiceId, setChargeInvoiceId] = useState(null);
  const [checkout, setCheckout] = useState(null);
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [paymentResult, setPaymentResult] = useState(null);
  const [confirming, setConfirming] = useState(false);
  const authnetFormRef = useRef(null);

  // Saved-card ("charge card on file") support within the charge-now step.
  const [savedCards, setSavedCards] = useState([]);
  const [payMode, setPayMode] = useState('new'); // 'new' | 'saved' — 'saved' is default when cards exist
  const [selectedVaultProfile, setSelectedVaultProfile] = useState(null);
  const [vaultCharging, setVaultCharging] = useState(false);
  const [saveCardChecked, setSaveCardChecked] = useState(false);

  // Mandatory processing-fee preview for the charge-now form step — same
  // gating computeProcessingFee()/vault.js's charge routes apply server-side
  // (fee_mode/supports_surcharge active, and b2b_only off or an org donor),
  // so staff see up front whether/how much will actually be added.
  const [feeInfo, setFeeInfo] = useState(null);

  const [matchDonation, setMatchDonation] = useState(null); // the row being edited
  const [matchForm, setMatchForm] = useState({ matching_gift_employer: '', matching_gift_amount: '', matching_gift_state: 'none' });
  const [matchSaving, setMatchSaving] = useState(false);

  async function load() {
    const params = { page, pageSize };
    if (fundId) params.fund_id = fundId;
    if (startDate) params.start_date = startDate;
    if (endDate) params.end_date = endDate;
    const { data } = await api.get('/donations/admin', { params });
    setRows(data.rows);
    setTotal(data.total);
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [fundId, startDate, endDate, page]);
  useEffect(() => {
    api.get('/donations/admin/summary').then((r) => setSummary(r.data)).catch(() => {});
    api.get('/donations/admin/funds').then((r) => setFunds(r.data)).catch(() => {});
    api.get('/donations/public/fee-info').then((r) => setFeeInfo(r.data)).catch(() => {});
  }, []);

  const feeWouldApply = Boolean(
    feeInfo?.mandatory_active && (!feeInfo.b2b_only || gift.donor_type === 'organization')
  );
  const previewFee = feeWouldApply && Number(gift.amount) > 0
    ? Math.round((Number(gift.amount) * (Number(feeInfo.fee_percent) / 100) + Number(feeInfo.fee_fixed)) * 100) / 100
    : 0;
  const previewTotal = Math.round((Number(gift.amount || 0) + previewFee) * 100) / 100;

  function openRecord() {
    setGift(blankManualGift());
    setGiftError('');
    setChargeStep('form');
    setChargeInvoiceId(null);
    setCheckout(null);
    setPaymentResult(null);
    setSavedCards([]);
    setPayMode('new');
    setSelectedVaultProfile(null);
    setSaveCardChecked(false);
    if (!contacts.length) api.get('/contacts', { params: { pageSize: 500 } }).then((r) => setContacts(r.data.rows)).catch(() => {});
    if (!orgs.length) api.get('/organizations', { params: { pageSize: 500 } }).then((r) => setOrgs(r.data.rows)).catch(() => {});
    setShowRecord(true);
  }

  async function saveGift() {
    if (!gift.amount || Number(gift.amount) <= 0) { setGiftError('Enter a gift amount.'); return; }
    if (gift.donor_type === 'contact' && !gift.contact_id) { setGiftError('Select a contact.'); return; }
    if (gift.donor_type === 'organization' && !gift.organization_id) { setGiftError('Select an organization.'); return; }
    if (gift.is_in_kind && !gift.in_kind_description) { setGiftError('Describe the in-kind gift.'); return; }
    setGiftError(''); setSaving(true);
    try {
      if (!gift.is_in_kind && gift.method === 'card_ach') {
        const { data } = await api.post('/donations/admin/charge', {
          contact_id: gift.donor_type === 'contact' ? Number(gift.contact_id) : null,
          organization_id: gift.donor_type === 'organization' ? Number(gift.organization_id) : null,
          fund_id: gift.fund_id ? Number(gift.fund_id) : null,
          amount: Number(gift.amount),
        });
        setChargeInvoiceId(data.invoiceId);
        await openChargeCheckout(data.invoiceId);
        return;
      }
      await api.post('/donations/admin', {
        contact_id: gift.donor_type === 'contact' ? Number(gift.contact_id) : null,
        organization_id: gift.donor_type === 'organization' ? Number(gift.organization_id) : null,
        fund_id: gift.fund_id ? Number(gift.fund_id) : null,
        amount: Number(gift.amount),
        method: gift.is_in_kind ? 'other' : gift.method,
        is_in_kind: gift.is_in_kind,
        in_kind_description: gift.in_kind_description || null,
        quid_pro_quo_value: gift.quid_pro_quo_value ? Number(gift.quid_pro_quo_value) : 0,
        dedication_note: gift.dedication_note || null,
        is_anonymous: gift.is_anonymous,
        received_at: gift.received_at ? `${gift.received_at} 00:00:00` : null,
        soft_credit_contact_id: gift.soft_credit_contact_id ? Number(gift.soft_credit_contact_id) : null,
      });
      setShowRecord(false);
      load();
    } catch (e) {
      setGiftError(parseApiError(e));
    } finally { setSaving(false); }
  }

  async function openChargeCheckout(invoiceId) {
    setCheckout(null);
    setPaymentResult(null);
    setCheckoutLoading(true);
    setChargeStep('checkout');
    try {
      const { data: co } = await api.post(`/payments/public/checkout/${invoiceId}`, {});
      setCheckout(co);
      if (co.gateway === 'authnet') {
        setTimeout(() => authnetFormRef.current?.submit(), 100);
      }
    } catch (e) {
      setCheckout({ error: e.response?.data?.error || 'Failed to start checkout' });
    } finally {
      setCheckoutLoading(false);
    }

    // Offer a saved card, if the donor/org already has one on file — defaults
    // to "saved" mode so staff aren't forced to re-enter a card every time.
    try {
      const params = gift.donor_type === 'contact'
        ? { contact_id: Number(gift.contact_id) }
        : { organization_id: Number(gift.organization_id) };
      const { data } = await api.get('/vault/profiles', { params });
      const profiles = data.profiles || [];
      setSavedCards(profiles);
      if (profiles.length) {
        setPayMode('saved');
        setSelectedVaultProfile(profiles.find((p) => p.is_default) || profiles[0]);
      }
    } catch (_e) { /* saved-card lookup is a convenience, not required */ }
  }

  async function doVaultCharge(invoiceId) {
    if (!selectedVaultProfile) return;
    setVaultCharging(true);
    setGiftError('');
    try {
      await api.post('/vault/charge-invoice', {
        invoice_id: invoiceId,
        vault_profile_id: selectedVaultProfile.id,
      });
      await completeCharge(invoiceId);
    } catch (e) {
      setGiftError(parseApiError(e, 'Charge failed.'));
    } finally {
      setVaultCharging(false);
    }
  }

  // Called after a successful NEW-card charge if "save this card" was checked.
  // Best-effort: the donation itself already captured, so a save-card failure
  // shouldn't block finishing up — just skip saving and move on.
  async function saveCardIfRequested(result) {
    if (!saveCardChecked || !result?.card_token) return;
    try {
      await api.post('/vault/save-card', {
        gateway: 'valor',
        card_token: result.card_token,
        cardholder_name: result.cardholder_name || null,
        last4: result.last4 || null,
        card_brand: result.card_brand || null,
        expiry: result.expiry || null,
        payment_method: 'card',
        contact_id: gift.donor_type === 'contact' ? Number(gift.contact_id) : null,
        organization_id: gift.donor_type === 'organization' ? Number(gift.organization_id) : null,
      });
    } catch (_e) { /* non-fatal — the donation already succeeded */ }
  }

  // Tags the now-captured payment as a gift, then closes the modal and
  // refreshes the list — the invoice/payment side is already done by this
  // point (via /payments/public/charge or the Auth.net webhook/confirm).
  async function completeCharge(invoiceId) {
    try {
      await api.post(`/donations/public/finalize/${invoiceId}`, {
        fund_id: gift.fund_id ? Number(gift.fund_id) : null,
        dedication_note: gift.dedication_note || null,
        is_anonymous: gift.is_anonymous,
        soft_credit_contact_id: gift.soft_credit_contact_id ? Number(gift.soft_credit_contact_id) : null,
      });
    } finally {
      setShowRecord(false);
      load();
    }
  }

  async function confirmChargeManually() {
    setConfirming(true);
    try {
      await api.post(`/payments/public/confirm/${chargeInvoiceId}`, {});
      await completeCharge(chargeInvoiceId);
    } catch (e) {
      setGiftError(parseApiError(e, 'Could not confirm payment'));
    } finally {
      setConfirming(false);
    }
  }

  // While the checkout step is open (Auth.net path), poll for webhook-driven
  // capture — same pattern InvoiceDetail uses for "Take Payment".
  useEffect(() => {
    if (chargeStep !== 'checkout' || !checkout || checkout.error || !chargeInvoiceId) return undefined;
    const t = setInterval(async () => {
      try {
        const { data: s } = await api.get(`/payments/public/status/${chargeInvoiceId}`);
        if (Number(s.balance_due) <= 0 || s.status === 'paid') {
          clearInterval(t);
          await completeCharge(chargeInvoiceId);
        }
      } catch (_e) { /* keep polling */ }
    }, 4000);
    return () => clearInterval(t);
    /* eslint-disable-next-line */
  }, [chargeStep, checkout, chargeInvoiceId]);

  function openMatch(d) {
    setMatchDonation(d);
    setMatchForm({
      matching_gift_employer: d.matching_gift_employer || '',
      matching_gift_amount: d.matching_gift_amount || '',
      matching_gift_state: d.matching_gift_state || 'eligible',
    });
  }
  async function saveMatch() {
    setMatchSaving(true);
    try {
      await api.put(`/donations/admin/${matchDonation.id}/matching-gift`, {
        matching_gift_employer: matchForm.matching_gift_employer || null,
        matching_gift_amount: matchForm.matching_gift_amount ? Number(matchForm.matching_gift_amount) : null,
        matching_gift_state: matchForm.matching_gift_state,
      });
      setMatchDonation(null);
      load();
    } finally { setMatchSaving(false); }
  }

  function exportCsv() {
    const token = localStorage.getItem('lc_impersonate_token') || localStorage.getItem('lc_token');
    const apiBase = api.defaults.baseURL;
    const url = `${apiBase}/donations/admin/export.csv`;
    fetch(url, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.blob())
      .then((blob) => {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'donations.csv';
        a.click();
      });
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div>
      <PageHeader title="Donations" subtitle="Gifts received online and recorded by staff"
        actions={<>
          <button className="btn btn-light" onClick={exportCsv}>
            <iconify-icon icon="solar:download-line-duotone" class="me-1"></iconify-icon> Export CSV
          </button>
          <Link to="/admin/donations/funds" className="btn btn-light ms-2">
            <iconify-icon icon="solar:wallet-line-duotone" class="me-1"></iconify-icon> Manage Funds
          </Link>
          {can('donations.write') && (
            <button className="btn btn-primary ms-2" onClick={openRecord}>
              <iconify-icon icon="solar:add-circle-line-duotone" class="me-1"></iconify-icon> Record Donation
            </button>
          )}
        </>} />

      {summary && (
        <div className="row g-3 mb-3">
          <div className="col-md-3">
            <div className="card"><div className="card-body">
              <div className="text-muted small">Total Raised (all time)</div>
              <div className="fs-4 fw-bold">{fmtMoney(summary.totals.total_raised)}</div>
              <div className="text-muted small">{summary.totals.gift_count} gifts</div>
              {Number(summary.totals.total_fees) > 0 && (
                <div className="text-muted small">{fmtMoney(summary.totals.total_fees)} in processing fees collected</div>
              )}
            </div></div>
          </div>
          <div className="col-md-3">
            <div className="card"><div className="card-body">
              <div className="text-muted small">This Month</div>
              <div className="fs-4 fw-bold">{fmtMoney(summary.thisMonth.total_raised)}</div>
              <div className="text-muted small">{summary.thisMonth.gift_count} gifts</div>
              {Number(summary.thisMonth.total_fees) > 0 && (
                <div className="text-muted small">{fmtMoney(summary.thisMonth.total_fees)} in fees</div>
              )}
            </div></div>
          </div>
          <div className="col-md-3">
            <div className="card"><div className="card-body">
              <div className="text-muted small mb-1">Top Funds</div>
              {summary.byFund.length ? summary.byFund.slice(0, 3).map((f) => (
                <div key={f.fund_name} className="d-flex justify-content-between small">
                  <span>{f.fund_name}</span><strong>{fmtMoney(f.total_raised)}</strong>
                </div>
              )) : <div className="text-muted small">No gifts yet.</div>}
            </div></div>
          </div>
          <div className="col-md-3">
            <div className="card"><div className="card-body">
              <div className="text-muted small">Matching Gifts Pending</div>
              <div className="fs-4 fw-bold">{fmtMoney(summary.matching?.pending_amount)}</div>
              <div className="text-muted small">{summary.matching?.pending_count || 0} gifts · {fmtMoney(summary.matching?.matched_amount)} matched</div>
            </div></div>
          </div>
        </div>
      )}

      <div className="card">
        <div className="card-body">
          <div className="row g-2 mb-3">
            <div className="col-md-3">
              <select className="form-select" value={fundId} onChange={(e) => { setFundId(e.target.value); setPage(1); }}>
                <option value="">All funds</option>
                {funds.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
              </select>
            </div>
            <div className="col-md-3">
              <input type="date" className="form-control" value={startDate}
                onChange={(e) => { setStartDate(e.target.value); setPage(1); }} placeholder="Start date" />
            </div>
            <div className="col-md-3">
              <input type="date" className="form-control" value={endDate}
                onChange={(e) => { setEndDate(e.target.value); setPage(1); }} placeholder="End date" />
            </div>
          </div>

          <div className="table-responsive">
            <table className="table table-hover align-middle mb-0">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Donor</th>
                  <th>Fund</th>
                  <th className="text-end">Amount</th>
                  <th className="text-end">Fee</th>
                  <th>Status</th>
                  <th>Match</th>
                  <th>Invoice</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((d) => (
                  <tr key={d.id}>
                    <td>{new Date(d.created_at).toLocaleDateString()}</td>
                    <td>
                      {d.is_anonymous ? <span className="text-muted">Anonymous</span> : (
                        d.contact_id ? <Link to={`/admin/contacts/${d.contact_id}`}>{d.contact_name || d.contact_email}</Link> : (d.organization_name || '—')
                      )}
                      {d.dedication_note && <div className="text-muted small">{d.dedication_note}</div>}
                    </td>
                    <td>{d.fund_name || 'Undesignated'}</td>
                    <td className="text-end fw-semibold">{fmtMoney(d.net_amount)}</td>
                    <td className="text-end text-muted small">
                      {Number(d.fee_amount) > 0 ? fmtMoney(d.fee_amount) : '—'}
                    </td>
                    <td><span className={`badge bg-${STATUS_TONE[d.payment_status] || 'secondary'}-subtle text-${STATUS_TONE[d.payment_status] || 'secondary'}`}>{d.payment_status}</span></td>
                    <td>
                      <button className="btn btn-sm btn-link p-0 text-decoration-none" onClick={() => openMatch(d)}>
                        {d.matching_gift_state && d.matching_gift_state !== 'none' ? (
                          <span className={`badge bg-${MATCH_TONE[d.matching_gift_state]}-subtle text-${MATCH_TONE[d.matching_gift_state]}`}>
                            {MATCH_LABEL[d.matching_gift_state]}{d.matching_gift_amount ? ` · ${fmtMoney(d.matching_gift_amount)}` : ''}
                          </span>
                        ) : <span className="text-muted small">+ Add</span>}
                      </button>
                    </td>
                    <td>{d.invoice_id ? <Link to={`/admin/invoices/${d.invoice_id}`}>{d.invoice_number}</Link> : '—'}</td>
                  </tr>
                ))}
                {rows.length === 0 && <tr><td colSpan="8"><div className="empty-state">No donations yet.</div></td></tr>}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div className="d-flex justify-content-between align-items-center mt-3">
              <span className="text-muted small">Page {page} of {totalPages} ({total} total)</span>
              <div>
                <button className="btn btn-sm btn-light me-1" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</button>
                <button className="btn btn-sm btn-light" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>Next</button>
              </div>
            </div>
          )}
        </div>
      </div>

      <Modal show={showRecord} onClose={() => setShowRecord(false)} title="Record Donation" size="md"
        footer={chargeStep === 'checkout'
          ? <button className="btn btn-light" onClick={() => setShowRecord(false)}>Close</button>
          : <><button className="btn btn-light" onClick={() => setShowRecord(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={saveGift} disabled={saving}>
                {saving ? 'Saving…' : (gift.method === 'card_ach' && !gift.is_in_kind ? 'Continue to payment' : 'Save')}
              </button></>}>
        <FormErrorBanner error={giftError} />
        {chargeStep === 'checkout' ? (
          <>
            {checkoutLoading && <div className="text-muted">Starting secure checkout…</div>}
            {checkout?.error && <div className="alert alert-danger">{checkout.error}</div>}
            {checkout && !checkout.error && (
              <>
                <p className="small text-muted mb-2">
                  Powered by <strong>{checkout.gateway === 'authnet' ? 'Authorize.Net' : 'Valor PayTech'}</strong>.
                  Card or bank data is entered directly into the gateway — it never touches this server.
                </p>

                {checkout.gateway === 'valor' && savedCards.length > 0 && !paymentResult && (
                  <div className="btn-group w-100 mb-3" role="group">
                    <button type="button" className={`btn btn-sm ${payMode === 'saved' ? 'btn-primary' : 'btn-light'}`}
                      onClick={() => setPayMode('saved')}>Saved card</button>
                    <button type="button" className={`btn btn-sm ${payMode === 'new' ? 'btn-primary' : 'btn-light'}`}
                      onClick={() => setPayMode('new')}>New card</button>
                  </div>
                )}

                {checkout.gateway === 'valor' && payMode === 'saved' && savedCards.length > 0 && !paymentResult && (
                  <div>
                    <VaultProfilesWidget
                      contactId={gift.donor_type === 'contact' ? Number(gift.contact_id) : null}
                      organizationId={gift.donor_type === 'organization' ? Number(gift.organization_id) : null}
                      onSelectProfile={setSelectedVaultProfile}
                      selectedId={selectedVaultProfile?.id || null}
                      compact
                    />
                    <button
                      className="btn btn-primary w-100 mt-2"
                      disabled={!selectedVaultProfile || vaultCharging}
                      onClick={() => doVaultCharge(chargeInvoiceId)}
                    >
                      {vaultCharging ? 'Charging…' : `Charge ${fmtMoney(checkout.charge_amount ?? gift.amount)}`}
                    </button>
                  </div>
                )}

                {checkout.gateway === 'valor' && payMode === 'new' && !paymentResult && (
                  <>
                    <PassagePaymentForm
                      invoiceId={chargeInvoiceId}
                      chargeAmount={checkout.charge_amount ?? Number(gift.amount)}
                      currency="USD"
                      onSuccess={async (result) => {
                        setPaymentResult({ outcome: 'success', ...result });
                        await saveCardIfRequested(result);
                        await completeCharge(chargeInvoiceId);
                      }}
                      onDeclined={({ message }) => setPaymentResult({ outcome: 'declined', message })}
                      onCancel={() => { setChargeStep('form'); setCheckout(null); setPaymentResult(null); }}
                    />
                    <div className="form-check mt-2">
                      <input className="form-check-input" type="checkbox" id="save_card_on_file" checked={saveCardChecked}
                        onChange={(e) => setSaveCardChecked(e.target.checked)} />
                      <label className="form-check-label small" htmlFor="save_card_on_file">
                        Save this card on file for {gift.donor_type === 'contact'
                          ? (contacts.find((c) => String(c.id) === String(gift.contact_id))?.first_name || 'this contact')
                          : (orgs.find((o) => String(o.id) === String(gift.organization_id))?.name || 'this organization')}
                      </label>
                    </div>
                  </>
                )}

                {checkout.gateway === 'valor' && paymentResult?.outcome === 'declined' && (
                  <div className="mt-2">
                    <div className="alert alert-danger mb-3">
                      <strong>Payment declined</strong> — {paymentResult.message}
                    </div>
                    <button className="btn btn-outline-primary w-100" onClick={() => setPaymentResult(null)}>
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
                      target="donation-authnet-iframe"
                      style={{ display: 'none' }}
                    >
                      <input type="hidden" name="token" value={checkout.token} />
                    </form>
                    <iframe
                      name="donation-authnet-iframe"
                      title="Authorize.Net Checkout"
                      style={{ width: '100%', height: 620, border: '1px solid #e5e7eb', borderRadius: 8 }}
                      allow="payment"
                    />
                  </>
                )}

                {checkout.gateway === 'authnet' && (
                  <div className="alert alert-light small mt-3 mb-0 d-flex justify-content-between align-items-center">
                    <span>Once payment completes, this will finish automatically. Polling every 4s.</span>
                    <button
                      className="btn btn-sm btn-outline-success ms-3"
                      onClick={confirmChargeManually}
                      disabled={confirming}
                    >
                      {confirming ? 'Confirming…' : "I've completed payment"}
                    </button>
                  </div>
                )}
              </>
            )}
          </>
        ) : (
        <div className="row g-2">
          <div className="col-12">
            <div className="btn-group w-100" role="group">
              <button type="button" className={`btn btn-sm ${gift.donor_type === 'contact' ? 'btn-primary' : 'btn-light'}`}
                onClick={() => setGift({ ...gift, donor_type: 'contact' })}>Contact</button>
              <button type="button" className={`btn btn-sm ${gift.donor_type === 'organization' ? 'btn-primary' : 'btn-light'}`}
                onClick={() => setGift({ ...gift, donor_type: 'organization' })}>Organization</button>
            </div>
          </div>
          <div className="col-12">
            {gift.donor_type === 'contact' ? (
              <SearchableSelect
                options={contacts.map((c) => ({ value: c.id, label: `${c.first_name} ${c.last_name}`, sublabel: c.email }))}
                value={gift.contact_id}
                onChange={(v) => setGift({ ...gift, contact_id: v })}
                placeholder="Search contacts…"
              />
            ) : (
              <SearchableSelect
                options={orgs.map((o) => ({ value: o.id, label: o.name }))}
                value={gift.organization_id}
                onChange={(v) => setGift({ ...gift, organization_id: v })}
                placeholder="Search organizations…"
              />
            )}
          </div>
          <div className="col-md-6"><label className="form-label">Fund (optional)</label>
            <select className="form-select" value={gift.fund_id} onChange={(e) => setGift({ ...gift, fund_id: e.target.value })}>
              <option value="">Where needed most</option>
              {funds.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select></div>
          <div className="col-md-6"><label className="form-label">Date received</label>
            <input type="date" className="form-control" value={gift.received_at} onChange={(e) => setGift({ ...gift, received_at: e.target.value })} /></div>

          <div className="col-12">
            <div className="form-check form-switch">
              <input className="form-check-input" type="checkbox" id="gift_in_kind" checked={gift.is_in_kind}
                onChange={(e) => setGift({ ...gift, is_in_kind: e.target.checked })} />
              <label className="form-check-label" htmlFor="gift_in_kind">This is an in-kind gift (goods/services, not cash)</label>
            </div>
          </div>

          {gift.is_in_kind ? (
            <>
              <div className="col-12"><label className="form-label">Description</label>
                <input className="form-control" value={gift.in_kind_description} onChange={(e) => setGift({ ...gift, in_kind_description: e.target.value })} placeholder="e.g. Office supplies donated by Acme Corp" /></div>
              <div className="col-md-6"><label className="form-label">Fair market value ($)</label>
                <input type="number" step="0.01" className="form-control" value={gift.amount} onChange={(e) => setGift({ ...gift, amount: e.target.value })} /></div>
            </>
          ) : (
            <>
              <div className="col-md-6"><label className="form-label">Amount ($)</label>
                <input type="number" step="0.01" className="form-control" value={gift.amount} onChange={(e) => setGift({ ...gift, amount: e.target.value })} /></div>
              <div className="col-md-6"><label className="form-label">Method</label>
                <select className="form-select" value={gift.method} onChange={(e) => setGift({ ...gift, method: e.target.value })}>
                  <option value="check">Check</option>
                  <option value="cash">Cash</option>
                  <option value="wire">Wire</option>
                  <option value="card_ach">Credit card / ACH (charge now)</option>
                  <option value="other">Other</option>
                </select>
                {gift.method === 'card_ach' && (
                  <div className="form-text">Saving will open a secure card/bank entry form — nothing is charged until that's completed.</div>
                )}
                {gift.method === 'card_ach' && feeInfo?.mandatory_active && (
                  feeWouldApply ? (
                    <div className="small mt-1 p-2 bg-light rounded d-flex justify-content-between">
                      <span>
                        {feeInfo.fee_label || 'Processing fee'}
                        {feeInfo.fee_percent > 0 && ` (${feeInfo.fee_percent}%${feeInfo.fee_fixed > 0 ? ` + ${fmtMoney(feeInfo.fee_fixed)}` : ''})`}
                        {previewFee > 0 && <>: {fmtMoney(previewFee)}</>}
                      </span>
                      <strong>Total to charge: {fmtMoney(previewTotal)}</strong>
                    </div>
                  ) : (
                    <div className="small mt-1 text-muted">
                      No processing fee will be added — this gateway only surcharges organization-billed gifts.
                    </div>
                  )
                )}</div>
              <div className="col-md-6"><label className="form-label">Value received in exchange ($, optional)</label>
                <input type="number" step="0.01" className="form-control" value={gift.quid_pro_quo_value} onChange={(e) => setGift({ ...gift, quid_pro_quo_value: e.target.value })} />
                <div className="form-text">e.g. a gala dinner's value — reduces the tax-deductible amount on the receipt.</div></div>
            </>
          )}

          <div className="col-12"><label className="form-label">Soft credit (optional)</label>
            <SearchableSelect
              options={contacts.map((c) => ({ value: c.id, label: `${c.first_name} ${c.last_name}`, sublabel: c.email }))}
              value={gift.soft_credit_contact_id}
              onChange={(v) => setGift({ ...gift, soft_credit_contact_id: v })}
              placeholder="Credit another contact for influencing this gift…"
            />
          </div>
          <div className="col-12"><label className="form-label">Dedication / note (optional)</label>
            <input className="form-control" value={gift.dedication_note} onChange={(e) => setGift({ ...gift, dedication_note: e.target.value })} placeholder="In honor of…" /></div>
          <div className="col-12">
            <div className="form-check">
              <input className="form-check-input" type="checkbox" id="gift_anonymous" checked={gift.is_anonymous}
                onChange={(e) => setGift({ ...gift, is_anonymous: e.target.checked })} />
              <label className="form-check-label" htmlFor="gift_anonymous">Donor wishes to remain anonymous</label>
            </div>
          </div>
        </div>
        )}
      </Modal>

      <Modal show={!!matchDonation} onClose={() => setMatchDonation(null)} title="Matching Gift" size="sm"
        footer={<><button className="btn btn-light" onClick={() => setMatchDonation(null)}>Cancel</button>
                  <button className="btn btn-primary" onClick={saveMatch} disabled={matchSaving}>{matchSaving ? 'Saving…' : 'Save'}</button></>}>
        <div className="row g-2">
          <div className="col-12"><label className="form-label">Employer</label>
            <input className="form-control" value={matchForm.matching_gift_employer}
              onChange={(e) => setMatchForm({ ...matchForm, matching_gift_employer: e.target.value })} placeholder="Acme Corp" /></div>
          <div className="col-12"><label className="form-label">Status</label>
            <select className="form-select" value={matchForm.matching_gift_state}
              onChange={(e) => setMatchForm({ ...matchForm, matching_gift_state: e.target.value })}>
              <option value="none">Not applicable</option>
              <option value="eligible">Eligible (donor says employer matches)</option>
              <option value="submitted">Submitted to employer</option>
              <option value="matched">Matched — received</option>
              <option value="denied">Denied</option>
            </select></div>
          <div className="col-12"><label className="form-label">Matched amount ($)</label>
            <input type="number" step="0.01" className="form-control" value={matchForm.matching_gift_amount}
              onChange={(e) => setMatchForm({ ...matchForm, matching_gift_amount: e.target.value })} /></div>
        </div>
      </Modal>
    </div>
  );
}
