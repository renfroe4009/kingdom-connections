import { useState, useEffect, useRef } from 'react';
import api from '../../api/client.js';
import PageHeader from '../../components/PageHeader.jsx';
import { toast } from '../../components/Toast.jsx';
import { parseApiError } from '../../utils/apiError.js';
import CodeEditor from '../../builder/code/CodeEditor.jsx';

const SECTIONS = [
  { key: 'theme',   label: 'Theme' },
  { key: 'css',     label: 'CSS' },
  { key: 'js',      label: 'JS' },
  { key: 'contact', label: 'Contact Info' },
  { key: 'header',  label: 'Header' },
  { key: 'nav',     label: 'Navigation' },
  { key: 'social',  label: 'Social Links' },
  { key: 'footer',  label: 'Footer' },
];

// Stored as the strings 'true'/'false' — settings are a key/value text table,
// so a real boolean would come back as the string "1" and read as truthy even
// when off. Rendered as checkboxes.
const TOGGLE_KEYS = new Map([
  ['topbar_enabled', 'true'],
  ['header_show_cart', 'true'],
  ['header_show_theme_toggle', 'false'],
]);

// Colour fields get a swatch alongside the text box; everything else is plain
// text. Kept as data so the Theme tab stays declarative like the others.
const COLOR_KEYS = new Set([
  'primary_color', 'secondary_color', 'button_color', 'icon_color',
  'text_on_dark', 'text_on_light', 'footer_background', 'footer_text',
  'topbar_background', 'topbar_text_color',
]);

const TEXT_FIELDS = {
  // Same settings the builder's Theme drawer writes, so the two surfaces stay
  // in agreement — edit here, or against a live page in the builder.
  theme: [
    { key: 'primary_color',     label: 'Primary Colour',            help: '#0a1230' },
    { key: 'secondary_color',   label: 'Secondary Colour',          help: '#f5b800' },
    { key: 'button_color',      label: 'Button Colour',             help: 'Falls back to the primary colour when blank' },
    { key: 'icon_color',        label: 'Icon Colour',               help: 'Falls back to the primary colour when blank' },
    { key: 'text_on_dark',      label: 'Text on Dark Backgrounds',  help: '#ffffff' },
    { key: 'text_on_light',     label: 'Text on Light Backgrounds', help: '#1a1f2e' },
    { key: 'footer_background', label: 'Footer Background',         help: 'Blank uses the design’s own footer rule' },
    { key: 'footer_text',       label: 'Footer Text Colour',        help: 'Blank uses the design’s own footer rule' },
    { key: 'font_heading',      label: 'Heading Font Stack',        help: '"Playfair Display", Georgia, serif' },
    { key: 'font_body',         label: 'Body Font Stack',           help: '"Inter", system-ui, sans-serif' },
    { key: 'layout_width',      label: 'Content Width',             help: '1120px — must match the design’s container' },
  ],
  contact: [
    { key: 'site_name',        label: 'Site Name',   help: 'Used for alt text and copyright' },
    { key: 'header_address',   label: 'Address',     help: 'Shown in the top info bar and footer' },
    { key: 'header_phone',          label: 'Phone',            help: '555 123 4567' },
    { key: 'header_phone_tollfree', label: 'Toll-free Phone',  help: 'Optional second number, hidden on small screens' },
    { key: 'header_email',          label: 'Email',            help: 'info@example.org' },
    { key: 'header_website',        label: 'Website URL',      help: 'https://example.org' },
  ],

  // Everything about the header chrome itself. The top-bar and cart settings
  // were previously read by PublicLayout with no field anywhere to set them.
  header: [
    { key: 'header_logo_url',      label: 'Header Logo URL',            help: 'Leave blank to show the site name as text' },
    { key: 'header_logo_dark_url', label: 'Header Logo URL (dark mode)', help: 'Shown when the visitor picks the dark theme' },
    // The design shows a two-line brand mark beside the logo icon — a bold
    // line and a small letter-spaced line beneath it — always together, never
    // as a substitute for the logo. Blank line 1 falls back to Site Name so
    // this isn't broken for a site that hasn't touched it yet; blank line 2
    // renders nothing rather than an empty line.
    { key: 'header_wordmark_line1', label: 'Brand Text — bold line', help: 'Blank uses Site Name' },
    { key: 'header_wordmark_line2', label: 'Brand Text — small line (optional)', help: 'e.g. a tagline under the name' },
    { key: 'topbar_enabled',       label: 'Show the top bar',           help: 'The thin strip above the header' },
    { key: 'topbar_text',          label: 'Top bar text',               help: 'Shown on the left. Contact details sit on the right.' },
    { key: 'header_contact_label', label: 'Right-side link text',       help: 'Sits after the phone number. Blank shows only the phone.' },
    { key: 'header_contact_url',   label: 'Right-side link URL',        help: '/contact' },
    { key: 'topbar_background',    label: 'Top bar background',         help: 'Blank keeps the colour from the design’s stylesheet' },
    { key: 'topbar_text_color',    label: 'Top bar text colour',        help: 'Blank keeps the colour from the design’s stylesheet' },
    { key: 'header_show_cart',        label: 'Show the shopping cart icon', help: 'Turn off for sites that don’t sell anything' },
    { key: 'header_show_theme_toggle', label: 'Show the light/dark toggle', help: 'Only useful if the design ships a dark palette' },
  ],
  // Header CTAs are a list (`header_cta_buttons`), not a fixed member/donate
  // pair — that is the key PublicLayout reads. The old four text fields wrote
  // header_cta_member_* / header_cta_donate_*, which nothing renders, so they
  // saved happily and never appeared on the site.
  nav: [],
  social: [
    { key: 'social_facebook',  label: 'Facebook URL' },
    { key: 'social_twitter',   label: 'Twitter / X URL' },
    { key: 'social_instagram', label: 'Instagram URL' },
    { key: 'social_youtube',   label: 'YouTube URL' },
    { key: 'social_linkedin',  label: 'LinkedIn URL' },
  ],
};

