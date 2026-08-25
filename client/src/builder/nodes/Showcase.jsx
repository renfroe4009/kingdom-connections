// Stats, Testimonials, Logo strip and Gallery — the four repeater-driven
// "showcase" blocks. They share a shape (a list of small records rendered in a
// grid), so they live together rather than in four near-identical files.

import { useNode } from '@craftjs/core';
import { ColorField, FieldGroup, ImageField, LinkField, NumberField, RepeaterField, TextField, TextareaField } from '../fields/index.jsx';
import { IDENTITY_DEFAULTS, cssVars, cx, px, resolveHref, useDomIdentity, useNodeRef } from './nodeUtils.js';

/* ── Stats ────────────────────────────────────────────────────────────────── */

export function Stats({ items, columns, valueColor }) {
  const ref = useNodeRef();
  const { domId, customClass } = useDomIdentity('stats');
  const list = Array.isArray(items) ? items : [];
  return (
    <div ref={ref} id={domId} className={cx('bx-stats', customClass)} style={cssVars({ '--bx-stat-cols': columns })}>
      {list.map((item, index) => (
        <div className="bx-stat" key={index}>
          <div className="bx-stat__value" style={cssVars({ color: valueColor })}>
            {item.value}
          </div>
          <div className="bx-stat__label">{item.label}</div>
        </div>
      ))}
    </div>
  );
}

function StatsSettings() {
  const { props, actions: { setProp } } = useNode((node) => ({ props: node.data.props }));
  const p = (key) => (value) => setProp((s) => { s[key] = value; });
  return (
    <>
      <FieldGroup title="Stats">
        <RepeaterField
          value={props.items}
          onChange={p('items')}
          addLabel="Add stat"
          itemLabel={(item) => `${item.value} — ${item.label}`}
          newItem={{ value: '100+', label: 'Describe the number' }}
          renderItem={(item, patch) => (
            <>
              <TextField label="Value" value={item.value} onChange={(v) => patch({ value: v })} />
              <TextField label="Label" value={item.label} onChange={(v) => patch({ label: v })} />
            </>
          )}
        />
      </FieldGroup>
      <FieldGroup title="Style">
        <NumberField label="Columns" value={props.columns} onChange={p('columns')} min={1} max={6} />
        <ColorField label="Value colour" value={props.valueColor} onChange={p('valueColor')} />
      </FieldGroup>
      <FieldGroup title="Identity" defaultOpen={false}>
        <TextField label="Custom ID" value={props.customId} onChange={p('customId')} />
        <TextField label="Custom CSS class" value={props.customClass} onChange={p('customClass')} />
      </FieldGroup>
    </>
  );
}

Stats.craft = {
  displayName: 'Stats',
  props: {
    ...IDENTITY_DEFAULTS,
    items: [
      { value: '100+', label: 'Describe the number' },
      { value: '25', label: 'Describe the number' },
      { value: '15 yrs', label: 'Describe the number' },
      { value: '98%', label: 'Describe the number' },
    ],
    columns: 4,
    valueColor: '',
  },
  related: { settings: StatsSettings },
};

/* ── Testimonials ─────────────────────────────────────────────────────────── */

export function Testimonials({ items, columns }) {
  const ref = useNodeRef();
  const { domId, customClass } = useDomIdentity('testimonials');
  const list = Array.isArray(items) ? items : [];
  return (
    <div ref={ref} id={domId} className={cx('bx-card-grid', customClass)} style={cssVars({ '--bx-cards': columns })}>
      {list.map((item, index) => (
        <figure className="bx-card" key={index}>
          <blockquote className="bx-card__body bx-quote">
            <p className="bx-quote__text">{item.quote}</p>
            <figcaption className="bx-quote__who">
              {item.avatar && <img className="bx-quote__avatar" src={item.avatar} alt="" loading="lazy" />}
              <span>
                <span className="bx-quote__name">{item.name}</span>
                {item.role && <span className="bx-quote__role"> · {item.role}</span>}
              </span>
            </figcaption>
          </blockquote>
        </figure>
      ))}
    </div>
  );
}

function TestimonialsSettings() {
  const { props, actions: { setProp } } = useNode((node) => ({ props: node.data.props }));
  const p = (key) => (value) => setProp((s) => { s[key] = value; });
  return (
    <>
      <FieldGroup title="Testimonials">
        <RepeaterField
          value={props.items}
          onChange={p('items')}
          addLabel="Add testimonial"
          itemLabel={(item) => item.name}
          newItem={{ quote: 'What the customer said.', name: 'Customer name', role: '', avatar: '' }}
          renderItem={(item, patch) => (
            <>
              <TextareaField label="Quote" value={item.quote} onChange={(v) => patch({ quote: v })} rows={3} />
              <TextField label="Name" value={item.name} onChange={(v) => patch({ name: v })} />
              <TextField label="Role / company" value={item.role} onChange={(v) => patch({ role: v })} />
              <ImageField label="Photo" value={item.avatar} onChange={(v) => patch({ avatar: v })} />
            </>
          )}
        />
      </FieldGroup>
      <FieldGroup title="Style">
        <NumberField label="Columns" value={props.columns} onChange={p('columns')} min={1} max={4} />
      </FieldGroup>
      <FieldGroup title="Identity" defaultOpen={false}>
        <TextField label="Custom ID" value={props.customId} onChange={p('customId')} />
        <TextField label="Custom CSS class" value={props.customClass} onChange={p('customClass')} />
      </FieldGroup>
    </>
  );
}

