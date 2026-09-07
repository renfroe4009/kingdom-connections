// Payment / donation block.
//
// On the live site this runs the real flow: pick an amount → a synthetic
// invoice is created via /api/donations/public/checkout → the shared
// DonationCheckout component takes over for the gateway step.
//
// In the builder it renders a safe, non-functional preview. That decision is
// made from the editor's own state (`useEditor(state => state.options.enabled)`)
// and never by inspecting the URL — the same component is mounted in both
// places and only Craft knows which is which.

import { useState } from 'react';
import { useEditor, useNode } from '@craftjs/core';
import api from '../../api/client.js';
import DonationCheckout from '../../frontend/components/DonationCheckout.jsx';
import { FieldGroup, RepeaterField, TextField, TextareaField, ToggleField } from '../fields/index.jsx';
import { IDENTITY_DEFAULTS, cx, useDomIdentity, useNodeRef } from './nodeUtils.js';

export default function DonationBlock({
  heading,
  blurb,
  amounts,
  allowCustom,
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

  const presets = Array.isArray(amounts) ? amounts : [];
  const [amount, setAmount] = useState(() => Number(presets[0]?.value) || 25);
  const [custom, setCustom] = useState('');
  const [donor, setDonor] = useState({ first_name: '', last_name: '', email: '' });
  const [coverFees, setCoverFees] = useState(false);
  const [checkout, setCheckout] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  const effectiveAmount = custom ? Number(custom) : amount;

  async function start(event) {
    event.preventDefault();
    setError('');
    if (!effectiveAmount || effectiveAmount <= 0) return setError('Enter an amount.');
    if (!donor.email) return setError('Email is required.');
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

  return (
    <div ref={ref} id={domId} className={cx('form-card', customClass)}>
      {heading && <h3 className="donate-panel__heading">{heading}</h3>}
      {blurb && <p className="donate-panel__blurb">{blurb}</p>}

      {done ? (
        <div className="form-note">{thankYouText}</div>
      ) : checkout && !editing ? (
        <DonationCheckout
          invoiceId={checkout.invoiceId}
          chargeAmount={checkout.total}
          onSuccess={async () => {
            try { await api.post(`/donations/public/finalize/${checkout.invoiceId}`, {}); } catch { /* the gift is recorded server-side either way */ }
            setDone(true);
          }}
          onDeclined={() => setError('That payment was declined. Please try another card.')}
          onCancel={() => setCheckout(null)}
        />
      ) : (
        <form onSubmit={start}>
          <div className="donate-amounts">
            {presets.map((preset, index) => (
              <button
                key={index}
                type="button"
                className={cx('amount-pill', Number(preset.value) === amount && !custom ? 'amount-pill--active' : null)}
                onClick={() => { setAmount(Number(preset.value)); setCustom(''); }}
              >
                {preset.label || `$${preset.value}`}
              </button>
            ))}
          </div>

          {allowCustom && (
            <div className="form-field">
              <label htmlFor={`${domId}-custom`}>Other amount</label>
              <input id={`${domId}-custom`} type="number" min="1" step="1" value={custom} placeholder="0.00" onChange={(e) => setCustom(e.target.value)} />
            </div>
          )}

          <div className="form-row-2">
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
            <label htmlFor={`${domId}-email`}>Email</label>
            <input id={`${domId}-email`} type="email" required value={donor.email} onChange={(e) => setDonor({ ...donor, email: e.target.value })} />
          </div>

          {coverFeesOption && (
            <label className="donate-checkbox">
              <input type="checkbox" checked={coverFees} onChange={(e) => setCoverFees(e.target.checked)} />
              <span>{coverFeesLabel}</span>
            </label>
          )}

          {error && <div className="form-error">{error}</div>}

          <button type="submit" className="btn btn--gold" disabled={busy || editing}>
            {busy ? 'Starting…' : buttonLabel}
          </button>

          {disclaimerText && <p className="form-note">{disclaimerText}</p>}

          {editing && (
            <div className="bx-editor-note">
              <i className="fa-solid fa-shield-halved" /> Payment is disabled inside the builder. This form is live on the published page.
            </div>
          )}
        </form>
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
        <TextField label="Heading" value={props.heading} onChange={p('heading')} />
        <TextareaField label="Intro text" value={props.blurb} onChange={p('blurb')} rows={3} />
        <TextField label="Button label" value={props.buttonLabel} onChange={p('buttonLabel')} />
        <TextareaField label="Thank-you message" value={props.thankYouText} onChange={p('thankYouText')} rows={2} />
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
              <TextField label="Label" value={item.label} onChange={(v) => patch({ label: v })} placeholder="$50" />
            </>
          )}
        />
        <ToggleField label="Allow a custom amount" value={props.allowCustom} onChange={p('allowCustom')} />
        <ToggleField label="Offer to cover processing fees" value={props.coverFeesOption} onChange={p('coverFeesOption')} />
        <TextField label="Cover-fees checkbox label" value={props.coverFeesLabel} onChange={p('coverFeesLabel')} />
        <TextField
          label="Fund slug"
          value={props.fundSlug}
          onChange={p('fundSlug')}
          hint="Optional. Attributes gifts to a fund from Admin → Donations → Funds."
        />
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
    heading: 'Support our work',
    blurb: 'Every contribution helps. Choose an amount to get started.',
    amounts: [
      { value: 25, label: '' },
      { value: 50, label: '' },
      { value: 100, label: '' },
      { value: 250, label: '' },
    ],
    allowCustom: true,
    coverFeesOption: true,
    coverFeesLabel: 'Add a little extra to cover processing fees',
    fundSlug: '',
    buttonLabel: 'Continue to payment',
    thankYouText: 'Thank you — your gift has been received.',
    disclaimerText: 'Payments processed securely. A receipt is sent to your email automatically.',
  },
  related: { settings: DonationSettings },
};
