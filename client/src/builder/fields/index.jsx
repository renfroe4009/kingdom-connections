// Reusable setting controls for the builder's SettingsPanel.
//
// Every node's settings UI is built from these — write a control once, get it
// everywhere. They are plain controlled inputs: `value` in, `onChange(next)`
// out. Nothing here knows about Craft.js, which keeps them testable and lets
// the same controls serve page settings and site settings too.
//
// COLOUR CONVENTION: an empty string means "inherit from the theme". Colour
// settings must default to '' so the CSS design tokens supply the value —
// a hardcoded hex default is what makes every new page look like the last
// client's site.

import { useMemo, useState } from 'react';
import MediaPickerModal from '../../components/MediaPickerModal.jsx';
import { FA_SOLID_ICONS } from './faIconList.js';

/* ── Layout ───────────────────────────────────────────────────────────────── */

export function Field({ label, hint, children, inline = false }) {
  return (
    <div className={`bxf ${inline ? 'bxf--inline' : ''}`}>
      {label && <label className="bxf__label">{label}</label>}
      <div className="bxf__control">{children}</div>
      {hint && <div className="bxf__hint">{hint}</div>}
    </div>
  );
}

export function FieldGroup({ title, children, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="bxf-group">
      <button type="button" className="bxf-group__head" onClick={() => setOpen((o) => !o)}>
        <span>{title}</span>
        <i className={`fa-solid fa-chevron-${open ? 'up' : 'down'}`} />
      </button>
      {open && <div className="bxf-group__body">{children}</div>}
    </section>
  );
}

export function FieldRow({ children }) {
  return <div className="bxf-row">{children}</div>;
}

/* ── Primitives ───────────────────────────────────────────────────────────── */

export function TextField({ label, value, onChange, placeholder, hint, type = 'text' }) {
  return (
    <Field label={label} hint={hint}>
      <input
        className="bxf__input"
        type={type}
        value={value ?? ''}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </Field>
  );
}

export function TextareaField({ label, value, onChange, placeholder, hint, rows = 4 }) {
  return (
    <Field label={label} hint={hint}>
      <textarea
        className="bxf__input bxf__input--area"
        rows={rows}
        value={value ?? ''}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </Field>
  );
}

export function NumberField({ label, value, onChange, min, max, step = 1, suffix, hint }) {
  return (
    <Field label={label} hint={hint}>
      <div className="bxf__with-suffix">
        <input
          className="bxf__input"
          type="number"
          value={value ?? ''}
          min={min}
          max={max}
          step={step}
          onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))}
        />
        {suffix && <span className="bxf__suffix">{suffix}</span>}
      </div>
    </Field>
  );
}

export function SelectField({ label, value, onChange, options, hint }) {
  return (
    <Field label={label} hint={hint}>
      <select className="bxf__input" value={value ?? ''} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => {
          const opt = typeof o === 'string' ? { value: o, label: o } : o;
          return (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          );
        })}
      </select>
    </Field>
  );
}

export function ToggleField({ label, value, onChange, hint }) {
  // Deliberately not `inline` — the checkbox and its hint must stack, or a
  // long hint wraps underneath the label and overlaps it.
  return (
    <Field hint={hint}>
      <label className="bxf__toggle">
        <input type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} />
        <span>{label}</span>
      </label>
    </Field>
  );
}

/** Segmented button group — nicer than a select for 2–4 mutually exclusive options. */
export function ChoiceField({ label, value, onChange, options, hint }) {
  return (
    <Field label={label} hint={hint}>
      <div className="bxf__choices">
        {options.map((o) => {
          const opt = typeof o === 'string' ? { value: o, label: o } : o;
          const active = (value ?? '') === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              title={opt.title || opt.label}
              className={`bxf__choice ${active ? 'is-active' : ''}`}
              onClick={() => onChange(opt.value)}
            >
              {opt.icon ? <i className={opt.icon} /> : opt.label}
            </button>
          );
        })}
      </div>
    </Field>
  );
}

