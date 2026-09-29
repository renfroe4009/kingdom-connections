// Payment / donation block.
//
// On the live site this runs the real flow: pick an amount → a synthetic
// invoice is created via /api/donations/public/checkout → the shared
// DonationCheckout component takes over for the gateway step. A monthly gift
// goes through /public/recurring-intent and DonationRecurringCheckout instead.
//
// In the builder it renders a safe, non-functional preview. That decision is
// made from the editor's own state (`useEditor(state => state.options.enabled)`)
// and never by inspecting the URL — the same component is mounted in both
// places and only Craft knows which is which.
//
// MARKUP: the design's own `.donate-panel` (see website-files/join.html) —
// tabs, one-time/monthly toggle, an amount grid with a POPULAR badge, the
// impact line and the fee row. Those classes are styled site-wide by the
// imported stylesheet, so the block looks like the mockup rather than like a
// generic form, while still being the real, working checkout.

import { useEffect, useState } from 'react';
import { useEditor, useNode } from '@craftjs/core';
import api from '../../api/client.js';
import DonationCheckout from '../../frontend/components/DonationCheckout.jsx';
import DonationRecurringCheckout from '../../frontend/components/DonationRecurringCheckout.jsx';
import { FieldGroup, RepeaterField, TextField, TextareaField, ToggleField } from '../fields/index.jsx';
import { IDENTITY_DEFAULTS, cx, useDomIdentity, useNodeRef } from './nodeUtils.js';

const money = (n) => `$${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: Number.isInteger(Number(n)) ? 0 : 2, maximumFractionDigits: 2 })}`;

