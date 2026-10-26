// Membership tier picker block.
//
// Markup matches website-files/join.html's own `.join-grid` / `.tier-card`
// design exactly (same classes, loaded site-wide via the imported design's
// stylesheet) — real, admin-managed tiers from /api/membership/public/tiers
// (server/src/routes/membership.js) rendered into that same visual design,
// not a generic component-library card.
//
// The /join page needs three independent instances of this block —
// "Supporting Members" (Emerald/Diamond/Ruby), "Founding Members"
// (Eagle/Liberty/Patriot), and "Partner" (the $2,500/$5,000/$10,000 tiers) —
// all reading from the same tier list. Since membership_tiers has no
// grouping column, `skip`/`limit` slice the single sort_order-ordered list
// so each instance shows its own range.
//
// A tier's button is a plain anchor to #give (the GiveWidgetBlock elsewhere
// on the page) that also dispatches a `kc:select-tier` window event — no
// modal, no local checkout state here at all. GiveWidgetBlock listens for
// that event and jumps straight to the matching tab + tier; the two blocks
// never share props or state, only this one DOM event (see
// GiveWidgetBlock.jsx's own header comment for why that's deliberate).
//
// In the builder the anchor is inert (no navigation, no event) — same
// `useEditor(state => state.options.enabled)` split used elsewhere.

import { useEffect, useState } from 'react';
import { useEditor, useNode } from '@craftjs/core';
import api from '../../api/client.js';
import { FieldGroup, NumberField, TextField, TextareaField, ToggleField } from '../fields/index.jsx';
import { IDENTITY_DEFAULTS, cx, useDomIdentity, useNodeRef } from './nodeUtils.js';
import { sanitizeHtml } from '../../utils/sanitizeHtml.js';
import { parseTierBenefits } from '../../utils/tierBenefits.js';