Testimonials.craft = {
  displayName: 'Testimonials',
  props: {
    ...IDENTITY_DEFAULTS,
    items: [
      { quote: 'Replace this with a real quote once you have one.', name: 'Customer name', role: 'Role, Company', avatar: '' },
      { quote: 'Replace this with a real quote once you have one.', name: 'Customer name', role: 'Role, Company', avatar: '' },
    ],
    columns: 2,
  },
  related: { settings: TestimonialsSettings },
};

/* ── Logo strip ───────────────────────────────────────────────────────────── */

export function LogoStrip({ items, height }) {
  const ref = useNodeRef();
  const { domId, customClass } = useDomIdentity('logos');
  const list = Array.isArray(items) ? items : [];
  return (
    <div ref={ref} id={domId} className={cx('bx-logos', customClass)} style={cssVars({ '--bx-logo-h': px(height) })}>
      {list.map((item, index) => {
        const href = resolveHref(item.link?.url);
        const img = <img src={item.image} alt={item.name || ''} loading="lazy" />;
        return href ? (
          <a key={index} href={href} target={item.link?.newTab ? '_blank' : undefined} rel="noopener noreferrer">
            {img}
          </a>
        ) : (
          <span key={index}>{img}</span>
        );
      })}
      {!list.length && <div className="bx-editor-note">Add logos in the settings panel</div>}
    </div>
  );
}

function LogoStripSettings() {
  const { props, actions: { setProp } } = useNode((node) => ({ props: node.data.props }));
  const p = (key) => (value) => setProp((s) => { s[key] = value; });
  return (
    <>
      <FieldGroup title="Logos">
        <RepeaterField
          value={props.items}
          onChange={p('items')}
          addLabel="Add logo"
          itemLabel={(item) => item.name}
          newItem={{ name: '', image: '', link: { url: '', newTab: true } }}
          renderItem={(item, patch) => (
            <>
              <ImageField label="Logo" value={item.image} onChange={(v) => patch({ image: v })} />
              <TextField label="Name (alt text)" value={item.name} onChange={(v) => patch({ name: v })} />
              <LinkField label="Link" value={item.link} onChange={(v) => patch({ link: v })} />
            </>
          )}
        />
      </FieldGroup>
      <FieldGroup title="Style">
        <NumberField label="Logo height" value={props.height} onChange={p('height')} suffix="px" min={16} />
      </FieldGroup>
      <FieldGroup title="Identity" defaultOpen={false}>
        <TextField label="Custom ID" value={props.customId} onChange={p('customId')} />
        <TextField label="Custom CSS class" value={props.customClass} onChange={p('customClass')} />
      </FieldGroup>
    </>
  );
}

LogoStrip.craft = {
  displayName: 'Logo Strip',
  props: { ...IDENTITY_DEFAULTS, items: [], height: 48 },
  related: { settings: LogoStripSettings },
};

/* ── Gallery ──────────────────────────────────────────────────────────────── */

export function Gallery({ items, columns, gap }) {
  const ref = useNodeRef();
  const { domId, customClass } = useDomIdentity('gallery');
  const list = Array.isArray(items) ? items : [];
  return (
    <div
      ref={ref}
      id={domId}
      className={cx('bx-gallery', customClass)}
      style={cssVars({ '--bx-gallery-cols': columns, '--bx-card-gap': px(gap) })}
    >
      {list.map((item, index) => (
        <img key={index} src={item.image} alt={item.alt || ''} loading="lazy" />
      ))}
      {!list.length && <div className="bx-editor-note">Add images in the settings panel</div>}
    </div>
  );
}

function GallerySettings() {
  const { props, actions: { setProp } } = useNode((node) => ({ props: node.data.props }));
  const p = (key) => (value) => setProp((s) => { s[key] = value; });
  return (
    <>
      <FieldGroup title="Images">
        <RepeaterField
          value={props.items}
          onChange={p('items')}
          addLabel="Add image"
          itemLabel={(item, index) => item.alt || `Image ${index + 1}`}
          newItem={{ image: '', alt: '' }}
          renderItem={(item, patch) => (
            <>
              <ImageField label="Image" value={item.image} onChange={(v) => patch({ image: v })} />
              <TextField label="Alt text" value={item.alt} onChange={(v) => patch({ alt: v })} />
            </>
          )}
        />
      </FieldGroup>
      <FieldGroup title="Style">
        <NumberField label="Columns" value={props.columns} onChange={p('columns')} min={1} max={6} />
        <NumberField label="Gap" value={props.gap} onChange={p('gap')} suffix="px" min={0} />
      </FieldGroup>
      <FieldGroup title="Identity" defaultOpen={false}>
        <TextField label="Custom ID" value={props.customId} onChange={p('customId')} />
        <TextField label="Custom CSS class" value={props.customClass} onChange={p('customClass')} />
      </FieldGroup>
    </>
  );
}

Gallery.craft = {
  displayName: 'Gallery',
  props: { ...IDENTITY_DEFAULTS, items: [], columns: 3, gap: 12 },
  related: { settings: GallerySettings },
};
