// Unified "give" widget — the single bottom-of-page block a tier card's
// Select button scrolls to (href="#give"), replacing the old pattern where
// clicking a membership tier opened a slide-out modal. One widget, one
// checkout flow, reused across membership tiers AND general donations.
//
// Each tab is one of two *kinds*:
//   - 'membership': amounts are LIVE tiers from /api/membership/public/tiers
//     (skip/limit-sliced exactly like MembershipBlock — same convention,
//     same reason: membership_tiers has no category column, so sort_order
//     ranges stand in for "Supporting" vs "Founding" vs "Partner"). A tier's
//     price is fixed, so the custom-amount field and fee-cover option are
//     hidden for these tabs, but the one-time/monthly toggle stays: one-time
//     buys a year of membership, monthly bills the tier price every month
//     until cancelled (server/src/services/membershipTerms.js). The payment
//     step always runs the real membership signup (MembershipCheckout ->
//     /api/membership/public/signup), which creates the actual tier-linked
//     subscription Admin -> Membership reports on.
//   - 'donation': behaves exactly like DonationBlock's own flow (its own
//     configurable amount list, real one-time/monthly choice, optional fee
//     cover) — for general giving that isn't tied to a membership tier.
//
// MembershipBlock's tier cards no longer open a modal — they're plain
// anchors to #give that also dispatch a `kc:select-tier` window event
// carrying the tier's slug. This widget listens for that event and jumps to
// the matching tab + tier so the browser's own anchor scroll and this
// widget's own pre-selection happen together, with no shared React state
// needed between the two independent builder nodes.

import { useEffect, useState } from 'react';
import { useEditor, useNode } from '@craftjs/core';
import api from '../../api/client.js';
import DonationCheckout from '../../frontend/components/DonationCheckout.jsx';
import DonationRecurringCheckout from '../../frontend/components/DonationRecurringCheckout.jsx';
import MembershipCheckout from '../../frontend/components/MembershipCheckout.jsx';
import { FieldGroup, NumberField, RepeaterField, SelectField, TextField, TextareaField, ToggleField } from '../fields/index.jsx';
import { IDENTITY_DEFAULTS, cx, useDomIdentity, useNodeRef } from './nodeUtils.js';

const money = (n) => `$${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: Number.isInteger(Number(n)) ? 0 : 2, maximumFractionDigits: 2 })}`;