const FOOTER_LINK_MANAGERS = [
  { key: 'footer_col2_links',  title: 'Column 2 Title', titleKey: 'footer_col2_title', label: 'Column 2 Links' },
  { key: 'footer_col3_links',  title: 'Column 3 Title', titleKey: 'footer_col3_title', label: 'Column 3 Links' },
  { key: 'footer_col4_links',  title: 'Column 4 Title', titleKey: 'footer_col4_title', label: 'Column 4 Links' },
  { key: 'footer_cta_buttons', label: 'CTA Buttons',    titleKey: null },
  { key: 'footer_legal_links', label: 'Bottom Bar Links', titleKey: null },
];

const JSON_FIELDS = {
  footer: [
    { key: 'footer_copyright', label: 'Copyright Name', simple: true },
  ],
};

// Footer fields rendered above the link managers. Kept separate from
// TEXT_FIELDS.footer so they appear before the columns rather than after them.
const FOOTER_TEXT_FIELDS = [
  { key: 'footer_logo_url',      label: 'Footer Logo URL',             help: 'Blank falls back to the site name' },
  { key: 'footer_logo_dark_url', label: 'Footer Logo URL (dark mode)', help: 'Shown when the visitor picks the dark theme' },
  { key: 'footer_blurb',         label: 'Footer Blurb',                help: 'Short paragraph under the footer logo' },
  { key: 'footer_contact_title',    label: 'Contact Column Heading',   help: 'e.g. Contact — blank hides the whole column' },
  { key: 'footer_contact_phone',    label: 'Contact Column Phone',     help: 'Blank reuses the phone from Contact Info' },
  { key: 'footer_contact_location', label: 'Contact Column Location',  help: 'e.g. Worldwide' },
  { key: 'footer_domain_label',     label: 'Domain Label',             help: 'e.g. EXAMPLE.ORG — shown under the contact list' },
  { key: 'footer_domain_url',       label: 'Domain URL',               help: 'https://example.org' },
];

function prettyJson(val) {
  try { return JSON.stringify(JSON.parse(val), null, 2); } catch { return val; }
}

function validateJson(val) {
  try { JSON.parse(val); return null; } catch (e) { return e.message; }
}

/* ─── Visual Nav Manager ─────────────────────────────────────── */

