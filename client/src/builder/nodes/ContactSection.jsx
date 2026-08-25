// Contact details and a map. Both default to the business profile so a new
// site shows the right address without anyone retyping it.

import { useNode } from '@craftjs/core';
import { useSiteTheme } from '../../frontend/theme/useSiteTheme.js';
import { ColorField, FieldGroup, RepeaterField, SelectField, TextField, ToggleField } from '../fields/index.jsx';
import { IDENTITY_DEFAULTS, cssVars, cx, useDomIdentity, useNodeRef } from './nodeUtils.js';

/* ── Contact details ──────────────────────────────────────────────────────── */

export function ContactDetails({ items, useBusinessProfile, iconColor }) {
  const ref = useNodeRef();
  const { domId, customClass } = useDomIdentity('contact');
  const settings = useSiteTheme();

  // Business-profile values are merged in only where the block hasn't been
  // given an explicit override, so editing one line doesn't drop the rest.
  const fromProfile = [
    settings.header_address && { icon: 'location-dot', label: 'Address', value: settings.header_address },
    settings.header_phone && { icon: 'phone', label: 'Phone', value: settings.header_phone, href: `tel:${settings.header_phone}` },
    settings.header_email && { icon: 'envelope', label: 'Email', value: settings.header_email, href: `mailto:${settings.header_email}` },
  ].filter(Boolean);

  const list = useBusinessProfile ? fromProfile : Array.isArray(items) ? items : [];

  return (
    <ul ref={ref} id={domId} className={cx('bx-contact__list', customClass)} style={cssVars({ '--bx-icon': iconColor })}>
      {list.map((item, index) => (
        <li className="bx-contact__item" key={index}>
          {item.icon && <i className={`fa-solid fa-${item.icon}`} />}
          <div>
            {item.label && <div style={{ fontWeight: 600 }}>{item.label}</div>}
            {item.href ? (
              <a href={item.href}>{item.value}</a>
            ) : (
              <div style={{ whiteSpace: 'pre-line' }}>{item.value}</div>
            )}
          </div>
        </li>
      ))}
      {!list.length && <li className="bx-editor-note">Add contact details in the settings panel</li>}
    </ul>
  );
}

function ContactSettings() {
  const { props, actions: { setProp } } = useNode((node) => ({ props: node.data.props }));
  const p = (key) => (value) => setProp((s) => { s[key] = value; });
  return (
    <>
      <FieldGroup title="Details">
        <ToggleField
          label="Use the business profile"
          value={props.useBusinessProfile}
          onChange={p('useBusinessProfile')}
          hint="Pulls address, phone and email from Settings → Business Profile so they stay in one place."
        />
        {!props.useBusinessProfile && (
          <RepeaterField
            value={props.items}
            onChange={p('items')}
            addLabel="Add detail"
            itemLabel={(item) => item.label}
            newItem={{ icon: 'circle-info', label: '', value: '', href: '' }}
            renderItem={(item, patch) => (
              <>
                <TextField label="Icon" value={item.icon} onChange={(v) => patch({ icon: v })} placeholder="phone" />
                <TextField label="Label" value={item.label} onChange={(v) => patch({ label: v })} />
                <TextField label="Value" value={item.value} onChange={(v) => patch({ value: v })} />
                <TextField label="Link" value={item.href} onChange={(v) => patch({ href: v })} placeholder="tel:… or mailto:…" />
              </>
            )}
          />
        )}
      </FieldGroup>
      <FieldGroup title="Style">
        <ColorField label="Icon colour" value={props.iconColor} onChange={p('iconColor')} />
      </FieldGroup>
      <FieldGroup title="Identity" defaultOpen={false}>
        <TextField label="Custom ID" value={props.customId} onChange={p('customId')} />
        <TextField label="Custom CSS class" value={props.customClass} onChange={p('customClass')} />
      </FieldGroup>
    </>
  );
}

ContactDetails.craft = {
  displayName: 'Contact Details',
  props: { ...IDENTITY_DEFAULTS, items: [], useBusinessProfile: true, iconColor: '' },
  related: { settings: ContactSettings },
};

/* ── Map ──────────────────────────────────────────────────────────────────── */

export function MapBlock({ query, zoom, ratio, useBusinessAddress }) {
  const ref = useNodeRef();
  const { domId, customClass } = useDomIdentity('map');
  const settings = useSiteTheme();

  const address = useBusinessAddress ? settings.header_address : query;
  const src = address
    ? `https://www.google.com/maps?q=${encodeURIComponent(address)}&z=${zoom || 14}&output=embed`
    : null;

  if (!src) {
    return (
      <div ref={ref} id={domId} className={cx('bx-editor-note', customClass)}>
        Enter an address in the settings panel
      </div>
    );
  }

  return (
    <iframe
      ref={ref}
      id={domId}
      className={cx('bx-map', customClass)}
      style={cssVars({ '--bx-map-ratio': ratio })}
      src={src}
      title="Map"
      loading="lazy"
      referrerPolicy="no-referrer-when-downgrade"
      allowFullScreen
    />
  );
}

function MapSettings() {
  const { props, actions: { setProp } } = useNode((node) => ({ props: node.data.props }));
  const p = (key) => (value) => setProp((s) => { s[key] = value; });
  return (
    <>
      <FieldGroup title="Location">
        <ToggleField label="Use the business address" value={props.useBusinessAddress} onChange={p('useBusinessAddress')} />
        {!props.useBusinessAddress && (
          <TextField label="Address or search" value={props.query} onChange={p('query')} placeholder="1600 Amphitheatre Pkwy, Mountain View" />
        )}
        <TextField label="Zoom" type="number" value={props.zoom} onChange={(v) => p('zoom')(Number(v))} />
        <SelectField
          label="Shape"
          value={props.ratio}
          onChange={p('ratio')}
          options={[
            { value: '16 / 9', label: 'Wide 16:9' },
            { value: '4 / 3', label: '4:3' },
            { value: '1 / 1', label: 'Square' },
            { value: '21 / 9', label: 'Panorama' },
          ]}
        />
      </FieldGroup>
      <FieldGroup title="Identity" defaultOpen={false}>
        <TextField label="Custom ID" value={props.customId} onChange={p('customId')} />
        <TextField label="Custom CSS class" value={props.customClass} onChange={p('customClass')} />
      </FieldGroup>
    </>
  );
}

MapBlock.craft = {
  displayName: 'Map',
  props: { ...IDENTITY_DEFAULTS, query: '', zoom: 14, ratio: '16 / 9', useBusinessAddress: true },
  related: { settings: MapSettings },
};