/* ── Colour ───────────────────────────────────────────────────────────────── */

/**
 * Empty value = "use the theme colour". The swatch shows a dashed outline in
 * that state and a Clear button appears once a colour is explicitly chosen,
 * so users can always get back to theme-driven.
 */
export function ColorField({ label, value, onChange, hint }) {
  const isSet = !!value;
  return (
    <Field label={label} hint={hint}>
      <div className="bxf__color">
        <label className={`bxf__swatch ${isSet ? '' : 'is-empty'}`} style={isSet ? { background: value } : undefined}>
          <input type="color" value={isSet ? value : '#000000'} onChange={(e) => onChange(e.target.value)} />
        </label>
        <input
          className="bxf__input bxf__input--hex"
          value={value ?? ''}
          placeholder="Theme colour"
          onChange={(e) => onChange(e.target.value)}
        />
        {isSet && (
          <button type="button" className="bxf__clear" title="Use theme colour" onClick={() => onChange('')}>
            <i className="fa-solid fa-rotate-left" />
          </button>
        )}
      </div>
    </Field>
  );
}

/* ── Media ────────────────────────────────────────────────────────────────── */

export function ImageField({ label, value, onChange, hint }) {
  const [picking, setPicking] = useState(false);
  return (
    <Field label={label} hint={hint}>
      <div className="bxf__image">
        {value ? (
          <div className="bxf__image-preview">
            <img src={value} alt="" />
            <button type="button" className="bxf__clear" title="Remove" onClick={() => onChange('')}>
              <i className="fa-solid fa-xmark" />
            </button>
          </div>
        ) : (
          <button type="button" className="bxf__dropzone" onClick={() => setPicking(true)}>
            <i className="fa-solid fa-image" /> Choose image
          </button>
        )}
        <input
          className="bxf__input"
          value={value ?? ''}
          placeholder="…or paste a URL"
          onChange={(e) => onChange(e.target.value)}
        />
        {value && (
          <button type="button" className="bxf__btn" onClick={() => setPicking(true)}>
            Replace from media library
          </button>
        )}
      </div>
      <MediaPickerModal
        show={picking}
        onClose={() => setPicking(false)}
        onSelect={(file) => {
          onChange(file.file_url);
          setPicking(false);
        }}
      />
    </Field>
  );
}

/* ── Icon ─────────────────────────────────────────────────────────────────── */

export function IconField({ label, value, onChange, hint }) {
  const [query, setQuery] = useState('');
  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return FA_SOLID_ICONS.slice(0, 60);
    return FA_SOLID_ICONS.filter((n) => n.includes(q)).slice(0, 60);
  }, [query]);

  return (
    <Field label={label} hint={hint}>
      <div className="bxf__icon">
        <div className="bxf__icon-current">
          {value ? <i className={`fa-solid fa-${value}`} /> : <span className="bxf__hint">None</span>}
          {value && (
            <button type="button" className="bxf__clear" onClick={() => onChange('')}>
              <i className="fa-solid fa-xmark" />
            </button>
          )}
        </div>
        <input
          className="bxf__input"
          value={query}
          placeholder="Search icons…"
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="bxf__icon-grid">
          {results.map((name) => (
            <button
              key={name}
              type="button"
              title={name}
              className={`bxf__icon-cell ${value === name ? 'is-active' : ''}`}
              onClick={() => onChange(name)}
            >
              <i className={`fa-solid fa-${name}`} />
            </button>
          ))}
        </div>
      </div>
    </Field>
  );
}

/* ── Link ─────────────────────────────────────────────────────────────────── */