function ChildRow({ child, onUpdate, onRemove }) {
  return (
    <div className="ps-2 py-1" style={{ borderLeft: '3px solid #dee2e6' }}>
      <div className="d-flex align-items-center gap-2">
        <span style={{ color: '#aaa', fontSize: 14, cursor: 'default', userSelect: 'none' }}>↳</span>
        <input
          className="form-control form-control-sm"
          style={{ width: 140 }}
          value={child.label}
          onChange={e => onUpdate({ label: e.target.value })}
          placeholder="Link label"
          aria-label="Child link label"
        />
        <input
          className="form-control form-control-sm"
          style={{ flex: 1 }}
          value={child.url || ''}
          onChange={e => onUpdate({ url: e.target.value })}
          placeholder="/path"
          aria-label="Child link URL"
        />
        <input
          className="form-control form-control-sm"
          style={{ width: 150 }}
          value={child.title || ''}
          onChange={e => onUpdate({ title: e.target.value })}
          placeholder="ADA title (optional)"
          aria-label="Child link ADA title attribute"
          title="Used as the HTML title attribute for screen readers"
        />
        <div className="d-flex align-items-center gap-1 flex-shrink-0" title="Open in new tab">
          <input
            type="checkbox"
            id={`child-newtab-${child.label}`}
            checked={!!child.newTab}
            onChange={e => onUpdate({ newTab: e.target.checked })}
            aria-label="Open in new tab"
          />
          <label htmlFor={`child-newtab-${child.label}`} className="small mb-0 text-muted" style={{ whiteSpace: 'nowrap', cursor: 'pointer' }}>New tab</label>
        </div>
        <button
          className="btn btn-sm btn-outline-danger"
          onClick={onRemove}
          aria-label="Remove child link"
          style={{ padding: '2px 8px', lineHeight: 1.4, flexShrink: 0 }}
        >×</button>
      </div>
    </div>
  );
}

function NavRow({ link, index, onUpdate, onRemove, onAddChild, onUpdateChild, onRemoveChild, dragHandlers }) {
  const [open, setOpen] = useState(false);
  const hasChildren = Array.isArray(link.dropdown) && link.dropdown.length > 0;

  return (
    <div
      className="mb-2"
      draggable
      onDragStart={dragHandlers.onDragStart}
      onDragOver={dragHandlers.onDragOver}
      onDragEnd={dragHandlers.onDragEnd}
      style={{ opacity: dragHandlers.isDragging ? 0.4 : 1, transition: 'opacity 0.15s' }}
    >
      <div
        className="d-flex align-items-center gap-2 p-2 rounded border bg-white"
        style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}
      >
        {/* Drag handle */}
        <span
          title="Drag to reorder"
          style={{ cursor: 'grab', color: '#adb5bd', fontSize: 18, lineHeight: 1, userSelect: 'none', flexShrink: 0 }}
          aria-hidden="true"
        >⠿</span>

        {/* Label */}
        <input
          className="form-control form-control-sm"
          style={{ width: 150, flexShrink: 0 }}
          value={link.label}
          onChange={e => onUpdate({ label: e.target.value })}
          placeholder="Label"
          aria-label={`Nav link ${index + 1} label`}
        />

        {/* URL */}
        <input
          className="form-control form-control-sm"
          style={{ flex: 1 }}
          value={link.url || ''}
          onChange={e => onUpdate({ url: e.target.value })}
          placeholder="/path or https://..."
          aria-label={`Nav link ${index + 1} URL`}
        />

        {/* ADA title */}
        <input
          className="form-control form-control-sm"
          style={{ width: 160 }}
          value={link.title || ''}
          onChange={e => onUpdate({ title: e.target.value })}
          placeholder="ADA title"
          aria-label={`Nav link ${index + 1} ADA title`}
          title="HTML title attribute — shown on hover and read by screen readers"
        />

        {/* New tab */}
        <div className="d-flex align-items-center gap-1 flex-shrink-0" title="Open link in new browser tab">
          <input
            type="checkbox"
            id={`nav-newtab-${index}`}
            checked={!!link.newTab}
            onChange={e => onUpdate({ newTab: e.target.checked })}
            aria-label={`Open ${link.label} in new tab`}
          />
          <label htmlFor={`nav-newtab-${index}`} className="small mb-0 text-muted" style={{ whiteSpace: 'nowrap', cursor: 'pointer' }}>New tab</label>
        </div>

        {/* Dropdown toggle */}
        <button
          className={`btn btn-sm ${hasChildren || link.dropdown ? 'btn-primary' : 'btn-outline-secondary'}`}
          onClick={() => {
            if (hasChildren || link.dropdown) {
              onUpdate({ dropdown: undefined });
            } else {
              onUpdate({ dropdown: [] });
              setOpen(true);
            }
          }}
          title={hasChildren || link.dropdown ? 'Has dropdown — click to remove' : 'Add dropdown'}
          aria-label="Toggle dropdown"
          style={{ fontSize: 12, padding: '2px 8px', whiteSpace: 'nowrap' }}
        >
          {hasChildren || link.dropdown ? '▾ Drop' : '+ Drop'}
        </button>

        {/* Expand/collapse children */}
        {(hasChildren || link.dropdown) && (
          <button
            className="btn btn-sm btn-outline-secondary"
            onClick={() => setOpen(o => !o)}
            aria-label={open ? 'Collapse children' : 'Expand children'}
            style={{ fontSize: 12, padding: '2px 8px' }}
          >
            {open ? '▲' : '▼'} {hasChildren ? link.dropdown.length : 0}
          </button>
        )}

        {/* Remove */}
        <button
          className="btn btn-sm btn-outline-danger"
          onClick={onRemove}
          aria-label={`Remove ${link.label} nav link`}
          style={{ padding: '2px 8px', lineHeight: 1.4, flexShrink: 0 }}
        >×</button>
      </div>

      {/* Child links */}
      {(hasChildren || link.dropdown) && open && (
        <div className="ms-4 mt-1">
          {(link.dropdown || []).map((child, ci) => (
            <ChildRow
              key={ci}
              child={child}
              onUpdate={patch => onUpdateChild(ci, patch)}
              onRemove={() => onRemoveChild(ci)}
            />
          ))}
          <button
            className="btn btn-sm btn-outline-primary mt-1"
            onClick={onAddChild}
            style={{ fontSize: 12 }}
          >
            + Add Child Link
          </button>
        </div>
      )}
    </div>
  );
}