function formatPrice(price) {
  return `$${(Number(price) || 0).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
}

export default function MembershipBlock({ heading, blurb, footnoteText, skip, limit, showFeatures, ctaTemplate }) {
  const ref = useNodeRef();
  const { enabled: editing } = useEditor((state) => ({ enabled: state.options.enabled }));
  const { domId, customClass } = useDomIdentity('membership');

  const [tiers, setTiers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    let cancelled = false;
    api.get('/membership/public/tiers')
      .then(({ data }) => { if (!cancelled) setTiers(Array.isArray(data) ? data : []); })
      .catch(() => { if (!cancelled) setLoadError('Membership tiers are unavailable right now.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const from = Math.max(0, Number(skip) || 0);
  const count = Number(limit) || 0;
  const visibleTiers = tiers.slice(from, count > 0 ? from + count : undefined);

  function selectTier(e, tier) {
    if (editing) { e.preventDefault(); return; }
    window.dispatchEvent(new CustomEvent('kc:select-tier', { detail: { tierSlug: tier.slug } }));
    // Anchor's own href="#give" handles the scroll — nothing else to do here.
  }

  return (
    <div ref={ref} id={domId} className={cx(customClass)}>
      {heading && <h2>{heading}</h2>}
      {blurb && <p>{blurb}</p>}

      {loading ? (
        <div className="bx-editor-note">Loading membership tiers…</div>
      ) : loadError ? (
        <div className="bx-editor-note">{loadError}</div>
      ) : !visibleTiers.length ? (
        <div className="bx-editor-note">No membership tiers are published yet.</div>
      ) : (
        // `founding-grid` when the tiers carry artwork — the design lays those
        // photo cards out on their own grid, with room for the image above.
        <div className={cx('join-grid', visibleTiers.some((t) => parseTierBenefits(t.benefits_json).image) && 'founding-grid')}>
          {visibleTiers.map((tier) => {
            const benefits = parseTierBenefits(tier.benefits_json);
            const { features } = benefits;
            const featured = Boolean(benefits.badge);
            const ctaLabel = benefits.cta || String(ctaTemplate || 'Select {name}').replace('{name}', tier.name);
            // The design gives every tier its own colour through a modifier
            // class keyed on the tier slug (`tier-card--ruby` is red, with
            // matching bullet diamonds), and the founding tiers add a photo.
            // Without these the cards render in one flat house style.
            const slug = tier.slug || String(tier.name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-');
            const art = benefits.image || '';
            return (
              <article
                className={cx('tier-card', art && 'founding-card', featured && 'tier-card--featured', slug && `tier-card--${slug}`)}
                key={tier.id}
              >
                {art && (
                  <div className="founding-card__art">
                    <img src={art} alt="" loading="lazy" />
                  </div>
                )}
                <div className="tier-card__name">{tier.name}</div>
                <div className="tier-card__price">{formatPrice(tier.price)}</div>
                {/* A photo card goes straight from the price to the benefits,
                    as the design does. These tiers repeat their first benefit
                    as the description, and the paragraph inherits the dark
                    section's white text — so it rendered as an empty band on
                    a white card. */}
                {tier.description && !art && <p>{tier.description}</p>}
                {showFeatures && features.length > 0 && (
                  <ul className="list-diamond">
                    {features.map((f, i) => <li key={i} dangerouslySetInnerHTML={{ __html: sanitizeHtml(f) }} />)}
                  </ul>
                )}
                <a
                  href="#give"
                  className={cx('btn', featured ? 'btn--gold' : 'btn--outline-dark')}
                  onClick={(e) => selectTier(e, tier)}
                >
                  {ctaLabel}
                </a>
              </article>
            );
          })}
        </div>
      )}

      {footnoteText && <p>{footnoteText}</p>}

      {editing && visibleTiers.length > 0 && (
        <div className="bx-editor-note" style={{ marginTop: 16 }}>
          <i className="fa-solid fa-shield-halved" /> Selecting a tier is disabled inside the builder. Tiers shown are live from Admin → Membership.
        </div>
      )}
    </div>
  );
}

function MembershipSettings() {
  const { props, actions: { setProp } } = useNode((node) => ({ props: node.data.props }));
  const p = (key) => (value) => setProp((s) => { s[key] = value; });
  return (
    <>
      <FieldGroup title="Content">
        <TextField label="Heading" value={props.heading} onChange={p('heading')} hint="Leave blank if a Heading block already sits above this one." />
        <TextareaField label="Intro text" value={props.blurb} onChange={p('blurb')} rows={2} />
        <TextField label="Footnote" value={props.footnoteText} onChange={p('footnoteText')} />
      </FieldGroup>

      <FieldGroup title="Tiers shown">
        <NumberField label="Skip" value={props.skip} onChange={p('skip')} min={0} hint="Skip this many tiers from the start of the list (by sort order). Use this to split tiers across two Membership blocks." />
        <NumberField label="Limit" value={props.limit} onChange={p('limit')} min={0} hint="Maximum tiers to show after skipping. 0 shows all remaining." />
        <ToggleField label="Show the benefits list" value={props.showFeatures} onChange={p('showFeatures')} hint="Turn off for a simpler card with just the description sentence." />
        <TextField
          label="Button label"
          value={props.ctaTemplate}
          onChange={p('ctaTemplate')}
          placeholder="Select {name}"
          hint="Use {name} for the tier's name. A tier can override this with its own 'cta' set in Admin → Membership."
        />
      </FieldGroup>

      <FieldGroup title="Identity" defaultOpen={false}>
        <TextField label="Custom ID" value={props.customId} onChange={p('customId')} />
        <TextField label="Custom CSS class" value={props.customClass} onChange={p('customClass')} />
      </FieldGroup>
    </>
  );
}

MembershipBlock.craft = {
  displayName: 'Membership',
  props: {
    ...IDENTITY_DEFAULTS,
    heading: '',
    blurb: '',
    skip: 0,
    limit: 0,
    showFeatures: true,
    ctaTemplate: 'Select {name}',
    footnoteText: '',
  },
  related: { settings: MembershipSettings },
};