export function LinkField({ label, value, onChange, hint }) {
  const link = value || { url: '', newTab: false };
  const set = (patch) => onChange({ ...link, ...patch });
  return (
    <Field label={label} hint={hint || 'Use /about for an internal page, or #services to jump to a section.'}>
      <input
        className="bxf__input"
        value={link.url ?? ''}
        placeholder="https://… or /about or #services"
        onChange={(e) => set({ url: e.target.value })}
      />
      <label className="bxf__toggle">
        <input type="checkbox" checked={!!link.newTab} onChange={(e) => set({ newTab: e.target.checked })} />
        <span>Open in a new tab</span>
      </label>
    </Field>
  );
}

/* ── Repeater ─────────────────────────────────────────────────────────────── */

/**
 * Add / remove / reorder a list of objects. Craft.js has no built-in for this
 * and cards, FAQs, nav lists and testimonials all need it, so it lives here.
 *
 * `renderItem(item, patch, index)` receives a patch function that merges into
 * that item — callers never have to splice the array themselves.
 */
export function RepeaterField({ label, value, onChange, newItem, renderItem, itemLabel, addLabel = 'Add item', max }) {
  const items = Array.isArray(value) ? value : [];
  const [openIndex, setOpenIndex] = useState(0);

  const replace = (next) => onChange(next);
  const patchAt = (index) => (patch) =>
    replace(items.map((it, i) => (i === index ? { ...it, ...patch } : it)));
  const move = (from, to) => {
    if (to < 0 || to >= items.length) return;
    const next = items.slice();
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    replace(next);
    setOpenIndex(to);
  };
  const remove = (index) => {
    replace(items.filter((_, i) => i !== index));
    setOpenIndex((o) => (o >= index ? Math.max(0, o - 1) : o));
  };
  const add = () => {
    replace([...items, typeof newItem === 'function' ? newItem(items.length) : { ...newItem }]);
    setOpenIndex(items.length);
  };

  return (
    <Field label={label}>
      <div className="bxf-repeater">
        {items.map((item, index) => {
          const open = openIndex === index;
          return (
            <div key={index} className={`bxf-repeater__item ${open ? 'is-open' : ''}`}>
              <div className="bxf-repeater__head">
                <button
                  type="button"
                  className="bxf-repeater__title"
                  onClick={() => setOpenIndex(open ? -1 : index)}
                >
                  <i className={`fa-solid fa-chevron-${open ? 'down' : 'right'}`} />
                  <span>{(itemLabel ? itemLabel(item, index) : '') || `Item ${index + 1}`}</span>
                </button>
                <div className="bxf-repeater__actions">
                  <button type="button" title="Move up" disabled={index === 0} onClick={() => move(index, index - 1)}>
                    <i className="fa-solid fa-arrow-up" />
                  </button>
                  <button
                    type="button"
                    title="Move down"
                    disabled={index === items.length - 1}
                    onClick={() => move(index, index + 1)}
                  >
                    <i className="fa-solid fa-arrow-down" />
                  </button>
                  <button type="button" title="Remove" onClick={() => remove(index)}>
                    <i className="fa-solid fa-trash" />
                  </button>
                </div>
              </div>
              {open && <div className="bxf-repeater__body">{renderItem(item, patchAt(index), index)}</div>}
            </div>
          );
        })}
        {(!max || items.length < max) && (
          <button type="button" className="bxf__btn bxf__btn--add" onClick={add}>
            <i className="fa-solid fa-plus" /> {addLabel}
          </button>
        )}
      </div>
    </Field>
  );
}

/* ── Composite: spacing ───────────────────────────────────────────────────── */

export function SpacingField({ label, value, onChange, hint }) {
  const v = value || {};
  return (
    <Field label={label} hint={hint}>
      <div className="bxf__spacing">
        {['top', 'right', 'bottom', 'left'].map((side) => (
          <label key={side} className="bxf__spacing-cell">
            <span>{side[0].toUpperCase()}</span>
            <input
              type="number"
              className="bxf__input"
              value={v[side] ?? ''}
              placeholder="—"
              onChange={(e) => onChange({ ...v, [side]: e.target.value === '' ? '' : Number(e.target.value) })}
            />
          </label>
        ))}
      </div>
    </Field>
  );
}