function NavManager({ value, onChange }) {
  // Array-guarded: valid-but-non-array JSON (an object, a quoted string) would
  // otherwise reach .map() and take the whole settings page down.
  const parseLinks = (v) => {
    try { const p = JSON.parse(v || '[]'); return Array.isArray(p) ? p : []; } catch { return []; }
  };
  const [links, setLinks] = useState(() => parseLinks(value));
  const [dragIdx, setDragIdx] = useState(null);
  const overIdx = useRef(null);

  // Sync value in from parent if it changes externally
  useEffect(() => { setLinks(parseLinks(value)); }, []); // eslint-disable-line

  function push(next) {
    setLinks(next);
    onChange(JSON.stringify(next));
  }

  function updateLink(i, patch) {
    push(links.map((l, idx) => idx === i ? { ...l, ...patch } : l));
  }

  function removeLink(i) { push(links.filter((_, idx) => idx !== i)); }

  function addLink() { push([...links, { label: 'New Link', url: '/' }]); }

  function addChild(i) {
    push(links.map((l, idx) => idx === i
      ? { ...l, dropdown: [...(l.dropdown || []), { label: 'Sub Link', url: '/' }] }
      : l));
  }

  function updateChild(i, ci, patch) {
    push(links.map((l, idx) => idx === i
      ? { ...l, dropdown: l.dropdown.map((c, cidx) => cidx === ci ? { ...c, ...patch } : c) }
      : l));
  }

  function removeChild(i, ci) {
    push(links.map((l, idx) => idx === i
      ? { ...l, dropdown: l.dropdown.filter((_, cidx) => cidx !== ci) }
      : l));
  }

  function onDragStart(i) { setDragIdx(i); overIdx.current = i; }
  function onDragOver(e, i) {
    e.preventDefault();
    if (overIdx.current === i || dragIdx === null) return;
    overIdx.current = i;
    const next = [...links];
    const [item] = next.splice(dragIdx, 1);
    next.splice(i, 0, item);
    setDragIdx(i);
    setLinks(next);
    onChange(JSON.stringify(next));
  }
  function onDragEnd() { setDragIdx(null); overIdx.current = null; }

  return (
    <div>
      <div className="d-flex align-items-center justify-content-between mb-2">
        <p className="text-muted small mb-0">Drag rows to reorder. Click <strong>+ Drop</strong> to add a dropdown group.</p>
        <button className="btn btn-sm btn-primary" onClick={addLink}>+ Add Link</button>
      </div>

      {links.length === 0 && (
        <div className="text-center text-muted py-4 border rounded" style={{ fontSize: '0.9rem' }}>
          No navigation links yet. Click <strong>+ Add Link</strong> to start.
        </div>
      )}

      {links.map((link, i) => (
        <NavRow
          key={i}
          link={link}
          index={i}
          onUpdate={patch => updateLink(i, patch)}
          onRemove={() => removeLink(i)}
          onAddChild={() => addChild(i)}
          onUpdateChild={(ci, patch) => updateChild(i, ci, patch)}
          onRemoveChild={(ci) => removeChild(i, ci)}
          dragHandlers={{
            isDragging: dragIdx === i,
            onDragStart: () => onDragStart(i),
            onDragOver: (e) => onDragOver(e, i),
            onDragEnd,
          }}
        />
      ))}

      <div className="mt-3 p-3 rounded" style={{ background: '#f8f9fa', fontSize: '0.8rem', color: '#6c757d' }}>
        <strong>Tips:</strong> Use <code>/panther</code> for internal links. Use the full URL for external links.
        Links with a dropdown group show a <strong>▾</strong> arrow in the nav.
        Child links appear in a hover menu below the parent.
      </div>
    </div>
  );
}