/** "50,100*,250" -> [{value:50},{value:100,popular:true},{value:250}] */
function parseAmounts(spec) {
  return String(spec || '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => ({ value: Number(part.replace('*', '')) || 0, popular: part.includes('*') }))
    .filter((a) => a.value > 0);
}

export default function GiveWidgetBlock({
  heading,
  blurb,
  tabs,
  stepHeading,
  stepLead,
  impactText,
  backLabel,
  backUrl,
  fundSlug,
  allowCustom,
  coverFeesOption,
  coverFeesLabel,
  buttonLabel,
  thankYouText,
  disclaimerText,
}) {
  const ref = useNodeRef();
  const { enabled: editing } = useEditor((state) => ({ enabled: state.options.enabled }));
  const { domId, customClass } = useDomIdentity('give');

  const tabList = Array.isArray(tabs) ? tabs.filter((t) => t && t.label) : [];
  const [tabIndex, setTabIndex] = useState(0);
  const activeTab = tabList[tabIndex] || null;
  const isMembership = activeTab?.kind === 'membership';

  const [tiers, setTiers] = useState([]);
  const [tiersLoaded, setTiersLoaded] = useState(false);

  useEffect(() => {
    if (!tabList.some((t) => t.kind === 'membership')) { setTiersLoaded(true); return; }
    let cancelled = false;
    api.get('/membership/public/tiers')
      .then(({ data }) => { if (!cancelled) setTiers(Array.isArray(data) ? data : []); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setTiersLoaded(true); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A membership tab's presets are real tiers sliced by skip/limit; a
  // donation tab's are its own configured amount spec. Either way each
  // preset carries `tierSlug` when (and only when) it's a real tier, since
  // that's what decides the checkout routing below.
  const presets = isMembership
    ? tiers.slice(Math.max(0, Number(activeTab.skip) || 0), (Number(activeTab.limit) || 0) > 0 ? Math.max(0, Number(activeTab.skip) || 0) + Number(activeTab.limit) : undefined)
      .map((t) => ({ value: Number(t.price), tierSlug: t.slug, popular: Boolean((t.benefits_json || {}).badge) }))
    : (activeTab ? parseAmounts(activeTab.amounts) : []);
  const impact = activeTab?.impact || impactText || '';

  const [frequency, setFrequency] = useState('once');
  const [amount, setAmount] = useState(() => Number(presets[0]?.value) || 0);
  const [tierSlug, setTierSlug] = useState(() => presets[0]?.tierSlug || null);
  const [custom, setCustom] = useState('');
  const [step, setStep] = useState(1);
  const [donor, setDonor] = useState({ first_name: '', last_name: '', email: '' });
  const [coverFees, setCoverFees] = useState(false);
  const [fee, setFee] = useState({ percent: 0, fixed: 0, available: false });
  const [checkout, setCheckout] = useState(null);
  const [recurring, setRecurring] = useState(null);
  const [membershipSignup, setMembershipSignup] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  // Switching tab re-picks that tab's first preset, so the selection can
  // never point at a price/tier the new tab doesn't offer.
  useEffect(() => {
    if (presets.length) {
      setAmount(Number(presets[0].value));
      setTierSlug(presets[0].tierSlug || null);
      setCustom('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabIndex, tiersLoaded]);

  useEffect(() => {
    if (!coverFeesOption) return;
    let cancelled = false;
    api.get('/donations/public/fee-info')
      .then((r) => { if (!cancelled) setFee({ percent: Number(r.data?.fee_percent || 0), fixed: Number(r.data?.fee_fixed || 0), available: true }); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [coverFeesOption]);

  // Bridge from MembershipBlock's tier cards — see file header. Jumps to
  // whichever tab's slice actually contains the matching tier, so this
  // keeps working even if tiers get reordered or a tab's skip/limit changes.
  useEffect(() => {
    function onSelectTier(e) {
      const slug = e?.detail?.tierSlug;
      if (!slug || !tiersLoaded) return;
      const idx = tiers.findIndex((t) => t.slug === slug);
      if (idx === -1) return;
      const tabI = tabList.findIndex((t) => {
        if (t.kind !== 'membership') return false;
        const from = Math.max(0, Number(t.skip) || 0);
        const count = Number(t.limit) || 0;
        const to = count > 0 ? from + count : tiers.length;
        return idx >= from && idx < to;
      });
      if (tabI === -1) return;
      setTabIndex(tabI);
      setAmount(Number(tiers[idx].price));
      setTierSlug(tiers[idx].slug);
      setCustom('');
      setStep(1);
      setDone(false);
      setCheckout(null);
      setRecurring(null);
      setMembershipSignup(null);
    }
    window.addEventListener('kc:select-tier', onSelectTier);
    return () => window.removeEventListener('kc:select-tier', onSelectTier);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tiers, tiersLoaded]);

  const effectiveAmount = (!isMembership && custom) ? Number(custom) : amount;
  const feeAmount = (!isMembership && fee.available && effectiveAmount > 0)
    ? Math.round((effectiveAmount * (fee.percent / 100) + fee.fixed) * 100) / 100
    : 0;

  function toStepTwo(event) {
    event.preventDefault();
    setError('');
    if (!effectiveAmount || effectiveAmount <= 0) return setError('Choose or enter an amount.');
    setStep(2);
  }

  async function start(event) {
    event.preventDefault();
    setError('');
    if (!donor.email) return setError('Email is required.');

    if (isMembership) {
      if (!tierSlug) return setError('Choose a membership level.');
      setMembershipSignup({ tierSlug, donor, frequency });
      return;
    }
    if (frequency === 'monthly') {
      setRecurring({
        amount: effectiveAmount,
        fundSlug: fundSlug || null,
        donor,
        intervalUnit: 'month',
        intervalCount: 1,
        source: 'give_widget',
      });
      return;
    }
    setBusy(true);
    try {
      const { data } = await api.post('/donations/public/checkout', {
        amount: effectiveAmount,
        fund_slug: fundSlug || undefined,
        donor,
        cover_fees: coverFees,
      });
      setCheckout(data);
    } catch (e) {
      setError(e.response?.data?.error || 'Could not start the donation.');
    } finally {
      setBusy(false);
    }
  }

  const amountGrid = (
    <div className="amount-grid">
      {presets.map((preset) => {
        const selected = isMembership
          ? tierSlug === preset.tierSlug
          : (!custom && Number(preset.value) === amount);
        return (
          <label key={preset.tierSlug || preset.value} className={cx('amount-option', selected && 'is-selected')}>
            <input
              type="radio"
              name={`${domId}-amount`}
              checked={selected}
              onChange={() => {
                setAmount(Number(preset.value));
                setTierSlug(preset.tierSlug || null);
                setCustom('');
              }}
            />
            {money(preset.value)}
            {preset.popular && <span className="popular-badge">Popular</span>}
          </label>
        );
      })}
    </div>
  );

  return (
    <div ref={ref} id={domId} className={cx('donate-panel', customClass)}>
      {heading && <h3 className="donate-panel__heading">{heading}</h3>}
      {blurb && <p className="donate-panel__blurb">{blurb}</p>}

      {done ? (
        <div className="form-note">{thankYouText}</div>
      ) : membershipSignup && !editing ? (
        <MembershipCheckout
          signup={membershipSignup}
          onSuccess={() => setDone(true)}
          onError={(msg) => setError(msg || 'That signup could not be completed.')}
          onCancel={() => setMembershipSignup(null)}
        />
      ) : recurring && !editing ? (
        <DonationRecurringCheckout
          donation={recurring}
          onSuccess={() => setDone(true)}
          onError={(msg) => setError(msg || 'That payment could not be set up.')}
          onCancel={() => setRecurring(null)}
        />
      ) : checkout && !editing ? (
        <DonationCheckout
          invoiceId={checkout.invoiceId}
          chargeAmount={checkout.total}
          onSuccess={async () => {
            try {
              await api.post(`/donations/public/finalize/${checkout.invoiceId}`, {
                payment_token: checkout.payment_token,
              });
            } catch { /* the gift is recorded server-side either way */ }
            setDone(true);
          }}
          onDeclined={() => setError('That payment was declined. Please try another card.')}
          onCancel={() => setCheckout(null)}
        />
      ) : (
        <>
          {tabList.length > 1 && (
            <div className="donate-tabs" role="tablist">
              {tabList.map((tab, i) => (
                <button
                  key={tab.label}
                  type="button"
                  role="tab"
                  aria-selected={i === tabIndex}
                  className={cx('donate-tab', i === tabIndex && 'is-active')}
                  onClick={() => { setTabIndex(i); setStep(1); }}
                  dangerouslySetInnerHTML={{ __html: String(tab.label).replace(/\s*\|\s*/, '<br />') }}
                />
              ))}
            </div>
          )}

          {step === 1 ? (
            <form className="donate-step-panel" onSubmit={toStepTwo}>
              {stepHeading && <h2>{stepHeading}</h2>}
              {stepLead && <p className="donate-lead">{stepLead}</p>}

              <div className="freq-toggle">
                <label>
                  <input type="radio" name={`${domId}-freq`} checked={frequency === 'once'} onChange={() => setFrequency('once')} />
                  One-time
                </label>
                <label>
                  <input type="radio" name={`${domId}-freq`} checked={frequency === 'monthly'} onChange={() => setFrequency('monthly')} />
                  Monthly
                </label>
              </div>

              {!tiersLoaded && isMembership ? (
                <div className="bx-editor-note">Loading membership tiers…</div>
              ) : amountGrid}

              {!isMembership && allowCustom && (
                <div className="custom-amount-wrap">
                  <span className="currency">$</span>
                  <input
                    type="number"
                    min="1"
                    step="0.01"
                    inputMode="decimal"
                    value={custom}
                    placeholder="Other amount"
                    aria-label="Other amount"
                    onChange={(e) => setCustom(e.target.value)}
                  />
                </div>
              )}

              {impact && <p className="impact-hint"><strong>Your impact: </strong><span>{impact}</span></p>}

              {!isMembership && coverFeesOption && (
                <div className="fee-row">
                  <input id={`${domId}-fees`} type="checkbox" checked={coverFees} onChange={(e) => setCoverFees(e.target.checked)} />
                  <div>
                    <label htmlFor={`${domId}-fees`}>
                      <strong>{coverFeesLabel}{feeAmount > 0 ? ` (${money(feeAmount)})` : ''}</strong>
                    </label>
                    <span>Help more of your gift reach the mission by offsetting standard card processing costs.</span>
                  </div>
                </div>
              )}

              {error && <div className="form-error">{error}</div>}

              <div className="donate-nav-btns">
                {backLabel ? <a className="btn btn--outline-dark" href={backUrl || '#'}>{backLabel}</a> : <span />}
                <button type="submit" className="btn btn--gold" disabled={editing}>{buttonLabel}</button>
              </div>
            </form>
          ) : (
            <form className="donate-step-panel" onSubmit={start}>
              <h2>Your details</h2>
              <p className="donate-lead">
                {isMembership
                  ? (frequency === 'monthly'
                    ? `${money(effectiveAmount)} every month, until you cancel`
                    : `${money(effectiveAmount)} one-time — 1 year of membership`)
                  : (frequency === 'monthly' ? `${money(effectiveAmount)} every month` : money(effectiveAmount))}
                {!isMembership && coverFees && feeAmount > 0 && frequency === 'once' ? ` + ${money(feeAmount)} fees` : ''}
              </p>

              <div className="form-grid two-col">
                <div className="form-field">
                  <label htmlFor={`${domId}-first`}>First name</label>
                  <input id={`${domId}-first`} value={donor.first_name} onChange={(e) => setDonor({ ...donor, first_name: e.target.value })} />
                </div>
                <div className="form-field">
                  <label htmlFor={`${domId}-last`}>Last name</label>
                  <input id={`${domId}-last`} value={donor.last_name} onChange={(e) => setDonor({ ...donor, last_name: e.target.value })} />
                </div>
              </div>
              <div className="form-field">
                <label htmlFor={`${domId}-email`}>Email <span className="required">*</span></label>
                <input id={`${domId}-email`} type="email" required value={donor.email} onChange={(e) => setDonor({ ...donor, email: e.target.value })} />
              </div>

              {error && <div className="form-error">{error}</div>}

              <div className="donate-nav-btns">
                <button type="button" className="btn btn--outline-dark" onClick={() => { setStep(1); setError(''); }}>← Back</button>
                <button type="submit" className="btn btn--gold" disabled={busy || editing}>
                  {busy ? 'Starting…' : 'Continue'}
                </button>
              </div>

              {disclaimerText && <p className="donate-secure">{disclaimerText}</p>}
            </form>
          )}

          {editing && (
            <div className="bx-editor-note">
              <i className="fa-solid fa-shield-halved" /> Payment is disabled inside the builder. This form is live on the published page.
            </div>
          )}
        </>
      )}
    </div>
  );
}

function GiveWidgetSettings() {
  const { props, actions: { setProp } } = useNode((node) => ({ props: node.data.props }));
  const p = (key) => (value) => setProp((s) => { s[key] = value; });
  return (
    <>
      <FieldGroup title="Content">
        <TextField label="Heading" value={props.heading} onChange={p('heading')} hint="Leave blank if a Heading block already sits above this one." />
        <TextareaField label="Intro text" value={props.blurb} onChange={p('blurb')} rows={3} />
        <TextField label="Step heading" value={props.stepHeading} onChange={p('stepHeading')} placeholder="Choose your gift" />
        <TextField label="Step intro" value={props.stepLead} onChange={p('stepLead')} placeholder="Select one-time or monthly, then pick an amount." />
        <TextField label="Button label" value={props.buttonLabel} onChange={p('buttonLabel')} />
        <TextareaField label="Thank-you message" value={props.thankYouText} onChange={p('thankYouText')} rows={2} />
      </FieldGroup>

      <FieldGroup title="Tabs">
        <RepeaterField
          value={props.tabs}
          onChange={p('tabs')}
          addLabel="Add tab"
          itemLabel={(item) => item.label || 'Tab'}
          newItem={{ label: '', kind: 'donation', amounts: '50,100*,250', skip: 0, limit: 3, impact: '' }}
          renderItem={(item, patch) => (
            <>
              <TextField label="Tab label" value={item.label} onChange={(v) => patch({ label: v })} hint="Use | to split it over two lines: Supporting | Membership" />
              <SelectField
                label="Tab type"
                value={item.kind || 'donation'}
                onChange={(v) => patch({ kind: v })}
                options={[
                  { value: 'membership', label: 'Membership tiers (live from Admin → Membership)' },
                  { value: 'donation', label: 'Donation amounts (set below)' },
                ]}
              />
              {item.kind === 'membership' ? (
                <>
                  <NumberField label="Skip" value={item.skip} onChange={(v) => patch({ skip: v })} min={0} hint="Skip this many tiers from the start of the list (by sort order)." />
                  <NumberField label="Limit" value={item.limit} onChange={(v) => patch({ limit: v })} min={0} hint="How many tiers this tab shows after skipping. 0 shows all remaining." />
                </>
              ) : (
                <TextField label="Amounts" value={item.amounts} onChange={(v) => patch({ amounts: v })} hint="Comma separated. Mark the popular one with * — 50,100*,250" />
              )}
              <TextareaField label="Impact line" value={item.impact} onChange={(v) => patch({ impact: v })} rows={2} />
            </>
          )}
        />
      </FieldGroup>

      <FieldGroup title="Donation tab options" defaultOpen={false}>
        <ToggleField label="Allow a custom amount" value={props.allowCustom} onChange={p('allowCustom')} hint="Donation-kind tabs only — a membership tier's price is fixed." />
        <ToggleField label="Offer to cover processing fees" value={props.coverFeesOption} onChange={p('coverFeesOption')} hint="Donation-kind tabs only." />
        <TextField label="Cover-fees checkbox label" value={props.coverFeesLabel} onChange={p('coverFeesLabel')} />
        <TextField
          label="Fund slug"
          value={props.fundSlug}
          onChange={p('fundSlug')}
          hint="Optional. Attributes general donations to a fund from Admin → Donations → Funds."
        />
      </FieldGroup>

      <FieldGroup title="Back link" defaultOpen={false}>
        <TextField label="Back button label" value={props.backLabel} onChange={p('backLabel')} placeholder="← Membership levels" />
        <TextField label="Back button link" value={props.backUrl} onChange={p('backUrl')} placeholder="#levels" />
      </FieldGroup>

      <FieldGroup title="Disclaimer" defaultOpen={false}>
        <TextareaField label="Disclaimer text" value={props.disclaimerText} onChange={p('disclaimerText')} rows={2} />
      </FieldGroup>

      <FieldGroup title="Identity" defaultOpen={false}>
        <TextField label="Custom ID" value={props.customId} onChange={p('customId')} />
        <TextField label="Custom CSS class" value={props.customClass} onChange={p('customClass')} />
      </FieldGroup>
    </>
  );
}

GiveWidgetBlock.craft = {
  displayName: 'Give Widget',
  props: {
    ...IDENTITY_DEFAULTS,
    heading: '',
    blurb: '',
    stepHeading: 'Choose your gift',
    stepLead: 'Select one-time or monthly, then pick an amount.',
    tabs: [
      { label: 'Supporting | Membership', kind: 'membership', skip: 0, limit: 3, impact: '' },
      { label: 'Founding | Membership', kind: 'membership', skip: 3, limit: 3, impact: '' },
      { label: 'Partner | Membership', kind: 'membership', skip: 6, limit: 3, impact: '' },
      { label: 'General | Donations', kind: 'donation', amounts: '25,50,100*,250,500,1000', impact: '' },
    ],
    allowCustom: true,
    coverFeesOption: true,
    coverFeesLabel: 'Cover processing fees',
    fundSlug: '',
    backLabel: '← Membership levels',
    backUrl: '#levels',
    buttonLabel: 'Continue',
    thankYouText: 'Thank you — your gift has been received. A receipt is on its way to your email.',
    disclaimerText: 'Payments processed securely. A receipt is sent to your email automatically.',
  },
  related: { settings: GiveWidgetSettings },
};