/** "50,100*,250" → [{value:50},{value:100,popular:true},{value:250}] */
function parseAmounts(spec) {
  return String(spec || '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => ({ value: Number(part.replace('*', '')) || 0, popular: part.includes('*') }))
    .filter((a) => a.value > 0);
}

export default function DonationBlock({
  heading,
  blurb,
  amounts,
  allowCustom,
  allowMonthly,
  tabs,
  stepHeading,
  stepLead,
  impactText,
  backLabel,
  backUrl,
  fundSlug,
  buttonLabel,
  thankYouText,
  coverFeesOption,
  coverFeesLabel,
  disclaimerText,
}) {
  const ref = useNodeRef();
  const { enabled: editing } = useEditor((state) => ({ enabled: state.options.enabled }));
  const { domId, customClass } = useDomIdentity('donate');

  const tabList = Array.isArray(tabs) ? tabs.filter((t) => t && t.label) : [];
  const [tabIndex, setTabIndex] = useState(0);
  const activeTab = tabList[tabIndex] || null;

  // A tab carries its own amounts and impact line; without tabs the block's
  // own Amounts list is used, so an existing block keeps working untouched.
  const presets = activeTab
    ? parseAmounts(activeTab.amounts)
    : (Array.isArray(amounts) ? amounts : []).map((a) => ({ value: Number(a.value), popular: /popular/i.test(a.label || '') }));
  const impact = activeTab?.impact || impactText || '';

  const [frequency, setFrequency] = useState('once');
  const [amount, setAmount] = useState(() => Number(presets[0]?.value) || 50);
  const [custom, setCustom] = useState('');
  const [step, setStep] = useState(1);
  const [donor, setDonor] = useState({ first_name: '', last_name: '', email: '' });
  const [coverFees, setCoverFees] = useState(false);
  const [fee, setFee] = useState({ percent: 0, fixed: 0, available: false });
  const [checkout, setCheckout] = useState(null);
  const [recurring, setRecurring] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  // Switching tab re-picks that tab's first amount, so the selection can never
  // point at a price the new tab doesn't offer.
  useEffect(() => {
    if (presets.length) { setAmount(Number(presets[0].value)); setCustom(''); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabIndex]);

  // The design shows the fee in the checkbox label ("Cover processing fees
  // ($3.20)"), so the real rate has to come from the gateway settings.
  useEffect(() => {
    if (!coverFeesOption) return;
    let cancelled = false;
    api.get('/donations/public/fee-info')
      .then((r) => { if (!cancelled) setFee({ percent: Number(r.data?.fee_percent || 0), fixed: Number(r.data?.fee_fixed || 0), available: true }); })
      .catch(() => { /* no gateway configured yet — the checkbox just shows no figure */ });
    return () => { cancelled = true; };
  }, [coverFeesOption]);

  const effectiveAmount = custom ? Number(custom) : amount;
  const feeAmount = fee.available && effectiveAmount > 0
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
    if (frequency === 'monthly') {
      setRecurring({
        amount: effectiveAmount,
        fundSlug: fundSlug || null,
        donor,
        intervalUnit: 'month',
        intervalCount: 1,
        source: 'donation_block',
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
        const selected = !custom && Number(preset.value) === amount;
        return (
          <label key={preset.value} className={cx('amount-option', selected && 'is-selected')}>
            <input
              type="radio"
              name={`${domId}-amount`}
              checked={selected}
              onChange={() => { setAmount(Number(preset.value)); setCustom(''); }}
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

              {allowMonthly && (
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
              )}

              {amountGrid}

              {allowCustom && (
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

              {coverFeesOption && (
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
                {frequency === 'monthly' ? `${money(effectiveAmount)} every month` : money(effectiveAmount)}
                {coverFees && feeAmount > 0 && frequency === 'once' ? ` + ${money(feeAmount)} fees` : ''}
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

function DonationSettings() {
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

      <FieldGroup title="Tabs" defaultOpen={false}>
        <RepeaterField
          value={props.tabs}
          onChange={p('tabs')}
          addLabel="Add tab"
          itemLabel={(item) => item.label || 'Tab'}
          newItem={{ label: '', amounts: '50,100*,250', impact: '' }}
          renderItem={(item, patch) => (
            <>
              <TextField label="Tab label" value={item.label} onChange={(v) => patch({ label: v })} hint="Use | to split it over two lines: Supporting | Membership" />
              <TextField label="Amounts" value={item.amounts} onChange={(v) => patch({ amounts: v })} hint="Comma separated. Mark the popular one with * — 50,100*,250" />
              <TextareaField label="Impact line" value={item.impact} onChange={(v) => patch({ impact: v })} rows={2} />
            </>
          )}
        />
      </FieldGroup>

      <FieldGroup title="Amounts">
        <RepeaterField
          value={props.amounts}
          onChange={p('amounts')}
          addLabel="Add amount"
          itemLabel={(item) => item.label || `$${item.value}`}
          newItem={{ value: 50, label: '' }}
          renderItem={(item, patch) => (
            <>
              <TextField label="Amount" type="number" value={item.value} onChange={(v) => patch({ value: Number(v) })} />
              <TextField label="Label" value={item.label} onChange={(v) => patch({ label: v })} placeholder="Popular" hint='Write "Popular" to badge this amount.' />
            </>
          )}
        />
        <ToggleField label="Allow a custom amount" value={props.allowCustom} onChange={p('allowCustom')} />
        <ToggleField label="Offer monthly giving" value={props.allowMonthly} onChange={p('allowMonthly')} />
        <ToggleField label="Offer to cover processing fees" value={props.coverFeesOption} onChange={p('coverFeesOption')} />
        <TextField label="Cover-fees checkbox label" value={props.coverFeesLabel} onChange={p('coverFeesLabel')} />
        <TextareaField label="Impact line" value={props.impactText} onChange={p('impactText')} rows={2} hint="Shown under the amounts when no tab supplies its own." />
        <TextField
          label="Fund slug"
          value={props.fundSlug}
          onChange={p('fundSlug')}
          hint="Optional. Attributes gifts to a fund from Admin → Donations → Funds."
        />
      </FieldGroup>

      <FieldGroup title="Back link" defaultOpen={false}>
        <TextField label="Back button label" value={props.backLabel} onChange={p('backLabel')} placeholder="← Membership levels" />
        <TextField label="Back button link" value={props.backUrl} onChange={p('backUrl')} placeholder="#levels" />
      </FieldGroup>

      <FieldGroup title="Disclaimer">
        <TextareaField label="Disclaimer text" value={props.disclaimerText} onChange={p('disclaimerText')} rows={2} />
      </FieldGroup>

      <FieldGroup title="Identity" defaultOpen={false}>
        <TextField label="Custom ID" value={props.customId} onChange={p('customId')} />
        <TextField label="Custom CSS class" value={props.customClass} onChange={p('customClass')} />
      </FieldGroup>
    </>
  );
}

DonationBlock.craft = {
  displayName: 'Donation / Payment',
  props: {
    ...IDENTITY_DEFAULTS,
    heading: '',
    blurb: '',
    stepHeading: 'Choose your gift',
    stepLead: 'Select one-time or monthly, then pick an amount.',
    amounts: [
      { value: 25, label: '' },
      { value: 50, label: '' },
      { value: 100, label: 'Popular' },
      { value: 250, label: '' },
    ],
    tabs: [],
    allowCustom: true,
    allowMonthly: true,
    impactText: '',
    coverFeesOption: true,
    coverFeesLabel: 'Cover processing fees',
    fundSlug: '',
    backLabel: '',
    backUrl: '',
    buttonLabel: 'Continue',
    thankYouText: 'Thank you — your gift has been received.',
    disclaimerText: 'Payments processed securely. A receipt is sent to your email automatically.',
  },
  related: { settings: DonationSettings },
};