/* ─── Footer Links Manager ───────────────────────────────────── */

function FooterLinkRow({ link, index, onUpdate, onRemove, dragHandlers }) {
  return (
    <div
      className="d-flex align-items-center gap-2 mb-2 p-2 rounded border bg-white"
      style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.06)', opacity: dragHandlers.isDragging ? 0.4 : 1, transition: 'opacity 0.15s' }}
      draggable
      onDragStart={dragHandlers.onDragStart}
      onDragOver={dragHandlers.onDragOver}
      onDragEnd={dragHandlers.onDragEnd}
    >
      <span title="Drag to reorder" style={{ cursor: 'grab', color: '#adb5bd', fontSize: 18, lineHeight: 1, userSelect: 'none', flexShrink: 0 }} aria-hidden="true">⠿</span>
      <input
        className="form-control form-control-sm"
        style={{ width: 180, flexShrink: 0 }}
        value={link.label || ''}
        onChange={e => onUpdate({ label: e.target.value })}
        placeholder="Link label"
        aria-label={`Footer link ${index + 1} label`}
      />
      <input
        className="form-control form-control-sm"
        style={{ flex: 1 }}
        value={link.url || ''}
        onChange={e => onUpdate({ url: e.target.value })}
        placeholder="/path or https://..."
        aria-label={`Footer link ${index + 1} URL`}
      />
      <input
        className="form-control form-control-sm"
        style={{ width: 140 }}
        value={link.title || ''}
        onChange={e => onUpdate({ title: e.target.value })}
        placeholder="ADA title"
        aria-label={`Footer link ${index + 1} ADA title`}
        title="HTML title attribute for screen readers"
      />
      <div className="d-flex align-items-center gap-1 flex-shrink-0">
        <input
          type="checkbox"
          id={`footer-newtab-${index}`}
          checked={!!link.newTab}
          onChange={e => onUpdate({ newTab: e.target.checked })}
          aria-label={`Open ${link.label || 'link'} in new tab`}
        />
        <label htmlFor={`footer-newtab-${index}`} className="small mb-0 text-muted" style={{ whiteSpace: 'nowrap', cursor: 'pointer' }}>New tab</label>
      </div>
      <button
        className="btn btn-sm btn-outline-danger"
        onClick={onRemove}
        aria-label={`Remove ${link.label || 'link'}`}
        style={{ padding: '2px 8px', lineHeight: 1.4, flexShrink: 0 }}
      >×</button>
    </div>
  );
}

function FooterLinksManager({ value, onChange, label }) {
  const parse = (v) => {
    if (Array.isArray(v)) return v;
    try {
      const parsed = JSON.parse(v || '[]');
      // Valid JSON is not necessarily a list — a stored '"[]"', an object, or a
      // number all parse cleanly and then blow up on .map(). Anything that
      // isn't an array is treated as "no links yet" rather than crashing the
      // whole settings page.
      return Array.isArray(parsed) ? parsed : [];
    } catch { return []; }
  };
  const [links, setLinks] = useState(() => parse(value));
  const [dragIdx, setDragIdx] = useState(null);
  const overIdx = useRef(null);

  useEffect(() => { setLinks(parse(value)); }, []); // eslint-disable-line

  function push(next) { setLinks(next); onChange(JSON.stringify(next)); }

  function updateLink(i, patch) { push(links.map((l, idx) => idx === i ? { ...l, ...patch } : l)); }
  function removeLink(i)        { push(links.filter((_, idx) => idx !== i)); }
  function addLink()            { push([...links, { label: 'New Link', url: '/' }]); }

  function onDragStart(i) { setDragIdx(i); overIdx.current = i; }
  function onDragOver(e, i) {
    e.preventDefault();
    if (overIdx.current === i || dragIdx === null) return;
    overIdx.current = i;
    const next = [...links];
    const [item] = next.splice(dragIdx, 1);
    next.splice(i, 0, item);
    setDragIdx(i);
    setLinks(next);
    onChange(JSON.stringify(next));
  }
  function onDragEnd() { setDragIdx(null); overIdx.current = null; }

  return (
    <div className="mb-4">
      <div className="d-flex align-items-center justify-content-between mb-2">
        <span className="form-label fw-semibold small mb-0">{label}</span>
        <button className="btn btn-sm btn-primary" onClick={addLink}>+ Add Link</button>
      </div>

      {links.length === 0 && (
        <div className="text-center text-muted py-3 border rounded" style={{ fontSize: '0.88rem' }}>
          No links yet. Click <strong>+ Add Link</strong> to start.
        </div>
      )}

      {links.map((link, i) => (
        <FooterLinkRow
          key={i}
          link={link}
          index={i}
          onUpdate={patch => updateLink(i, patch)}
          onRemove={() => removeLink(i)}
          dragHandlers={{
            isDragging: dragIdx === i,
            onDragStart: () => onDragStart(i),
            onDragOver: (e) => onDragOver(e, i),
            onDragEnd,
          }}
        />
      ))}
    </div>
  );
}

/* ─── Main Page ──────────────────────────────────────────────── */

export default function WebsiteHeaderFooterPage() {
  const [tab, setTab] = useState('contact');
  const [values, setValues] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [errors, setErrors] = useState({});

  useEffect(() => {
    api.get('/website/settings')
      .then(r => setValues(r.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  function set(key, val) {
    setValues(v => ({ ...v, [key]: val }));
    setErrors(e => { const n = { ...e }; delete n[key]; return n; });
  }

  async function save() {
    const newErrors = {};
    Object.values(JSON_FIELDS).flat().forEach(f => {
      if (!f.simple && values[f.key]) {
        const err = validateJson(values[f.key]);
        if (err) newErrors[f.key] = err;
      }
    });
    if (Object.keys(newErrors).length) { setErrors(newErrors); return; }

    setSaving(true);
    setSaved(false);
    try {
      await api.put('/website/settings', values);
      if (typeof window !== 'undefined') window.__siteSettingsCache = null;
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (e) {
      toast(parseApiError(e, 'Save failed'), 'error');
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="d-flex justify-content-center py-5"><div className="spinner-border text-primary" role="status"><span className="visually-hidden">Loading…</span></div></div>;

  const textFields = TEXT_FIELDS[tab] || [];
  const jsonFields = JSON_FIELDS[tab] || [];

  return (
    <div className="container-fluid py-4" style={{ maxWidth: 960 }}>
      <PageHeader title="Header & Footer" subtitle="Manage navigation, contact info, and footer content" />

      <ul className="nav nav-tabs mb-4" role="tablist">
        {SECTIONS.map(s => (
          <li key={s.key} className="nav-item" role="presentation">
            <button
              className={`nav-link${tab === s.key ? ' active' : ''}`}
              onClick={() => setTab(s.key)}
              role="tab"
              aria-selected={tab === s.key}
            >{s.label}</button>
          </li>
        ))}
      </ul>

      <div className="card border-0 shadow-sm">
        <div className="card-body p-4">

          {/* Business logo preview (Contact tab only) */}
          {tab === 'contact' && (
            <div className="mb-4 p-3 rounded border" style={{ background: '#1a1a2e', display: 'flex', alignItems: 'center', gap: 20 }}>
              <img
                src={`${(import.meta.env.VITE_API_URL || '').replace(/\/$/, '')}/api/settings/business/logo/web`}
                alt="Business logo"
                style={{ height: 64, objectFit: 'contain', background: 'transparent' }}
                onError={e => { e.target.style.display = 'none'; e.target.nextSibling.style.display = 'flex'; }}
              />
              <span style={{ display: 'none', alignItems: 'center', color: '#adb5bd', fontSize: '0.85rem', fontStyle: 'italic' }}>
                No logo uploaded yet
              </span>
              <div style={{ flex: 1 }}>
                <div className="fw-semibold small" style={{ color: '#fff' }}>Logo from Business Settings</div>
                <div className="text-muted small" style={{ color: '#adb5bd !important' }}>
                  This logo appears in the public site header. To change it, go to{' '}
                  <a href="/admin/settings/business" style={{ color: '#90caf9' }}>Business Settings → Logo</a>.
                </div>
              </div>
            </div>
          )}

          {tab === 'nav' && (
            <>
              <h6 className="fw-semibold mb-1">Header CTA Buttons</h6>
              <p className="text-muted small mb-3">
                Buttons shown at the top-right of the header, and repeated at the bottom of the
                mobile menu. Add as many as the design calls for.
              </p>
              <FooterLinksManager
                label="CTA Buttons"
                value={typeof values.header_cta_buttons === 'string'
                  ? values.header_cta_buttons
                  : JSON.stringify(values.header_cta_buttons || [])}
                onChange={v => set('header_cta_buttons', v)}
              />
              <hr className="mt-0" />
            </>
          )}

          {/* Site-wide CSS. This is where an imported design's stylesheet lives
              (import-design.js writes it to site_custom_css). It is loaded after
              the site stylesheet on every public page AND inside the builder
              canvas, so it wins — and it is deliberately never loaded on admin
              screens, which is what keeps the design's unscoped selectors from
              leaking into this dashboard. */}
          {tab === 'css' && (
            <>
              <h6 className="fw-semibold mb-1">Site CSS</h6>
              <p className="text-muted small mb-3">
                Applies to every public page and to the builder canvas. The imported design’s
                stylesheet is stored here — edit with care, it is the whole site’s styling.
                Do not paste this into a single page’s Custom CSS; that would load it once per page.
              </p>
              <CodeEditor
                language="css"
                value={values.site_custom_css || ''}
                onChange={v => set('site_custom_css', v)}
                height="520px"
                placeholder="/* Site-wide CSS */"
              />
              <div className="form-text mt-2">
                {((values.site_custom_css || '').length / 1024).toFixed(1)} KB stored
              </div>
            </>
          )}

          {/* Site-wide JS — public pages only. Never runs in the builder canvas,
              so a design's scroll/carousel scripts can't fight the editor. */}
          {tab === 'js' && (
            <>
              <h6 className="fw-semibold mb-1">Site JavaScript</h6>
              <p className="text-muted small mb-3">
                Runs on the live site only — never inside the builder canvas. The imported
                design’s <code>main.js</code> is stored here.
              </p>
              <CodeEditor
                language="javascript"
                value={values.site_custom_js || ''}
                onChange={v => set('site_custom_js', v)}
                height="520px"
                placeholder="// Site-wide JavaScript"
              />
              <div className="form-text mt-2">
                {((values.site_custom_js || '').length / 1024).toFixed(1)} KB stored
              </div>
            </>
          )}

          {/* Plain text fields */}
          {textFields.map(f => (
            <div key={f.key} className="mb-3">
              {TOGGLE_KEYS.has(f.key) ? (
                <div className="form-check">
                  <input
                    type="checkbox"
                    className="form-check-input"
                    id={`field-${f.key}`}
                    // Values live in a key/value text table, so these are the
                    // strings 'true'/'false'. An unset key falls back to the
                    // same default PublicLayout applies, so the checkbox shows
                    // what the site is actually doing before anyone saves.
                    checked={String(values[f.key] ?? TOGGLE_KEYS.get(f.key)) === 'true'}
                    onChange={e => set(f.key, e.target.checked ? 'true' : 'false')}
                  />
                  <label className="form-check-label fw-semibold small" htmlFor={`field-${f.key}`}>{f.label}</label>
                  {f.help && <div className="form-text mt-0">{f.help}</div>}
                </div>
              ) : (
              <>
              <label className="form-label fw-semibold small" htmlFor={`field-${f.key}`}>{f.label}</label>
              {COLOR_KEYS.has(f.key) ? (
                <div className="d-flex align-items-center gap-2">
                  <input
                    type="color"
                    className="form-control form-control-color flex-shrink-0"
                    aria-label={`${f.label} colour picker`}
                    // A blank setting means "use the design's own value", which a
                    // colour input can't represent — show black but leave the
                    // stored value empty until the user actually picks something.
                    value={/^#[0-9a-f]{6}$/i.test(values[f.key] || '') ? values[f.key] : '#000000'}
                    onChange={e => set(f.key, e.target.value)}
                  />
                  <input
                    id={`field-${f.key}`}
                    type="text"
                    className="form-control"
                    value={values[f.key] || ''}
                    onChange={e => set(f.key, e.target.value)}
                    placeholder={f.help || ''}
                  />
                </div>
              ) : (
                <input
                  id={`field-${f.key}`}
                  type="text"
                  className="form-control"
                  value={values[f.key] || ''}
                  onChange={e => set(f.key, e.target.value)}
                  placeholder={f.help || ''}
                />
              )}
              {f.help && <div className="form-text">{f.help}</div>}
              </>
              )}
            </div>
          ))}

          {/* Visual Nav Manager */}
          {tab === 'nav' && (
            <>
              <hr className="mt-1" />
              <h6 className="fw-semibold mb-3">Navigation Links</h6>
            </>
          )}
          {tab === 'nav' && (
            <NavManager
              value={typeof values['header_nav_links'] === 'string'
                ? values['header_nav_links']
                : JSON.stringify(values['header_nav_links'] || [])}
              onChange={v => set('header_nav_links', v)}
            />
          )}

          {/* Footer identity — logo and blurb, above the link columns */}
          {tab === 'footer' && FOOTER_TEXT_FIELDS.map(f => (
            <div key={f.key} className="mb-3">
              <label className="form-label fw-semibold small" htmlFor={`field-${f.key}`}>{f.label}</label>
              <input
                id={`field-${f.key}`}
                type="text"
                className="form-control"
                value={values[f.key] || ''}
                onChange={e => set(f.key, e.target.value)}
                placeholder={f.help || ''}
              />
              <div className="form-text">{f.help}</div>
            </div>
          ))}
          {tab === 'footer' && <hr className="mt-1 mb-4" />}

          {/* Footer visual link managers */}
          {tab === 'footer' && FOOTER_LINK_MANAGERS.map(f => (
            <div key={f.key} className="mb-5">
              {f.titleKey && (
                <div className="mb-2">
                  <label className="form-label fw-semibold small" htmlFor={`field-${f.titleKey}`}>{f.label} — Column Heading</label>
                  <input
                    id={`field-${f.titleKey}`}
                    type="text"
                    className="form-control mb-3"
                    value={values[f.titleKey] || ''}
                    onChange={e => set(f.titleKey, e.target.value)}
                    placeholder={`e.g. Quick Links`}
                  />
                </div>
              )}
              <FooterLinksManager
                label={f.label}
                // `|| []`, not `|| '[]'` — stringifying the *string* '[]' yields
                // '"[]"', which parses back to a string and has no .map().
                value={typeof values[f.key] === 'string' ? values[f.key] : JSON.stringify(values[f.key] || [])}
                onChange={v => set(f.key, v)}
              />
              <hr className="mt-0" />
            </div>
          ))}

          {/* JSON fields */}
          {jsonFields.map(f => (
            <div key={f.key} className="mb-4">
              <label className="form-label fw-semibold small" htmlFor={`field-${f.key}`}>{f.label}</label>
              {f.simple ? (
                <input
                  id={`field-${f.key}`}
                  type="text"
                  className="form-control"
                  value={values[f.key] || ''}
                  onChange={e => set(f.key, e.target.value)}
                />
              ) : (
                <>
                  <textarea
                    id={`field-${f.key}`}
                    className={`form-control font-monospace${errors[f.key] ? ' is-invalid' : ''}`}
                    rows={6}
                    value={values[f.key] || ''}
                    onChange={e => set(f.key, e.target.value)}
                    placeholder={f.example}
                    style={{ fontSize: '0.82rem' }}
                  />
                  {errors[f.key] && <div className="invalid-feedback">{errors[f.key]}</div>}
                  <div className="d-flex gap-2 mt-1">
                    <button className="btn btn-sm btn-outline-secondary" onClick={() => set(f.key, prettyJson(values[f.key] || '[]'))}>Format JSON</button>
                    {f.example && !values[f.key] && (
                      <button className="btn btn-sm btn-outline-secondary" onClick={() => set(f.key, f.example)}>Load Example</button>
                    )}
                  </div>
                </>
              )}
            </div>
          ))}

          <div className="d-flex align-items-center gap-3 mt-2 pt-3 border-top">
            <button className="btn btn-primary px-4" onClick={save} disabled={saving}>
              {saving ? 'Saving…' : 'Save Changes'}
            </button>
            {saved && <span className="text-success fw-semibold small" role="status">✓ Saved — refresh the public site to see changes</span>}
          </div>
        </div>
      </div>
    </div>
  );
}
