// Shared Puck component registry — used by both the editor and the public renderer.
import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

const API_BASE = import.meta.env.VITE_API_URL
  ? `${import.meta.env.VITE_API_URL.replace(/\/$/, '')}/api`
  : '/api';
const SERVER_BASE = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');
const resolveUrl = url => {
  if (!url || !SERVER_BASE) return url;
  if (url.startsWith('/uploads/') || url.startsWith('/api/')) return `${SERVER_BASE}${url}`;
  return url;
};
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import TipTapLink from '@tiptap/extension-link';
import MediaPickerModal from '../../components/MediaPickerModal.jsx';
import PublicFormEmbed from '../../frontend/components/PublicFormEmbed.jsx';
import DonationCheckout from '../../frontend/components/DonationCheckout.jsx';
import DonationRecurringCheckout from '../../frontend/components/DonationRecurringCheckout.jsx';
import MembershipCheckout from '../../frontend/components/MembershipCheckout.jsx';
import { useCart } from '../../frontend/context/CartContext.jsx';
import { FA_SOLID_ICONS } from './faIconList.js';

// ── Field help: label + hover tooltip ─────────────────────────────────────────
// Uses a portal so the tooltip renders in <body> and never gets clipped by the
// overflow:hidden panel. Smart left/right positioning based on available space.
function FieldHelp({ label, hint, example }) {
  const [tipPos, setTipPos] = useState(null);
  const btnRef = useRef(null);
  // Merge example into tooltip so the label row stays clean
  const fullHint = hint
    ? (example ? `${hint}\n\nExample: ${example}` : hint)
    : example ? `Example: ${example}` : null;

  function showTip() {
    if (!btnRef.current || !fullHint) return;
    const r = btnRef.current.getBoundingClientRect();
    const spaceRight = window.innerWidth - r.right;
    if (spaceRight > 248) {
      setTipPos({ top: r.top + r.height / 2, left: r.right + 8, anchor: 'left' });
    } else {
      setTipPos({ top: r.top + r.height / 2, rightPx: window.innerWidth - r.left + 8, anchor: 'right' });
    }
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 7 }}>
      <span style={{ fontSize: '0.7rem', fontWeight: 600, color: '#4b5563', textTransform: 'uppercase', letterSpacing: '0.05em', lineHeight: 1.2 }}>
        {label}
      </span>
      {fullHint && (
        <>
          <button
            ref={btnRef}
            type="button"
            onMouseEnter={showTip}
            onMouseLeave={() => setTipPos(null)}
            style={{ width: 12, height: 12, borderRadius: '50%', background: '#d1d5db', color: '#fff', border: 'none', fontSize: '0.5rem', fontWeight: 800, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'help', padding: 0, flexShrink: 0, lineHeight: 1 }}
          >?</button>
          {tipPos && createPortal(
            <div style={{
              position: 'fixed',
              top: tipPos.top,
              ...(tipPos.anchor === 'left' ? { left: tipPos.left } : { right: tipPos.rightPx }),
              transform: 'translateY(-50%)',
              background: '#1e293b', color: '#e2e8f0',
              padding: '7px 11px', borderRadius: 7,
              fontSize: '0.68rem', lineHeight: 1.6,
              maxWidth: 240, zIndex: 9999999,
              boxShadow: '0 4px 18px rgba(0,0,0,0.4)',
              pointerEvents: 'none', whiteSpace: 'pre-wrap',
            }}>
              {fullHint}
            </div>,
            document.body
          )}
        </>
      )}
    </div>
  );
}

// ── Media / image field ────────────────────────────────────────────────────────
function MediaField({ value, onChange, label = 'Image URL', hint, example }) {
  const [showPicker, setShowPicker] = useState(false);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      <FieldHelp
        label={label}
        hint={hint || 'Enter an image URL or click Browse to pick from your media library.\n\nAccepted: jpg, png, webp, gif, svg\nLocal: /uploads/photo.jpg\nExternal: https://example.com/img.jpg'}
        example={example || '/uploads/my-image.jpg'}
      />
      <div style={{ display: 'flex', gap: 4 }}>
        <input
          value={value || ''}
          onChange={e => onChange(e.target.value)}
          placeholder="/uploads/photo.jpg or https://…"
          style={{ flex: 1, border: '1px solid #dde1e7', borderRadius: 4, padding: '0.32rem 0.65rem', fontSize: '0.72rem', minWidth: 0 }}
        />
        <button
          type="button"
          onClick={() => setShowPicker(true)}
          style={{ background: '#C9A227', color: '#fff', border: 'none', borderRadius: 4, padding: '0.3rem 0.65rem', fontSize: '0.69rem', cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0 }}
        >
          Browse
        </button>
      </div>
      {value && value.match(/\.(jpg|jpeg|png|gif|webp|svg)$/i) && (
        <img src={resolveUrl(value)} alt="" style={{ width: '100%', maxHeight: 72, objectFit: 'cover', borderRadius: 4, marginTop: 2 }} />
      )}
      <MediaPickerModal
        show={showPicker}
        onClose={() => setShowPicker(false)}
        onSelect={file => { onChange(file.file_url); setShowPicker(false); }}
      />
    </div>
  );
}

// Helper: create a custom image URL field definition for Puck
const imageField = (label, hint, example) => ({
  type: 'custom',
  label,
  render: ({ value, onChange }) => <MediaField value={value} onChange={onChange} label={label} hint={hint} example={example} />,
});

// ── Color picker field ────────────────────────────────────────────────────────
function ColorField({ value, onChange, label = 'Color' }) {
  const swatchRef = useRef(null);
  const safeHex = v => /^#[0-9a-fA-F]{3,6}$/.test(v) ? v : '#ffffff';
  const hasColor = !!(value && value !== 'transparent' && value !== '');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      <FieldHelp
        label={label}
        hint={'Click the square swatch to open the OS color picker.\n\nOr type a value directly:\n• #C9A227 — hex color\n• #fff — shorthand hex\n• transparent — no color\n\nLeave blank to inherit from parent.'}
        example="#C9A227"
      />
      <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
        {/* Clickable square swatch — opens native OS color picker */}
        <div
          onClick={() => swatchRef.current?.click()}
          title="Click to pick color"
          style={{
            width: 24, height: 24, flexShrink: 0, borderRadius: 3,
            border: '1px solid #dde1e7', cursor: 'pointer', position: 'relative',
            background: hasColor
              ? value
              : 'repeating-linear-gradient(45deg,#eee 0,#eee 4px,#fff 4px,#fff 8px)',
          }}
        >
          <input
            ref={swatchRef}
            type="color"
            value={safeHex(value)}
            onChange={e => onChange(e.target.value)}
            style={{ position: 'absolute', opacity: 0, width: 1, height: 1, pointerEvents: 'none' }}
          />
        </div>

        {/* Text input — left side shows the color as an inset chip */}
        <div style={{ flex: 1, position: 'relative', minWidth: 0 }}>
          {hasColor && (
            <span
              style={{
                position: 'absolute', left: 6, top: '50%', transform: 'translateY(-50%)',
                width: 12, height: 12, borderRadius: 2,
                background: value, border: '1px solid rgba(0,0,0,0.15)',
                pointerEvents: 'none', zIndex: 1,
              }}
            />
          )}
          <input
            type="text"
            value={value || ''}
            onChange={e => onChange(e.target.value)}
            placeholder="#000000 or transparent"
            style={{
              width: '100%', boxSizing: 'border-box',
              border: '1px solid #dde1e7', borderRadius: 4,
              padding: '0.32rem 0.65rem',
              paddingLeft: hasColor ? 28 : '0.65rem',
              fontSize: '0.72rem', lineHeight: 1.45,
              background: hasColor ? `${value}18` : '#fff',
            }}
          />
        </div>

        {value && (
          <button type="button" onClick={() => onChange('')} title="Clear"
            style={{ background: 'none', border: '1px solid #e5e7eb', borderRadius: 3, padding: '1px 5px', cursor: 'pointer', fontSize: '0.65rem', color: '#9ca3af', flexShrink: 0 }}>
            ✕
          </button>
        )}
      </div>
    </div>
  );
}
const colorField = label => ({
  type: 'custom', label,
  render: ({ value, onChange }) => <ColorField value={value} onChange={onChange} label={label} />,
});

// ── Icon picker field (Font Awesome — offline search + preview) ───────────────
// Icon names come from FA_SOLID_ICONS (generated from the bundled
// @fortawesome/fontawesome-free package's own SVG file list — see
// faIconList.js), so search works instantly with no network call and can
// never drift from what's actually installed.
const FEATURED_ICONS = [
  'star', 'shield-halved', 'clock', 'user', 'house', 'gear', 'phone', 'envelope', 'globe',
  'cart-shopping', 'heart', 'bolt', 'plane', 'comment', 'rocket', 'circle-check', 'trophy',
  'medal', 'chart-line', 'building', 'key', 'lock', 'leaf', 'cloud', 'truck', 'sack-dollar',
  'headset', 'camera', 'video', 'microphone', 'book', 'graduation-cap', 'wrench', 'hammer',
  'code', 'server', 'handshake', 'lightbulb', 'users', 'map-pin', 'gift', 'award', 'thumbs-up',
  'gauge', 'wifi', 'laptop', 'mobile', 'print', 'calendar', 'magnifying-glass',
].filter(name => FA_SOLID_ICONS.includes(name));

function faClass(name) { return `fa-solid fa-${name}`; }

// Renders any value produced by iconField(): a Font Awesome class ('fa-solid fa-star'),
// a legacy Iconify name from before the FA switch ('solar:star-bold'), or a raw emoji/text
// fallback. Shared by every block that consumes an icon field so the three formats are
// handled consistently everywhere instead of each render function reimplementing it.
function renderIconValue(icon, style) {
  if (!icon) return null;
  if (icon.startsWith('fa-')) return <i className={icon} style={style} />;
  if (icon.includes(':')) return <iconify-icon icon={icon} style={style} />;
  return <span style={style}>{icon}</span>;
}

// Real card-network marks (simplified, faithful-to-brand SVGs) for payment
// blocks — used instead of generic colored text badges. `size` scales width;
// height follows each mark's natural aspect ratio.
function CardBrandIcon({ brand, size = 32 }) {
  const h = size * 0.64;
  switch (brand) {
    case 'visa':
      return (
        <svg width={size} height={h} viewBox="0 0 48 31" style={{ display: 'block' }}>
          <rect width="48" height="31" rx="4" fill="#fff" stroke="#e2e8f0" />
          <text x="24" y="21" textAnchor="middle" fontFamily="Arial, sans-serif" fontStyle="italic" fontWeight="900" fontSize="14" fill="#1A1F71">VISA</text>
        </svg>
      );
    case 'mastercard':
      return (
        <svg width={size} height={h} viewBox="0 0 48 31" style={{ display: 'block' }}>
          <rect width="48" height="31" rx="4" fill="#fff" stroke="#e2e8f0" />
          <circle cx="20" cy="15.5" r="9" fill="#EB001B" />
          <circle cx="28" cy="15.5" r="9" fill="#F79E1B" />
          <path d="M24 8.7a9 9 0 0 1 0 13.6 9 9 0 0 1 0-13.6Z" fill="#FF5F00" />
        </svg>
      );
    case 'amex':
      return (
        <svg width={size} height={h} viewBox="0 0 48 31" style={{ display: 'block' }}>
          <rect width="48" height="31" rx="4" fill="#006FCF" />
          <text x="24" y="20" textAnchor="middle" fontFamily="Arial, sans-serif" fontWeight="800" fontSize="10.5" fill="#fff" letterSpacing="0.5">AMEX</text>
        </svg>
      );
    case 'discover':
      return (
        <svg width={size} height={h} viewBox="0 0 48 31" style={{ display: 'block' }}>
          <rect width="48" height="31" rx="4" fill="#fff" stroke="#e2e8f0" />
          <text x="6" y="20" fontFamily="Arial, sans-serif" fontWeight="700" fontStyle="italic" fontSize="9.5" fill="#231F20">Discover</text>
          <circle cx="41" cy="15.5" r="5.5" fill="#FF6600" />
        </svg>
      );
    default:
      return null;
  }
}

const CARD_BRANDS = ['visa', 'mastercard', 'amex', 'discover'];

function IconPickerField({ value, onChange, label = 'Icon' }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');

  const isFA = v => v && typeof v === 'string' && v.startsWith('fa-');
  const isIconify = v => v && typeof v === 'string' && v.includes(':'); // legacy values from before the FA switch

  const q = search.trim().toLowerCase();
  const results = q
    ? FA_SOLID_ICONS.filter(name => name.includes(q)).slice(0, 60)
    : FEATURED_ICONS;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      <FieldHelp
        label={label}
        hint={'Click Pick to browse Font Awesome icons, or type a class name directly.\n\nFormat: fa-solid fa-<name>\nExample: fa-solid fa-star\n\nOr paste any emoji: ✈️ 📍\n\n(Older solar:/mdi:/lucide: values from before still render, just no longer searchable here.)'}
        example="fa-solid fa-star"
      />
      <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
        {/* Live preview */}
        {value && (
          isFA(value)
            ? <i className={value} style={{ fontSize: '1.1rem', width: 22, textAlign: 'center', flexShrink: 0, color: '#374151' }} />
            : isIconify(value)
              ? <iconify-icon icon={value} style={{ fontSize: '1.2rem', width: 22, display: 'block', flexShrink: 0 }} />
              : <span style={{ fontSize: '1.1rem', width: 22, textAlign: 'center', flexShrink: 0 }}>{value}</span>
        )}
        <input type="text" value={value || ''} onChange={e => onChange(e.target.value)}
          placeholder="fa-solid fa-star"
          style={{ flex: 1, border: '1px solid #dde1e7', borderRadius: 4, padding: '0.32rem 0.65rem', fontSize: '0.72rem', minWidth: 0 }} />
        <button type="button" onClick={() => { setOpen(v => !v); setSearch(''); }}
          style={{ padding: '0.3rem 0.65rem', border: '1px solid #dde1e7', borderRadius: 4, background: open ? '#e9ecef' : '#f8f9fa', fontSize: '0.69rem', cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0 }}>
          {open ? 'Close' : 'Pick'}
        </button>
      </div>
      {open && (
        <div style={{ border: '1px solid #dde1e7', borderRadius: 4, padding: 7, background: '#fff', marginTop: 2 }}>
          <input type="text" value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search Font Awesome (star, plane, home…)" autoFocus
            style={{ width: '100%', boxSizing: 'border-box', border: '1px solid #dde1e7', borderRadius: 4, padding: '0.32rem 0.65rem', fontSize: '0.72rem', marginBottom: 7 }} />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 4, maxHeight: 240, overflowY: 'auto' }}>
            {results.map(name => {
              const cls = faClass(name);
              return (
                <button key={name} type="button" title={name}
                  onClick={() => { onChange(cls); setOpen(false); setSearch(''); }}
                  style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, padding: '6px 2px', border: `1px solid ${value === cls ? '#C9A227' : '#eee'}`, borderRadius: 4, background: value === cls ? '#fff3e8' : '#fafafa', cursor: 'pointer', fontSize: '0.55rem', color: '#555', textAlign: 'center', minWidth: 0, overflow: 'hidden' }}>
                  <i className={cls} style={{ fontSize: '1.2rem', color: value === cls ? '#C9A227' : '#333' }} />
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '100%' }}>{name}</span>
                </button>
              );
            })}
          </div>
          {results.length === 0 && (
            <p style={{ color: '#888', fontSize: '0.78rem', textAlign: 'center', margin: '8px 0 0' }}>No icons found. Try a different search term.</p>
          )}
        </div>
      )}
    </div>
  );
}
const iconField = label => ({
  type: 'custom', label,
  render: ({ value, onChange }) => <IconPickerField value={value} onChange={onChange} label={label} />,
});

// ── URL picker field — page list from system + custom URL ─────────────────────
const STATIC_ROUTES = [
  { slug: '/', title: 'Home' },
  { slug: '/about', title: 'About' },
  { slug: '/programs', title: 'Programs' },
  { slug: '/support', title: 'Support Us' },
  { slug: '/shop', title: 'Shop' },
  { slug: '/news', title: 'News' },
  { slug: '/contact', title: 'Contact' },
  { slug: '/applications', title: 'Applications' },
  { slug: '/blog', title: 'Blog' },
  { slug: '/portal/login', title: 'Portal Login' },
  { slug: '#', title: '# (No link)' },
];

function UrlPickerField({ value, onChange, label = 'URL' }) {
  const isExternal = v => v && (v.startsWith('http://') || v.startsWith('https://'));
  const [mode, setMode] = useState(() => isExternal(value) ? 'custom' : 'pages');
  const [pages, setPages] = useState([]);

  useEffect(() => {
    fetch(`${API_BASE}/pub/website/page-list`)
      .then(r => r.json())
      .then(data => { if (Array.isArray(data)) setPages(data); })
      .catch(() => {});
  }, []);

  const allOptions = [
    ...STATIC_ROUTES,
    ...pages
      .map(p => ({ slug: `/${p.slug}`, title: p.title || p.slug }))
      .filter(p => !STATIC_ROUTES.some(s => s.slug === `/${p.slug}`) && !STATIC_ROUTES.some(s => s.slug === p.slug)),
  ];

  function switchMode(m) {
    setMode(m);
    if (m === 'pages' && isExternal(value)) onChange('');
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      {label && <FieldHelp label={label} hint={'Choose a page from your site using "Page List", or switch to "Custom URL" for external links or anchors.\n\nExamples:\n• /contact — internal page\n• https://example.com — external\n• # — button with no link\n• /shop#pricing — page + anchor'} example="/contact" />}
      <div style={{ display: 'flex', border: '1px solid #dde1e7', borderRadius: 4, overflow: 'hidden', marginBottom: 4 }}>
        {['pages', 'custom'].map(m => (
          <button key={m} type="button" onClick={() => switchMode(m)}
            style={{ flex: 1, padding: '3px 0', fontSize: '0.68rem', fontWeight: mode === m ? 700 : 400,
              border: 'none', borderRight: m === 'pages' ? '1px solid #dde1e7' : 'none',
              background: mode === m ? '#C9A227' : '#f8f9fa', color: mode === m ? '#fff' : '#6b7280', cursor: 'pointer' }}>
            {m === 'pages' ? 'Page List' : 'Custom URL'}
          </button>
        ))}
      </div>
      {mode === 'pages' ? (
        <select value={value || ''} onChange={e => onChange(e.target.value)}
          style={{ width: '100%', padding: '0.32rem 0.65rem', border: '1px solid #dde1e7', borderRadius: 4, fontSize: '0.72rem' }}>
          <option value="">— select page —</option>
          {allOptions.map(p => (
            <option key={p.slug} value={p.slug}>{p.title} ({p.slug})</option>
          ))}
        </select>
      ) : (
        <input type="text" value={value || ''} onChange={e => onChange(e.target.value)}
          placeholder="https://example.com or /path"
          style={{ width: '100%', padding: '0.32rem 0.65rem', border: '1px solid #dde1e7', borderRadius: 4, fontSize: '0.72rem' }} />
      )}
      {value && <span style={{ fontSize: '0.63rem', color: '#9ca3af', wordBreak: 'break-all' }}>{value}</span>}
    </div>
  );
}
const urlField = label => ({
  type: 'custom', label,
  render: ({ value, onChange }) => <UrlPickerField value={value} onChange={onChange} label={label} />,
});

const btnRadiusField = () => ({
  type: 'select',
  label: 'Button Corner Style',
  options: [
    { label: 'Square (0px)',   value: '0px'   },
    { label: 'Slight (4px)',   value: '4px'   },
    { label: 'Rounded (8px)', value: '8px'   },
    { label: 'More (16px)',   value: '16px'  },
    { label: 'Pill',          value: '50px' },
  ],
});

// Shared "rounded vs. squared" corner control for card/panel divs — same
// options PricingTable already used for its card style, promoted to a
// reusable field so every block with a card-like container gets the same
// consistent set of choices instead of a one-off per block.
const cardRadiusField = (label = 'Card Corner Style') => ({
  type: 'select',
  label,
  options: [
    { label: 'Square (0px)',  value: '0px'   },
    { label: 'Slight (4px)',  value: '4px'   },
    { label: 'Rounded (8px)', value: '8px'   },
    { label: 'More (16px)',   value: '16px'  },
    { label: 'Large (24px)',  value: '24px'  },
    { label: 'Pill (999px)',  value: '999px' },
  ],
});

// Same control for images — a separate helper (rather than reusing
// cardRadiusField for both) so a block with both a card AND an image inside
// it can offer two independent fields without a naming collision.
const imageRadiusField = (label = 'Image Corner Style') => ({
  type: 'select',
  label,
  options: [
    { label: 'Square (0px)',  value: '0px'   },
    { label: 'Slight (4px)',  value: '4px'   },
    { label: 'Rounded (8px)', value: '8px'   },
    { label: 'More (16px)',   value: '16px'  },
    { label: 'Circle (999px)', value: '999px' },
  ],
});

// ── Rich text field (TipTap) — no inline styles, semantic HTML only ────────────
function RichTextField({ value, onChange, label = 'Content' }) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ codeBlock: false, code: false }),
      TipTapLink.configure({ openOnClick: false, HTMLAttributes: { rel: 'noopener noreferrer' } }),
    ],
    content: value || '',
    onUpdate: ({ editor }) => onChange(editor.getHTML()),
  });

  function Btn({ active, onCmd, title, children }) {
    return (
      <button type="button" onMouseDown={e => { e.preventDefault(); onCmd(); }} title={title}
        style={{ padding: '2px 7px', border: '1px solid', borderColor: active ? '#C9A227' : '#dee2e6',
          background: active ? '#C9A227' : '#fff', color: active ? '#fff' : '#333',
          borderRadius: 3, fontSize: '0.72rem', cursor: 'pointer', fontWeight: 700, lineHeight: 1.5 }}>
        {children}
      </button>
    );
  }

  function addLink() {
    const prev = editor.getAttributes('link').href || '';
    const href = window.prompt('Link URL (leave empty to remove):', prev);
    if (href === null) return;
    if (!href.trim()) { editor.chain().focus().unsetLink().run(); return; }
    editor.chain().focus().setLink({ href: href.trim() }).run();
  }

  if (!editor) return null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
      <div style={{ fontSize: '0.78rem', fontWeight: 600, color: '#555', marginBottom: 4 }}>{label}</div>
      <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap', padding: '4px 6px', background: '#f8f9fa', border: '1px solid #dee2e6', borderBottom: 'none', borderRadius: '4px 4px 0 0' }}>
        <Btn active={editor.isActive('bold')}    onCmd={() => editor.chain().focus().toggleBold().run()}                    title="Bold">B</Btn>
        <Btn active={editor.isActive('italic')}  onCmd={() => editor.chain().focus().toggleItalic().run()}                  title="Italic"><em>I</em></Btn>
        <Btn active={editor.isActive('heading', { level: 2 })} onCmd={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} title="Heading 2">H2</Btn>
        <Btn active={editor.isActive('heading', { level: 3 })} onCmd={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} title="Heading 3">H3</Btn>
        <Btn active={editor.isActive('heading', { level: 4 })} onCmd={() => editor.chain().focus().toggleHeading({ level: 4 }).run()} title="Heading 4">H4</Btn>
        <Btn active={editor.isActive('bulletList')}  onCmd={() => editor.chain().focus().toggleBulletList().run()}           title="Bullet list">• List</Btn>
        <Btn active={editor.isActive('orderedList')} onCmd={() => editor.chain().focus().toggleOrderedList().run()}          title="Numbered list">1. List</Btn>
        <Btn active={editor.isActive('link')}    onCmd={addLink}                                                             title="Add / edit link">Link</Btn>
        {editor.isActive('link') && (
          <Btn active={false} onCmd={() => editor.chain().focus().unsetLink().run()} title="Remove link">× Link</Btn>
        )}
      </div>
      <div style={{ border: '1px solid #dee2e6', borderRadius: '0 0 4px 4px', minHeight: 90, padding: '6px 10px', background: '#fff', fontSize: '0.85rem', lineHeight: 1.6 }}>
        <EditorContent editor={editor} />
      </div>
      <p style={{ margin: '3px 0 0', fontSize: '0.68rem', color: '#aaa' }}>
        Semantic HTML only — no inline styles. Style text via color/bg fields above.
      </p>
    </div>
  );
}
const richTextField = label => ({
  type: 'custom', label,
  render: ({ value, onChange }) => <RichTextField value={value} onChange={onChange} label={label} />,
});

// ── Scroll-entry animation ─────────────────────────────────────────────────
const ANIM_OPTIONS = [
  { label: 'None',              value: 'none'       },
  { label: 'Fade In',           value: 'fadeIn'     },
  { label: 'Slide from Left',   value: 'slideLeft'  },
  { label: 'Slide from Right',  value: 'slideRight' },
  { label: 'Slide from Bottom', value: 'slideUp'    },
  { label: 'Slide from Top',    value: 'slideDown'  },
  { label: 'Scale Up',          value: 'scaleUp'    },
  { label: 'Word by Word',      value: 'wordByWord' },
];
const ANIM_DELAY_OPTIONS = [
  { label: 'No delay',   value: '0'   },
  { label: '0.2s delay', value: '0.2' },
  { label: '0.4s delay', value: '0.4' },
  { label: '0.6s delay', value: '0.6' },
  { label: '0.8s delay', value: '0.8' },
  { label: '1.0s delay', value: '1'   },
];

function AnimatedBlock({ animation, delay, children, style, className, id }) {
  const ref = useRef(null);
  const [entered, setEntered] = useState(false);

  useEffect(() => {
    if (!animation || animation === 'none') { setEntered(true); return; }
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) { setEntered(true); obs.disconnect(); } },
      { threshold: 0.12 }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [animation]);

  const anim = animation && animation !== 'none' ? animation : null;
  return (
    <div
      ref={ref}
      id={id}
      className={[
        anim ? `anim-block anim-${anim}` : '',
        entered ? 'anim-entered' : '',
        className || '',
      ].filter(Boolean).join(' ')}
      style={{ ...style, animationDelay: entered && delay ? `${delay}s` : undefined }}
    >
      {children}
    </div>
  );
}

// Word-by-word animated headline
function AnimatedWords({ text, animation, baseDelay = 0 }) {
  const ref = useRef(null);
  const [entered, setEntered] = useState(false);

  useEffect(() => {
    if (!animation || animation === 'none') { setEntered(true); return; }
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) { setEntered(true); obs.disconnect(); } },
      { threshold: 0.1 }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [animation]);

  if (!animation || animation === 'none') return <>{text}</>;

  const words = (text || '').split(' ');
  return (
    <span ref={ref} aria-label={text} style={{ display: 'inline' }}>
      {words.map((word, i) => (
        <span
          key={i}
          className={`anim-word anim-${animation === 'wordByWord' ? 'slideLeft' : animation}${entered ? ' anim-entered' : ''}`}
          style={{
            display: 'inline-block',
            animationDelay: entered ? `${baseDelay + i * 0.08}s` : undefined,
            transitionDelay: `${baseDelay + i * 0.08}s`,
          }}
        >
          {word}{i < words.length - 1 ? ' ' : ''}
        </span>
      ))}
    </span>
  );
}

const animField = () => ({ type: 'select', label: 'Entrance Animation', options: ANIM_OPTIONS });
const animDelayField = () => ({ type: 'select', label: 'Animation Delay', options: ANIM_DELAY_OPTIONS });

// Shown on the success stage of DonationCard/MembershipCard/EventRegistrationCard
// — prompts the donor to create a portal account so they can see this gift/
// registration alongside the rest of their history. Self-registration already
// matches by email to the contact record the transaction just created/updated
// (server/src/routes/portal.js's /register), so this is purely a discoverability
// nudge, not new backend logic.
function PortalSignupPrompt({ email, accentColor }) {
  const href = email ? `/portal/register?email=${encodeURIComponent(email)}` : '/portal/register';
  return (
    <div style={{ marginTop: '1.5rem', paddingTop: '1.5rem', borderTop: '1px solid #e5e7eb' }}>
      <p style={{ fontSize: '0.85rem', color: '#6b7280', marginBottom: '0.6rem' }}>
        Want to see this alongside your full giving history and manage recurring gifts?
      </p>
      <a href={href} style={{ display: 'inline-block', padding: '0.6rem 1.4rem', borderRadius: '50px', background: accentColor || '#C9A227', color: '#fff', fontWeight: 600, fontSize: '0.85rem', textDecoration: 'none' }}>
        Create your free account
      </a>
    </div>
  );
}

// ── Form picker field (editor sidebar only) ────────────────────────────────
function FormPickerField({ value, onChange }) {
  const [forms, setForms] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('lc_impersonate_token') || localStorage.getItem('lc_token');
    fetch(`${API_BASE}/forms`, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
      .then(r => r.json())
      .then(data => setForms(Array.isArray(data) ? data : []))
      .catch(() => setForms([]))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      <div style={{ fontSize: '0.78rem', fontWeight: 600, color: '#555', marginBottom: 2 }}>Form</div>
      {loading ? (
        <div style={{ fontSize: '0.8rem', color: '#888' }}>Loading forms…</div>
      ) : (
        <select
          value={value || ''}
          onChange={e => onChange(e.target.value)}
          style={{ width: '100%', border: '1px solid #ced4da', borderRadius: 4, padding: '0.3rem 0.5rem', fontSize: '0.85rem' }}
        >
          <option value="">— Select a form —</option>
          {forms.map(f => (
            <option key={f.id} value={f.slug}>{f.name}</option>
          ))}
        </select>
      )}
    </div>
  );
}

function FundPickerField({ value, onChange }) {
  const [funds, setFunds] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('lc_impersonate_token') || localStorage.getItem('lc_token');
    fetch(`${API_BASE}/donations/admin/funds`, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
      .then(r => r.json())
      .then(data => setFunds(Array.isArray(data) ? data : []))
      .catch(() => setFunds([]))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      <div style={{ fontSize: '0.78rem', fontWeight: 600, color: '#555', marginBottom: 2 }}>Fund / Campaign</div>
      {loading ? (
        <div style={{ fontSize: '0.8rem', color: '#888' }}>Loading funds…</div>
      ) : (
        <select
          value={value || ''}
          onChange={e => onChange(e.target.value)}
          style={{ width: '100%', border: '1px solid #ced4da', borderRadius: 4, padding: '0.3rem 0.5rem', fontSize: '0.85rem' }}
        >
          <option value="">— General fund (no designation) —</option>
          {funds.filter(f => f.is_active).map(f => (
            <option key={f.id} value={f.slug}>{f.name}</option>
          ))}
        </select>
      )}
    </div>
  );
}

function EventPickerField({ value, onChange }) {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('lc_impersonate_token') || localStorage.getItem('lc_token');
    fetch(`${API_BASE}/events/admin`, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
      .then(r => r.json())
      .then(data => setEvents(Array.isArray(data) ? data : []))
      .catch(() => setEvents([]))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      <div style={{ fontSize: '0.78rem', fontWeight: 600, color: '#555', marginBottom: 2 }}>Event</div>
      {loading ? (
        <div style={{ fontSize: '0.8rem', color: '#888' }}>Loading events…</div>
      ) : (
        <select
          value={value || ''}
          onChange={e => onChange(e.target.value)}
          style={{ width: '100%', border: '1px solid #ced4da', borderRadius: 4, padding: '0.3rem 0.5rem', fontSize: '0.85rem' }}
        >
          <option value="">— Select an event —</option>
          {events.filter(e => e.is_active).map(e => (
            <option key={e.id} value={e.slug}>{e.name} — {new Date(e.start_at).toLocaleDateString()}</option>
          ))}
        </select>
      )}
    </div>
  );
}

// ── Form renderer (used in block render — works editor + public) ────────────
function FormEmbedRenderer({ formSlug, textColor, btnColor, btnTextColor, btnRadius, inputRadius, textareaRadius, footerNote, footerNoteColor }) {
  const [form, setForm] = useState(null);
  const [values, setValues] = useState({});
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});

  useEffect(() => {
    if (!formSlug) return;
    setForm(null); setSubmitted(false); setValues({}); setError(''); setFieldErrors({});
    fetch(`${API_BASE}/forms/public/${formSlug}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (!data) return;
        const defaults = {};
        (data.fields || []).forEach(f => {
          if (f.default_value != null && f.default_value !== '') defaults[f.field_key] = f.default_value;
        });
        setValues(defaults);
        setForm(data);
      })
      .catch(() => {});
  }, [formSlug]);

  function isVisible(field, vals) {
    if (!field.show_if_json) return true;
    try {
      const rule = typeof field.show_if_json === 'string' ? JSON.parse(field.show_if_json) : field.show_if_json;
      const v = String(vals[rule.field] ?? '');
      const cmp = String(rule.value ?? '');
      if (rule.operator === '==' || rule.operator === 'equals') return v === cmp;
      if (rule.operator === '!=' || rule.operator === 'not_equals') return v !== cmp;
      if (rule.operator === 'contains') return v.toLowerCase().includes(cmp.toLowerCase());
      if (rule.operator === 'not_empty') return v.trim() !== '';
      if (rule.operator === 'empty') return v.trim() === '';
      return true;
    } catch { return true; }
  }

  function validate(vals) {
    const errors = {};
    const LAYOUT = new Set(['heading', 'divider', 'paragraph', 'hidden']);
    (form.fields || []).forEach(f => {
      if (LAYOUT.has(f.field_type) || !isVisible(f, vals)) return;
      const v = vals[f.field_key];
      if (f.is_required && (v == null || v === '' || v === false || (Array.isArray(v) && v.length === 0))) {
        errors[f.field_key] = `${f.label} is required`;
        return;
      }
      if (!v && v !== 0) return;
      try {
        const vj = typeof f.validation_json === 'string' ? JSON.parse(f.validation_json || '{}') : (f.validation_json || {});
        if (vj.minLength && String(v).length < vj.minLength) errors[f.field_key] = `Minimum ${vj.minLength} characters`;
        if (vj.maxLength && String(v).length > vj.maxLength) errors[f.field_key] = `Maximum ${vj.maxLength} characters`;
        if (vj.min != null && Number(v) < vj.min) errors[f.field_key] = `Minimum value is ${vj.min}`;
        if (vj.max != null && Number(v) > vj.max) errors[f.field_key] = `Maximum value is ${vj.max}`;
      } catch {}
    });
    return errors;
  }

  async function submit(e) {
    e.preventDefault();
    const errors = validate(values);
    if (Object.keys(errors).length > 0) { setFieldErrors(errors); return; }
    setSubmitting(true); setError('');
    try {
      const payload = { ...values };
      if (form.honeypot) payload.__hp = '';
      const res = await fetch(`${API_BASE}/forms/public/${formSlug}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error('Submit failed');
      const data = await res.json();
      if (data.redirect_url) { window.location.href = data.redirect_url; return; }
      setSubmitted(true);
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  if (!formSlug) return (
    <div style={{ padding: '2rem', textAlign: 'center', color: '#888', border: '2px dashed #dee2e6', borderRadius: 8 }}>
      Select a form from the panel →
    </div>
  );

  if (!form) return <div style={{ padding: '1rem', color: '#888', fontSize: '0.9rem' }}>Loading form…</div>;

  if (submitted) return (
    <div style={{ padding: '1.5rem', textAlign: 'center', color: textColor || 'inherit' }}>
      <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>✓</div>
      <p style={{ fontWeight: 600 }}>{form.success_msg || 'Thank you! Your message has been sent.'}</p>
    </div>
  );

  const baseInput = { width: '100%', border: '1px solid #e5e5e5', borderRadius: Number(inputRadius) || 8, padding: '12px 16px', fontSize: '0.9rem', fontFamily: 'inherit', marginTop: 6, boxSizing: 'border-box', background: '#fafafa', color: '#374151', transition: 'border-color 0.35s cubic-bezier(0.4,0,0.2,1), box-shadow 0.35s cubic-bezier(0.4,0,0.2,1), background 0.35s cubic-bezier(0.4,0,0.2,1)' };
  const textareaInput = { ...baseInput, borderRadius: Number(textareaRadius) || Number(inputRadius) || 8 };
  const errInput  = { ...baseInput, borderColor: '#dc3545' };
  const labelStyle = { display: 'block', fontWeight: 600, fontSize: '0.8rem', color: textColor || '#4b5563' };
  const widthMap = { full: '100%', half: 'calc(50% - 8px)', third: 'calc(33.33% - 11px)', 'two-thirds': 'calc(66.66% - 5px)' };
  const LAYOUT_TYPES = new Set(['heading', 'divider', 'paragraph', 'hidden']);

  function renderField(field) {
    const ft = field.field_type || 'text';
    const val = values[field.field_key];
    const hasErr = !!fieldErrors[field.field_key];
    const fs = hasErr ? errInput : baseInput;
    const set = v => {
      setValues(prev => ({ ...prev, [field.field_key]: v }));
      if (fieldErrors[field.field_key]) setFieldErrors(prev => ({ ...prev, [field.field_key]: null }));
    };

    if (ft === 'heading') return <h3 style={{ fontWeight: 700, color: textColor || 'inherit', margin: '0 0 0.25rem', fontSize: '1.25rem' }}>{field.label}</h3>;
    if (ft === 'divider') return <hr style={{ borderColor: '#dee2e6', margin: '0.25rem 0' }} />;
    if (ft === 'paragraph') return <p style={{ color: textColor || '#555', fontSize: '0.9rem', margin: 0 }}>{field.label}</p>;
    if (ft === 'hidden') return <input type="hidden" name={field.field_key} value={field.default_value || ''} />;

    const label = (
      <label style={{ ...labelStyle, color: hasErr ? '#dc3545' : (textColor || 'inherit') }}>
        {field.label}{!!field.is_required && <span style={{ color: '#dc3545', marginLeft: 2 }}>*</span>}
      </label>
    );
    const helpEl = field.help_text ? <small style={{ display: 'block', color: '#888', fontSize: '0.78rem', marginTop: 3 }}>{field.help_text}</small> : null;
    const errEl  = hasErr ? <small style={{ display: 'block', color: '#dc3545', fontSize: '0.78rem', marginTop: 3 }}>{fieldErrors[field.field_key]}</small> : null;

    let input;
    if (ft === 'textarea') {
      input = <textarea className="lit-form-input" rows={4} style={{ ...fs, borderRadius: textareaInput.borderRadius, resize: 'vertical', minHeight: 120 }} placeholder={field.placeholder || ''} value={val || ''} onChange={e => set(e.target.value)} />;
    } else if (ft === 'select') {
      input = (
        <select className="lit-form-input" style={fs} value={val || ''} onChange={e => set(e.target.value)}>
          <option value="">Select…</option>
          {(field.options_json || []).map((o, i) => <option key={i} value={o.value || o}>{o.label || o}</option>)}
        </select>
      );
    } else if (ft === 'radio') {
      input = (
        <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 5 }}>
          {(field.options_json || []).map((o, i) => (
            <label key={i} style={{ display: 'flex', gap: 8, alignItems: 'center', fontWeight: 'normal', fontSize: '0.9rem', color: textColor || 'inherit', cursor: 'pointer' }}>
              <input type="radio" name={field.field_key} value={o.value || o} checked={val === (o.value || o)} onChange={() => set(o.value || o)} />
              {o.label || o}
            </label>
          ))}
        </div>
      );
    } else if (ft === 'checkboxes') {
      const sel = Array.isArray(val) ? val : [];
      input = (
        <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 5 }}>
          {(field.options_json || []).map((o, i) => {
            const ov = o.value || o;
            return (
              <label key={i} style={{ display: 'flex', gap: 8, alignItems: 'center', fontWeight: 'normal', fontSize: '0.9rem', color: textColor || 'inherit', cursor: 'pointer' }}>
                <input type="checkbox" checked={sel.includes(ov)} onChange={() => set(sel.includes(ov) ? sel.filter(v => v !== ov) : [...sel, ov])} />
                {o.label || o}
              </label>
            );
          })}
        </div>
      );
    } else if (ft === 'checkbox' || ft === 'terms') {
      input = (
        <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginTop: 6, fontWeight: 'normal', fontSize: '0.9rem', color: textColor || 'inherit', cursor: 'pointer' }}>
          <input type="checkbox" style={{ marginTop: 3, flexShrink: 0 }} checked={!!val} onChange={e => set(e.target.checked)} />
          <span>{field.placeholder || (ft === 'terms' ? 'I agree to the terms and conditions' : field.label)}</span>
        </label>
      );
    } else if (ft === 'rating') {
      const cur = Number(val) || 0;
      input = (
        <div style={{ display: 'flex', gap: 4, marginTop: 6 }}>
          {[1,2,3,4,5].map(n => (
            <button key={n} type="button" onClick={() => set(n)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.6rem', color: n <= cur ? '#f59e0b' : '#ddd', padding: 0, lineHeight: 1 }}>
              ★
            </button>
          ))}
        </div>
      );
    } else if (ft === 'range') {
      const vj = (() => { try { return typeof field.validation_json === 'string' ? JSON.parse(field.validation_json || '{}') : (field.validation_json || {}); } catch { return {}; } })();
      input = (
        <div style={{ marginTop: 6 }}>
          <input type="range" style={{ width: '100%' }} min={vj.min ?? 0} max={vj.max ?? 100} step={vj.step ?? 1} value={val ?? vj.min ?? 0} onChange={e => set(e.target.value)} />
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem', color: '#888' }}>
            <span>{vj.min ?? 0}</span><span style={{ fontWeight: 600 }}>{val ?? vj.min ?? 0}</span><span>{vj.max ?? 100}</span>
          </div>
        </div>
      );
    } else {
      const typeMap = { phone: 'tel' };
      const vj = (() => { try { return typeof field.validation_json === 'string' ? JSON.parse(field.validation_json || '{}') : (field.validation_json || {}); } catch { return {}; } })();
      input = (
        <input className="lit-form-input" type={typeMap[ft] || ft} style={fs} placeholder={field.placeholder || ''} value={val || ''}
          {...(vj.minLength ? { minLength: vj.minLength } : {})}
          {...(vj.maxLength ? { maxLength: vj.maxLength } : {})}
          {...(vj.min != null ? { min: vj.min } : {})}
          {...(vj.max != null ? { max: vj.max } : {})}
          onChange={e => set(e.target.value)} />
      );
    }

    return <>{label}{input}{helpEl}{errEl}</>;
  }

  return (
    <form onSubmit={submit} noValidate>
      <style>{`
        .lit-form-input:focus { outline: none; border-color: #C9A227 !important; box-shadow: 0 0 0 3px rgba(201,162,39,0.15); background: #ffffff !important; }
      `}</style>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px' }}>
        {(form.fields || []).filter(f => isVisible(f, values)).map(field => {
          const isLayout = LAYOUT_TYPES.has(field.field_type);
          return (
            <div key={field.id} style={{ width: isLayout ? '100%' : (widthMap[field.col_width] || '100%'), minWidth: 0 }}>
              {renderField(field)}
            </div>
          );
        })}
      </div>
      {error && <p style={{ color: '#dc3545', fontSize: '0.85rem', margin: '0.75rem 0' }}>{error}</p>}
      <div style={{ marginTop: '1.25rem' }}>
        <button type="submit" disabled={submitting}
          style={{ width: '100%', background: btnColor || 'var(--brand-primary, #C9A227)', color: btnTextColor || '#fff', border: 'none', borderRadius: btnRadius ?? '50px', padding: '0.9rem 2rem', fontWeight: 700, fontSize: '0.95rem', cursor: 'pointer', opacity: submitting ? 0.7 : 1, transition: 'transform 0.2s, box-shadow 0.2s', boxShadow: '0 4px 20px rgba(201,162,39,0.3)' }}
          onMouseEnter={e => { if (!submitting) e.currentTarget.style.transform = 'translateY(-2px)'; }}
          onMouseLeave={e => { e.currentTarget.style.transform = 'translateY(0)'; }}>
          {submitting ? 'Sending…' : (form.submit_text || 'Submit')}
        </button>
        {footerNote && <p style={{ textAlign: 'center', fontSize: '0.75rem', color: footerNoteColor || '#9ca3af', marginTop: '0.75rem' }}>{footerNote}</p>}
      </div>
    </form>
  );
}

// ── Shared default nav links ──────────────────────────────────────────────────
const DEFAULT_NAV = [
  { label: 'Home',     url: '/' },
  { label: 'Services', url: '/services' },
  { label: 'About',    url: '/about' },
  { label: 'Blog',     url: '/blog' },
  { label: 'Contact',  url: '/contact' },
];

const DEFAULT_FOOTER_LINKS_1 = [
  { label: 'Home',     url: '/' },
  { label: 'Services', url: '/services' },
  { label: 'About',    url: '/about' },
  { label: 'Blog',     url: '/blog' },
];

const DEFAULT_FOOTER_LINKS_2 = [
  { label: 'About Us', url: '/about' },
  { label: 'Contact',  url: '/contact' },
  { label: 'FAQ',      url: '/faq' },
];

// ── Header renders ────────────────────────────────────────────────────────────
function renderHeader({ layout, logoText, logoImage, logoUrl, bgColor, textColor, accentColor, ctaText, ctaUrl, navLinks, announcementText, announcementBg, phone }) {
  const links = navLinks || DEFAULT_NAV;
  const logo = logoImage
    ? <img src={resolveUrl(logoImage)} alt={logoText || 'Logo'} style={{ height: 40, objectFit: 'contain' }} />
    : <span style={{ fontWeight: 800, fontSize: '1.3rem', letterSpacing: '-0.5px', color: textColor || '#fff' }}>{logoText || 'VCSF'}</span>;

  const navItems = (
    <nav style={{ display: 'flex', gap: '1.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
      {links.map((l, i) => (
        <a key={i} href={l.url} style={{ color: textColor || '#fff', textDecoration: 'none', fontSize: '0.9rem', fontWeight: 500, opacity: 0.9 }}
          onMouseOver={e => e.currentTarget.style.opacity = 1}
          onMouseOut={e => e.currentTarget.style.opacity = 0.9}
        >{l.label}</a>
      ))}
      {ctaText && (
        <a href={ctaUrl || '/contact'} style={{ background: accentColor || '#C9A227', color: '#fff', padding: '0.4rem 1.2rem', borderRadius: 50, textDecoration: 'none', fontWeight: 700, fontSize: '0.85rem' }}>{ctaText}</a>
      )}
    </nav>
  );

  if (layout === 'light') {
    const bg = bgColor || '#ffffff';
    const tc = textColor || '#0A1F3D';
    return (
      <header style={{ background: bg, borderBottom: '1px solid #dee2e6', padding: '0.75rem 2rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <a href={logoUrl || '/'} style={{ textDecoration: 'none' }}>
          {logoImage ? <img src={resolveUrl(logoImage)} alt={logoText || 'Logo'} style={{ height: 40, objectFit: 'contain' }} />
            : <span style={{ fontWeight: 800, fontSize: '1.3rem', color: tc }}>{logoText || 'VCSF'}</span>}
        </a>
        <nav style={{ display: 'flex', gap: '1.5rem', alignItems: 'center' }}>
          {links.map((l, i) => (
            <a key={i} href={l.url} style={{ color: tc, textDecoration: 'none', fontSize: '0.9rem', fontWeight: 500 }}>{l.label}</a>
          ))}
          {ctaText && (
            <a href={ctaUrl || '/contact'} style={{ background: accentColor || '#C9A227', color: '#fff', padding: '0.4rem 1.2rem', borderRadius: 50, textDecoration: 'none', fontWeight: 700, fontSize: '0.85rem' }}>{ctaText}</a>
          )}
        </nav>
      </header>
    );
  }

  if (layout === 'centered') {
    const bg = bgColor || '#0A1F3D';
    const tc = textColor || '#ffffff';
    return (
      <header style={{ background: bg, padding: '1rem 2rem', textAlign: 'center' }}>
        <div style={{ marginBottom: '0.5rem' }}>
          <a href={logoUrl || '/'} style={{ textDecoration: 'none' }}>
            {logoImage ? <img src={resolveUrl(logoImage)} alt={logoText || 'Logo'} style={{ height: 44, objectFit: 'contain' }} />
              : <span style={{ fontWeight: 800, fontSize: '1.5rem', color: tc }}>{logoText || 'VCSF'}</span>}
          </a>
        </div>
        <nav style={{ display: 'flex', gap: '1.5rem', justifyContent: 'center', alignItems: 'center', flexWrap: 'wrap' }}>
          {links.map((l, i) => (
            <a key={i} href={l.url} style={{ color: tc, textDecoration: 'none', fontSize: '0.85rem', fontWeight: 500, opacity: 0.85 }}>{l.label}</a>
          ))}
          {ctaText && <a href={ctaUrl || '/contact'} style={{ background: accentColor || '#C9A227', color: '#fff', padding: '0.35rem 1rem', borderRadius: 50, textDecoration: 'none', fontWeight: 700, fontSize: '0.82rem' }}>{ctaText}</a>}
        </nav>
      </header>
    );
  }

  if (layout === 'minimal') {
    const bg = bgColor || '#ffffff';
    const tc = textColor || '#0A1F3D';
    return (
      <header style={{ background: bg, borderBottom: '1px solid #eee', padding: '1rem 2rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <a href={logoUrl || '/'} style={{ textDecoration: 'none' }}>
          {logoImage ? <img src={resolveUrl(logoImage)} alt={logoText || 'Logo'} style={{ height: 40 }} />
            : <span style={{ fontWeight: 800, fontSize: '1.3rem', color: tc }}>{logoText || 'VCSF'}</span>}
        </a>
        {ctaText && <a href={ctaUrl || '/contact'} style={{ background: accentColor || '#C9A227', color: '#fff', padding: '0.5rem 1.4rem', borderRadius: 50, textDecoration: 'none', fontWeight: 700 }}>{ctaText}</a>}
      </header>
    );
  }

  if (layout === 'split') {
    const bg = bgColor || '#ffffff';
    const tc = textColor || '#0A1F3D';
    return (
      <header>
        {/* Top strip: phone + CTA */}
        <div style={{ background: accentColor || '#C9A227', color: '#fff', padding: '0.3rem 2rem', display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '1.5rem', fontSize: '0.82rem' }}>
          {phone && <span>📞 {phone}</span>}
          {ctaText && <a href={ctaUrl || '/contact'} style={{ color: '#fff', textDecoration: 'none', fontWeight: 700 }}>{ctaText} →</a>}
        </div>
        {/* Main nav bar */}
        <div style={{ background: bg, borderBottom: '1px solid #eee', padding: '0.75rem 2rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <a href={logoUrl || '/'} style={{ textDecoration: 'none' }}>
            {logoImage ? <img src={resolveUrl(logoImage)} alt={logoText || 'Logo'} style={{ height: 40 }} />
              : <span style={{ fontWeight: 800, fontSize: '1.3rem', color: tc }}>{logoText || 'VCSF'}</span>}
          </a>
          <nav style={{ display: 'flex', gap: '1.5rem', alignItems: 'center' }}>
            {links.map((l, i) => (
              <a key={i} href={l.url} style={{ color: tc, textDecoration: 'none', fontSize: '0.9rem', fontWeight: 500 }}>{l.label}</a>
            ))}
          </nav>
        </div>
      </header>
    );
  }

  if (layout === 'announcement') {
    const bg = bgColor || '#0A1F3D';
    const tc = textColor || '#ffffff';
    return (
      <header>
        {announcementText && (
          <div style={{ background: announcementBg || '#C9A227', color: '#fff', textAlign: 'center', padding: '0.4rem 1rem', fontSize: '0.85rem', fontWeight: 500 }}>
            {announcementText}
          </div>
        )}
        <div style={{ background: bg, padding: '0.75rem 2rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <a href={logoUrl || '/'} style={{ textDecoration: 'none' }}>
            {logoImage ? <img src={resolveUrl(logoImage)} alt={logoText || 'Logo'} style={{ height: 40 }} />
              : <span style={{ fontWeight: 800, fontSize: '1.3rem', color: tc }}>{logoText || 'VCSF'}</span>}
          </a>
          {navItems}
        </div>
      </header>
    );
  }

  // default: 'dark'
  return (
    <header style={{ background: bgColor || '#0A1F3D', padding: '0.75rem 2rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
      <a href={logoUrl || '/'} style={{ textDecoration: 'none' }}>{logo}</a>
      {navItems}
    </header>
  );
}

// ── Footer renders ────────────────────────────────────────────────────────────
function renderFooter({ layout, logoText, logoImage, logoUrl, tagline, col1Title, col1Links, col2Title, col2Links, address, copyright, bgColor, textColor, facebookUrl, twitterUrl, instagramUrl, linkedinUrl }) {
  const cols1 = col1Links || DEFAULT_FOOTER_LINKS_1;
  const cols2 = col2Links || DEFAULT_FOOTER_LINKS_2;
  const copy  = copyright || `© ${new Date().getFullYear()} VCSF. All rights reserved.`;
  const logoEl = logoImage
    ? <img src={resolveUrl(logoImage)} alt={logoText || 'Logo'} style={{ height: 36, objectFit: 'contain' }} />
    : <span style={{ fontWeight: 800, fontSize: '1.2rem' }}>{logoText || 'VCSF'}</span>;

  const socialLinks = (color = '#fff') => (
    <div style={{ display: 'flex', gap: '1rem', marginTop: '0.5rem' }}>
      {facebookUrl  && <a href={facebookUrl}  target="_blank" rel="noopener noreferrer" style={{ color, textDecoration: 'none', fontSize: '0.85rem' }}>Facebook</a>}
      {twitterUrl   && <a href={twitterUrl}   target="_blank" rel="noopener noreferrer" style={{ color, textDecoration: 'none', fontSize: '0.85rem' }}>Twitter</a>}
      {instagramUrl && <a href={instagramUrl} target="_blank" rel="noopener noreferrer" style={{ color, textDecoration: 'none', fontSize: '0.85rem' }}>Instagram</a>}
      {linkedinUrl  && <a href={linkedinUrl}  target="_blank" rel="noopener noreferrer" style={{ color, textDecoration: 'none', fontSize: '0.85rem' }}>LinkedIn</a>}
    </div>
  );

  if (layout === 'simple') {
    const bg = bgColor || '#f8f9fa';
    const tc = textColor || '#333';
    return (
      <footer style={{ background: bg, borderTop: '1px solid #dee2e6', padding: '2rem', textAlign: 'center' }}>
        <a href={logoUrl || '/'} style={{ textDecoration: 'none', color: tc, display: 'block', marginBottom: '0.75rem' }}>{logoEl}</a>
        {tagline && <p style={{ color: tc, opacity: 0.7, fontSize: '0.9rem', marginBottom: '1rem' }}>{tagline}</p>}
        <nav style={{ display: 'flex', gap: '1.5rem', justifyContent: 'center', flexWrap: 'wrap', marginBottom: '1rem' }}>
          {[...cols1, ...cols2].map((l, i) => (
            <a key={i} href={l.url} style={{ color: tc, textDecoration: 'none', fontSize: '0.85rem', opacity: 0.8 }}>{l.label}</a>
          ))}
        </nav>
        {socialLinks(tc)}
        <p style={{ color: tc, opacity: 0.5, fontSize: '0.8rem', marginTop: '1rem', marginBottom: 0 }}>{copy}</p>
      </footer>
    );
  }

  if (layout === 'minimal') {
    const bg = bgColor || '#0A1F3D';
    const tc = textColor || '#aaa';
    return (
      <footer style={{ background: bg, padding: '1.25rem 2rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem' }}>
        <a href={logoUrl || '/'} style={{ textDecoration: 'none', color: '#fff' }}>{logoEl}</a>
        <p style={{ color: tc, fontSize: '0.82rem', margin: 0 }}>{copy}</p>
      </footer>
    );
  }

  if (layout === 'dark') {
    const bg = bgColor || '#0A1F3D';
    const tc = textColor || '#ccc';
    return (
      <footer style={{ background: bg, color: tc, padding: '3rem 2rem 1.5rem' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '2rem', maxWidth: 1200, margin: '0 auto' }}>
          <div>
            <a href={logoUrl || '/'} style={{ textDecoration: 'none', color: '#fff', display: 'block', marginBottom: '0.5rem' }}>{logoEl}</a>
            {tagline && <p style={{ fontSize: '0.85rem', opacity: 0.6, lineHeight: 1.6 }}>{tagline}</p>}
            {socialLinks('#aaa')}
          </div>
          <div>
            <h6 style={{ color: '#fff', fontWeight: 700, marginBottom: '0.75rem', fontSize: '0.9rem' }}>{col1Title || 'Fleet'}</h6>
            {cols1.map((l, i) => <div key={i}><a href={l.url} style={{ color: tc, textDecoration: 'none', fontSize: '0.85rem', opacity: 0.75, lineHeight: 2 }}>{l.label}</a></div>)}
          </div>
          <div>
            <h6 style={{ color: '#fff', fontWeight: 700, marginBottom: '0.75rem', fontSize: '0.9rem' }}>{col2Title || 'Company'}</h6>
            {cols2.map((l, i) => <div key={i}><a href={l.url} style={{ color: tc, textDecoration: 'none', fontSize: '0.85rem', opacity: 0.75, lineHeight: 2 }}>{l.label}</a></div>)}
          </div>
          {address && (
            <div>
              <h6 style={{ color: '#fff', fontWeight: 700, marginBottom: '0.75rem', fontSize: '0.9rem' }}>Contact</h6>
              <p style={{ fontSize: '0.85rem', opacity: 0.7, lineHeight: 1.8, whiteSpace: 'pre-line' }}>{address}</p>
            </div>
          )}
        </div>
        <div style={{ borderTop: '1px solid rgba(255,255,255,0.1)', marginTop: '2rem', paddingTop: '1rem', textAlign: 'center' }}>
          <p style={{ color: tc, fontSize: '0.8rem', opacity: 0.5, margin: 0 }}>{copy}</p>
        </div>
      </footer>
    );
  }

  if (layout === 'branded') {
    const bg = bgColor || '#C9A227';
    const tc = textColor || '#e0d4f7';
    return (
      <footer style={{ background: bg, color: tc, padding: '3rem 2rem 1.5rem' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '2rem', maxWidth: 1200, margin: '0 auto' }}>
          <div>
            <a href={logoUrl || '/'} style={{ textDecoration: 'none', color: '#fff', display: 'block', marginBottom: '0.5rem' }}>{logoEl}</a>
            {tagline && <p style={{ fontSize: '0.85rem', opacity: 0.75, lineHeight: 1.6 }}>{tagline}</p>}
            {socialLinks('rgba(255,255,255,0.7)')}
          </div>
          <div>
            <h6 style={{ color: '#fff', fontWeight: 700, marginBottom: '0.75rem', fontSize: '0.9rem', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{col1Title || 'Fleet'}</h6>
            {cols1.map((l, i) => <div key={i}><a href={l.url} style={{ color: tc, textDecoration: 'none', fontSize: '0.85rem', lineHeight: 2 }}>{l.label}</a></div>)}
          </div>
          <div>
            <h6 style={{ color: '#fff', fontWeight: 700, marginBottom: '0.75rem', fontSize: '0.9rem', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{col2Title || 'Company'}</h6>
            {cols2.map((l, i) => <div key={i}><a href={l.url} style={{ color: tc, textDecoration: 'none', fontSize: '0.85rem', lineHeight: 2 }}>{l.label}</a></div>)}
          </div>
          {address && (
            <div>
              <h6 style={{ color: '#fff', fontWeight: 700, marginBottom: '0.75rem', fontSize: '0.9rem', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Contact</h6>
              <p style={{ fontSize: '0.85rem', opacity: 0.8, lineHeight: 1.8, whiteSpace: 'pre-line' }}>{address}</p>
            </div>
          )}
        </div>
        <div style={{ borderTop: '1px solid rgba(255,255,255,0.15)', marginTop: '2rem', paddingTop: '1rem', textAlign: 'center' }}>
          <p style={{ color: tc, fontSize: '0.8rem', opacity: 0.6, margin: 0 }}>{copy}</p>
        </div>
      </footer>
    );
  }

  // default: 'three-col'
  const bg = bgColor || '#0A1F3D';
  const tc = textColor || '#ccc';
  return (
    <footer style={{ background: bg, color: tc, padding: '3rem 2rem 1.5rem' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '2rem', maxWidth: 1200, margin: '0 auto' }}>
        <div>
          <a href={logoUrl || '/'} style={{ textDecoration: 'none', color: '#fff', display: 'block', marginBottom: '0.5rem' }}>{logoEl}</a>
          {tagline && <p style={{ fontSize: '0.85rem', opacity: 0.65, lineHeight: 1.6, marginTop: '0.5rem' }}>{tagline}</p>}
          {socialLinks('#aaa')}
        </div>
        <div>
          <h6 style={{ color: '#fff', fontWeight: 700, marginBottom: '0.75rem', fontSize: '0.9rem' }}>{col1Title || 'Fleet'}</h6>
          {cols1.map((l, i) => <div key={i}><a href={l.url} style={{ color: tc, textDecoration: 'none', fontSize: '0.85rem', opacity: 0.75, lineHeight: 2 }}>{l.label}</a></div>)}
        </div>
        <div>
          <h6 style={{ color: '#fff', fontWeight: 700, marginBottom: '0.75rem', fontSize: '0.9rem' }}>{col2Title || 'Company'}</h6>
          {cols2.map((l, i) => <div key={i}><a href={l.url} style={{ color: tc, textDecoration: 'none', fontSize: '0.85rem', opacity: 0.75, lineHeight: 2 }}>{l.label}</a></div>)}
        </div>
        {address && (
          <div>
            <h6 style={{ color: '#fff', fontWeight: 700, marginBottom: '0.75rem', fontSize: '0.9rem' }}>Contact</h6>
            <p style={{ fontSize: '0.85rem', opacity: 0.7, lineHeight: 1.8, whiteSpace: 'pre-line' }}>{address}</p>
          </div>
        )}
      </div>
      <div style={{ borderTop: '1px solid rgba(255,255,255,0.1)', marginTop: '2rem', paddingTop: '1rem', textAlign: 'center' }}>
        <p style={{ color: tc, fontSize: '0.8rem', opacity: 0.5, margin: 0 }}>{copy}</p>
      </div>
    </footer>
  );
}

// ── Photo Gallery block — named component so useState works in Puck editor ────
function PhotoGalleryBlock({ heading, headingColor, captionColor, columns, imageRadius, bgColor, items }) {
  const [lightbox, setLightbox] = useState(null);
  const list   = items || [];
  const capClr = captionColor || '#666666';
  const imgRad = imageRadius ?? '4px';
  return (
    <div style={{ padding: '2rem 1rem', background: bgColor || 'transparent' }}>
      {heading && <h2 style={{ textAlign: 'center', marginBottom: '1.5rem', color: headingColor || 'inherit' }}>{heading}</h2>}
      <div className="lit-responsive-grid" style={{ display: 'grid', gridTemplateColumns: `repeat(${columns}, 1fr)`, gap: '0.75rem', maxWidth: 1200, margin: '0 auto' }}>
        {list.map((img, i) => (
          <div key={i} style={{ overflow: 'hidden', borderRadius: imgRad, cursor: 'pointer' }}
            onClick={() => setLightbox(i)}>
            <img src={resolveUrl(img.src)} alt={img.caption || ''} style={{ width: '100%', display: 'block', aspectRatio: '4/3', objectFit: 'cover', transition: 'transform 0.2s' }}
              onMouseOver={e => e.currentTarget.style.transform = 'scale(1.03)'}
              onMouseOut={e => e.currentTarget.style.transform = 'scale(1)'} />
            {img.caption && <p style={{ margin: '0.25rem 0 0', fontSize: '0.8rem', color: capClr, textAlign: 'center' }}>{img.caption}</p>}
          </div>
        ))}
      </div>

      {lightbox !== null && (
        <div onClick={() => setLightbox(null)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.92)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {lightbox > 0 && (
            <button onClick={e => { e.stopPropagation(); setLightbox(lightbox - 1); }}
              style={{ position: 'absolute', left: 20, background: 'rgba(255,255,255,0.15)', border: 'none', color: '#fff', fontSize: '2rem', width: 48, height: 48, borderRadius: '50%', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>‹</button>
          )}
          <div onClick={e => e.stopPropagation()} style={{ maxWidth: '90vw', maxHeight: '90vh', textAlign: 'center' }}>
            <img src={resolveUrl(list[lightbox].src)} alt={list[lightbox].caption || ''}
              style={{ maxWidth: '90vw', maxHeight: '80vh', objectFit: 'contain', borderRadius: 4, boxShadow: '0 8px 40px rgba(0,0,0,0.6)' }} />
            {list[lightbox].caption && (
              <p style={{ color: 'rgba(255,255,255,0.8)', marginTop: '0.75rem', fontSize: '0.95rem' }}>{list[lightbox].caption}</p>
            )}
            <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: '0.8rem', marginTop: '0.25rem' }}>{lightbox + 1} / {list.length}</p>
          </div>
          {lightbox < list.length - 1 && (
            <button onClick={e => { e.stopPropagation(); setLightbox(lightbox + 1); }}
              style={{ position: 'absolute', right: 20, background: 'rgba(255,255,255,0.15)', border: 'none', color: '#fff', fontSize: '2rem', width: 48, height: 48, borderRadius: '50%', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>›</button>
          )}
          <button onClick={() => setLightbox(null)}
            style={{ position: 'absolute', top: 16, right: 16, background: 'none', border: 'none', color: '#fff', fontSize: '2rem', cursor: 'pointer', lineHeight: 1 }}>×</button>
        </div>
      )}
    </div>
  );
}

// ── Shared nav / footer field definitions ─────────────────────────────────────
const NAV_LINK_ARRAY = {
  type: 'array',
  label: 'Navigation Links',
  arrayFields: {
    label: { type: 'text', label: 'Label' },
    url:   { type: 'text', label: 'URL'   },
  },
  defaultItemProps: { label: 'Page', url: '/' },
};

const FOOTER_LINK_ARRAY = {
  type: 'array',
  label: 'Links',
  arrayFields: {
    label: { type: 'text', label: 'Label' },
    url:   { type: 'text', label: 'URL'   },
  },
  defaultItemProps: { label: 'Page', url: '/' },
};

// ── Pricing Table block — named so useState works in Puck editor ─────────────
function PricingTableBlock({
  id, tiers, pricingNote,
  accentColor, standardHeaderBg, cardBodyBg, featureTextColor, sectionBg,
  headerTextColor, priceColor, noteTextColor, noteBgColor,
  tierNameSize, priceSize, featureSize,
  modalTitle, modalHeaderBg,
  cardRadius, btnRadius, bulletColor,
}) {
  const [activeQuote, setActiveQuote] = useState(null);

  const ACCENT      = accentColor      || '#C9A227';
  const STD_HDR     = standardHeaderBg || '#0A1F3D';
  const CARD_BG     = cardBodyBg       || '#ffffff';
  const FEAT_CLR    = featureTextColor  || '#444444';
  const SECTION     = sectionBg        || 'transparent';
  const MODAL_BG    = modalHeaderBg    || ACCENT;
  const TIER_SZ     = tierNameSize     || '1.25rem';
  const PRICE_SZ    = priceSize        || '1.5rem';
  const FEAT_SZ     = featureSize      || '0.95rem';
  const MOD_TTL     = modalTitle       || 'Request a Quote';
  const CARD_RADIUS = cardRadius       || '0px';
  const BTN_RADIUS  = btnRadius        || '4px';
  const BULLET_CLR  = bulletColor      || ACCENT;
  const HDR_TXT     = headerTextColor  || '#ffffff';
  const NOTE_TXT    = noteTextColor    || '#555555';
  const NOTE_BG     = noteBgColor      || '#f5f5f5';

  const list = tiers || [];
  const activeTier = list.find(t => t.name === activeQuote);
  const activeSlug = activeTier?.formSlug || 'contact';

  return (
    <div style={{ background: SECTION }}>
      <div className="container py-5">
        <div className="row g-4 mb-5">
          {list.map((tier, i) => {
            const featured = tier.featured === true || tier.featured === 'true';
            const features = (tier.features || '').split('\n').map(s => s.trim()).filter(Boolean);
            const hdrBg  = featured ? ACCENT : STD_HDR;
            const btnBg  = featured ? ACCENT : 'transparent';
            const btnBdr = featured ? ACCENT : STD_HDR;
            const btnClr = featured ? '#fff' : STD_HDR;
            const topRadius    = CARD_RADIUS === '0px' ? '0px' : CARD_RADIUS;
            const bottomRadius = CARD_RADIUS === '0px' ? '0px' : CARD_RADIUS;
            return (
              <div className="col-lg-4" key={i}>
                <div style={{ border: `2px solid ${featured ? ACCENT : '#ddd'}`, height: '100%', display: 'flex', flexDirection: 'column', borderRadius: CARD_RADIUS, overflow: 'hidden' }}>
                  <div style={{ backgroundColor: hdrBg, color: HDR_TXT, padding: '1.5rem', textAlign: 'center' }}>
                    {tier.icon && (
                      tier.icon.includes(':')
                        ? <iconify-icon icon={tier.icon} style={{ fontSize: '2rem', marginBottom: '0.75rem', display: 'block', color: HDR_TXT }} />
                        : <i className={tier.icon} style={{ fontSize: '2rem', marginBottom: '0.75rem', display: 'block', color: HDR_TXT }} />
                    )}
                    <h4 style={{ fontWeight: 700, marginBottom: '0.5rem', fontSize: TIER_SZ, color: HDR_TXT }}>{tier.name || 'Tier Name'}</h4>
                    <div style={{ fontSize: PRICE_SZ, fontWeight: 900, color: priceColor || (featured ? '#ffffff' : ACCENT) }}>
                      {tier.price || 'Contact for Pricing'}
                    </div>
                  </div>
                  <div style={{ padding: '1.5rem', flex: 1, background: CARD_BG }}>
                    <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                      {features.map((f, j) => (
                        <li key={j} style={{ padding: '0.4rem 0', borderBottom: '1px solid #eee', fontSize: FEAT_SZ, color: FEAT_CLR, display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                          <i className="fa-solid fa-circle-check" style={{ color: BULLET_CLR, flexShrink: 0 }} />
                          {f}
                        </li>
                      ))}
                    </ul>
                  </div>
                  {tier.formSlug && (
                    <div style={{ padding: '1rem 1.5rem', background: CARD_BG }}>
                      <button
                        onClick={() => setActiveQuote(tier.name)}
                        style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', width: '100%', padding: '0.6rem', backgroundColor: btnBg, border: `2px solid ${btnBdr}`, color: btnClr, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', fontSize: '0.85rem', cursor: 'pointer', borderRadius: BTN_RADIUS }}>
                        <i className="fa-solid fa-envelope" />
                        Get a Quote
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {pricingNote && (
          <div style={{ backgroundColor: NOTE_BG, padding: '2rem', borderLeft: `4px solid ${ACCENT}` }}>
            <h5 style={{ fontWeight: 700, color: NOTE_TXT, marginBottom: '0.5rem' }}>
              <i className="fa-solid fa-circle-info" style={{ color: ACCENT, marginRight: '0.5rem' }} />
              Pricing Note
            </h5>
            <p style={{ color: NOTE_TXT, marginBottom: 0 }}>{pricingNote}</p>
          </div>
        )}

        {activeQuote && (
          <div onClick={() => setActiveQuote(null)}
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 3000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
            <div onClick={e => e.stopPropagation()}
              style={{ background: '#fff', borderRadius: 8, width: '100%', maxWidth: 620, maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 8px 40px rgba(0,0,0,0.25)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '1.25rem 1.5rem', borderBottom: '1px solid #dee2e6', background: MODAL_BG, borderRadius: '8px 8px 0 0' }}>
                <div>
                  <h5 style={{ margin: 0, color: '#fff', fontWeight: 700 }}>{MOD_TTL}</h5>
                  <small style={{ color: 'rgba(255,255,255,0.8)' }}>{activeQuote}</small>
                </div>
                <button onClick={() => setActiveQuote(null)} style={{ background: 'none', border: 'none', color: '#fff', fontSize: '1.4rem', cursor: 'pointer', lineHeight: 1, padding: 0 }}>✕</button>
              </div>
              <div key={activeQuote} style={{ padding: '1.5rem' }}>
                <PublicFormEmbed
                  formSlug={activeSlug}
                  initialValues={{ kit_interest: activeQuote }}
                  onSuccess={() => setActiveQuote(null)}
                />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Aircraft Hero Block ─────────────────────────────────────────────────────
function AircraftHeroBlock({ logoImage, logoHeight, badge, badgeBg, badgeTextColor, headline, headlineColor, headlineSpan, headlineSpanColor, subtext, subtextColor, bgImage, overlay, bgColor, btn1Text, btn1Url, btn1BgColor, btn1TextColor, btn2Text, btn2Url, btn2TextColor, btnRadius }) {
  const BG = bgImage
    ? `linear-gradient(135deg, rgba(0,0,0,${overlay ?? 0.85}) 0%, rgba(0,0,0,${(overlay ?? 0.85) * 0.7}) 55%, rgba(0,0,0,${(overlay ?? 0.85) * 0.45}) 100%), url('${resolveUrl(bgImage)}') center 35%/cover no-repeat`
    : (bgColor || '#0d1b2a');
  const BTN_R = btnRadius || '4px';
  return (
    <section style={{ minHeight: '100vh', background: BG, display: 'flex', alignItems: 'center', position: 'relative', overflow: 'hidden' }}>
      <div className="container py-5" style={{ position: 'relative', zIndex: 1 }}>
        {logoImage && <img src={resolveUrl(logoImage)} alt="Aircraft Logo" style={{ height: logoHeight || 110, maxWidth: '90vw', marginBottom: '2rem', filter: 'brightness(0) invert(1) drop-shadow(0 4px 24px rgba(0,0,0,0.5))' }} />}
        {badge && <div style={{ display: 'inline-block', background: badgeBg || '#C9A227', color: badgeTextColor || '#ffffff', fontSize: '0.75rem', fontWeight: 700, letterSpacing: '0.2em', textTransform: 'uppercase', padding: '4px 14px', borderRadius: 2, marginBottom: '1.25rem' }}>{badge}</div>}
        <h1 style={{ color: headlineColor || '#ffffff', fontWeight: 900, fontSize: 'clamp(2.2rem, 5vw, 3.8rem)', lineHeight: 1.1, marginBottom: '1.25rem', maxWidth: 640 }}>
          {headline}{headlineSpan && <><br /><span style={{ color: headlineSpanColor || '#c8d0e0' }}>{headlineSpan}</span></>}
        </h1>
        {subtext && <p style={{ color: subtextColor || 'rgba(255,255,255,0.75)', fontSize: '1.1rem', maxWidth: 520, marginBottom: '2rem', lineHeight: 1.7 }}>{subtext}</p>}
        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
          {btn1Text && <a href={btn1Url || '#'} className="btn btn-lg fw-bold px-5" style={{ background: btn1BgColor || '#C9A227', color: btn1TextColor || '#fff', border: 'none', borderRadius: BTN_R }}>{btn1Text}</a>}
          {btn2Text && <a href={btn2Url || '#'} className="btn btn-lg fw-semibold px-4" style={{ background: 'transparent', color: btn2TextColor || '#fff', border: '1px solid rgba(255,255,255,0.35)', borderRadius: BTN_R }}>{btn2Text}</a>}
        </div>
      </div>
      <div style={{ position: 'absolute', bottom: 32, left: '50%', transform: 'translateX(-50%)', textAlign: 'center', color: 'rgba(255,255,255,0.35)', fontSize: '0.7rem', letterSpacing: '0.15em', pointerEvents: 'none' }}>
        <div style={{ width: 1, height: 36, background: 'rgba(255,255,255,0.2)', margin: '0 auto 8px' }} />SCROLL
      </div>
    </section>
  );
}

// ── Image Text Split Block ──────────────────────────────────────────────────
function ImageTextSplitBlock({ image, imagePosition, logoImage, logoHeight, accentColor, heading, headingColor, body, textColor, bgColor, panelBg, statItems, statValueColor, statLabelColor, imageRadius }) {
  const ACCENT  = accentColor    || '#C9A227';
  const HDG_CLR = headingColor   || '#0d1b2a';
  const TXT_CLR = textColor      || '#475569';
  const SV_CLR  = statValueColor || '#1a2e45';
  const SL_CLR  = statLabelColor || '#94a3b8';
  const textColEl = (
    <div style={{ padding: 'clamp(2.5rem, 6vw, 5rem)', display: 'flex', flexDirection: 'column', justifyContent: 'center', background: panelBg || '#ffffff' }}>
      {logoImage && <img src={resolveUrl(logoImage)} alt="Logo" style={{ height: logoHeight || 64, maxWidth: '100%', objectFit: 'contain', objectPosition: 'left', marginBottom: '1.75rem' }} />}
      <div style={{ width: 48, height: 4, background: ACCENT, marginBottom: '1.5rem', borderRadius: 2 }} />
      {heading && <h2 style={{ color: HDG_CLR, fontWeight: 800, fontSize: 'clamp(1.6rem, 3vw, 2.2rem)', marginBottom: '1.25rem' }}>{heading}</h2>}
      {body && body.split('\n\n').map((p, i) => <p key={i} style={{ color: TXT_CLR, lineHeight: 1.8, marginBottom: '1rem' }}>{p}</p>)}
      {statItems && statItems.length > 0 && (
        <div style={{ display: 'flex', gap: '2.5rem', marginTop: '0.5rem', flexWrap: 'wrap' }}>
          {statItems.map((s, i) => (
            <div key={i}>
              <div style={{ fontSize: '2rem', fontWeight: 900, color: SV_CLR }}>{s.value}</div>
              <div style={{ fontSize: '0.8rem', color: SL_CLR, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{s.label}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
  const imgColEl = <div style={{ background: image ? `url('${resolveUrl(image)}') center/cover no-repeat` : '#e2e8f0', minHeight: 480, borderRadius: imageRadius ?? '0px' }} />;
  return (
    <section style={{ background: bgColor || '#fff' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))' }}>
        {imagePosition === 'right' ? <>{textColEl}{imgColEl}</> : <>{imgColEl}{textColEl}</>}
      </div>
    </section>
  );
}

// ── Specs Comparison Block ──────────────────────────────────────────────────
function SpecsComparisonBlock({ heading, subtext, bgColor, accentColor, card1Title, card1Label, card1Bg, card1Specs, card2Title, card2Label, card2Bg, card2Specs, labelColor, valueColor, cardRadius }) {
  const ACCENT  = accentColor || '#C9A227';
  const BG      = bgColor     || '#f8fafc';
  const LBL_CLR = labelColor  || '#94b4d4';
  const VAL_CLR = valueColor  || '#ffffff';
  function SpecCard({ title, label, bg, specs }) {
    return (
      <div style={{ background: bg || '#0d1b2a', borderRadius: cardRadius ?? '12px', overflow: 'hidden', boxShadow: '0 8px 32px rgba(13,27,42,0.2)' }}>
        <div style={{ padding: '1.5rem 2rem', borderBottom: `3px solid ${ACCENT}` }}>
          <div style={{ fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.15em', color: ACCENT, fontWeight: 700, marginBottom: '0.25rem' }}>{label}</div>
          <div style={{ color: '#fff', fontWeight: 800, fontSize: '1.3rem' }}>{title}</div>
        </div>
        <div style={{ padding: '1.5rem 2rem' }}>
          {(specs || []).map((s, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '0.65rem 0', borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
              <span style={{ color: LBL_CLR, fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{s.label}</span>
              <span style={{ color: VAL_CLR, fontWeight: 600, fontSize: '0.9rem', textAlign: 'right', maxWidth: '55%' }}>{s.value}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }
  return (
    <section style={{ background: BG, padding: '5rem 0' }}>
      <div className="container">
        {(heading || subtext) && (
          <div className="text-center mb-5">
            <div style={{ width: 48, height: 4, background: ACCENT, margin: '0 auto 1.25rem', borderRadius: 2 }} />
            {heading && <h2 style={{ color: '#0d1b2a', fontWeight: 800, fontSize: 'clamp(1.6rem, 3vw, 2.2rem)', marginBottom: '0.5rem' }}>{heading}</h2>}
            {subtext && <p style={{ color: '#64748b', maxWidth: 480, margin: '0 auto' }}>{subtext}</p>}
          </div>
        )}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1.5rem' }}>
          <SpecCard title={card1Title} label={card1Label} bg={card1Bg} specs={card1Specs} />
          <SpecCard title={card2Title} label={card2Label} bg={card2Bg} specs={card2Specs} />
        </div>
      </div>
    </section>
  );
}

// ── Feature Checklist Block ─────────────────────────────────────────────────
function FeatureChecklistBlock({ heading, subtext, headingColor, subtextColor, bgImage, overlay, bgColor, items, checkColor, itemColor, accentColor }) {
  const ACCENT   = accentColor  || '#C9A227';
  const OVR      = overlay ?? 0.88;
  const BG       = bgImage
    ? `linear-gradient(rgba(0,0,0,${OVR}), rgba(0,0,0,${Math.min(OVR + 0.07, 1)})), url('${resolveUrl(bgImage)}') center/cover no-repeat`
    : (bgColor || '#0d1b2a');
  const HDG_CLR  = headingColor || '#ffffff';
  const SUB_CLR  = subtextColor || 'rgba(255,255,255,0.65)';
  const CHK_CLR  = checkColor   || ACCENT;
  const ITEM_CLR = itemColor    || 'rgba(255,255,255,0.88)';
  const list     = Array.isArray(items) ? items : [];
  return (
    <section style={{ background: BG, padding: '6rem 0' }}>
      <div className="container">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '4rem', alignItems: 'center' }}>
          <div>
            <div style={{ width: 48, height: 4, background: ACCENT, marginBottom: '1.5rem', borderRadius: 2 }} />
            {heading && <h2 style={{ color: HDG_CLR, fontWeight: 800, fontSize: 'clamp(1.6rem, 3vw, 2.2rem)', marginBottom: '1rem' }}>{heading}</h2>}
            {subtext && <p style={{ color: SUB_CLR, lineHeight: 1.7, marginBottom: 0 }}>{subtext}</p>}
          </div>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {list.map((item, i) => (
              <li key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: '1rem', padding: '0.85rem 0', borderBottom: i < list.length - 1 ? '1px solid rgba(255,255,255,0.08)' : 'none' }}>
                <i className="fa-solid fa-circle-check" style={{ color: CHK_CLR, flexShrink: 0, marginTop: 3 }} />
                <span style={{ color: ITEM_CLR, lineHeight: 1.5 }}>{item.text || item}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

// ── Construction Block ──────────────────────────────────────────────────────
function ConstructionBlock({ heading, headingColor, body, textColor, bgColor, accentColor, rows, tableHeadingColor, tableValueColor, cardRadius }) {
  const ACCENT = accentColor       || '#C9A227';
  const HDG    = headingColor      || '#0d1b2a';
  const TXT    = textColor         || '#64748b';
  const TH     = tableHeadingColor || '#64748b';
  const TV     = tableValueColor   || '#0d1b2a';
  return (
    <section style={{ background: bgColor || '#f8fafc', padding: '5rem 0' }}>
      <div className="container">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '4rem', alignItems: 'start' }}>
          <div>
            <div style={{ width: 48, height: 4, background: ACCENT, marginBottom: '1.5rem', borderRadius: 2 }} />
            {heading && <h2 style={{ color: HDG, fontWeight: 800, fontSize: 'clamp(1.6rem, 3vw, 2.2rem)', marginBottom: '1rem' }}>{heading}</h2>}
            {body && <p style={{ color: TXT, lineHeight: 1.8 }}>{body}</p>}
          </div>
          <div style={{ background: '#fff', borderRadius: cardRadius ?? '12px', border: '1px solid #e2e8f0', overflow: 'hidden', boxShadow: '0 2px 16px rgba(0,0,0,0.06)' }}>
            {(rows || []).map((r, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '1rem 1.5rem', background: i % 2 === 0 ? '#fff' : '#f8fafc', borderBottom: i < (rows || []).length - 1 ? '1px solid #e2e8f0' : 'none', gap: '1rem' }}>
                <span style={{ color: TH, fontSize: '0.85rem', fontWeight: 600 }}>{r.label}</span>
                <span style={{ color: TV, fontWeight: 700, fontSize: '0.9rem', textAlign: 'right' }}>{r.value}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

// ── Specs Strip Block ───────────────────────────────────────────────────────
function SpecsStripBlock({ bgColor, labelColor, valueColor, items, cardRadius }) {
  const BG  = bgColor    || '#0d1433';
  const LBL = labelColor || '#94b4d4';
  const VAL = valueColor || '#ffffff';
  return (
    <section style={{ background: BG, padding: '4rem 0' }}>
      <div className="container">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: cardRadius ?? '8px', overflow: 'hidden' }}>
          {(items || []).map((s, i) => (
            <div key={i} style={{ padding: '1.75rem 1.5rem', background: BG, borderRight: i < (items || []).length - 1 ? '1px solid rgba(255,255,255,0.07)' : 'none' }}>
              <div style={{ fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.12em', color: LBL, fontWeight: 600, marginBottom: '0.5rem' }}>{s.label}</div>
              <div style={{ color: VAL, fontWeight: 700, fontSize: '1rem' }}>{s.value}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ── Timeline Block ──────────────────────────────────────────────────────────
function TimelineBlock({ eyebrow, heading, subtext, headingColor, subtextColor, bgColor, accentColor, layout, milestones, cardRadius }) {
  const BG      = bgColor      || '#0a0f1e';
  const HDG_CLR = headingColor || '#ffffff';
  const ACCENT  = accentColor  || '#C9A227';
  const list    = Array.isArray(milestones) ? milestones : [];

  if (layout === 'horizontal') {
    return (
      <section style={{ background: BG, padding: '6rem 0' }}>
        <style>{`
          .lit-process-step { text-align: center; position: relative; }
          .lit-process-number { transition: transform 0.35s cubic-bezier(0.4,0,0.2,1), background 0.35s cubic-bezier(0.4,0,0.2,1), color 0.35s cubic-bezier(0.4,0,0.2,1), border-color 0.35s cubic-bezier(0.4,0,0.2,1); }
          .lit-process-step:hover .lit-process-number { background: linear-gradient(135deg, #DDBC4E, ${ACCENT}); color: #fff; border-color: transparent; transform: scale(1.1); box-shadow: 0 8px 30px ${ACCENT}66; }
        `}</style>
        <div className="container">
          <div className="text-center mb-5">
            {eyebrow && (
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem' }}>
                <div style={{ width: 32, height: 2, background: ACCENT }} />
                <span style={{ color: ACCENT, fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.15em' }}>{eyebrow}</span>
                <div style={{ width: 32, height: 2, background: ACCENT }} />
              </div>
            )}
            {heading && <h2 style={{ color: HDG_CLR, fontWeight: 800, fontSize: 'clamp(1.6rem, 3vw, 2.4rem)', marginBottom: '0.75rem' }}>{heading}</h2>}
            {subtext && <p style={{ color: subtextColor || '#64748b', maxWidth: 640, margin: '0 auto' }}>{subtext}</p>}
          </div>
          <div className="lit-responsive-grid" style={{ position: 'relative', display: 'grid', gridTemplateColumns: `repeat(${list.length || 1}, 1fr)`, gap: '1rem', maxWidth: 1200, margin: '0 auto' }}>
            {list.length > 1 && <div style={{ position: 'absolute', top: 36, left: '8%', right: '8%', height: 2, background: `linear-gradient(90deg, #DDBC4E, ${ACCENT})`, opacity: 0.3 }} />}
            {list.map((m, idx) => (
              <div key={idx} className="lit-process-step">
                <div className="lit-process-number" style={{ width: 72, height: 72, margin: '0 auto 20px', background: bgColor === '#ffffff' || bgColor === '#fafafa' ? '#fff' : 'rgba(255,255,255,0.04)', border: `2px solid ${ACCENT}`, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.25rem', fontWeight: 800, color: ACCENT, position: 'relative', zIndex: 2 }}>
                  {m.phase || String(idx + 1).padStart(2, '0')}
                </div>
                <h4 style={{ fontSize: '0.9rem', fontWeight: 700, color: HDG_CLR, marginBottom: '0.4rem' }}>{m.title}</h4>
                <p style={{ fontSize: '0.8rem', color: subtextColor || '#64748b', lineHeight: 1.5, margin: 0 }}>{m.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
    );
  }

  return (
    <section style={{ background: BG, padding: '6rem 0' }}>
      <div className="container">
        <div className="text-center mb-5">
          {eyebrow && (
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem' }}>
              <div style={{ width: 32, height: 2, background: ACCENT }} />
              <span style={{ color: ACCENT, fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.15em' }}>{eyebrow}</span>
              <div style={{ width: 32, height: 2, background: ACCENT }} />
            </div>
          )}
          {heading && <h2 style={{ color: HDG_CLR, fontWeight: 800, fontSize: 'clamp(1.6rem, 3vw, 2.4rem)', marginBottom: '0.75rem' }}>{heading}</h2>}
          {subtext && <p style={{ color: subtextColor || '#64748b', maxWidth: 500, margin: '0 auto' }}>{subtext}</p>}
        </div>
        <div style={{ maxWidth: 680, margin: '0 auto' }}>
          {list.map((m, idx) => {
            const isDone   = m.status === 'done';
            const isActive = m.status === 'active';
            const dotColor = isDone ? '#22c55e' : isActive ? ACCENT : '#4b5563';
            return (
              <div key={idx} style={{ display: 'flex', gap: '1.5rem' }}>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0 }}>
                  <div style={{ width: 40, height: 40, borderRadius: '50%', background: dotColor, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 800, fontSize: '0.75rem', boxShadow: isDone ? '0 0 0 4px rgba(34,197,94,0.2)' : isActive ? '0 0 0 4px rgba(204,17,34,0.25)' : 'none' }}>
                    {isDone ? <i className="fa-solid fa-check" style={{ fontSize: '0.85rem' }} /> : (m.phase || String(idx + 1).padStart(2, '0'))}
                  </div>
                  {idx < list.length - 1 && <div style={{ width: 2, flex: 1, minHeight: 40, background: isDone ? '#22c55e' : '#2d3748', marginTop: 4 }} />}
                </div>
                <div style={{ flex: 1, paddingBottom: '2rem' }}>
                  <div style={{ background: isDone ? 'rgba(255,255,255,0.04)' : isActive ? 'rgba(204,17,34,0.08)' : 'rgba(255,255,255,0.02)', border: `1px solid ${isDone ? 'rgba(34,197,94,0.2)' : isActive ? 'rgba(204,17,34,0.3)' : 'rgba(255,255,255,0.06)'}`, borderRadius: cardRadius ?? '12px', overflow: 'hidden' }}>
                    {m.img && <img src={resolveUrl(m.img)} alt={m.title} style={{ width: '100%', height: 220, objectFit: 'cover', display: 'block' }} />}
                    <div style={{ padding: '1.25rem 1.5rem' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
                        <h4 style={{ margin: 0, color: '#fff', fontWeight: 700, fontSize: '1.05rem' }}>{m.title}</h4>
                        {isActive && <span style={{ fontSize: '0.7rem', fontWeight: 700, padding: '2px 8px', background: ACCENT, color: '#fff', borderRadius: 20, textTransform: 'uppercase' }}>Active</span>}
                        {isDone  && <span style={{ fontSize: '0.7rem', fontWeight: 700, padding: '2px 8px', background: 'rgba(34,197,94,0.15)', color: '#22c55e', borderRadius: 20, textTransform: 'uppercase' }}>Complete</span>}
                      </div>
                      <p style={{ margin: 0, color: '#94a3b8', fontSize: '0.9rem', lineHeight: 1.6 }}>{m.desc}</p>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

// ── Logo Showcase Block ─────────────────────────────────────────────────────
function LogoShowcaseBlock({ logoImage, logoHeight, logoAlt, caption, captionColor, bg1, bg2 }) {
  return (
    <section style={{ background: `linear-gradient(135deg, ${bg1 || '#0d1b2a'} 0%, ${bg2 || '#1a2e45'} 100%)`, padding: '5rem 0', textAlign: 'center' }}>
      <div className="container">
        {logoImage && <img src={resolveUrl(logoImage)} alt={logoAlt || 'Logo'} style={{ height: logoHeight || 140, maxWidth: '80vw', filter: 'brightness(0) invert(1) drop-shadow(0 8px 32px rgba(0,0,0,0.5))' }} />}
        {caption && <p style={{ color: captionColor || 'rgba(255,255,255,0.45)', marginTop: '2rem', fontSize: '0.85rem', letterSpacing: '0.15em', textTransform: 'uppercase', marginBottom: 0 }}>{caption}</p>}
      </div>
    </section>
  );
}

// ── Sponsor Logo Grid Block ──────────────────────────────────────────────────
function SponsorLogoGridBlock({ eyebrow, heading, ctaText, ctaUrl, logos, columns, bgColor, textColor, grayscaleHover, footnoteText }) {
  return (
    <section style={{ background: bgColor || '#0A1F3D', padding: '3rem 0' }}>
      <div className="container">
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '1.5rem', marginBottom: '2rem' }}>
          <div>
            {eyebrow && <div style={{ color: '#C9A227', textTransform: 'uppercase', fontSize: '0.75rem', letterSpacing: '2.5px', fontWeight: 600 }}>{eyebrow}</div>}
            {heading && <div style={{ color: textColor || '#ffffff', fontSize: '1.875rem', letterSpacing: '-0.5px', fontWeight: 600, marginTop: '0.25rem' }}>{heading}</div>}
          </div>
          {ctaText && <a href={ctaUrl || '#'} style={{ fontSize: '0.875rem', color: '#C9A227', fontWeight: 500, textDecoration: 'none' }}>{ctaText}</a>}
        </div>
        <div className="lit-responsive-grid" style={{ display: 'grid', gridTemplateColumns: `repeat(${columns || 6}, 1fr)`, gap: '1.5rem 2rem', textAlign: 'center' }}>
          {(logos || []).map((logo, i) => (
            logo.image ? (
              <img key={i} src={resolveUrl(logo.image)} alt={logo.name || ''}
                className={grayscaleHover ? 'sponsor-logo' : undefined}
                style={{ maxHeight: 40, maxWidth: '100%', margin: '0 auto', ...(grayscaleHover ? {} : { opacity: 0.9 }) }} />
            ) : (
              <div key={i} style={{ color: textColor ? `${textColor}b3` : 'rgba(255,255,255,0.7)', fontSize: '0.875rem', fontWeight: 500, letterSpacing: '0.05em', padding: '0.25rem 0' }}>
                {logo.name}
              </div>
            )
          ))}
        </div>
        {footnoteText && (
          <div style={{ textAlign: 'center', fontSize: 10, color: 'rgba(255,255,255,0.5)', marginTop: '1.25rem', letterSpacing: '0.2em' }}>{footnoteText}</div>
        )}
      </div>
    </section>
  );
}

// ── Page Hero Banner Block ──────────────────────────────────────────────────
function PageHeroBannerBlock({ eyebrow, eyebrowColor, bgImage, overlay, minHeight, headline, headlineBg, headlineColor, borderColor, boxPosition, cardRadius }) {
  const gradient = bgImage && overlay > 0
    ? `linear-gradient(to right, rgba(10,31,61,${overlay}), rgba(10,31,61,${overlay * 0.4})), `
    : '';
  const BG = bgImage
    ? `${gradient}url('${resolveUrl(bgImage)}') center/cover no-repeat`
    : '#0d1b2a';
  const centered = boxPosition === 'center';
  const boxed = headlineBg && headlineBg !== 'transparent';
  return (
    <section style={{
      background: BG,
      minHeight: minHeight || 420,
      borderBottom: borderColor && borderColor !== 'transparent' ? `4px solid ${borderColor}` : 'none',
      display: 'flex',
      alignItems: centered ? 'center' : 'flex-end',
      justifyContent: centered ? 'center' : 'flex-start',
    }}>
      <div style={{
        margin: centered ? '0' : '0 0 32px 32px',
        background: boxed ? headlineBg : 'transparent',
        padding: boxed ? '18px 32px' : 0,
        borderRadius: boxed ? (cardRadius ?? 4) : 0,
        maxWidth: 640,
      }}>
        {eyebrow && (
          <div style={{ textTransform: 'uppercase', letterSpacing: '2.5px', fontSize: '0.875rem', fontWeight: 500, color: eyebrowColor || '#C9A227', marginBottom: '0.75rem' }}>
            {eyebrow}
          </div>
        )}
        <h1 style={{ fontWeight: 700, margin: 0, color: headlineColor || '#ffffff', fontSize: 'clamp(2.5rem,5vw,3.75rem)', letterSpacing: '-2px', lineHeight: 1 }}>
          {headline || 'Page Title'}
        </h1>
      </div>
    </section>
  );
}

// ── Team Grid Block ─────────────────────────────────────────────────────────
function TeamGridBlock({ heading, subheading, headingColor, subheadingColor, bgColor, accentColor, cardStyle, avatarColor1, avatarColor2, members, cardRadius }) {
  const list = Array.isArray(members) ? members : [];
  const AC = accentColor || '#E85800';
  const isCard = cardStyle === 'card';
  return (
    <section style={{ backgroundColor: bgColor || '#f0f4f8', padding: '4rem 0' }}>
      {isCard && (
        <style>{`
          .lit-team-card { transition: transform 0.35s cubic-bezier(0.4,0,0.2,1), box-shadow 0.35s cubic-bezier(0.4,0,0.2,1); }
          .lit-team-card:hover { transform: translateY(-8px); box-shadow: 0 20px 60px ${AC}38; }
        `}</style>
      )}
      <div className="container">
        {heading && <h2 style={{ fontWeight: 700, textAlign: 'center', marginBottom: '0.5rem', color: headingColor || '#0d1b2a' }}>{heading}</h2>}
        {subheading && <p style={{ textAlign: 'center', color: subheadingColor || '#6c757d', marginBottom: '3rem', maxWidth: 640, marginLeft: 'auto', marginRight: 'auto' }}>{subheading}</p>}
        <div className="row g-4 justify-content-center">
          {list.map((m, i) => {
            const isPhoto = typeof m.img === 'string' && (m.img.startsWith('http') || m.img.startsWith('/'));
            return (
              <div key={i} className="col-sm-6 col-lg-3">
                {isCard ? (
                  <div className="lit-team-card" style={{ background: '#fff', borderRadius: cardRadius ?? 20, overflow: 'hidden', border: '1px solid #e5e5e5', textAlign: 'center', height: '100%', display: 'flex', flexDirection: 'column' }}>
                    <div style={{ width: '100%', aspectRatio: '1', background: `linear-gradient(135deg, ${avatarColor1 || '#0A1F3D'}, ${avatarColor2 || AC})`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '3rem', position: 'relative', overflow: 'hidden' }}>
                      {isPhoto
                        ? <img src={resolveUrl(m.img)} alt={m.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        : (m.img || '🙂')}
                    </div>
                    <div style={{ padding: '1.25rem' }}>
                      <h5 style={{ fontWeight: 700, color: '#0d1b2a', marginBottom: '0.25rem', fontSize: '1rem' }}>{m.name}</h5>
                      <p style={{ fontSize: '0.8rem', fontWeight: 600, color: AC, marginBottom: '0.5rem' }}>{m.title}</p>
                      <p style={{ fontSize: '0.8rem', color: '#6c757d', lineHeight: 1.5, marginBottom: (m.email || m.phone) ? '0.5rem' : 0 }}>{m.bio}</p>
                      {(m.email || m.phone) && (
                        <div style={{ fontSize: '0.75rem', color: '#6c757d' }}>
                          {m.email && <div><a href={`mailto:${m.email}`} style={{ color: AC, textDecoration: 'none' }}>{m.email}</a></div>}
                          {m.phone && <div>Phone: {m.phone}</div>}
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <div style={{ background: '#fff', borderRadius: cardRadius ?? 8, boxShadow: '0 2px 12px rgba(0,0,0,0.08)', padding: '1.5rem', textAlign: 'center', height: '100%', display: 'flex', flexDirection: 'column' }}>
                    {m.img && (
                      isPhoto
                        ? <img src={resolveUrl(m.img)} alt={m.name} style={{ width: 96, height: 96, borderRadius: '50%', objectFit: 'cover', margin: '0 auto 1rem', border: `3px solid ${AC}` }} />
                        : <div style={{ width: 96, height: 96, borderRadius: '50%', margin: '0 auto 1rem', fontSize: '2.5rem', display: 'flex', alignItems: 'center', justifyContent: 'center', border: `3px solid ${AC}` }}>{m.img}</div>
                    )}
                    <h5 style={{ fontWeight: 700, color: '#0d1b2a', marginBottom: '0.25rem' }}>{m.name}</h5>
                    <p style={{ fontSize: '0.8rem', fontWeight: 600, color: AC, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '0.75rem' }}>{m.title}</p>
                    <p style={{ fontSize: '0.875rem', color: '#6c757d', marginBottom: '0.75rem', flex: 1 }}>{m.bio}</p>
                    {(m.email || m.phone) && (
                      <div style={{ fontSize: '0.8rem', color: '#6c757d' }}>
                        {m.email && <div><a href={`mailto:${m.email}`} style={{ color: AC, textDecoration: 'none' }}>{m.email}</a></div>}
                        {m.phone && <div>Phone: {m.phone}</div>}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

// ── Values Grid Block ───────────────────────────────────────────────────────
function ValuesGridBlock({ heading, subheading, headingColor, subheadingColor, bgColor, accentColor, cardStyle, values, cardRadius }) {
  const list = Array.isArray(values) ? values : [];
  const AC = accentColor || '#E85800';
  const isIconCard = cardStyle === 'iconCard';
  return (
    <section style={{ backgroundColor: bgColor || '#ffffff', padding: '4rem 0' }}>
      {isIconCard && (
        <style>{`
          .lit-award-card { transition: transform 0.35s cubic-bezier(0.4,0,0.2,1), box-shadow 0.35s cubic-bezier(0.4,0,0.2,1), border-color 0.35s cubic-bezier(0.4,0,0.2,1); }
          .lit-award-card:hover { transform: translateY(-6px); box-shadow: 0 20px 60px ${AC}38; border-color: ${AC}; }
        `}</style>
      )}
      <div className="container">
        {heading && <h2 style={{ fontWeight: 700, textAlign: 'center', marginBottom: '0.5rem', color: headingColor || '#0d1b2a' }}>{heading}</h2>}
        {subheading && <p style={{ textAlign: 'center', color: subheadingColor || '#6c757d', marginBottom: '3rem', maxWidth: 640, marginLeft: 'auto', marginRight: 'auto' }}>{subheading}</p>}
        <div className="row g-4">
          {list.map((v, i) => (
            <div key={i} className="col-md-4">
              {isIconCard ? (
                <div className="lit-award-card" style={{ background: '#fff', height: '100%', padding: '2.5rem 1.75rem', textAlign: 'center', border: '1px solid #e5e5e5', borderRadius: cardRadius ?? 20 }}>
                  {v.icon && <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>{renderIconValue(v.icon, { fontSize: '3rem' })}</div>}
                  <h4 style={{ fontWeight: 700, color: '#0d1b2a', marginBottom: '0.5rem', fontSize: '1rem' }}>{v.title}</h4>
                  <p style={{ color: '#6c757d', marginBottom: 0, fontSize: '0.85rem' }}>{v.desc}</p>
                </div>
              ) : (
                <div style={{ background: '#fff', height: '100%', padding: '1.5rem', textAlign: 'center', borderTop: `4px solid ${AC}`, boxShadow: '0 2px 12px rgba(0,0,0,0.08)', borderRadius: '0 0 6px 6px' }}>
                  <h4 style={{ fontWeight: 700, color: '#0d1b2a', marginBottom: '0.75rem' }}>{v.title}</h4>
                  <p style={{ color: '#6c757d', marginBottom: 0 }}>{v.desc}</p>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ── Full Width Image Block ──────────────────────────────────────────────────
function FullWidthImageBlock({ image, alt, maxHeight }) {
  if (!image) return <div style={{ background: '#eee', height: 120, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#999', fontSize: '0.85rem' }}>No image set</div>;
  return (
    <div style={{ lineHeight: 0, overflow: 'hidden' }}>
      <img src={resolveUrl(image)} alt={alt || ''} style={{ width: '100%', display: 'block', maxHeight: maxHeight ? `${maxHeight}px` : undefined, objectFit: 'cover' }} />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
export const puckConfig = {
  components: {

    // ── Header ──────────────────────────────────────────────────────────────
    Header: {
      label: 'Header / Navigation',
      fields: {
        layout: { type: 'select', label: 'Layout Style', options: [
          { label: 'Dark Bar (logo left, links right)',      value: 'dark'         },
          { label: 'Light Bar (logo left, links right)',     value: 'light'        },
          { label: 'Centered (logo center, links below)',    value: 'centered'     },
          { label: 'Split (top strip + main bar)',           value: 'split'        },
          { label: 'Announcement Bar + Dark Nav',           value: 'announcement' },
          { label: 'Minimal (logo + CTA only)',              value: 'minimal'      },
        ]},
        logoText:          { type: 'text',  label: 'Logo Text (if no image)' },
        logoImage:         imageField('Logo Image URL'),
        logoUrl:           { type: 'text',  label: 'Logo Link URL' },
        bgColor:           colorField('Background Color'),
        textColor:         colorField('Text / Link Color'),
        accentColor:       colorField('Accent / CTA Button Color'),
        ctaText:           { type: 'text',  label: 'CTA Button Text' },
        ctaUrl:            { type: 'text',  label: 'CTA Button URL' },
        phone:             { type: 'text',  label: 'Phone (split layout top strip)' },
        announcementText:  { type: 'text',  label: 'Announcement Text (announcement layout)' },
        announcementBg:    colorField('Announcement Bar Color'),
        navLinks:          NAV_LINK_ARRAY,
      },
      defaultProps: {
        layout:           'light',
        logoText:         'VCSF',
        logoImage:        '/vcsf/logo-header.png',
        logoUrl:          '/',
        bgColor:          '#ffffff',
        textColor:        '#0A1F3D',
        accentColor:      '#C9A227',
        ctaText:          "Let's Connect",
        ctaUrl:           '/contact',
        phone:            '',
        announcementText: '',
        announcementBg:   '#C9A227',
        navLinks:         DEFAULT_NAV,
      },
      render: renderHeader,
    },

    // ── Footer ──────────────────────────────────────────────────────────────
    Footer: {
      label: 'Footer',
      fields: {
        layout: { type: 'select', label: 'Layout Style', options: [
          { label: 'Three-Column Dark',    value: 'three-col' },
          { label: 'Dark (4 columns)',     value: 'dark'      },
          { label: 'Branded Purple',       value: 'branded'   },
          { label: 'Simple Centered',      value: 'simple'    },
          { label: 'Minimal (logo + copyright)', value: 'minimal' },
        ]},
        logoText:    { type: 'text',     label: 'Brand Name / Logo Text' },
        logoImage:   imageField('Logo Image URL'),
        logoUrl:     { type: 'text',     label: 'Logo Link URL' },
        tagline:     { type: 'text',     label: 'Tagline' },
        col1Title:   { type: 'text',     label: 'Column 1 Heading' },
        col1Links:   { ...FOOTER_LINK_ARRAY, label: 'Column 1 Links' },
        col2Title:   { type: 'text',     label: 'Column 2 Heading' },
        col2Links:   { ...FOOTER_LINK_ARRAY, label: 'Column 2 Links' },
        address:     { type: 'textarea', label: 'Contact / Address Block' },
        copyright:   { type: 'text',     label: 'Copyright Line' },
        bgColor:     colorField('Background Color'),
        textColor:   colorField('Text Color'),
        facebookUrl:  { type: 'text',    label: 'Facebook URL' },
        twitterUrl:   { type: 'text',    label: 'Twitter / X URL' },
        instagramUrl: { type: 'text',    label: 'Instagram URL' },
        linkedinUrl:  { type: 'text',    label: 'LinkedIn URL' },
      },
      defaultProps: {
        layout:      'three-col',
        logoText:    'VCSF',
        logoImage:   '/vcsf/logo-footer.png',
        logoUrl:     '/',
        tagline:     "Supporting the Ventura County Sheriff's Office and our community",
        col1Title:   'Site',
        col1Links:   DEFAULT_FOOTER_LINKS_1,
        col2Title:   'Company',
        col2Links:   DEFAULT_FOOTER_LINKS_2,
        address:     'P.O. Box 3007\nCamarillo, CA 93011\n(805) 492-4398',
        copyright:   '',
        bgColor:     '',
        textColor:   '',
        facebookUrl:  '',
        twitterUrl:   '',
        instagramUrl: '',
        linkedinUrl:  '',
      },
      render: renderFooter,
    },

    // ── Hero Banner ─────────────────────────────────────────────────────────
    HeroBanner: {
      label: 'Hero Banner',
      fields: {
        eyebrow:       { type: 'text', label: 'Eyebrow Badge (optional, above headline)' },
        eyebrowBg:     colorField('Eyebrow Badge Background'),
        eyebrowColor:  colorField('Eyebrow Badge Text Color'),
        headline:      { type: 'textarea', label: 'Headline (line breaks preserved)' },
        headlineColor: colorField('Headline Color'),
        headlineFont:  { type: 'select', label: 'Headline Font', options: [
          { label: 'Sans-Serif', value: 'sans'  },
          { label: 'Serif',      value: 'serif' },
        ]},
        headlineSize:  { type: 'select', label: 'Headline Size', options: [
          { label: 'Small',    value: 'clamp(1.4rem,3vw,2rem)'   },
          { label: 'Medium',   value: 'clamp(1.8rem,4vw,3rem)'   },
          { label: 'Large',    value: 'clamp(2.2rem,5vw,3.5rem)' },
          { label: 'X-Large',  value: 'clamp(2.5rem,6vw,4rem)'   },
        ]},
        subtext:       { type: 'textarea', label: 'Subtext' },
        subtextColor:  colorField('Subtext Color'),
        subtextSize:   { type: 'select', label: 'Subtext Size', options: [
          { label: 'Small (0.95rem)',  value: '0.95rem' },
          { label: 'Medium (1.1rem)', value: '1.1rem'  },
          { label: 'Large (1.25rem)', value: '1.25rem' },
        ]},
        bgImage:       imageField('Background Image URL'),
        bgPosition:    { type: 'text', label: 'Image Position' },
        bgSize:        { type: 'select', label: 'Image Size', options: [
          { label: 'Cover (fill)',  value: 'cover'   },
          { label: 'Contain (fit)', value: 'contain' },
          { label: 'Auto',          value: 'auto'    },
        ]},
        bgColor:       colorField('Background Color'),
        overlay:       { type: 'number', label: 'Overlay Darkness (0–1)', min: 0, max: 1, step: 0.05 },
        height:        { type: 'select', label: 'Height', options: [
          { label: '35vh', value: '35vh' }, { label: '50vh', value: '50vh' },
          { label: '70vh', value: '70vh' }, { label: '80vh', value: '80vh' }, { label: '100vh', value: '100vh' },
        ]},
        verticalAlign: { type: 'select', label: 'Text Vertical Position', options: [
          { label: 'Top',    value: 'flex-start' },
          { label: 'Center', value: 'center'     },
          { label: 'Bottom', value: 'flex-end'   },
        ]},
        textOffsetY:   { type: 'text', label: 'Text Nudge' },
        align:         { type: 'select', label: 'Text Horizontal Align', options: [{ label: 'Left', value: 'left' }, { label: 'Center', value: 'center' }] },
        ctaText:       { type: 'text', label: 'CTA Button Text' },
        ctaUrl:        urlField('CTA Button URL'),
        ctaColor:      colorField('CTA Button Color'),
        ctaTextColor:  colorField('CTA Button Text Color'),
        ctaText2:      { type: 'text', label: 'Second (outline) Button Text — optional' },
        ctaUrl2:       urlField('Second Button URL'),
        btnRadius:     btnRadiusField(),
        scrollLinkText: { type: 'text', label: 'Scroll-Down Link Text (optional, e.g. "See our impact ↓")' },
        scrollLinkTarget: { type: 'text', label: 'Scroll-Down Link Target (element id, e.g. "impact")' },
        trustCaption:  { type: 'text', label: 'Trust Row Caption (optional, e.g. "Trusted by thousands…")' },
        trustAvatars:  { type: 'array', label: 'Trust Row Avatars (optional)', arrayFields: {
          image: imageField('Avatar Image'),
        }, defaultItemProps: { image: '' } },
        overlayDirection: { type: 'select', label: 'Overlay Style', options: [
          { label: 'Flat',                value: 'flat' },
          { label: 'Gradient (left→right)', value: 'gradient' },
        ]},
        animation:     animField(),
        animDelay:     animDelayField(),
      },
      defaultProps: {
        eyebrow:       '',
        eyebrowBg:     'rgba(255,255,255,0.9)',
        eyebrowColor:  '#0A1F3D',
        headline:      'VALUE • VERSATILITY • INTEGRITY',
        headlineColor: '#ffffff',
        headlineFont:  'sans',
        headlineSize:  'clamp(1.8rem,4vw,3rem)',
        subtext:       '',
        subtextColor:  'rgba(255,255,255,0.9)',
        subtextSize:   '1.1rem',
        bgImage:       '/images/main_header_bg.jpg',
        bgPosition:    'center',
        bgSize:        'cover',
        bgColor:       '#0A1F3D',
        overlay:       0.4,
        height:        '70vh',
        verticalAlign: '',
        textOffsetY:   '',
        align:         'left',
        ctaText:       '',
        ctaUrl:        '#',
        ctaColor:      '#C9A227',
        ctaTextColor:  '#ffffff',
        ctaText2:      '',
        ctaUrl2:       '#',
        btnRadius:     '50px',
        scrollLinkText: '',
        scrollLinkTarget: '',
        trustCaption:  '',
        trustAvatars:  [],
        overlayDirection: 'flat',
        animation:     'none',
        animDelay:     '0',
      },
      render: ({ eyebrow, eyebrowBg, eyebrowColor, headline, headlineColor, headlineFont, headlineSize, subtext, subtextColor, subtextSize,
                 bgImage, bgPosition, bgSize, bgColor, overlay, height,
                 verticalAlign, textOffsetY, align,
                 ctaText, ctaUrl, ctaColor, ctaTextColor, ctaText2, ctaUrl2, btnRadius,
                 scrollLinkText, scrollLinkTarget, trustCaption, trustAvatars, overlayDirection, animation, animDelay }) => {
        const vAlign = verticalAlign || (align === 'center' ? 'center' : 'flex-end');
        const tint = overlayDirection === 'gradient'
          ? `linear-gradient(to right, rgba(10,31,61,${Math.min((overlay ?? 0.4) * 2, 1)}), rgba(10,31,61,${overlay ?? 0.4}))`
          : `linear-gradient(rgba(0,0,0,${overlay ?? 0.4}),rgba(0,0,0,${overlay ?? 0.4}))`;
        const bgStyle = bgImage ? {
          backgroundImage: `${tint},url('${resolveUrl(bgImage)}')`,
          backgroundColor: bgColor || '#0A1F3D',
          backgroundPosition: bgPosition || 'center',
          backgroundSize: bgSize || 'cover',
          backgroundRepeat: 'no-repeat',
        } : { background: bgColor || '#0A1F3D' };
        return (
          <section style={{
            height,
            ...bgStyle,
            display: 'flex',
            alignItems: vAlign,
            textAlign: align,
          }}>
            <div className="site-container" style={{ display: 'flex', justifyContent: align === 'center' ? 'center' : 'flex-start' }}>
            <AnimatedBlock animation={animation} delay={Number(animDelay) || 0}
              style={{ maxWidth: 800, width: '100%', marginTop: textOffsetY || undefined }}>
              {eyebrow && (
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: eyebrowBg || 'rgba(255,255,255,0.9)', backdropFilter: 'blur(4px)', padding: '0.35rem 1rem', borderRadius: 999, fontSize: '0.72rem', fontWeight: 600, letterSpacing: '0.15em', color: eyebrowColor || '#0A1F3D', marginBottom: '1.5rem' }}>
                  {eyebrow}
                </div>
              )}
              <h1 style={{ color: headlineColor || '#ffffff', fontWeight: headlineFont === 'serif' ? 700 : 900, fontFamily: headlineFont === 'serif' ? "'Playfair Display', Georgia, serif" : 'inherit', textShadow: '0 2px 8px rgba(0,0,0,0.6)', fontSize: headlineSize || 'clamp(1.8rem,4vw,3rem)', whiteSpace: 'pre-line', letterSpacing: headlineFont === 'serif' ? '-2px' : 'inherit' }}>
                {animation === 'wordByWord'
                  ? <AnimatedWords text={headline} animation="wordByWord" />
                  : headline}
              </h1>
              {subtext && <p style={{ color: subtextColor || 'rgba(255,255,255,0.9)', fontSize: subtextSize || '1.1rem' }}>{subtext}</p>}
              {(ctaText || ctaText2) && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', marginTop: '1rem', justifyContent: align === 'center' ? 'center' : 'flex-start' }}>
                  {ctaText && (
                    <a href={ctaUrl} style={{ display: 'inline-block', background: ctaColor || '#C9A227', color: ctaTextColor || '#ffffff', padding: '0.6rem 1.8rem', borderRadius: btnRadius ?? '50px', textDecoration: 'none', fontWeight: 600 }}>{ctaText}</a>
                  )}
                  {ctaText2 && (
                    <a href={ctaUrl2} style={{ display: 'inline-block', background: 'transparent', border: '2px solid #ffffff', color: '#ffffff', padding: '0.6rem 1.8rem', borderRadius: btnRadius ?? '50px', textDecoration: 'none', fontWeight: 600 }}>{ctaText2}</a>
                  )}
                </div>
              )}
              {(trustCaption || (trustAvatars && trustAvatars.length > 0)) && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginTop: '1.75rem', justifyContent: align === 'center' ? 'center' : 'flex-start' }}>
                  {trustAvatars && trustAvatars.length > 0 && (
                    <div style={{ display: 'flex' }}>
                      {trustAvatars.map((a, i) => a.image && (
                        <img key={i} src={resolveUrl(a.image)} alt="" style={{ width: 32, height: 32, borderRadius: '50%', objectFit: 'cover', border: '2px solid #fff', marginLeft: i === 0 ? 0 : -10 }} />
                      ))}
                    </div>
                  )}
                  {trustCaption && <span style={{ color: 'rgba(255,255,255,0.85)', fontSize: '0.85rem' }}>{trustCaption}</span>}
                </div>
              )}
              {scrollLinkText && (
                <a href={scrollLinkTarget ? `#${scrollLinkTarget}` : '#'} style={{ display: 'inline-block', marginTop: '1.5rem', color: 'rgba(255,255,255,0.85)', fontSize: '0.9rem', textDecoration: 'none' }}>{scrollLinkText}</a>
              )}
            </AnimatedBlock>
            </div>
          </section>
        );
      },
    },

    // ── Text Block ──────────────────────────────────────────────────────────
    TextBlock: {
      label: 'Text / Rich Content',
      fields: {
        html:      { type: 'textarea', label: 'HTML Content' },
        maxWidth:  { type: 'select',   label: 'Max Width', options: [{ label: 'Full', value: '100%' }, { label: '960px', value: '960px' }, { label: '800px', value: '800px' }, { label: '640px', value: '640px' }] },
        padding:   { type: 'select',   label: 'Padding',   options: [{ label: 'Small', value: '1rem' }, { label: 'Medium', value: '2rem' }, { label: 'Large', value: '4rem' }] },
        bgColor:   colorField('Background Color'),
        textColor: colorField('Text Color'),
        center:    { type: 'select',   label: 'Center Text', options: [{ label: 'No', value: 'left' }, { label: 'Yes', value: 'center' }] },
        blockAlign: { type: 'select', label: 'Block Position', options: [
          { label: 'Centered on page',           value: 'center' },
          { label: 'Left, flush with page edge',  value: 'left' },
          { label: 'Match site container (header width)', value: 'site' },
        ]},
        animation: animField(),
        animDelay: animDelayField(),
      },
      defaultProps: {
        html: '<h2>Section Heading</h2><p>Add your content here. You can use HTML for <strong>bold</strong>, <em>italic</em>, <a href="#">links</a>, and more.</p>',
        maxWidth:  '800px',
        padding:   '2rem',
        bgColor:   '',
        textColor: '',
        center:    'left',
        blockAlign: 'center',
        animation: 'none',
        animDelay: '0',
      },
      render: ({ html, maxWidth, padding, bgColor, textColor, center, blockAlign, animation, animDelay }) => (
        <AnimatedBlock animation={animation} delay={Number(animDelay) || 0}
          style={{ background: bgColor || 'transparent', padding, color: textColor || 'inherit' }}>
          {blockAlign === 'site' ? (
            <div className="site-container" style={{ textAlign: center }} dangerouslySetInnerHTML={{ __html: html }} />
          ) : (
            <div style={{ maxWidth, margin: blockAlign === 'left' ? '0' : '0 auto', textAlign: center }}
              dangerouslySetInnerHTML={{ __html: html }} />
          )}
        </AnimatedBlock>
      ),
    },

    // ── Image Block ─────────────────────────────────────────────────────────
    ImageBlock: {
      label: 'Image',
      fields: {
        src:          imageField('Image URL'),
        alt:          { type: 'text',   label: 'Alt Text' },
        caption:      { type: 'text',   label: 'Caption' },
        captionColor: colorField('Caption Color'),
        captionSize:  { type: 'select', label: 'Caption Size', options: [
          { label: 'Small (0.75rem)',  value: '0.75rem' },
          { label: 'Medium (0.85rem)', value: '0.85rem' },
          { label: 'Large (1rem)',     value: '1rem'    },
        ]},
        bgColor:   colorField('Block Background Color'),
        align:     { type: 'select', label: 'Align', options: [{ label: 'Left', value: 'left' }, { label: 'Center', value: 'center' }, { label: 'Right', value: 'right' }] },
        maxWidth:  { type: 'text',   label: 'Max Width' },
        imageRadius: imageRadiusField(),
        link:      { type: 'text',   label: 'Link URL (optional)' },
        animation: animField(),
        animDelay: animDelayField(),
      },
      defaultProps: { src: '', alt: '', caption: '', captionColor: '#666666', captionSize: '0.85rem', bgColor: '', align: 'center', maxWidth: '100%', imageRadius: '0px', link: '', animation: 'none', animDelay: '0' },
      render: ({ src, alt, caption, captionColor, captionSize, bgColor, align, maxWidth, imageRadius, link, animation, animDelay }) => (
        <AnimatedBlock animation={animation} delay={Number(animDelay) || 0}
          style={{ textAlign: align, padding: '1rem', background: bgColor || 'transparent' }}>
          {link
            ? <a href={link}><img src={resolveUrl(src)} alt={alt} style={{ maxWidth, display: 'inline-block', borderRadius: imageRadius || '0px' }} /></a>
            : <img src={resolveUrl(src)} alt={alt} style={{ maxWidth, display: 'inline-block', borderRadius: imageRadius || '0px' }} />}
          {caption && <p style={{ fontSize: captionSize || '0.85rem', color: captionColor || '#666', marginTop: '0.5rem' }}>{caption}</p>}
        </AnimatedBlock>
      ),
    },

    // ── Two Columns ─────────────────────────────────────────────────────────
    TwoColumn: {
      label: 'Two Columns',
      fields: {
        ratio:  { type: 'select', label: 'Column Ratio', options: [
          { label: '50 / 50',  value: '1fr 1fr'  },
          { label: '60 / 40',  value: '3fr 2fr'  },
          { label: '40 / 60',  value: '2fr 3fr'  },
          { label: '70 / 30',  value: '7fr 3fr'  },
          { label: '30 / 70',  value: '3fr 7fr'  },
        ]},
        gap:           { type: 'text', label: 'Column Gap' },
        verticalAlign: { type: 'select', label: 'Vertical Align', options: [
          { label: 'Top',    value: 'flex-start' },
          { label: 'Center', value: 'center'     },
          { label: 'Bottom', value: 'flex-end'   },
        ]},
        // ── Container (spans both columns — use for a single seamless background) ──
        containerBgColor:      colorField('Container Background Color (spans both columns, e.g. a gradient)'),
        containerBgDecoration: richTextField('Container Background Decoration (raw HTML/CSS, renders full-bleed behind both columns)'),
        containerPadding:      { type: 'text', label: 'Container Padding (vertical space around the full-bleed background)' },
        containerMaxWidth:     { type: 'text', label: 'Content Max Width (e.g. 1200px — background still spans full width, content is boxed/centered)' },
        containerWidthMode:    { type: 'select', label: 'Content Width', options: [
          { label: 'Custom (use Content Max Width above)', value: 'custom' },
          { label: 'Match Site Container', value: 'site' },
        ]},
        containerRadius: cardRadiusField('Container Corner Style (rounds the whole boxed block, e.g. a bordered card)'),
        containerBorder: { type: 'select', label: 'Container Border', options: [{ label: 'None', value: 'none' }, { label: 'Thin Border', value: 'thin' }] },
        containerBorderColor: colorField('Container Border Color'),
        cardRadius: cardRadiusField('Column Corner Style'),
        // ── Left column ──────────────────────────────────────────────────────
        leftContent:   richTextField('Left Column Content'),
        leftBgDecoration: richTextField('Left Background Decoration (raw HTML/CSS, renders full-bleed behind content)'),
        leftBgImage:   imageField('Left Background Image'),
        leftBgColor:   colorField('Left Background Color'),
        leftOverlay:   { type: 'number', label: 'Left Overlay (0–1)', min: 0, max: 1, step: 0.05 },
        leftTextColor: colorField('Left Text Color'),
        leftPadding:   { type: 'text', label: 'Left Padding' },
        leftMinHeight: { type: 'text', label: 'Left Min Height' },
        leftBgPosition: { type: 'select', label: 'Left Image Position', options: [
          { label: 'Center (default)', value: 'center center' },
          { label: 'Top',             value: 'center top'    },
          { label: 'Bottom',          value: 'center bottom' },
          { label: 'Left',            value: 'left center'   },
          { label: 'Right',           value: 'right center'  },
          { label: 'Top Left',        value: 'left top'      },
          { label: 'Top Right',       value: 'right top'     },
          { label: 'Bottom Left',     value: 'left bottom'   },
          { label: 'Bottom Right',    value: 'right bottom'  },
        ]},
        // ── Right column ─────────────────────────────────────────────────────
        rightContent:   richTextField('Right Column Content'),
        rightBgDecoration: richTextField('Right Background Decoration (raw HTML/CSS, renders full-bleed behind content)'),
        rightBgImage:   imageField('Right Background Image'),
        rightBgColor:   colorField('Right Background Color'),
        rightOverlay:   { type: 'number', label: 'Right Overlay (0–1)', min: 0, max: 1, step: 0.05 },
        rightTextColor: colorField('Right Text Color'),
        rightPadding:   { type: 'text', label: 'Right Padding' },
        rightMinHeight: { type: 'text', label: 'Right Min Height' },
        rightBgPosition: { type: 'select', label: 'Right Image Position', options: [
          { label: 'Center (default)', value: 'center center' },
          { label: 'Top',             value: 'center top'    },
          { label: 'Bottom',          value: 'center bottom' },
          { label: 'Left',            value: 'left center'   },
          { label: 'Right',           value: 'right center'  },
          { label: 'Top Left',        value: 'left top'      },
          { label: 'Top Right',       value: 'right top'     },
          { label: 'Bottom Left',     value: 'left bottom'   },
          { label: 'Bottom Right',    value: 'right bottom'  },
        ]},
        animation: animField(),
        animDelay: animDelayField(),
      },
      defaultProps: {
        ratio: '1fr 1fr', gap: '0', verticalAlign: 'flex-start',
        containerBgColor: '', containerBgDecoration: '', containerPadding: '', containerMaxWidth: '', containerWidthMode: 'custom',
        containerRadius: '0px', containerBorder: 'none', containerBorderColor: '#e5e5e5', cardRadius: '0px',
        // Left
        leftContent: '<h3>Left Heading</h3><p>Left content goes here.</p>',
        leftBgDecoration: '',
        leftBgImage: '', leftBgColor: '', leftOverlay: 0.4, leftTextColor: '', leftPadding: '3rem 2.5rem', leftMinHeight: '', leftBgPosition: 'center center',
        // Right
        rightContent: '<h3>Right Heading</h3><p>Right content goes here.</p>',
        rightBgDecoration: '',
        rightBgImage: '', rightBgColor: '', rightOverlay: 0.4, rightTextColor: '', rightPadding: '3rem 2.5rem', rightMinHeight: '', rightBgPosition: 'center center',
        // Legacy (kept so old pages still render)
        leftHtml: '', rightHtml: '', leftImage: '', rightImage: '',
        animation: 'none', animDelay: '0',
      },
      render: ({ ratio, gap, verticalAlign,
                 containerBgColor, containerBgDecoration, containerPadding, containerMaxWidth, containerWidthMode,
                 containerRadius, containerBorder, containerBorderColor, cardRadius,
                 leftContent, leftBgDecoration, leftBgImage, leftBgColor, leftOverlay, leftTextColor, leftPadding, leftMinHeight, leftBgPosition,
                 rightContent, rightBgDecoration, rightBgImage, rightBgColor, rightOverlay, rightTextColor, rightPadding, rightMinHeight, rightBgPosition,
                 leftHtml, rightHtml, leftImage, rightImage,
                 animation, animDelay }) => {
        // backward-compat: leftImage (old) → leftBgImage, leftHtml → leftContent
        const lBg  = leftBgImage  || leftImage  || '';
        const rBg  = rightBgImage || rightImage || '';
        const lTxt = leftContent  || leftHtml   || '';
        const rTxt = rightContent || rightHtml  || '';

        function bgValue(bgColor) {
          if (!bgColor) return {};
          return /^(linear|radial)-gradient\(/.test(bgColor.trim()) ? { background: bgColor } : { backgroundColor: bgColor };
        }

        function colStyle(bg, bgColor, textColor, padding, minHeight, bgPosition, decoration) {
          return {
            position: 'relative',
            display: 'flex', flexDirection: 'column', justifyContent: verticalAlign || 'flex-start',
            padding: padding || '3rem 2.5rem',
            minHeight: minHeight || undefined,
            color: textColor || 'inherit',
            overflow: (decoration || (cardRadius && cardRadius !== '0px')) ? 'hidden' : undefined,
            borderRadius: cardRadius || '0px',
            ...(bg ? { backgroundImage: `url('${resolveUrl(bg)}')`, backgroundSize: 'cover', backgroundPosition: bgPosition || 'center center' } : {}),
            ...(bgColor && !bg ? bgValue(bgColor) : {}),
          };
        }

        // Boxed-card mode: background/border/radius apply to a width-constrained
        // wrapper (e.g. a bordered rounded card, per website-files reference
        // designs) instead of a full-bleed strip. Off by default so every
        // already-published page keeps its old full-bleed look unchanged.
        const boxed = (containerRadius && containerRadius !== '0px') || containerBorder === 'thin';

        // Outer: full-bleed decoration, spans the whole section width.
        const outerStyle = {
          position: 'relative',
          padding: boxed ? undefined : (containerPadding || undefined),
          overflow: containerBgDecoration ? 'hidden' : undefined,
          ...(boxed ? {} : bgValue(containerBgColor)),
        };

        // Two ways to box/center content:
        //   'site' (containerWidthMode) — matches the header's real responsive
        //     width via the shared .site-container class (see vcsf-design.css).
        //   'custom' (default, backward-compatible) — the original ad-hoc
        //     width: min(<max>, 92%) math when containerMaxWidth is set, or
        //     full-bleed (no width constraint) when it's blank — unchanged
        //     for every already-published page that relies on this today.
        const useSiteContainer = containerWidthMode === 'site';
        const widthStyle = (!useSiteContainer && containerMaxWidth) ? { width: `min(${containerMaxWidth}, 92%)`, marginLeft: 'auto', marginRight: 'auto' } : {};
        const cardStyle = boxed ? {
          ...bgValue(containerBgColor),
          borderRadius: containerRadius || '0px',
          border: containerBorder === 'thin' ? `1px solid ${containerBorderColor || '#e5e5e5'}` : undefined,
          padding: containerPadding || undefined,
          overflow: (containerRadius && containerRadius !== '0px') ? 'hidden' : undefined,
          ...widthStyle,
        } : {};
        const gridStyle = {
          position: 'relative', zIndex: 1,
          display: 'grid', gridTemplateColumns: ratio, gap: gap || '0',
          ...(boxed ? {} : widthStyle),
        };

        return (
          <AnimatedBlock animation={animation} delay={Number(animDelay) || 0}>
            <style>{`
              @media (max-width: 768px) {
                .lit-twocol-grid { grid-template-columns: 1fr !important; }
              }
            `}</style>
            <div style={outerStyle}>
              {containerBgDecoration && (
                <div aria-hidden="true" style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
                  dangerouslySetInnerHTML={{ __html: containerBgDecoration }} />
              )}
              <div className={useSiteContainer ? 'site-container' : ''} style={boxed ? cardStyle : {}}>
              <div className="lit-twocol-grid" style={gridStyle}>
              {/* Left */}
              <div style={{ ...colStyle(lBg, leftBgColor, leftTextColor, leftPadding, leftMinHeight, leftBgPosition, leftBgDecoration), zIndex: 1 }}>
                {lBg && (leftOverlay > 0) && (
                  <div aria-hidden="true" style={{ position: 'absolute', inset: 0, background: `rgba(0,0,0,${leftOverlay})`, pointerEvents: 'none' }} />
                )}
                {leftBgDecoration && (
                  <div aria-hidden="true" style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
                    dangerouslySetInnerHTML={{ __html: leftBgDecoration }} />
                )}
                <div className="twocol-content" style={{ position: 'relative', zIndex: 1 }}
                  dangerouslySetInnerHTML={{ __html: lTxt }} />
              </div>
              {/* Right */}
              <div style={{ ...colStyle(rBg, rightBgColor, rightTextColor, rightPadding, rightMinHeight, rightBgPosition, rightBgDecoration), zIndex: 1 }}>
                {rBg && (rightOverlay > 0) && (
                  <div aria-hidden="true" style={{ position: 'absolute', inset: 0, background: `rgba(0,0,0,${rightOverlay})`, pointerEvents: 'none' }} />
                )}
                {rightBgDecoration && (
                  <div aria-hidden="true" style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
                    dangerouslySetInnerHTML={{ __html: rightBgDecoration }} />
                )}
                <div className="twocol-content" style={{ position: 'relative', zIndex: 1 }}
                  dangerouslySetInnerHTML={{ __html: rTxt }} />
              </div>
              </div>
              </div>
            </div>
          </AnimatedBlock>
        );
      },
    },

    // ── Card Grid ───────────────────────────────────────────────────────────
    CardGrid: {
      label: 'Card Grid',
      fields: {
        label:          { type: 'text',   label: 'Eyebrow Label (optional)' },
        heading:        { type: 'text',   label: 'Section Heading' },
        headingColor:   colorField('Heading Color'),
        headingFont:    { type: 'select', label: 'Heading Font', options: [
          { label: 'Sans-Serif', value: 'sans'  },
          { label: 'Serif',      value: 'serif' },
        ]},
        subtext:        { type: 'textarea', label: 'Section Description (optional)' },
        subtextColor:   colorField('Section Description Color'),
        headerLinkText: { type: 'text', label: 'Section "View All" Link Text (optional)' },
        headerLinkUrl:  urlField('Section "View All" Link URL'),
        columns:        { type: 'select', label: 'Columns', options: [{ label: '2', value: 2 }, { label: '3', value: 3 }, { label: '4', value: 4 }] },
        cardStyle:      { type: 'select', label: 'Card Style', options: [{ label: 'Bordered', value: 'bordered' }, { label: 'Shadow', value: 'shadow' }, { label: 'Plain', value: 'plain' }, { label: 'Hover Fill (icon+title fade to accent gradient)', value: 'hoverFill' }] },
        cardRadius:     cardRadiusField(),
        bgColor:        colorField('Background Color'),
        cardBg:         colorField('Card Background Color'),
        cardTitleColor: colorField('Card Title Color'),
        cardTextColor:  colorField('Card Text Color'),
        cardLinkColor:  colorField('Card Link Color'),
        cardLinkStyle:  { type: 'select', label: 'Card CTA Style', options: [{ label: 'Text Link', value: 'text' }, { label: 'Filled Button', value: 'button' }] },
        cardLinkBg:         colorField('Card CTA Button Background (Filled Button style only)'),
        cardLinkTextColor:  colorField('Card CTA Button Text Color (Filled Button style only)'),
        iconColor:      colorField('Icon Color'),
        btnRadius:      btnRadiusField(),
        cardTitleSize:  { type: 'select', label: 'Card Title Size', options: [
          { label: 'Small (1rem)',      value: '1rem'    },
          { label: 'Medium (1.1rem)',   value: '1.1rem'  },
          { label: 'Large (1.25rem)',   value: '1.25rem' },
          { label: 'X-Large (1.5rem)', value: '1.5rem'  },
        ]},
        animation: animField(),
        animDelay: animDelayField(),
        items: {
          type: 'array',
          label: 'Cards',
          arrayFields: {
            image:    imageField('Photo (optional — shown instead of icon when set)'),
            icon:     iconField('Icon (Font Awesome or emoji, used when no photo)'),
            eyebrow:  { type: 'text',     label: 'Eyebrow / Tag Label (optional, e.g. a date or category)' },
            title:    { type: 'text',     label: 'Title' },
            text:     { type: 'textarea', label: 'Description' },
            link:     urlField('Link URL'),
            linkText: { type: 'text',     label: 'Link Label' },
          },
          defaultItemProps: { image: '', icon: 'fa-solid fa-star', eyebrow: '', title: 'Card Title', text: 'Description here.', link: '', linkText: 'Learn More' },
        },
      },
      defaultProps: {
        label: '', heading: '', headingColor: '', headingFont: 'sans', subtext: '', subtextColor: '',
        headerLinkText: '', headerLinkUrl: '',
        columns: 3, cardStyle: 'bordered', cardRadius: '8px', bgColor: '',
        cardBg: '', cardTitleColor: '', cardTextColor: '#555555', cardLinkColor: '#C9A227',
        cardLinkStyle: 'text', cardLinkBg: '#0A1F3D', cardLinkTextColor: '#ffffff',
        iconColor: '', btnRadius: '50px', cardTitleSize: '1.1rem',
        animation: 'none', animDelay: '0',
        items: [
          { image: '', icon: 'fa-solid fa-plane',  eyebrow: '', title: 'Feature One',   text: 'Description of this feature.', link: '', linkText: 'Learn More' },
          { image: '', icon: 'fa-solid fa-wrench', eyebrow: '', title: 'Feature Two',   text: 'Description of this feature.', link: '', linkText: 'Learn More' },
          { image: '', icon: 'fa-solid fa-trophy', eyebrow: '', title: 'Feature Three', text: 'Description of this feature.', link: '', linkText: 'Learn More' },
        ],
      },
      render: ({ label, heading, headingColor, headingFont, subtext, subtextColor, headerLinkText, headerLinkUrl, columns, cardStyle, cardRadius, bgColor, cardBg, cardTitleColor, cardTextColor, cardLinkColor, cardLinkStyle, cardLinkBg, cardLinkTextColor, iconColor, btnRadius, cardTitleSize, animation, animDelay, items }) => {
        const isHoverFill = cardStyle === 'hoverFill';
        const acc = iconColor || cardLinkColor || '#C9A227';
        const radius = cardRadius ?? '8px';
        const cardCss = { bordered: { border: '1px solid #dee2e6', borderRadius: radius }, shadow: { boxShadow: '0 2px 12px rgba(0,0,0,0.1)', borderRadius: radius }, plain: { borderRadius: radius }, hoverFill: { border: '1px solid #e5e5e5', borderRadius: radius } }[cardStyle] || {};
        return (
          <div style={{ background: bgColor || 'transparent', padding: '2rem 1rem', position: 'relative' }}>
            {isHoverFill && (
              <style>{`
                .lit-cardgrid-hoverfill { position: relative; overflow: hidden; cursor: default; transition: transform 0.35s cubic-bezier(0.4,0,0.2,1), box-shadow 0.35s cubic-bezier(0.4,0,0.2,1), border-color 0.35s cubic-bezier(0.4,0,0.2,1); }
                .lit-cardgrid-hoverfill::before { content: ''; position: absolute; inset: 0; background: linear-gradient(135deg, ${acc}, ${acc}); opacity: 0; transition: opacity 0.35s cubic-bezier(0.4,0,0.2,1); }
                .lit-cardgrid-hoverfill:hover { transform: translateY(-6px) scale(1.02); box-shadow: 0 20px 60px ${acc}38; border-color: transparent; }
                .lit-cardgrid-hoverfill:hover::before { opacity: 1; }
                .lit-cardgrid-hoverfill > * { position: relative; z-index: 1; transition: color 0.35s cubic-bezier(0.4,0,0.2,1); }
                .lit-cardgrid-hoverfill:hover .lit-cardgrid-title { color: #fff !important; }
                .lit-cardgrid-hoverfill:hover .lit-cardgrid-text { color: rgba(255,255,255,0.85) !important; }
              `}</style>
            )}
            <div style={{ maxWidth: 1200, margin: '0 auto' }}>
              {(label || (headerLinkText && headerLinkUrl)) && (
                <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '1rem', marginBottom: '0.75rem' }}>
                  {label && <div style={{ fontSize: '0.75rem', fontWeight: 700, letterSpacing: '0.15em', textTransform: 'uppercase', color: acc }}>{label}</div>}
                  {headerLinkText && headerLinkUrl && (
                    <a href={headerLinkUrl} style={{ display: 'none', fontSize: '0.8rem', fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: acc, textDecoration: 'none' }} className="lit-cardgrid-headerlink-desktop">{headerLinkText} →</a>
                  )}
                </div>
              )}
              {heading && <h2 style={{ textAlign: 'center', marginBottom: subtext ? '1rem' : '2.5rem', color: headingColor || 'inherit', fontSize: 'clamp(1.6rem,3vw,2.25rem)', fontWeight: headingFont === 'serif' ? 700 : 800, fontFamily: headingFont === 'serif' ? "'Playfair Display', Georgia, serif" : 'inherit', letterSpacing: headingFont === 'serif' ? '-1px' : 'inherit' }}>{heading}</h2>}
              {subtext && <p style={{ textAlign: 'center', color: subtextColor || '#6b7280', marginBottom: '2.5rem', fontSize: '1.05rem', maxWidth: 640, marginLeft: 'auto', marginRight: 'auto' }}>{subtext}</p>}
              <style>{`
                @media (min-width: 769px) { .lit-cardgrid-headerlink-desktop { display: inline-flex !important; } }
              `}</style>
              <div className="lit-responsive-grid" style={{ display: 'grid', gridTemplateColumns: `repeat(${columns}, 1fr)`, gap: '1.5rem' }}>
                {(items || []).map((item, i) => {
                  const Wrapper = item.link ? 'a' : 'div';
                  const wrapperProps = item.link ? { href: item.link, style: { textDecoration: 'none', color: 'inherit', display: 'block' } } : {};
                  const isButtonCta = cardLinkStyle === 'button';
                  return (
                    <AnimatedBlock key={i} animation={animation} delay={(Number(animDelay) || 0) + i * 0.1} style={{ height: '100%' }}>
                      <Wrapper {...wrapperProps} className={isHoverFill ? 'lit-cardgrid-hoverfill' : 'vcsf-card'} style={{ ...wrapperProps.style, overflow: 'hidden', background: cardBg || (isHoverFill ? '#fff' : 'transparent'), height: '100%', display: 'flex', flexDirection: 'column', ...cardCss }}>
                        {item.image && (
                          <div style={{ height: '14rem', overflow: 'hidden', flexShrink: 0 }}>
                            <img src={resolveUrl(item.image)} alt={item.title || ''} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                          </div>
                        )}
                        <div style={{ padding: item.image ? '0 1.5rem 1.5rem' : (isHoverFill ? '1.75rem 1.5rem' : '1.5rem'), display: 'flex', flexDirection: 'column', flex: 1 }}>
                          {!item.image && renderIconValue(item.icon, { fontSize: '2rem', marginBottom: '0.75rem', display: 'block', color: iconColor || 'inherit' })}
                          {item.eyebrow && <div style={{ display: 'inline-block', fontSize: '0.7rem', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: iconColor || cardLinkColor || '#C9A227', marginBottom: '0.4rem' }}>{item.eyebrow}</div>}
                          <h3 className={isHoverFill ? 'lit-cardgrid-title' : undefined} style={{ fontSize: isHoverFill ? '1rem' : (cardTitleSize || '1.1rem'), marginBottom: '0.4rem', color: cardTitleColor || 'inherit', fontWeight: 700 }}>{item.title}</h3>
                          <p className={isHoverFill ? 'lit-cardgrid-text' : undefined} style={{ color: cardTextColor || '#555', fontSize: isHoverFill ? '0.8rem' : '0.9rem', flex: 1 }}>{item.text}</p>
                          {item.link && item.linkText && (isButtonCta
                            ? <span style={{ display: 'inline-block', marginTop: '0.75rem', background: cardLinkBg || '#0A1F3D', color: cardLinkTextColor || '#ffffff', padding: '0.75rem 2rem', fontWeight: 600, fontSize: '0.9rem', borderRadius: btnRadius ?? '50px' }}>{item.linkText}</span>
                            : <span style={{ display: 'block', marginTop: '0.5rem', color: cardLinkColor || '#C9A227', fontWeight: 600, fontSize: '0.9rem' }}>{item.linkText}</span>
                          )}
                        </div>
                      </Wrapper>
                    </AnimatedBlock>
                  );
                })}
              </div>
              {headerLinkText && headerLinkUrl && (
                <div className="lit-cardgrid-headerlink-mobile" style={{ textAlign: 'center', marginTop: '1.5rem' }}>
                  <a href={headerLinkUrl} style={{ fontSize: '0.85rem', fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: acc, textDecoration: 'none' }}>{headerLinkText} →</a>
                </div>
              )}
              <style>{`
                @media (min-width: 769px) { .lit-cardgrid-headerlink-mobile { display: none !important; } }
              `}</style>
            </div>
          </div>
        );
      },
    },

    // ── FAQ Accordion ────────────────────────────────────────────────────────
    FAQAccordion: {
      label: 'FAQ Accordion',
      fields: {
        heading:       { type: 'text', label: 'Section Heading' },
        subheading:    { type: 'text', label: 'Subheading' },
        bgColor:       colorField('Background Color'),
        headingColor:  colorField('Heading Color'),
        questionColor: colorField('Question Text Color'),
        answerColor:   colorField('Answer Text Color'),
        questionSize:  { type: 'select', label: 'Question Font Size', options: [
          { label: 'Small (0.9rem)',  value: '0.9rem' },
          { label: 'Medium (1rem)',  value: '1rem'   },
          { label: 'Large (1.1rem)', value: '1.1rem' },
        ]},
        accentColor:   colorField('Accent Color (CTA button)'),
        btnRadius:     btnRadiusField(),
        cardRadius:    cardRadiusField(),
        showCta:       { type: 'select', label: 'Show "Still have questions?" CTA', options: [{ label: 'Yes', value: 'yes' }, { label: 'No', value: 'no' }] },
        ctaText:       { type: 'text', label: 'CTA Button Text' },
        ctaUrl:        urlField('CTA Button URL'),
        faqs: {
          type: 'array',
          label: 'FAQ Items',
          arrayFields: {
            question: { type: 'text',     label: 'Question' },
            answer:   { type: 'textarea', label: 'Answer' },
          },
          defaultItemProps: { question: 'New Question', answer: 'Answer goes here.' },
        },
      },
      defaultProps: {
        heading:       'Frequently Asked Questions',
        subheading:    'Everything you need to know about supporting the Foundation.',
        bgColor:       '',
        headingColor:  '#0A1F3D',
        questionColor: '#0A1F3D',
        answerColor:   '#555555',
        questionSize:  '1rem',
        accentColor:   '#C9A227',
        btnRadius:     '12px',
        cardRadius:    '8px',
        showCta:       'yes',
        ctaText:       'Contact Us',
        ctaUrl:        '/contact',
        faqs: [
          { question: 'Is my donation tax-deductible?', answer: 'Yes. The Ventura County Sheriff\'s Foundation is an independent 501(c)(3) nonprofit organization (Tax ID #20-3780163). All donations are tax-deductible and a receipt is provided for every gift.' },
          { question: 'Where does my donation go?', answer: '100% of proceeds support the Ventura County Sheriff\'s Office — grants for equipment and technology, the Sgt. Ron Helus Training Facility, Shop with a Cop, Coppers and Choppers, and the Grossman Scholarship for deputy families.' },
          { question: 'How do I become a member?', answer: 'Memberships start at $20/year (Senior Bronze) and include a personalized membership card, window decals, and recognition in our annual report. Visit the Support Us page or contact us to join.' },
          { question: 'Can my business sponsor an event?', answer: 'Absolutely. Local businesses sponsor Shop with a Cop, Coppers and Choppers, and training initiatives, receiving prominent recognition across the community. Contact us to discuss sponsorship opportunities.' },
          { question: 'Who can apply for the Grossman Scholarship?', answer: 'Graduating high school seniors or GED recipients who are children or legal dependents of current VCSO employees or sworn deputies in good standing, with a minimum 3.0 GPA. Applications go through the Ventura County Community Foundation portal.' },
          { question: 'Does the Foundation fund other nonprofits?', answer: 'No. We fund the Ventura County Sheriff\'s Office directly and exclusively — equipment, training, scholarships for deputy families, and community programs run by deputies themselves.' },
        ],
      },
      render: function FAQAccordionBlock({ id, heading, subheading, bgColor, headingColor, questionColor, answerColor, questionSize, accentColor, btnRadius, cardRadius, showCta, ctaText, ctaUrl, faqs }) {
        const accent  = accentColor  || '#C9A227';
        const hClr    = headingColor  || '#0d1b2a';
        const qClr    = questionColor || '#0d1b2a';
        const aClr    = answerColor   || '#555555';
        const qSz     = questionSize  || '1rem';
        const items   = Array.isArray(faqs) ? faqs : [];
        const blockId = id || 'faq';
        return (
          <section style={{ background: bgColor || 'transparent', padding: '3.5rem 0' }}>
            <div className="container">
              {(heading || subheading) && (
                <div className="text-center mb-4">
                  {heading && <h2 style={{ fontWeight: 800, color: hClr, marginBottom: '0.5rem' }}>{heading}</h2>}
                  {subheading && <p style={{ color: aClr }}>{subheading}</p>}
                </div>
              )}
              <div className="row justify-content-center">
                <div className="col-lg-9">
                  <div className="accordion" id={`faqAcc-${blockId}`}>
                    {items.map((faq, i) => {
                      const colId = `faq-${blockId}-${i}`;
                      return (
                        <div key={i} className="accordion-item border mb-2 shadow-sm overflow-hidden" style={{ borderRadius: cardRadius ?? '8px' }}>
                          <h2 className="accordion-header">
                            <button
                              className="accordion-button collapsed fw-semibold"
                              type="button"
                              data-bs-toggle="collapse"
                              data-bs-target={`#${colId}`}
                              aria-expanded="false"
                              style={{ color: qClr, fontSize: qSz }}
                            >
                              {faq.question}
                            </button>
                          </h2>
                          <div id={colId} className="accordion-collapse collapse" data-bs-parent={`#faqAcc-${blockId}`}>
                            <div className="accordion-body" style={{ whiteSpace: 'pre-line', color: aClr }}>
                              {faq.answer}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {showCta !== 'no' && (
                    <div className="mt-5 p-4 text-center" style={{ backgroundColor: '#f0f4f8', border: '1px solid #dee2e6', borderRadius: cardRadius ?? '8px' }}>
                      <h5 className="fw-bold mb-2" style={{ color: hClr }}>Still have questions?</h5>
                      <p style={{ color: aClr, marginBottom: '1rem' }}>Our support team is happy to help — reach out any time.</p>
                      <a href={ctaUrl || '/contact'} className="btn fw-semibold px-4"
                        style={{ backgroundColor: accent, color: '#fff', border: 'none', textDecoration: 'none', borderRadius: btnRadius ?? '50px' }}>
                        {ctaText || 'Contact Us'}
                      </a>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </section>
        );
      },
    },

    // ── CTA Banner ──────────────────────────────────────────────────────────
    CTABanner: {
      label: 'Call to Action Banner',
      fields: {
        eyebrow:       { type: 'text', label: 'Eyebrow Label (optional, e.g. "FOR LOCAL BUSINESSES")' },
        eyebrowColor:  colorField('Eyebrow Label Color'),
        headline:      { type: 'text', label: 'Headline' },
        headlineColor: colorField('Headline Color'),
        headlineFont:  { type: 'select', label: 'Headline Font', options: [
          { label: 'Sans-Serif', value: 'sans'  },
          { label: 'Serif',      value: 'serif' },
        ]},
        headlineSize:  { type: 'select', label: 'Headline Size', options: [
          { label: 'Medium (1.5rem)',   value: '1.5rem' },
          { label: 'Large (2rem)',      value: '2rem'   },
          { label: 'X-Large (2.5rem)', value: '2.5rem' },
          { label: 'XX-Large (3rem)',  value: '3rem'   },
        ]},
        subtext:       { type: 'text', label: 'Subtext' },
        subtextColor:  colorField('Subtext Color'),
        subtextSize:   { type: 'select', label: 'Subtext Size', options: [
          { label: 'Small (0.9rem)',  value: '0.9rem' },
          { label: 'Medium (1rem)',  value: '1rem'   },
          { label: 'Large (1.1rem)', value: '1.1rem' },
        ]},
        footnoteText:  { type: 'text', label: 'Footnote (optional, small print below the buttons)' },
        footnoteColor: colorField('Footnote Color'),
        bgImage:       imageField('Background Image URL'),
        bgOverlay:     { type: 'number', label: 'Image Overlay Darkness (0–1)' },
        bgColor:       colorField('Background Color (fallback, gradient supported)'),
        bgDecoration:  richTextField('Background Decoration (raw HTML/CSS, e.g. glow orbs — renders full-bleed behind content)'),
        textColor:     colorField('Text Color (fallback)'),
        btnRadius:     btnRadiusField(),
        btn1Text:      { type: 'text', label: 'Button 1 Text' },
        btn1Url:       urlField('Button 1 URL'),
        btn1BgColor:   colorField('Button 1 Background'),
        btn1TextColor: colorField('Button 1 Text Color'),
        btn2Text:      { type: 'text', label: 'Button 2 Text' },
        btn2Url:       urlField('Button 2 URL'),
        btn2BgColor:   colorField('Button 2 Background'),
        btn2TextColor: colorField('Button 2 Text Color'),
        layout:        { type: 'select', label: 'Layout', options: [
          { label: 'Full-Bleed, Centered (default)', value: 'bleed'  },
          { label: 'Boxed Card, Left-Aligned',        value: 'boxed' },
        ]},
        cardRadius:    cardRadiusField('Card Corner Style (Boxed layout only)'),
        paddingY:      { type: 'text', label: 'Vertical Padding (e.g. 6rem, or 3.5rem for Boxed layout)' },
        paddingX:      { type: 'text', label: 'Horizontal Padding' },
      },
      defaultProps: {
        eyebrow: '', eyebrowColor: '#C9A227',
        headline: 'Ready to Get Started?', headlineColor: '', headlineFont: 'sans', headlineSize: '2rem',
        subtext: 'Contact our team today.', subtextColor: '', subtextSize: '1rem',
        footnoteText: '', footnoteColor: '',
        bgImage: '', bgOverlay: 0.7, bgColor: '#C9A227', bgDecoration: '', textColor: '#ffffff', btnRadius: '50px',
        btn1Text: 'Contact Us', btn1Url: '/contact', btn1BgColor: '#ffffff', btn1TextColor: '#C9A227',
        btn2Text: '', btn2Url: '', btn2BgColor: 'transparent', btn2TextColor: '#ffffff',
        layout: 'bleed', cardRadius: '0px', paddingY: '6rem', paddingX: '2rem',
      },
      render: ({ eyebrow, eyebrowColor, headline, headlineColor, headlineFont, headlineSize, subtext, subtextColor, subtextSize,
                 footnoteText, footnoteColor, bgColor, bgImage, bgOverlay, bgDecoration, textColor, btnRadius,
                 btn1Text, btn1Url, btn1BgColor, btn1TextColor, btn2Text, btn2Url, btn2BgColor, btn2TextColor,
                 layout, cardRadius, paddingY, paddingX }) => {
        const BG = bgImage
          ? `linear-gradient(rgba(0,0,0,${bgOverlay ?? 0.7}), rgba(0,0,0,${bgOverlay ?? 0.7})), url('${resolveUrl(bgImage)}') center/cover no-repeat`
          : (bgColor || '#C9A227');
        const boxed = layout === 'boxed';
        const inner = (
          <>
            {eyebrow && <div style={{ textTransform: 'uppercase', fontSize: '0.75rem', letterSpacing: '0.15em', color: eyebrowColor || '#C9A227', marginBottom: '0.5rem' }}>{eyebrow}</div>}
            <h2 style={{ fontSize: headlineSize || '2rem', marginBottom: '1rem', fontWeight: headlineFont === 'serif' ? 700 : 800, fontFamily: headlineFont === 'serif' ? "'Playfair Display', Georgia, serif" : 'inherit', letterSpacing: headlineFont === 'serif' ? '-1px' : 'inherit', color: headlineColor || textColor || '#ffffff' }}>{headline}</h2>
            {subtext && <p style={{ fontSize: subtextSize || '1rem', opacity: 0.9, marginBottom: '2rem', color: subtextColor || textColor || '#ffffff' }}>{subtext}</p>}
            <div style={{ display: 'flex', gap: '1rem', justifyContent: boxed ? 'flex-start' : 'center', flexWrap: 'wrap' }}>
              {btn1Text && (
                <a href={btn1Url} style={{ background: btn1BgColor || '#ffffff', color: btn1TextColor || bgColor, padding: '0.9rem 2rem', borderRadius: btnRadius ?? '50px', textDecoration: 'none', fontWeight: 700, boxShadow: '0 4px 20px rgba(0,0,0,0.2)', transition: 'transform 0.2s, box-shadow 0.2s', display: 'inline-block' }}
                  onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-2px)'; }}
                  onMouseLeave={e => { e.currentTarget.style.transform = 'translateY(0)'; }}>{btn1Text}</a>
              )}
              {btn2Text && (
                <a href={btn2Url} style={{ background: btn2BgColor || 'transparent', color: btn2TextColor || textColor, padding: '0.9rem 2rem', borderRadius: btnRadius ?? '50px', textDecoration: 'none', fontWeight: 700, border: `2px solid ${btn2TextColor ? btn2TextColor + '4d' : 'rgba(255,255,255,0.3)'}`, backdropFilter: 'blur(8px)', transition: 'border-color 0.2s, background 0.2s', display: 'inline-block' }}>{btn2Text}</a>
              )}
            </div>
            {footnoteText && <p style={{ marginTop: '1.25rem', fontSize: '0.75rem', textAlign: boxed ? 'left' : 'center', color: footnoteColor || (textColor ? textColor + 'aa' : 'rgba(255,255,255,0.7)') }}>{footnoteText}</p>}
          </>
        );
        if (boxed) {
          return (
            <div className="site-container" style={{ padding: `${paddingY || '3.5rem'} 0` }}>
              <div style={{ background: BG, color: textColor, padding: '2.5rem', borderRadius: cardRadius || '24px', position: 'relative', overflow: bgDecoration ? 'hidden' : undefined }}>
                {bgDecoration && (
                  <div aria-hidden="true" style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }} dangerouslySetInnerHTML={{ __html: bgDecoration }} />
                )}
                <div style={{ position: 'relative', zIndex: 1, maxWidth: 640 }}>{inner}</div>
              </div>
            </div>
          );
        }
        return (
          <div style={{ background: BG, color: textColor, padding: `${paddingY || '6rem'} ${paddingX || '2rem'}`, textAlign: 'center', position: 'relative', overflow: bgDecoration ? 'hidden' : undefined }}>
            {bgDecoration && (
              <div aria-hidden="true" style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }} dangerouslySetInnerHTML={{ __html: bgDecoration }} />
            )}
            <div style={{ position: 'relative', zIndex: 1, maxWidth: 720, margin: '0 auto' }}>{inner}</div>
          </div>
        );
      },
    },

    // ── Divider / Spacer ────────────────────────────────────────────────────
    Divider: {
      label: 'Divider / Spacer',
      fields: {
        style:   { type: 'select', label: 'Style',   options: [{ label: 'Line', value: 'line' }, { label: 'Thick Line', value: 'thick' }, { label: 'Space Only', value: 'space' }] },
        spacing: { type: 'select', label: 'Spacing', options: [{ label: 'Small (16px)', value: '16px' }, { label: 'Medium (32px)', value: '32px' }, { label: 'Large (64px)', value: '64px' }] },
        color:   colorField('Line Color'),
      },
      defaultProps: { style: 'line', spacing: '32px', color: '#dee2e6' },
      render: ({ style, spacing, color }) => (
        <div style={{ padding: `${spacing} 0` }}>
          {style !== 'space' && <hr style={{ borderColor: color, borderTopWidth: style === 'thick' ? 4 : 1, margin: 0 }} />}
        </div>
      ),
    },

    // ── Raw HTML ────────────────────────────────────────────────────────────
    RawHTML: {
      label: 'Raw HTML / Embed',
      fields: {
        code: { type: 'textarea', label: 'HTML Code' },
      },
      defaultProps: { code: '<!-- Paste your HTML or embed code here -->' },
      render: ({ code }) => <div dangerouslySetInnerHTML={{ __html: code }} />,
    },

    // ── Shop Listing (full interactive shop: search / filter / sort / pages) ──
    ShopListing: {
      label: 'Shop Listing',
      fields: {
        accentColor: colorField('Accent Color'),
        columns:     { type: 'select', label: 'Columns', options: [
          { label: '2', value: 2 }, { label: '3', value: 3 }, { label: '4', value: 4 },
        ]},
        pageSize: { type: 'select', label: 'Products per Page', options: [
          { label: '6', value: 6 }, { label: '12', value: 12 }, { label: '24', value: 24 },
        ]},
        showPrice: { type: 'select', label: 'Show Price', options: [{ label: 'Yes', value: 'yes' }, { label: 'No', value: 'no' }] },
        cardRadius: cardRadiusField(),
        bgColor:   colorField('Background Color'),
      },
      defaultProps: { accentColor: '#C9A227', columns: 3, pageSize: 12, showPrice: 'yes', cardRadius: '8px', bgColor: '' },
      render: function ShopListingBlock({ accentColor, columns, pageSize: pageSizeProp, showPrice, cardRadius, bgColor }) {
        const accent   = accentColor || '#C9A227';
        const cols     = Number(columns) || 3;
        const pageSize = Number(pageSizeProp) || 12;
        const colClass = { 2: 'col-sm-6', 3: 'col-sm-6 col-lg-4', 4: 'col-sm-6 col-xl-3' }[cols] || 'col-sm-6 col-lg-4';

        // URL-param state: category comes from path /shop/category/:slug, rest from query params
        function getParams() {
          try {
            const p = new URLSearchParams(window.location.search);
            const pathMatch = window.location.pathname.match(/\/shop\/category\/([^/?]+)/);
            let categorySlug = pathMatch ? pathMatch[1] : '';
            // Redirect old ?category= query param to new path format
            const legacyCategory = p.get('category');
            if (!categorySlug && legacyCategory) {
              categorySlug = legacyCategory;
              const qs = new URLSearchParams();
              if (p.get('search')) qs.set('search', p.get('search'));
              if (p.get('sort'))   qs.set('sort',   p.get('sort'));
              if (p.get('page'))   qs.set('page',   p.get('page'));
              const newPath = `/shop/category/${legacyCategory}${qs.toString() ? `?${qs}` : ''}`;
              try { window.history.replaceState(null, '', newPath); } catch {}
            }
            return {
              search:       p.get('search') || '',
              categorySlug,
              sort:         p.get('sort')   || 'name_asc',
              page:         parseInt(p.get('page') || '1', 10),
            };
          } catch { return { search: '', categorySlug: '', sort: 'name_asc', page: 1 }; }
        }

        const [params,     setParams]     = useState(getParams);
        const [products,   setProducts]   = useState([]);
        const [categories, setCategories] = useState([]);
        const [total,      setTotal]      = useState(0);
        const [loading,    setLoading]    = useState(true);

        function setParam(key, value) {
          const next = { ...params, [key]: value };
          if (key !== 'page') next.page = 1;
          setParams(next);
          try {
            const qs = new URLSearchParams();
            if (next.search) qs.set('search', next.search);
            if (next.sort && next.sort !== 'name_asc') qs.set('sort', next.sort);
            if (next.page > 1) qs.set('page', String(next.page));
            const basePath = next.categorySlug ? `/shop/category/${next.categorySlug}` : '/shop';
            window.history.replaceState(null, '', qs.toString() ? `${basePath}?${qs}` : basePath);
          } catch {}
        }

        useEffect(() => {
          setLoading(true);
          const { search, categorySlug, sort, page } = params;
          const [sortField, sortDir] = sort.split('_');
          const qs = new URLSearchParams({
            active: '1', pageSize: String(pageSize), page: String(page),
            sortBy: sortField === 'price' ? 'price' : 'name',
            sortDir: sortDir || 'asc',
          });
          if (search)       qs.set('search',        search);
          if (categorySlug) qs.set('category_slug', categorySlug);
          fetch(`${API_BASE}/pub/products?${qs}`)
            .then(r => r.json())
            .then(d => { setProducts(d.rows || []); setTotal(d.total || 0); })
            .catch(() => { setProducts([]); setTotal(0); })
            .finally(() => setLoading(false));
        }, [params, pageSize]);

        useEffect(() => {
          fetch(`${API_BASE}/pub/products/categories`)
            .then(r => r.json())
            .then(d => setCategories(d || []))
            .catch(() => {});
        }, []);

        const totalPages = Math.ceil(total / pageSize);
        const { search, categorySlug, sort, page } = params;

        return (
          <div style={{ background: bgColor || 'transparent' }}>
            {/* Filters */}
            <div style={{ background: '#f8f9fa', borderBottom: '1px solid #dee2e6', padding: '1rem 0' }}>
              <div className="container">
                <div className="row g-3 align-items-center">
                  <div className="col-md-4">
                    <input
                      type="text" className="form-control" placeholder="Search products…"
                      value={search}
                      onChange={e => setParam('search', e.target.value)}
                    />
                  </div>
                  <div className="col-md-3">
                    <select className="form-select" value={categorySlug} onChange={e => setParam('categorySlug', e.target.value)}>
                      <option value="">All Categories</option>
                      {categories.map(c => <option key={c.id} value={c.slug}>{c.name}</option>)}
                    </select>
                  </div>
                  <div className="col-md-3">
                    <select className="form-select" value={sort} onChange={e => setParam('sort', e.target.value)}>
                      <option value="name_asc">Name A–Z</option>
                      <option value="name_desc">Name Z–A</option>
                      <option value="price_asc">Price: Low to High</option>
                      <option value="price_desc">Price: High to Low</option>
                    </select>
                  </div>
                  <div className="col-md-2 text-muted small text-end">
                    {loading ? 'Loading…' : `${total} product${total !== 1 ? 's' : ''}`}
                  </div>
                </div>
              </div>
            </div>

            {/* Grid */}
            <div className="py-5">
              <div className="container">
                {loading ? (
                  <div className="text-center py-5"><div className="spinner-border" style={{ color: accent }} /></div>
                ) : products.length === 0 ? (
                  <div className="text-center py-5">
                    <p className="text-muted fs-5">No products found.</p>
                    <button className="btn btn-outline-secondary" onClick={() => { setParams({ search: '', categorySlug: '', sort: 'name_asc', page: 1 }); try { window.history.replaceState(null, '', '/shop'); } catch {} }}>Clear Filters</button>
                  </div>
                ) : (
                  <div className="row g-4">
                    {products.map(p => (
                      <div key={p.id} className={colClass}>
                        <div className="card border-0 shadow-sm h-100" style={{ '--bs-card-border-radius': cardRadius ?? '8px', '--bs-card-inner-border-radius': cardRadius ?? '8px' }}>
                          <img
                            src={p.primary_image || '/images/placeholder-product.jpg'}
                            alt={p.name}
                            className="card-img-top"
                            style={{ height: 200, objectFit: 'cover' }}
                            onError={e => { e.target.src = '/images/placeholder-product.jpg'; }}
                          />
                          <div className="card-body p-3 d-flex flex-column">
                            <p className="text-muted small mb-1">{p.category_name || ''}</p>
                            <h6 className="fw-semibold mb-1 flex-grow-1">{p.name}</h6>
                            {showPrice !== 'no' && (
                              <p className="fw-bold mb-3" style={{ color: accent }}>
                                ${Number(p.price || 0).toFixed(2)}
                              </p>
                            )}
                            <a href={`/shop/${p.slug}`} className="btn btn-sm w-100 fw-semibold" style={{ backgroundColor: accent, color: '#fff', border: 'none' }}>
                              View Details
                            </a>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {totalPages > 1 && (
                  <nav className="d-flex justify-content-center gap-3 mt-5">
                    <button className="btn btn-outline-secondary fw-semibold px-4" disabled={page <= 1} onClick={() => setParam('page', String(page - 1))}>← Previous</button>
                    <span className="d-flex align-items-center text-muted small">Page {page} of {totalPages}</span>
                    <button className="btn btn-outline-secondary fw-semibold px-4" disabled={page >= totalPages} onClick={() => setParam('page', String(page + 1))}>Next →</button>
                  </nav>
                )}
              </div>
            </div>
          </div>
        );
      },
    },

    // ── Product List ────────────────────────────────────────────────────────
    ProductList: {
      label: 'Product List',
      fields: {
        heading:     { type: 'text',   label: 'Section Heading' },
        subheading:  { type: 'text',   label: 'Subheading' },
        categoryId:  { type: 'text',   label: 'Category ID (blank = all)' },
        limit:       { type: 'select', label: 'Products to Show', options: [
          { label: '4', value: 4 }, { label: '8', value: 8 },
          { label: '12', value: 12 }, { label: '24', value: 24 },
        ]},
        columns:     { type: 'select', label: 'Columns', options: [
          { label: '2', value: 2 }, { label: '3', value: 3 }, { label: '4', value: 4 },
        ]},
        showPrice:   { type: 'select', label: 'Show Price', options: [{ label: 'Yes', value: 'yes' }, { label: 'No', value: 'no' }] },
        btnText:     { type: 'text',   label: 'Button Text' },
        viewAllUrl:  { type: 'text',   label: 'View All Link (optional)' },
        cardRadius:  cardRadiusField(),
        bgColor:     colorField('Background Color'),
        accentColor: colorField('Accent / Button Color'),
      },
      defaultProps: {
        heading: 'Shop Our Products', subheading: '', categoryId: '',
        limit: 8, columns: 4, showPrice: 'yes', btnText: 'View Details',
        viewAllUrl: '/shop', cardRadius: '6px', bgColor: '', accentColor: '#C9A227',
      },
      render: function ProductListBlock({ heading, subheading, categoryId, limit, columns, showPrice, btnText, viewAllUrl, cardRadius, bgColor, accentColor }) {
        const [products, setProducts] = useState([]);
        const [loading,  setLoading]  = useState(true);
        const accent = accentColor || '#C9A227';
        const cols   = Number(columns) || 4;
        const colClass = { 2: 'col-sm-6', 3: 'col-sm-6 col-lg-4', 4: 'col-sm-6 col-xl-3' }[cols] || 'col-sm-6 col-xl-3';

        useEffect(() => {
          const params = new URLSearchParams({ pageSize: String(limit || 8), page: '1' });
          if (categoryId) params.set('category_id', categoryId);
          fetch(`${API_BASE}/pub/products?${params}`)
            .then(r => r.json())
            .then(d => setProducts(d.rows || []))
            .catch(() => {})
            .finally(() => setLoading(false));
        }, [categoryId, limit]);

        return (
          <section style={{ background: bgColor || 'transparent', padding: '3rem 0' }}>
            <div className="container">
              {(heading || subheading) && (
                <div className="text-center mb-4">
                  {heading && <h2 style={{ fontWeight: 800, marginBottom: '0.5rem' }}>{heading}</h2>}
                  {subheading && <p className="text-muted">{subheading}</p>}
                </div>
              )}
              {loading ? (
                <div className="text-center py-4"><div className="spinner-border" style={{ color: accent }} /></div>
              ) : (
                <div className="row g-4">
                  {products.map(p => (
                    <div key={p.id} className={colClass}>
                      <a href={`/shop/${p.slug}`} style={{ textDecoration: 'none', color: 'inherit' }}>
                        <div className="card h-100 border-0 shadow-sm" style={{ transition: 'transform 0.2s,box-shadow 0.2s', '--bs-card-border-radius': cardRadius ?? '6px', '--bs-card-inner-border-radius': cardRadius ?? '6px' }}
                          onMouseEnter={e => { e.currentTarget.style.transform='translateY(-3px)'; e.currentTarget.style.boxShadow='0 6px 24px rgba(0,0,0,0.13)'; }}
                          onMouseLeave={e => { e.currentTarget.style.transform=''; e.currentTarget.style.boxShadow=''; }}>
                          <div style={{ height: 200, overflow: 'hidden', background: '#f5f5f5', borderRadius: `${cardRadius ?? '6px'} ${cardRadius ?? '6px'} 0 0` }}>
                            <img src={p.primary_image ? resolveUrl(p.primary_image) : '/images/placeholder-product.jpg'} alt={p.name}
                              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                              onError={e => { e.target.src = '/images/placeholder-product.jpg'; }} />
                          </div>
                          <div className="card-body d-flex flex-column p-3">
                            <h6 className="fw-bold mb-1" style={{ lineHeight: 1.3, fontSize: '0.9rem' }}>{p.name}</h6>
                            {showPrice !== 'no' && p.price > 0 && (
                              <p className="mb-2" style={{ color: accent, fontWeight: 700 }}>
                                ${Number(p.price).toFixed(2)}
                              </p>
                            )}
                            <div className="mt-auto">
                              <span className="btn btn-sm w-100" style={{ background: accent, color: '#fff', fontWeight: 600, fontSize: '0.8rem' }}>
                                {btnText || 'View Details'}
                              </span>
                            </div>
                          </div>
                        </div>
                      </a>
                    </div>
                  ))}
                </div>
              )}
              {viewAllUrl && (
                <div className="text-center mt-4">
                  <a href={viewAllUrl} className="btn btn-outline-secondary px-4">View All Products →</a>
                </div>
              )}
            </div>
          </section>
        );
      },
    },

    // ── Product Detail ───────────────────────────────────────────────────────
    ProductDetail: {
      label: 'Product Detail',
      fields: {
        productSlug: { type: 'text', label: 'Product Slug (leave blank to use URL slug)' },
        showDesc:    { type: 'select', label: 'Show Description', options: [{ label: 'Yes', value: 'yes' }, { label: 'No', value: 'no' }] },
        imageRadius: imageRadiusField(),
        accentColor: colorField('Accent / Button Color'),
      },
      defaultProps: { productSlug: '', showDesc: 'yes', imageRadius: '4px', accentColor: '#C9A227' },
      render: function ProductDetailBlock({ productSlug, showDesc, imageRadius, accentColor }) {
        const [product, setProduct]   = useState(null);
        const [loading, setLoading]   = useState(true);
        const [notFound, setNotFound] = useState(false);
        const accent = accentColor || '#C9A227';

        useEffect(() => {
          const slug = productSlug || window.location.pathname.split('/').filter(Boolean).pop();
          if (!slug) { setLoading(false); return; }
          fetch(`${API_BASE}/pub/products/by-slug/${slug}`)
            .then(r => { if (!r.ok) throw new Error(); return r.json(); })
            .then(d => setProduct(d))
            .catch(() => setNotFound(true))
            .finally(() => setLoading(false));
        }, [productSlug]);

        if (loading) return <div className="text-center py-5"><div className="spinner-border" style={{ color: accent }} /></div>;
        if (notFound || !product) return <div className="container py-5 text-center text-muted">Product not found.</div>;

        const images = product.images || [];
        const primary = images.find(i => i.is_primary) || images[0];

        return (
          <section className="py-5">
            <div className="container">
              <div className="row g-5 align-items-start">
                <div className="col-md-6">
                  {primary ? (
                    <img src={resolveUrl(primary.url)} alt={product.name}
                      className="img-fluid shadow-sm" style={{ width: '100%', objectFit: 'contain', maxHeight: 460, borderRadius: imageRadius ?? '4px' }}
                      onError={e => { e.target.src = '/images/placeholder-product.jpg'; }} />
                  ) : (
                    <div className="bg-light d-flex align-items-center justify-content-center" style={{ height: 360, borderRadius: imageRadius ?? '4px' }}>
                      <span className="text-muted">No image</span>
                    </div>
                  )}
                  {images.length > 1 && (
                    <div className="d-flex gap-2 mt-3 flex-wrap">
                      {images.map((img, i) => (
                        <img key={i} src={resolveUrl(img.url)} alt="" style={{ width: 64, height: 64, objectFit: 'cover', borderRadius: imageRadius ?? '4px', cursor: 'pointer', border: img === primary ? `2px solid ${accent}` : '2px solid #dee2e6' }} />
                      ))}
                    </div>
                  )}
                </div>
                <div className="col-md-6">
                  {product.category_name && <p className="text-uppercase fw-semibold mb-1" style={{ color: accent, fontSize: '0.8rem', letterSpacing: '0.08em' }}>{product.category_name}</p>}
                  <h1 className="fw-bold mb-3" style={{ fontSize: '1.8rem' }}>{product.name}</h1>
                  {product.price > 0 && (
                    <p className="mb-3" style={{ fontSize: '1.6rem', fontWeight: 800, color: accent }}>
                      ${Number(product.price).toFixed(2)}
                      {product.compare_price > product.price && (
                        <span className="text-muted text-decoration-line-through ms-2" style={{ fontSize: '1rem', fontWeight: 400 }}>
                          ${Number(product.compare_price).toFixed(2)}
                        </span>
                      )}
                    </p>
                  )}
                  {product.short_desc && <p className="text-muted mb-4">{product.short_desc}</p>}
                  <a href={`/shop/${product.slug}`} className="btn btn-lg px-5 mb-4" style={{ background: accent, color: '#fff', fontWeight: 700 }}>
                    View in Shop →
                  </a>
                  {showDesc !== 'no' && product.description && (
                    <div className="mt-4 pt-4 border-top" dangerouslySetInnerHTML={{ __html: product.description }} />
                  )}
                </div>
              </div>
            </div>
          </section>
        );
      },
    },

    // ── Donation Card — two-column quick-donate UI (amounts, designation,
    // donor info) wired to the real donation checkout. One-time gifts create
    // a synthetic invoice and <DonationCheckout> renders whichever gateway is
    // active (Valor inline Passage.js or Auth.net hosted iframe). Monthly
    // gifts go through <DonationRecurringCheckout> instead, which vaults the
    // card and creates a subscriptions row billing-cron.js auto-charges each
    // cycle — Valor only for now (see DonationRecurringCheckout's header). ──
    DonationCard: {
      label: 'Donation Card',
      fields: {
        eyebrow:        { type: 'text',     label: 'Eyebrow Label' },
        heading:        { type: 'text',     label: 'Heading' },
        description:    { type: 'textarea', label: 'Description' },
        amounts:        { type: 'text',     label: 'Quick Amounts (comma-separated dollar values)' },
        showCoverFees:  { type: 'select', label: 'Show "Cover processing fees" checkbox', options: [{ label: 'Yes', value: 'yes' }, { label: 'No', value: 'no' }] },
        coverFeesLabel: { type: 'text', label: 'Cover-fees Checkbox Label' },
        showMonthlyOption: { type: 'select', label: 'Show "Monthly Recurring" checkbox', options: [{ label: 'Yes', value: 'yes' }, { label: 'No', value: 'no' }] },
        monthlyLabel:   { type: 'text', label: 'Monthly Checkbox Label' },
        submitText:     { type: 'text', label: 'Submit Button Text' },
        disclaimerText: { type: 'text', label: 'Disclaimer Text (below button)' },
        successMessage: { type: 'textarea', label: 'Message shown after a completed donation' },
        bgColor:        colorField('Card Background Color'),
        sectionBgColor: colorField('Section Background Color (outside the card)'),
        accentColor:    colorField('Accent Color (eyebrow + amount button selection)'),
        headingColor:   colorField('Heading Color'),
        textColor:      colorField('Description / Label Text Color'),
        btnColor:       colorField('Submit Button Color'),
        btnTextColor:   colorField('Submit Button Text Color'),
        btnRadius:      btnRadiusField(),
        cardRadius:     cardRadiusField(),
        animation:      animField(),
        animDelay:      animDelayField(),
      },
      defaultProps: {
        eyebrow: 'DIRECT IMPACT',
        heading: 'Make a Donation',
        description: "100% of every gift supports grants, training facilities, Shop with a Cop, scholarships, and community events. Designate your gift or let us direct it where it's needed most.",
        amounts: '25,50,100,250,500',
        showCoverFees: 'yes',
        coverFeesLabel: 'Add a little extra to cover processing fees',
        showMonthlyOption: 'yes',
        monthlyLabel: 'Make this a monthly recurring gift',
        submitText: 'Donate Securely',
        disclaimerText: 'Payments processed securely. Tax receipt sent automatically.',
        successMessage: 'Thank you for your generous gift! A receipt has been sent to your email.',
        bgColor: '#ffffff',
        sectionBgColor: 'transparent',
        accentColor: '#C9A227',
        headingColor: '#0A1F3D',
        textColor: '#4b5563',
        btnColor: '#C9A227',
        btnTextColor: '#0A1F3D',
        btnRadius: '16px',
        cardRadius: '24px',
        animation: 'none',
        animDelay: '0',
      },
      render: ({ eyebrow, heading, description, amounts, showCoverFees, coverFeesLabel,
                 showMonthlyOption, monthlyLabel,
                 submitText, disclaimerText, successMessage, bgColor, sectionBgColor, accentColor,
                 headingColor, textColor, btnColor, btnTextColor, btnRadius, cardRadius, animation, animDelay }) => {
        const [stage, setStage]         = useState('form'); // 'form' | 'checkout' | 'success'
        const [funds, setFunds]         = useState([]);
        const [selected, setSelected]   = useState(null);
        const [custom, setCustom]       = useState('');
        const [fundSlug, setFundSlug]   = useState('');
        const [firstName, setFirstName] = useState('');
        const [lastName, setLastName]   = useState('');
        const [email, setEmail]         = useState('');
        const [coverFees, setCoverFees] = useState(false);
        const [feeInfo, setFeeInfo]     = useState(null); // { active, fee_percent, fee_fixed }
        const [isMonthly, setIsMonthly] = useState(false);
        const [submitting, setSubmitting] = useState(false);
        const [error, setError]         = useState('');
        const [checkoutInfo, setCheckoutInfo] = useState(null); // { invoiceId, total } (one-time) or { recurring: true, amount } (monthly)
        const [source, setSource]       = useState('form'); // 'form' | 'sms' — set from ?src= on load, e.g. Text-to-Give reply links
        const [portalToken, setPortalToken] = useState(null); // lc_token, when a donor is logged into the portal
        const amountList = (amounts || '').split(',').map(a => a.trim()).filter(Boolean);
        const inputStyle = { width: '100%', padding: '0.75rem 1rem', border: '1px solid #dde1e7', borderRadius: '16px', fontSize: '0.9rem', boxSizing: 'border-box' };

        // Pre-fill from URL (?fund=<slug>&amount=<n>&src=sms) — used by
        // Text-to-Give reply links and any other campaign link that wants to
        // land a donor on a pre-selected fund/amount. Plain URLSearchParams
        // rather than react-router's useSearchParams since this block also
        // renders inside the Puck builder canvas (SitePreviewShell), which
        // isn't necessarily wrapped in a Router.
        useEffect(() => {
          if (typeof window === 'undefined') return;
          const params = new URLSearchParams(window.location.search);
          const urlFund = params.get('fund');
          const urlAmount = Number(params.get('amount'));
          const urlSrc = params.get('src');
          if (urlFund) setFundSlug(urlFund);
          if (urlAmount > 0) setCustom(String(urlAmount));
          if (urlSrc === 'sms') setSource('sms');
        }, []);

        useEffect(() => {
          fetch(`${API_BASE}/donations/public/funds`)
            .then(r => r.ok ? r.json() : [])
            .then(data => setFunds(Array.isArray(data) ? data : []))
            .catch(() => setFunds([]));
          fetch(`${API_BASE}/donations/public/fee-info`)
            .then(r => r.ok ? r.json() : null)
            .then(data => { if (data) { setFeeInfo(data); setCoverFees(Boolean(data.active)); } })
            .catch(() => {});
        }, []);

        // If a donor is already logged into the portal, prefill their name/
        // email from their profile and route the eventual submit through the
        // portal's own /donations/checkout — that guarantees the resulting
        // invoice links to their real contact_id (not a best-effort email
        // match), which is what makes the saved-card charge inside
        // <DonationCheckout> reliable rather than coincidental.
        useEffect(() => {
          if (typeof window === 'undefined') return;
          const token = window.localStorage.getItem('lc_token');
          if (!token) return;
          fetch(`${API_BASE}/portal/me`, { headers: { Authorization: `Bearer ${token}` } })
            .then(r => r.ok ? r.json() : null)
            .then(data => {
              if (!data?.contact) return;
              setPortalToken(token);
              setFirstName(data.contact.first_name || '');
              setLastName(data.contact.last_name || '');
              setEmail(data.contact.email || '');
            })
            .catch(() => {}); // not logged in, or no portal access — anonymous form unchanged
        }, []);

        const donationAmount = Number(custom || selected) || 0;
        const feeAmount = (feeInfo?.active && showCoverFees === 'yes' && coverFees)
          ? Math.round((donationAmount * (Number(feeInfo.fee_percent) / 100) + Number(feeInfo.fee_fixed)) * 100) / 100
          : 0;
        const totalWithFee = Math.round((donationAmount + feeAmount) * 100) / 100;

        async function handleSubmit(e) {
          e.preventDefault();
          const amount = Number(custom || selected);
          if (!amount || amount <= 0) { setError('Please choose or enter a donation amount.'); return; }
          if (!email) { setError('Email is required.'); return; }
          setError('');

          if (showMonthlyOption === 'yes' && isMonthly) {
            // Recurring gifts vault the card + charge the first cycle in one
            // request (DonationRecurringCheckout) — no separate checkout-session
            // call needed here, just hand off the details collected so far.
            setCheckoutInfo({
              recurring: true, amount,
              donor: { first_name: firstName, last_name: lastName, email },
              source,
            });
            setStage('checkout');
            return;
          }


          setSubmitting(true);
          try {
            // Logged-into-the-portal donors route through the authenticated
            // endpoint so the resulting invoice links to their real contact_id
            // (see the useEffect above) rather than a donor-supplied email —
            // everything downstream (checkoutInfo, <DonationCheckout>, finalize)
            // is identical either way, since both endpoints return the same shape.
            const url = portalToken ? `${API_BASE}/portal/donations/checkout` : `${API_BASE}/donations/public/checkout`;
            const headers = { 'Content-Type': 'application/json' };
            if (portalToken) headers.Authorization = `Bearer ${portalToken}`;
            const body = portalToken
              ? { amount, fund_slug: fundSlug || null, cover_fees: showCoverFees === 'yes' && coverFees }
              : {
                  amount, fund_slug: fundSlug || null,
                  donor: { first_name: firstName, last_name: lastName, email },
                  cover_fees: showCoverFees === 'yes' && coverFees,
                };
            const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Could not start checkout');
            setCheckoutInfo({ invoiceId: data.invoiceId, total: data.total, contactId: data.contactId });
            setStage('checkout');
          } catch (err) {
            setError(err.message || 'Something went wrong. Please try again.');
          } finally {
            setSubmitting(false);
          }
        }

        async function handlePaymentSuccess() {
          try {
            await fetch(`${API_BASE}/donations/public/finalize/${checkoutInfo.invoiceId}`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ fund_slug: fundSlug || null, source }),
            });
          } catch { /* the payment already captured — finalize is best-effort tagging */ }
          setStage('success');
        }

        return (
          <AnimatedBlock animation={animation} delay={Number(animDelay) || 0}
            style={{ background: sectionBgColor || 'transparent', padding: '2.5rem 1.5rem' }}>
            <div style={{ maxWidth: 1200, margin: '0 auto', background: bgColor || '#fff', borderRadius: cardRadius ?? '24px', padding: 'clamp(1.75rem, 4vw, 3rem)', border: '1px solid #e5e5e5' }}>
            <style>{`
              @media (max-width: 768px) {
                .lit-donation-split { grid-template-columns: 1fr !important; }
              }
            `}</style>
              <div className="lit-donation-split" style={{ display: 'grid', gridTemplateColumns: '5fr 7fr', gap: '2rem' }}>
                <div>
                  {eyebrow && <div style={{ textTransform: 'uppercase', letterSpacing: '0.15em', fontSize: '0.72rem', fontWeight: 700, color: accentColor || '#C9A227' }}>{eyebrow}</div>}
                  {heading && <h2 style={{ fontFamily: "'Playfair Display', Georgia, serif", fontWeight: 700, fontSize: 'clamp(1.75rem,3vw,2.25rem)', letterSpacing: '-1px', color: headingColor || '#0A1F3D', marginTop: '0.5rem' }}>{heading}</h2>}
                  {description && <p style={{ marginTop: '1rem', fontSize: '0.9rem', color: textColor || '#4b5563' }}>{description}</p>}
                </div>
                <div>
                  {stage === 'success' ? (
                    <div style={{ padding: '2rem', textAlign: 'center' }}>
                      <p style={{ fontSize: '1rem', color: headingColor || '#0A1F3D', fontWeight: 600 }}>{successMessage}</p>
                      <PortalSignupPrompt email={email} accentColor={accentColor} />
                    </div>
                  ) : stage === 'checkout' && checkoutInfo?.recurring ? (
                    <div>
                      <DonationRecurringCheckout
                        donation={{
                          amount: checkoutInfo.amount, fundSlug, donor: checkoutInfo.donor,
                          isAnonymous: false, intervalUnit: 'month', intervalCount: 1,
                          source: checkoutInfo.source || source,
                        }}
                        onSuccess={() => setStage('success')}
                        onError={(message) => setError(message)}
                        onCancel={() => setStage('form')}
                      />
                      {error && <p style={{ color: '#b42318', fontSize: '0.85rem', marginTop: '0.75rem' }}>{error}</p>}
                    </div>
                  ) : stage === 'checkout' ? (
                    <div>
                      <DonationCheckout
                        invoiceId={checkoutInfo.invoiceId}
                        chargeAmount={checkoutInfo.total}
                        currency="USD"
                        contactId={checkoutInfo.contactId}
                        allowSaveCard
                        saveCardLabel="Save this card for future donations"
                        onSuccess={handlePaymentSuccess}
                        onDeclined={({ message }) => setError(message || 'Payment declined.')}
                        onCancel={() => setStage('form')}
                      />
                      {error && <p style={{ color: '#b42318', fontSize: '0.85rem', marginTop: '0.75rem' }}>{error}</p>}
                    </div>
                  ) : (
                    <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(64px, 1fr))', gap: '0.5rem' }}>
                        {amountList.map(amt => (
                          <button key={amt} type="button" onClick={() => { setSelected(amt); setCustom(''); }}
                            style={{
                              padding: '0.75rem 0', borderRadius: 16, fontSize: '0.9rem', cursor: 'pointer',
                              border: `1px solid ${selected === amt ? (accentColor || '#C9A227') : '#dde1e7'}`,
                              background: selected === amt ? (accentColor || '#C9A227') : 'transparent',
                              color: selected === amt ? '#ffffff' : 'inherit',
                              fontWeight: selected === amt ? 700 : 400,
                            }}>${amt}</button>
                        ))}
                      </div>
                      <input type="number" placeholder="Enter custom amount" value={custom} style={inputStyle}
                        onChange={e => { setCustom(e.target.value); setSelected(null); }} />
                      {funds.length > 0 && (
                        <select style={inputStyle} value={fundSlug} onChange={e => setFundSlug(e.target.value)}>
                          <option value="">Where needed most</option>
                          {funds.map(f => <option key={f.id} value={f.slug}>{f.name}</option>)}
                        </select>
                      )}
                      {portalToken && (
                        <p style={{ fontSize: '0.85rem', color: textColor || '#4b5563', margin: 0 }}>
                          Giving as {firstName} {lastName} ({email}) — not you? Edit the fields below.
                        </p>
                      )}
                      <div className="lit-responsive-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                        <input required placeholder="First Name" style={inputStyle} value={firstName} onChange={e => setFirstName(e.target.value)} />
                        <input required placeholder="Last Name" style={inputStyle} value={lastName} onChange={e => setLastName(e.target.value)} />
                      </div>
                      <input required type="email" placeholder="Email" style={inputStyle} value={email} onChange={e => setEmail(e.target.value)} />
                      {showMonthlyOption === 'yes' && (
                        <label style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', fontSize: '0.9rem', color: textColor || '#4b5563' }}>
                          <input type="checkbox" checked={isMonthly} style={{ accentColor: accentColor || '#C9A227' }}
                            onChange={e => setIsMonthly(e.target.checked)} />
                          {monthlyLabel}
                        </label>
                      )}
                      {showCoverFees === 'yes' && !isMonthly && feeInfo?.active && (
                        <>
                          <label style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', fontSize: '0.9rem', color: textColor || '#4b5563' }}>
                            <input type="checkbox" checked={coverFees} style={{ accentColor: accentColor || '#C9A227' }}
                              onChange={e => setCoverFees(e.target.checked)} />
                            {coverFeesLabel}
                          </label>
                          {donationAmount > 0 && (
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', color: textColor || '#4b5563', padding: '0.5rem 0.75rem', background: 'rgba(0,0,0,0.03)', borderRadius: 12 }}>
                              <span>{coverFees ? 'Total charge (includes fee)' : 'Donation amount'}</span>
                              <strong>${(coverFees ? totalWithFee : donationAmount).toFixed(2)}</strong>
                            </div>
                          )}
                        </>
                      )}
                      {error && <p style={{ color: '#b42318', fontSize: '0.85rem', margin: 0 }}>{error}</p>}
                      <button type="submit" disabled={submitting} style={{ padding: '1rem', borderRadius: btnRadius ?? '16px', border: 'none', background: btnColor || '#C9A227', color: btnTextColor || '#0A1F3D', fontWeight: 700, fontSize: '1rem', cursor: 'pointer', opacity: submitting ? 0.7 : 1 }}>
                        {submitting ? 'Please wait…' : submitText}
                      </button>
                      {disclaimerText && <p style={{ textAlign: 'center', fontSize: '0.75rem', color: '#9ca3af' }}>{disclaimerText}</p>}
                    </form>
                  )}
                </div>
              </div>
            </div>
          </AnimatedBlock>
        );
      },
    },

    // ── Membership Card — tier picker + signup, wired to real membership
    // tiers and checkout (vault card, charge first cycle, auto-renew via
    // billing-cron.js). Mirrors DonationCard's real-checkout wiring. ───────
    MembershipCard: {
      label: 'Membership Card',
      fields: {
        eyebrow:        { type: 'text',     label: 'Eyebrow Label' },
        heading:        { type: 'text',     label: 'Heading' },
        description:    { type: 'textarea', label: 'Description' },
        submitText:     { type: 'text', label: 'Submit Button Text' },
        disclaimerText: { type: 'text', label: 'Disclaimer Text (below button)' },
        successMessage: { type: 'textarea', label: 'Message shown after a completed signup' },
        bgColor:        colorField('Card Background Color'),
        sectionBgColor: colorField('Section Background Color (outside the card)'),
        accentColor:    colorField('Accent Color'),
        headingColor:   colorField('Heading Color'),
        textColor:      colorField('Description / Label Text Color'),
        btnColor:       colorField('Submit Button Color'),
        btnTextColor:   colorField('Submit Button Text Color'),
        btnRadius:      btnRadiusField(),
        cardRadius:     cardRadiusField(),
        animation:      animField(),
        animDelay:      animDelayField(),
      },
      defaultProps: {
        eyebrow: 'JOIN US',
        heading: 'Become a Member',
        description: 'Choose a membership level below — your support funds our year-round programs, and membership renews automatically each period.',
        submitText: 'Join Now',
        disclaimerText: 'Payments processed securely. Cancel anytime.',
        successMessage: 'Welcome! Your membership is active and a receipt has been sent to your email.',
        bgColor: '#ffffff',
        sectionBgColor: 'transparent',
        accentColor: '#C9A227',
        headingColor: '#0A1F3D',
        textColor: '#4b5563',
        btnColor: '#C9A227',
        btnTextColor: '#0A1F3D',
        btnRadius: '16px',
        cardRadius: '24px',
        animation: 'none',
        animDelay: '0',
      },
      render: ({ eyebrow, heading, description, submitText, disclaimerText, successMessage,
                 bgColor, sectionBgColor, accentColor, headingColor, textColor, btnColor, btnTextColor,
                 btnRadius, cardRadius, animation, animDelay }) => {
        const [stage, setStage]         = useState('form'); // 'form' | 'checkout' | 'success'
        const [tiers, setTiers]         = useState([]);
        const [tierSlug, setTierSlug]   = useState('');
        const [firstName, setFirstName] = useState('');
        const [lastName, setLastName]   = useState('');
        const [email, setEmail]         = useState('');
        const [submitting, setSubmitting] = useState(false);
        const [error, setError]         = useState('');
        const inputStyle = { width: '100%', padding: '0.75rem 1rem', border: '1px solid #dde1e7', borderRadius: '16px', fontSize: '0.9rem', boxSizing: 'border-box' };

        useEffect(() => {
          fetch(`${API_BASE}/membership/public/tiers`)
            .then(r => r.ok ? r.json() : [])
            .then(data => {
              const list = Array.isArray(data) ? data : [];
              setTiers(list);
              if (list.length) setTierSlug(list[0].slug);
            })
            .catch(() => setTiers([]));
        }, []);

        function handleSubmit(e) {
          e.preventDefault();
          if (!tierSlug) { setError('Please choose a membership level.'); return; }
          if (!email) { setError('Email is required.'); return; }
          setError('');
          setStage('checkout');
        }

        const selectedTier = tiers.find(t => t.slug === tierSlug);

        return (
          <AnimatedBlock animation={animation} delay={Number(animDelay) || 0}
            style={{ background: sectionBgColor || 'transparent', padding: '2.5rem 1.5rem' }}>
            <div style={{ maxWidth: 1200, margin: '0 auto', background: bgColor || '#fff', borderRadius: cardRadius ?? '24px', padding: 'clamp(1.75rem, 4vw, 3rem)', border: '1px solid #e5e5e5' }}>
            <style>{`
              @media (max-width: 768px) {
                .lit-membership-split { grid-template-columns: 1fr !important; }
              }
            `}</style>
              <div className="lit-membership-split" style={{ display: 'grid', gridTemplateColumns: '5fr 7fr', gap: '2rem' }}>
                <div>
                  {eyebrow && <div style={{ textTransform: 'uppercase', letterSpacing: '0.15em', fontSize: '0.72rem', fontWeight: 700, color: accentColor || '#C9A227' }}>{eyebrow}</div>}
                  {heading && <h2 style={{ fontFamily: "'Playfair Display', Georgia, serif", fontWeight: 700, fontSize: 'clamp(1.75rem,3vw,2.25rem)', letterSpacing: '-1px', color: headingColor || '#0A1F3D', marginTop: '0.5rem' }}>{heading}</h2>}
                  {description && <p style={{ marginTop: '1rem', fontSize: '0.9rem', color: textColor || '#4b5563' }}>{description}</p>}
                  {selectedTier?.benefits_json && (
                    <ul style={{ marginTop: '1rem', paddingLeft: '1.25rem', fontSize: '0.85rem', color: textColor || '#4b5563' }}>
                      {(Array.isArray(selectedTier.benefits_json) ? selectedTier.benefits_json : []).map((b, i) => <li key={i}>{b}</li>)}
                    </ul>
                  )}
                </div>
                <div>
                  {stage === 'success' ? (
                    <div style={{ padding: '2rem', textAlign: 'center' }}>
                      <p style={{ fontSize: '1rem', color: headingColor || '#0A1F3D', fontWeight: 600 }}>{successMessage}</p>
                      <PortalSignupPrompt email={email} accentColor={accentColor} />
                    </div>
                  ) : stage === 'checkout' ? (
                    <div>
                      <MembershipCheckout
                        signup={{ tierSlug, donor: { first_name: firstName, last_name: lastName, email } }}
                        onSuccess={() => setStage('success')}
                        onError={(message) => setError(message)}
                        onCancel={() => setStage('form')}
                      />
                      {error && <p style={{ color: '#b42318', fontSize: '0.85rem', marginTop: '0.75rem' }}>{error}</p>}
                    </div>
                  ) : (
                    <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                      {tiers.length > 0 ? (
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '0.5rem' }}>
                          {tiers.map(t => (
                            <button key={t.slug} type="button" onClick={() => setTierSlug(t.slug)}
                              style={{
                                padding: '0.75rem', borderRadius: 16, fontSize: '0.85rem', cursor: 'pointer', textAlign: 'left',
                                border: `1px solid ${tierSlug === t.slug ? (accentColor || '#C9A227') : '#dde1e7'}`,
                                background: tierSlug === t.slug ? (accentColor || '#C9A227') : 'transparent',
                                color: tierSlug === t.slug ? '#ffffff' : 'inherit',
                              }}>
                              <div style={{ fontWeight: 700 }}>{t.name}</div>
                              <div>${Number(t.price).toFixed(0)}/{t.interval_unit}</div>
                            </button>
                          ))}
                        </div>
                      ) : (
                        <p style={{ fontSize: '0.85rem', color: '#9ca3af' }}>No membership tiers are available yet.</p>
                      )}
                      <div className="lit-responsive-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                        <input required placeholder="First Name" style={inputStyle} value={firstName} onChange={e => setFirstName(e.target.value)} />
                        <input required placeholder="Last Name" style={inputStyle} value={lastName} onChange={e => setLastName(e.target.value)} />
                      </div>
                      <input required type="email" placeholder="Email" style={inputStyle} value={email} onChange={e => setEmail(e.target.value)} />
                      {error && <p style={{ color: '#b42318', fontSize: '0.85rem', margin: 0 }}>{error}</p>}
                      <button type="submit" disabled={submitting || !tiers.length} style={{ padding: '1rem', borderRadius: btnRadius ?? '16px', border: 'none', background: btnColor || '#C9A227', color: btnTextColor || '#0A1F3D', fontWeight: 700, fontSize: '1rem', cursor: 'pointer', opacity: submitting ? 0.7 : 1 }}>
                        {submitText}
                      </button>
                      {disclaimerText && <p style={{ textAlign: 'center', fontSize: '0.75rem', color: '#9ca3af' }}>{disclaimerText}</p>}
                    </form>
                  )}
                </div>
              </div>
            </div>
          </AnimatedBlock>
        );
      },
    },

    // ── Membership Tier Grid — one bordered pricing card per real membership
    // tier (fetched from /membership/public/tiers, same data MembershipCard
    // uses), each with its own "Join as X" button. Unlike MembershipCard
    // (a single picker + form), this renders every tier side-by-side as
    // distinct visual cards — the shape most Support/Join pages actually
    // want (see website-files/support.html's 4-tier grid). ──
    MembershipTierGrid: {
      label: 'Membership Tier Grid',
      fields: {
        eyebrow:        { type: 'text', label: 'Eyebrow Label' },
        heading:        { type: 'text', label: 'Heading' },
        featuredSlug:   { type: 'text', label: 'Featured Tier Slug (optional, shows a "POPULAR" ribbon — e.g. "bronze")' },
        footnote:       { type: 'text', label: 'Footnote (below the grid, e.g. fulfillment timing)' },
        submitText:     { type: 'text', label: 'Checkout Button Text' },
        successMessage: { type: 'textarea', label: 'Message shown after a completed signup' },
        bgColor:        colorField('Section Background Color'),
        cardBgColor:    colorField('Card Background Color'),
        accentColor:    colorField('Accent Color'),
        headingColor:   colorField('Heading Color'),
        textColor:      colorField('Body Text Color'),
        btnRadius:      btnRadiusField(),
        cardRadius:     cardRadiusField(),
        animation:      animField(),
        animDelay:      animDelayField(),
      },
      defaultProps: {
        eyebrow: 'MEMBERSHIP',
        heading: "Join the Ventura County Sheriff's Foundation",
        featuredSlug: '',
        footnote: 'Allow 4–6 weeks for fulfillment of physical membership materials.',
        submitText: 'Join Now',
        successMessage: 'Welcome! Your membership is active and a receipt has been sent to your email.',
        bgColor: 'transparent',
        cardBgColor: '#ffffff',
        accentColor: '#C9A227',
        headingColor: '#0A1F3D',
        textColor: '#4b5563',
        btnRadius: '16px',
        cardRadius: '24px',
        animation: 'none',
        animDelay: '0',
      },
      render: ({ eyebrow, heading, featuredSlug, footnote, submitText, successMessage,
                 bgColor, cardBgColor, accentColor, headingColor, textColor, btnRadius, cardRadius, animation, animDelay }) => {
        const [tiers, setTiers] = useState([]);
        const [activeSlug, setActiveSlug] = useState('');
        const [stage, setStage] = useState('form'); // 'form' | 'checkout' | 'success'
        const [firstName, setFirstName] = useState('');
        const [lastName, setLastName] = useState('');
        const [email, setEmail] = useState('');
        const [error, setError] = useState('');
        const acc = accentColor || '#C9A227';
        const inputStyle = { width: '100%', padding: '0.75rem 1rem', border: '1px solid #dde1e7', borderRadius: '16px', fontSize: '0.9rem', boxSizing: 'border-box' };

        useEffect(() => {
          fetch(`${API_BASE}/membership/public/tiers`)
            .then(r => r.ok ? r.json() : [])
            .then(data => setTiers(Array.isArray(data) ? data : []))
            .catch(() => setTiers([]));
        }, []);

        function openTier(slug) {
          setActiveSlug(slug);
          setStage('form');
          setError('');
        }

        function handleSubmit(e) {
          e.preventDefault();
          if (!email) { setError('Email is required.'); return; }
          setError('');
          setStage('checkout');
        }

        const activeTier = tiers.find(t => t.slug === activeSlug);

        return (
          <AnimatedBlock animation={animation} delay={Number(animDelay) || 0} style={{ background: bgColor || 'transparent', padding: '2.5rem 1.5rem' }}>
            <style>{`
              @media (max-width: 900px) { .lit-membertier-grid { grid-template-columns: repeat(2, 1fr) !important; } }
              @media (max-width: 560px) { .lit-membertier-grid { grid-template-columns: 1fr !important; } }
            `}</style>
            <div style={{ maxWidth: 1200, margin: '0 auto' }}>
              {(eyebrow || heading) && (
                <div style={{ marginBottom: 32 }}>
                  {eyebrow && <div style={{ textTransform: 'uppercase', letterSpacing: '2px', fontSize: '0.75rem', fontWeight: 700, color: acc }}>{eyebrow}</div>}
                  {heading && <h2 style={{ fontFamily: "'Playfair Display', Georgia, serif", fontWeight: 700, fontSize: 'clamp(1.75rem,3vw,2.25rem)', letterSpacing: '-1px', color: headingColor || '#0A1F3D', marginTop: 8 }}>{heading}</h2>}
                </div>
              )}
              {tiers.length === 0 ? (
                <p style={{ fontSize: '0.9rem', color: '#9ca3af' }}>No membership tiers are available yet.</p>
              ) : (
                <div className="lit-membertier-grid" style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(tiers.length, 4)}, 1fr)`, gap: '1.5rem' }}>
                  {tiers.map(t => {
                    const featured = featuredSlug && t.slug === featuredSlug;
                    const benefits = Array.isArray(t.benefits_json) ? t.benefits_json : [];
                    return (
                      <div key={t.slug} style={{ position: 'relative', background: cardBgColor || '#fff', border: `1px solid ${featured ? acc : '#e5e5e5'}`, borderRadius: cardRadius ?? '24px', padding: '2rem', height: '100%', display: 'flex', flexDirection: 'column' }}>
                        {featured && (
                          <div style={{ position: 'absolute', top: -10, right: 20, background: acc, color: headingColor || '#0A1F3D', fontSize: '0.65rem', fontWeight: 700, padding: '2px 12px', borderRadius: 4, letterSpacing: '0.05em' }}>POPULAR</div>
                        )}
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: '0.85rem', color: acc, fontWeight: 600, textTransform: 'uppercase' }}>{t.name}</div>
                          <div style={{ marginTop: 12, display: 'flex', alignItems: 'baseline' }}>
                            <span style={{ fontSize: '2rem', fontWeight: 700, color: headingColor || '#0A1F3D' }}>${Number(t.price).toFixed(0)}</span>
                            <span style={{ color: '#9ca3af', marginLeft: 4 }}>/{t.interval_unit}</span>
                          </div>
                          {benefits.length > 0 && (
                            <ul style={{ marginTop: 24, marginBottom: 0, paddingLeft: 0, listStyle: 'none', fontSize: '0.85rem', color: textColor || '#4b5563', display: 'flex', flexDirection: 'column', gap: 8 }}>
                              {benefits.map((b, i) => <li key={i}>• {b}</li>)}
                            </ul>
                          )}
                        </div>
                        <button type="button" onClick={() => openTier(t.slug)}
                          style={{ width: '100%', padding: '0.75rem', borderRadius: btnRadius ?? '16px', border: featured ? 'none' : `1px solid ${headingColor || '#0A1F3D'}`, background: featured ? acc : 'transparent', color: featured ? (headingColor || '#0A1F3D') : 'inherit', fontWeight: 600, fontSize: '0.9rem', cursor: 'pointer', marginTop: 28 }}>
                          Join as {t.name}
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
              {footnote && <p style={{ fontSize: '0.75rem', color: '#9ca3af', marginTop: 16 }}>{footnote}</p>}

              {activeSlug && (
                <div role="dialog" aria-modal="true" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }} onClick={e => { if (e.target === e.currentTarget) setActiveSlug(''); }}>
                  <div style={{ background: '#fff', borderRadius: cardRadius ?? '24px', padding: '2rem', maxWidth: 440, width: '100%', maxHeight: '90vh', overflow: 'auto' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
                      <h3 style={{ margin: 0, color: headingColor || '#0A1F3D' }}>{activeTier?.name || ''} Membership</h3>
                      <button type="button" onClick={() => setActiveSlug('')} aria-label="Close" style={{ background: 'none', border: 'none', fontSize: '1.5rem', cursor: 'pointer', lineHeight: 1, color: '#9ca3af' }}>×</button>
                    </div>
                    {stage === 'success' ? (
                      <div style={{ textAlign: 'center' }}>
                        <p style={{ fontSize: '1rem', color: headingColor || '#0A1F3D', fontWeight: 600 }}>{successMessage}</p>
                        <PortalSignupPrompt email={email} accentColor={acc} />
                      </div>
                    ) : stage === 'checkout' ? (
                      <div>
                        <MembershipCheckout
                          signup={{ tierSlug: activeSlug, donor: { first_name: firstName, last_name: lastName, email } }}
                          onSuccess={() => setStage('success')}
                          onError={(message) => setError(message)}
                          onCancel={() => setStage('form')}
                        />
                        {error && <p style={{ color: '#b42318', fontSize: '0.85rem', marginTop: '0.75rem' }}>{error}</p>}
                      </div>
                    ) : (
                      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                        <div className="lit-responsive-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                          <input required placeholder="First Name" style={inputStyle} value={firstName} onChange={e => setFirstName(e.target.value)} />
                          <input required placeholder="Last Name" style={inputStyle} value={lastName} onChange={e => setLastName(e.target.value)} />
                        </div>
                        <input required type="email" placeholder="Email" style={inputStyle} value={email} onChange={e => setEmail(e.target.value)} />
                        {error && <p style={{ color: '#b42318', fontSize: '0.85rem', margin: 0 }}>{error}</p>}
                        <button type="submit" style={{ padding: '1rem', borderRadius: btnRadius ?? '16px', border: 'none', background: acc, color: headingColor || '#0A1F3D', fontWeight: 700, fontSize: '1rem', cursor: 'pointer' }}>
                          {submitText || 'Join Now'}
                        </button>
                      </form>
                    )}
                  </div>
                </div>
              )}
            </div>
          </AnimatedBlock>
        );
      },
    },

    // ── Event Registration Card — one event at a time, picked via the Event
    // prop or a `?event=<slug>` URL param (for a shared purchase page linked
    // from EventsListBlock). Every ticket type adds a hold to the shared
    // shopping cart and hands off to /cart+/checkout — same pipeline shop
    // orders already use. A $0 cart checks out with one click (no card
    // form); a mix of free and paid tickets checks out together. ──
    EventRegistrationCard: {
      label: 'Event Registration Card',
      fields: {
        eventSlug:      { type: 'custom', label: 'Event', render: ({ value, onChange }) => <EventPickerField value={value} onChange={onChange} /> },
        eyebrow:        { type: 'text',     label: 'Eyebrow Label' },
        heading:        { type: 'text',     label: 'Heading' },
        description:    { type: 'textarea', label: 'Description' },
        submitText:     { type: 'text', label: 'Submit Button Text' },
        disclaimerText: { type: 'text', label: 'Disclaimer Text (below button)' },
        bgColor:        colorField('Card Background Color'),
        sectionBgColor: colorField('Section Background Color (outside the card)'),
        accentColor:    colorField('Accent Color'),
        headingColor:   colorField('Heading Color'),
        textColor:      colorField('Description / Label Text Color'),
        btnColor:       colorField('Submit Button Color'),
        btnTextColor:   colorField('Submit Button Text Color'),
        btnRadius:      btnRadiusField(),
        cardRadius:     cardRadiusField(),
        animation:      animField(),
        animDelay:      animDelayField(),
      },
      defaultProps: {
        eventSlug: '',
        eyebrow: 'SAVE YOUR SPOT',
        heading: 'Register Now',
        description: 'Choose a ticket type below to reserve your spot.',
        submitText: 'Add to Cart',
        disclaimerText: 'Payments processed securely.',
        bgColor: '#ffffff',
        sectionBgColor: 'transparent',
        accentColor: '#C9A227',
        headingColor: '#0A1F3D',
        textColor: '#4b5563',
        btnColor: '#C9A227',
        btnTextColor: '#0A1F3D',
        btnRadius: '16px',
        cardRadius: '24px',
        animation: 'none',
        animDelay: '0',
      },
      render: ({ eventSlug, eyebrow, heading, description, submitText, disclaimerText,
                 bgColor, sectionBgColor, accentColor, headingColor, textColor, btnColor, btnTextColor,
                 btnRadius, cardRadius, animation, animDelay }) => {
        const { addTicket } = useCart();
        const [event, setEvent]         = useState(null);
        const [ticketId, setTicketId]   = useState('');
        const [quantity, setQuantity]   = useState(1);
        const [submitting, setSubmitting] = useState(false);
        const [error, setError]         = useState('');
        const [cartAdded, setCartAdded] = useState(false);
        const [urlEventSlug, setUrlEventSlug] = useState('');
        const inputStyle = { width: '100%', padding: '0.75rem 1rem', border: '1px solid #dde1e7', borderRadius: '16px', fontSize: '0.9rem', boxSizing: 'border-box' };

        // Falls back to ?event=<slug> when the block's own Event prop is left
        // blank — lets one shared page (e.g. the "Event Ticket Purchase"
        // template) serve any event, driven by whichever card a visitor
        // clicked in EventsListBlock. Plain URLSearchParams rather than
        // react-router's useSearchParams since this block also renders
        // inside the Puck builder canvas (SitePreviewShell), which isn't
        // necessarily wrapped in a Router.
        useEffect(() => {
          if (typeof window === 'undefined') return;
          const urlSlug = new URLSearchParams(window.location.search).get('event');
          if (urlSlug) setUrlEventSlug(urlSlug);
        }, []);
        const effectiveSlug = eventSlug || urlEventSlug;

        useEffect(() => {
          if (!effectiveSlug) return;
          fetch(`${API_BASE}/events/public/events/${effectiveSlug}`)
            .then(r => r.ok ? r.json() : null)
            .then(data => {
              setEvent(data);
              if (data?.tickets?.length) setTicketId(String(data.tickets[0].id));
            })
            .catch(() => setEvent(null));
        }, [effectiveSlug]);

        // Every ticket — free or paid — is a hold in the shared shopping
        // cart, not a standalone invoice. checkout.js's fulfillment (on the
        // /cart and /checkout pages) creates the event_registrations/
        // event_tickets rows once checkout completes — for a $0 cart that's
        // an instant "Complete Free Registration" with no card form; for a
        // paid cart it's the normal payment flow. Same pipeline shop orders
        // already use, and lets one checkout cover a mixed free+paid cart.
        async function handleAddToCart() {
          if (!ticketId) { setError('Please choose a ticket type.'); return; }
          setError(''); setSubmitting(true); setCartAdded(false);
          try {
            await addTicket(Number(ticketId), quantity);
            setCartAdded(true);
          } catch (err) {
            setError(err.response?.data?.error || 'Could not add this ticket to your cart.');
          } finally {
            setSubmitting(false);
          }
        }

        if (!effectiveSlug) {
          return (
            <div style={{ padding: '2rem', textAlign: 'center', color: '#9ca3af', fontSize: '0.9rem' }}>
              Select an event in the block settings to enable registration.
            </div>
          );
        }

        return (
          <AnimatedBlock animation={animation} delay={Number(animDelay) || 0}
            style={{ background: sectionBgColor || 'transparent', padding: '2.5rem 1.5rem' }}>
            <div style={{ maxWidth: 1200, margin: '0 auto', background: bgColor || '#fff', borderRadius: cardRadius ?? '24px', padding: 'clamp(1.75rem, 4vw, 3rem)', border: '1px solid #e5e5e5' }}>
            <style>{`
              @media (max-width: 768px) {
                .lit-event-split { grid-template-columns: 1fr !important; }
              }
            `}</style>
              <div className="lit-event-split" style={{ display: 'grid', gridTemplateColumns: '5fr 7fr', gap: '2rem' }}>
                <div>
                  {eyebrow && <div style={{ textTransform: 'uppercase', letterSpacing: '0.15em', fontSize: '0.72rem', fontWeight: 700, color: accentColor || '#C9A227' }}>{eyebrow}</div>}
                  {(event?.name || heading) && <h2 style={{ fontFamily: "'Playfair Display', Georgia, serif", fontWeight: 700, fontSize: 'clamp(1.75rem,3vw,2.25rem)', letterSpacing: '-1px', color: headingColor || '#0A1F3D', marginTop: '0.5rem' }}>{event?.name || heading}</h2>}
                  {event && <p style={{ marginTop: '0.5rem', fontSize: '0.85rem', color: accentColor || '#C9A227', fontWeight: 600 }}>{new Date(event.start_at).toLocaleString()}{event.location ? ` · ${event.location}` : ''}</p>}
                  {description && <p style={{ marginTop: '1rem', fontSize: '0.9rem', color: textColor || '#4b5563' }}>{description}</p>}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  {event?.tickets?.length > 0 ? (
                    <div style={{ display: 'grid', gap: '0.5rem' }}>
                      {event.tickets.map(t => (
                        <button key={t.id} type="button" onClick={() => { setTicketId(String(t.id)); setCartAdded(false); setError(''); }}
                          style={{
                            padding: '0.75rem 1rem', borderRadius: 16, fontSize: '0.9rem', cursor: 'pointer', textAlign: 'left',
                            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                            border: `1px solid ${ticketId === String(t.id) ? (accentColor || '#C9A227') : '#dde1e7'}`,
                            background: ticketId === String(t.id) ? (accentColor || '#C9A227') : 'transparent',
                            color: ticketId === String(t.id) ? '#ffffff' : 'inherit',
                          }}>
                          <span style={{ fontWeight: 600 }}>{t.name}</span>
                          <span>{Number(t.price) > 0 ? `$${Number(t.price).toFixed(2)}` : 'Free'}</span>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <p style={{ fontSize: '0.85rem', color: '#9ca3af' }}>No ticket types are available for this event yet.</p>
                  )}
                  <div>
                    <label style={{ fontSize: '0.8rem', fontWeight: 600, color: textColor || '#4b5563' }}>Quantity</label>
                    <input type="number" min="1" value={quantity} style={inputStyle}
                      onChange={e => { setQuantity(Math.max(1, Number(e.target.value) || 1)); setCartAdded(false); }} />
                  </div>
                  {error && <p style={{ color: '#b42318', fontSize: '0.85rem', margin: 0 }}>{error}</p>}
                  <button type="button" disabled={submitting || !event?.tickets?.length} onClick={handleAddToCart}
                    style={{ padding: '1rem', borderRadius: btnRadius ?? '16px', border: 'none', background: btnColor || '#C9A227', color: btnTextColor || '#0A1F3D', fontWeight: 700, fontSize: '1rem', cursor: 'pointer', opacity: submitting ? 0.7 : 1 }}>
                    {submitting ? 'Adding…' : (cartAdded ? 'Added ✓' : (submitText || 'Add to Cart'))}
                  </button>
                  {cartAdded && (
                    <p style={{ textAlign: 'center', fontSize: '0.85rem', color: '#16a34a', fontWeight: 600 }}>
                      {quantity} ticket{quantity > 1 ? 's' : ''} added to your cart. <a href="/cart" style={{ color: accentColor || '#C9A227', fontWeight: 700 }}>View Cart →</a>
                    </p>
                  )}
                  {disclaimerText && <p style={{ textAlign: 'center', fontSize: '0.75rem', color: '#9ca3af' }}>{disclaimerText}</p>}
                </div>
              </div>
            </div>
          </AnimatedBlock>
        );
      },
    },

    // ── Events List — browse multiple upcoming events, each card linking to
    // a ticket-purchase page (e.g. the "Event Ticket Purchase" template's
    // EventRegistrationCard, driven by its ?event=<slug> URL param). Modeled
    // directly on ProductList's fetch-list-render-cards shape. ──
    EventsListBlock: {
      label: 'Events List',
      fields: {
        heading:      { type: 'text',   label: 'Section Heading' },
        subheading:   { type: 'text',   label: 'Subheading' },
        limit:        { type: 'select', label: 'Events to Show', options: [
          { label: '3', value: 3 }, { label: '6', value: 6 },
          { label: '9', value: 9 }, { label: '12', value: 12 },
        ]},
        columns:      { type: 'select', label: 'Columns', options: [
          { label: '2', value: 2 }, { label: '3', value: 3 }, { label: '4', value: 4 },
        ]},
        purchasePath: { type: 'text', label: 'Ticket Purchase Page Path (e.g. /event-tickets)' },
        btnText:      { type: 'text', label: 'Button Text' },
        viewAllUrl:   { type: 'text', label: 'View All Link (optional)' },
        cardRadius:   cardRadiusField(),
        bgColor:      colorField('Background Color'),
        accentColor:  colorField('Accent / Button Color'),
      },
      defaultProps: {
        heading: 'Upcoming Events', subheading: '',
        limit: 6, columns: 3, purchasePath: '/event-tickets', btnText: 'Get Tickets',
        viewAllUrl: '', cardRadius: '6px', bgColor: '', accentColor: '#C9A227',
      },
      render: function EventsListBlock({ heading, subheading, limit, columns, purchasePath, btnText, viewAllUrl, cardRadius, bgColor, accentColor }) {
        const [events, setEvents] = useState([]);
        const [loading, setLoading] = useState(true);
        const accent = accentColor || '#C9A227';
        const cols   = Number(columns) || 3;
        const colClass = { 2: 'col-sm-6', 3: 'col-sm-6 col-lg-4', 4: 'col-sm-6 col-xl-3' }[cols] || 'col-sm-6 col-lg-4';

        useEffect(() => {
          fetch(`${API_BASE}/events/public/events`)
            .then(r => r.ok ? r.json() : [])
            .then(data => setEvents(Array.isArray(data) ? data.slice(0, Number(limit) || 6) : []))
            .catch(() => {})
            .finally(() => setLoading(false));
        }, [limit]);

        return (
          <section style={{ background: bgColor || 'transparent', padding: '3rem 0' }}>
            <div className="container">
              {(heading || subheading) && (
                <div className="text-center mb-4">
                  {heading && <h2 style={{ fontWeight: 800, marginBottom: '0.5rem' }}>{heading}</h2>}
                  {subheading && <p className="text-muted">{subheading}</p>}
                </div>
              )}
              {loading ? (
                <div className="text-center py-4"><div className="spinner-border" style={{ color: accent }} /></div>
              ) : events.length === 0 ? (
                <p className="text-center text-muted">No upcoming events at this time.</p>
              ) : (
                <div className="row g-4">
                  {events.map(e => (
                    <div key={e.id} className={colClass}>
                      <a href={`${purchasePath || '/event-tickets'}?event=${e.slug}`} style={{ textDecoration: 'none', color: 'inherit' }}>
                        <div className="card h-100 border-0 shadow-sm" style={{ transition: 'transform 0.2s,box-shadow 0.2s', '--bs-card-border-radius': cardRadius ?? '6px', '--bs-card-inner-border-radius': cardRadius ?? '6px' }}
                          onMouseEnter={ev => { ev.currentTarget.style.transform='translateY(-3px)'; ev.currentTarget.style.boxShadow='0 6px 24px rgba(0,0,0,0.13)'; }}
                          onMouseLeave={ev => { ev.currentTarget.style.transform=''; ev.currentTarget.style.boxShadow=''; }}>
                          <div className="card-body d-flex flex-column p-3">
                            <div style={{ textTransform: 'uppercase', letterSpacing: '0.1em', fontSize: '0.72rem', fontWeight: 700, color: accent }}>
                              {new Date(e.start_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                            </div>
                            <h6 className="fw-bold mt-1 mb-1" style={{ lineHeight: 1.3, fontSize: '1rem' }}>{e.name}</h6>
                            {e.location && <p className="text-muted mb-2" style={{ fontSize: '0.85rem' }}>{e.location}</p>}
                            <div className="mt-auto">
                              <span className="btn btn-sm w-100" style={{ background: accent, color: '#fff', fontWeight: 600, fontSize: '0.8rem' }}>
                                {btnText || 'Get Tickets'}
                              </span>
                            </div>
                          </div>
                        </div>
                      </a>
                    </div>
                  ))}
                </div>
              )}
              {viewAllUrl && (
                <div className="text-center mt-4">
                  <a href={viewAllUrl} className="btn btn-outline-secondary px-4">View All Events →</a>
                </div>
              )}
            </div>
          </section>
        );
      },
    },

    // ── Form Embed ──────────────────────────────────────────────────────────
    FormEmbed: {
      label: 'Form Embed',
      fields: {
        formSlug:  { type: 'custom', label: 'Form', render: ({ value, onChange }) => <FormPickerField value={value} onChange={onChange} /> },
        heading:   { type: 'text', label: 'Section Heading (optional)' },
        subtext:   { type: 'text', label: 'Sub-text (optional)' },
        bgColor:   colorField('Background Color'),
        textColor: colorField('Text Color'),
        padding:   { type: 'text', label: 'Padding' },
        maxWidth:  { type: 'text', label: 'Max Width' },
        animation: animField(),
        animDelay: animDelayField(),
      },
      defaultProps: {
        formSlug: '', heading: '', subtext: '',
        bgColor: '', textColor: '', padding: '3rem 1rem', maxWidth: '640px',
        animation: 'none', animDelay: '0',
      },
      render: ({ formSlug, heading, subtext, bgColor, textColor, padding, maxWidth, animation, animDelay }) => (
        <AnimatedBlock animation={animation} delay={Number(animDelay) || 0}
          style={{ background: bgColor || 'transparent', padding }}>
          <div style={{ maxWidth: maxWidth || '640px', margin: '0 auto' }}>
            {heading && <h2 style={{ fontWeight: 800, marginBottom: subtext ? '0.5rem' : '1.5rem', color: textColor || 'inherit' }}>{heading}</h2>}
            {subtext && <p style={{ color: textColor || '#666', marginBottom: '1.5rem' }}>{subtext}</p>}
            <FormEmbedRenderer formSlug={formSlug} textColor={textColor} />
          </div>
        </AnimatedBlock>
      ),
    },

    // ── Google Maps Embed ────────────────────────────────────────────────────
    GoogleMap: {
      label: 'Google Map',
      fields: {
        embedUrl:  { type: 'text',   label: 'Google Maps Embed URL (paste from Maps > Share > Embed)' },
        height:    { type: 'text',   label: 'Map Height' },
        bgColor:   colorField('Section Background'),
        padding:   { type: 'text',   label: 'Section Padding' },
        radius:    { type: 'text',   label: 'Border Radius' },
        animation: animField(),
        animDelay: animDelayField(),
      },
      defaultProps: {
        embedUrl: '',
        height: '400px',
        bgColor: '',
        padding: '0',
        radius: '0',
        animation: 'none',
        animDelay: '0',
      },
      render: ({ embedUrl, height, bgColor, padding, radius, animation, animDelay }) => (
        <AnimatedBlock animation={animation} delay={Number(animDelay) || 0}
          style={{ background: bgColor || 'transparent', padding }}>
          {embedUrl ? (
            <iframe
              src={embedUrl}
              width="100%"
              height={height || '400px'}
              style={{ border: 0, borderRadius: radius || 0, display: 'block' }}
              allowFullScreen=""
              loading="lazy"
              referrerPolicy="no-referrer-when-downgrade"
              title="Google Map"
            />
          ) : (
            <div style={{ height: height || '400px', background: '#e9ecef', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: radius || 0, color: '#6c757d', fontSize: '0.9rem' }}>
              Paste a Google Maps embed URL in the block settings
            </div>
          )}
        </AnimatedBlock>
      ),
    },

    // ── Contact Section — Form + Info side-by-side ──────────────────────────
    ContactSection: {
      label: 'Contact — Form + Info',
      fields: {
        bgColor:      colorField('Section Background'),
        padding:      { type: 'text', label: 'Section Padding' },
        formSide:     { type: 'select', label: 'Form Position', options: [{ label: 'Right (form) / Left (info) — matches site design', value: 'right' }, { label: 'Left (form) / Right (info)', value: 'left' }] },
        accentColor:  colorField('Accent Color'),
        heroEyebrow:  { type: 'text', label: 'Full-Width Page Heading Eyebrow (optional, sits above both columns)' },
        heroHeading:  { type: 'text', label: 'Full-Width Page Heading (optional, sits above both columns)' },
        heroHeadingFont: { type: 'select', label: 'Page Heading Font', options: [
          { label: 'Sans-Serif', value: 'sans'  },
          { label: 'Serif',      value: 'serif' },
        ]},
        infoEyebrow:  { type: 'text', label: 'Info Eyebrow Label' },
        infoHeading:  { type: 'text', label: 'Info Heading' },
        infoDescription: { type: 'textarea', label: 'Info Description' },
        infoCardLabel: { type: 'text', label: 'Info Card Label (optional — e.g. "Direct Contact"; when set, wraps the contact-method cards in a bordered white card with this label)' },
        infoItems:    {
          type: 'array', label: 'Contact Method Cards',
          arrayFields: {
            icon:  iconField('Icon (Font Awesome, or paste an emoji)'),
            label: { type: 'text',     label: 'Label (e.g. Phone)' },
            value: { type: 'textarea', label: 'Value (newlines supported)' },
            href:  { type: 'text',     label: 'Link URL (optional)' },
          },
          defaultItemProps: { icon: 'fa-solid fa-phone', label: '', value: '', href: '' },
        },
        quickLinksIntro: { type: 'text', label: 'Quick Links Intro Sentence (optional)' },
        quickLinksStyle: { type: 'select', label: 'Quick Links Style', options: [{ label: 'Filled Pills', value: 'pill' }, { label: 'Plain Text', value: 'text' }] },
        quickLinks: {
          type: 'array', label: 'Quick Link Pills (e.g. Remote Support, Client Portal)',
          arrayFields: {
            label: { type: 'text', label: 'Label' },
            url:   { type: 'text', label: 'URL' },
          },
          defaultItemProps: { label: 'Link', url: '#' },
        },
        formHeading:  { type: 'text', label: 'Form Card Heading' },
        formSubtext:  { type: 'text', label: 'Form Card Subtext (optional)' },
        formSlug:     { type: 'custom', label: 'Form', render: ({ value, onChange }) => <FormPickerField value={value} onChange={onChange} /> },
        formCardStyle: { type: 'select', label: 'Form Card Style', options: [{ label: 'Card (bordered, shadowed)', value: 'card' }, { label: 'No Card (plain, on page background)', value: 'none' }] },
        footerNote:   { type: 'text', label: 'Form Footer Note (optional, small text under Submit)' },
        footerNoteColor: colorField('Form Footer Note Color'),
        inputRadius:  { type: 'text', label: 'Input Corner Radius (e.g. 16 for 16px)' },
        textareaRadius: { type: 'text', label: 'Textarea Corner Radius (e.g. 24 for 24px)' },
        btnColor:     colorField('Submit Button Color'),
        btnTextColor: colorField('Submit Button Text Color'),
        btnRadius:    btnRadiusField(),
        cardRadius:   cardRadiusField('Form Card Corner Style'),
        mapEmbedUrl:  { type: 'text', label: 'Google Maps Embed URL (optional — paste from Maps > Share > Embed)' },
        mapHeight:    { type: 'text', label: 'Map Height' },
        mapRadius:    { type: 'text', label: 'Map Radius' },
      },
      defaultProps: {
        bgColor:      '#ffffff',
        padding:      '6rem 2rem',
        formSide:     'right',
        accentColor:  '#C9A227',
        heroEyebrow:  '', heroHeading: '', heroHeadingFont: 'sans',
        infoEyebrow:  'Contact Us',
        infoHeading:  "We'd Love to Hear From You",
        infoDescription: "Questions about donations, membership, sponsorship, or our programs? The Ventura County Sheriff's Foundation team is ready to help.",
        infoCardLabel: '',
        infoItems: [
          { icon: 'fa-solid fa-phone', label: 'Phone', value: '(805) 492-4398', href: 'tel:+18054924398' },
          { icon: 'fa-solid fa-envelope', label: 'Email', value: 'admin@vcsheriffsfoundation.org', href: 'mailto:admin@vcsheriffsfoundation.org' },
          { icon: 'fa-solid fa-location-dot', label: 'Mailing Address', value: 'P.O. Box 3007\nCamarillo, CA 93011', href: '' },
        ],
        quickLinksIntro: '', quickLinksStyle: 'pill',
        quickLinks: [
          { label: 'Donate', url: '/support' },
          { label: 'Programs', url: '/programs' },
        ],
        formHeading:  'Send Us a Message',
        formSubtext:  '',
        formSlug:     '',
        formCardStyle: 'card',
        footerNote: '', footerNoteColor: '',
        inputRadius: '8', textareaRadius: '8',
        btnColor:     '#C9A227',
        btnTextColor: '#ffffff',
        btnRadius:    '50px',
        cardRadius:   '28px',
        mapEmbedUrl:  '',
        mapHeight:    '220px',
        mapRadius:    '12px',
      },
      render: ({ bgColor, padding, formSide, accentColor, heroEyebrow, heroHeading, heroHeadingFont, infoEyebrow, infoHeading, infoDescription, infoCardLabel, infoItems, quickLinksIntro, quickLinksStyle, quickLinks, formHeading, formSubtext, formSlug, formCardStyle, footerNote, footerNoteColor, inputRadius, textareaRadius, btnColor, btnTextColor, btnRadius, cardRadius, mapEmbedUrl, mapHeight, mapRadius }) => {
        const acc = accentColor || '#C9A227';
        const infoCardsEl = (
          <div style={{ display: 'grid', gap: 20, marginBottom: 32 }}>
            {(infoItems || []).map((item, idx) => (
              <div key={idx} className="lit-contact-method" style={{ display: 'flex', alignItems: 'flex-start', gap: 16, padding: 20, background: infoCardLabel ? 'transparent' : '#fafafa', borderRadius: 12, transition: 'background 0.35s cubic-bezier(0.4,0,0.2,1), transform 0.35s cubic-bezier(0.4,0,0.2,1)' }}>
                <div style={{ width: 44, height: 44, borderRadius: 8, background: `linear-gradient(135deg, #DDBC4E, ${acc})`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  {renderIconValue(item.icon, { fontSize: '1.1rem', color: '#fff' })}
                </div>
                <div>
                  {item.label && <h4 style={{ fontSize: '0.9rem', fontWeight: 700, color: '#0A1F3D', marginBottom: 2 }}>{item.label}</h4>}
                  {item.href ? (
                    <a href={item.href} style={{ color: '#6b7280', textDecoration: 'none', fontSize: '0.85rem', whiteSpace: 'pre-line' }}>{item.value}</a>
                  ) : (
                    <p style={{ color: '#6b7280', margin: 0, whiteSpace: 'pre-line', fontSize: '0.85rem' }}>{item.value}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        );

        const infoColumn = (
          <div style={{ minWidth: 0 }}>
            {infoEyebrow && (
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                <span style={{ width: 24, height: 2, background: `linear-gradient(135deg, #DDBC4E, ${acc})`, borderRadius: 2 }} />
                <span style={{ fontSize: '0.75rem', fontWeight: 700, letterSpacing: '0.15em', textTransform: 'uppercase', color: acc }}>{infoEyebrow}</span>
              </div>
            )}
            {infoHeading && !heroHeading && <h2 style={{ fontSize: '1.75rem', fontWeight: 800, color: '#0A1F3D', marginBottom: 16 }}>{infoHeading}</h2>}
            {infoDescription && <p style={{ color: '#6b7280', lineHeight: 1.7, marginBottom: 32 }}>{infoDescription}</p>}

            {infoCardLabel ? (
              <div style={{ background: '#fff', border: '1px solid #e5e5e5', borderRadius: cardRadius ?? '28px', padding: 32, marginBottom: 32 }}>
                <div style={{ fontWeight: 700, color: '#0A1F3D', marginBottom: 16 }}>{infoCardLabel}</div>
                {infoCardsEl}
              </div>
            ) : infoCardsEl}

            {(mapEmbedUrl) && (
              <iframe
                src={mapEmbedUrl}
                width="100%"
                height={mapHeight || '220px'}
                style={{ border: 0, borderRadius: mapRadius || '12px', display: 'block', marginBottom: 32 }}
                allowFullScreen=""
                loading="lazy"
                referrerPolicy="no-referrer-when-downgrade"
                title="Location Map"
              />
            )}

            {quickLinksIntro && <div style={{ fontSize: '0.8rem', color: '#6b7280', marginBottom: 8 }}>{quickLinksIntro}</div>}
            {quickLinks?.length > 0 && (
              <div style={{ display: 'flex', gap: quickLinksStyle === 'text' ? 20 : 12, flexWrap: 'wrap' }}>
                {quickLinks.map((link, i) => (
                  quickLinksStyle === 'text' ? (
                    <a key={i} href={link.url} target="_blank" rel="noopener noreferrer" className="lit-contact-quicklink-text"
                      style={{ fontSize: '0.9rem', fontWeight: 500, color: 'inherit', textDecoration: 'none', transition: 'color 0.2s' }}>
                      {link.label}
                    </a>
                  ) : (
                    <a key={i} href={link.url} target="_blank" rel="noopener noreferrer" className="lit-contact-quicklink"
                      style={{ padding: '10px 18px', fontSize: '0.8rem', fontWeight: 600, background: '#0A1F3D', color: '#fff', borderRadius: 50, textDecoration: 'none', transition: 'background 0.35s cubic-bezier(0.4,0,0.2,1)' }}>
                      {link.label}
                    </a>
                  )
                ))}
              </div>
            )}
          </div>
        );

        const isFormCard = formCardStyle !== 'none';
        const formColumn = (
          <div style={isFormCard ? { background: '#fff', border: '1px solid #e5e5e5', borderRadius: cardRadius ?? '28px', padding: 40, boxShadow: '0 4px 24px rgba(0,0,0,0.08)', minWidth: 0 } : { minWidth: 0 }}>
            {formHeading && <h3 style={{ fontSize: '1.25rem', fontWeight: 800, color: '#0A1F3D', marginBottom: formSubtext ? 8 : 24 }}>{formHeading}</h3>}
            {formSubtext && <p style={{ color: '#6b7280', marginBottom: 24 }}>{formSubtext}</p>}
            <FormEmbedRenderer formSlug={formSlug} btnColor={btnColor} btnTextColor={btnTextColor} btnRadius={btnRadius}
              inputRadius={inputRadius} textareaRadius={textareaRadius} footerNote={footerNote} footerNoteColor={footerNoteColor} />
          </div>
        );

        return (
          <section style={{ background: bgColor || 'transparent', padding: padding || '6rem 2rem' }}>
            <style>{`
              .lit-contact-method:hover { background: ${acc}14; transform: translateX(4px); }
              .lit-contact-quicklink:hover { background: ${acc}; }
              .lit-contact-quicklink-text:hover { color: ${acc} !important; }
              /* This is a two-column SPLIT (form vs. info), not a multi-column
                 card grid — .lit-responsive-grid's shared "collapse to 2, then
                 1" behavior (vcsf-design.css) only fully stacks below 480px,
                 which is too narrow for two content-heavy columns like these.
                 Stack straight to 1 column at the tablet breakpoint instead,
                 same pattern the TwoColumn block already uses. */
              @media (max-width: 768px) {
                .lit-contact-grid { grid-template-columns: 1fr !important; }
              }
            `}</style>
            <div style={{ maxWidth: 1200, margin: '0 auto' }}>
              {(heroEyebrow || heroHeading) && (
                <div style={{ maxWidth: 560, marginBottom: 48 }}>
                  {heroEyebrow && <div style={{ fontSize: '0.75rem', fontWeight: 700, letterSpacing: '0.15em', textTransform: 'uppercase', color: acc, marginBottom: 8 }}>{heroEyebrow}</div>}
                  {heroHeading && <h1 style={{ fontSize: 'clamp(2.25rem,5vw,3.75rem)', fontWeight: heroHeadingFont === 'serif' ? 700 : 800, fontFamily: heroHeadingFont === 'serif' ? "'Playfair Display', Georgia, serif" : 'inherit', letterSpacing: heroHeadingFont === 'serif' ? '-2px' : 'inherit', color: '#0A1F3D', margin: 0 }}>{heroHeading}</h1>}
                </div>
              )}
              <div className="lit-contact-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1.2fr', gap: 60 }}>
              {formSide === 'left' ? (
                <>{formColumn}{infoColumn}</>
              ) : (
                <>{infoColumn}{formColumn}</>
              )}
              </div>
            </div>
          </section>
        );
      },
    },

    // ── Photo Gallery ───────────────────────────────────────────────────────
    PhotoGallery: {
      label: 'Photo Gallery',
      fields: {
        heading:      { type: 'text',   label: 'Heading' },
        headingColor: colorField('Heading Color'),
        captionColor: colorField('Caption Color'),
        columns:      { type: 'select', label: 'Columns', options: [{ label: '2', value: 2 }, { label: '3', value: 3 }, { label: '4', value: 4 }] },
        imageRadius:  imageRadiusField(),
        bgColor:      colorField('Background Color'),
        items: {
          type: 'array',
          label: 'Photos',
          arrayFields: {
            src:     imageField('Photo'),
            caption: { type: 'text', label: 'Caption' },
            link:    { type: 'text', label: 'Link URL (optional)' },
          },
          defaultItemProps: { src: '', caption: '', link: '' },
        },
      },
      defaultProps: { heading: '', headingColor: '', captionColor: '#666666', columns: 3, imageRadius: '4px', bgColor: '', items: [] },
      render: PhotoGalleryBlock,
    },

    // ── Pricing Table ────────────────────────────────────────────────────────
    PricingTable: {
      label: 'Pricing Table',
      fields: {
        // ── Styling ──────────────────────────────────────────────────────────
        accentColor:      colorField('Accent / Featured Card Color'),
        standardHeaderBg: colorField('Standard Card Header Color'),
        headerTextColor:  colorField('Card Header Text Color'),
        priceColor:       colorField('Price Text Color'),
        cardBodyBg:       colorField('Card Body Background'),
        featureTextColor: colorField('Feature Text Color'),
        bulletColor:      colorField('Bullet Icon Color'),
        sectionBg:        colorField('Section Background'),
        noteBgColor:      colorField('Pricing Note Background'),
        noteTextColor:    colorField('Pricing Note Text Color'),
        cardRadius: cardRadiusField(),
        btnRadius: btnRadiusField(),
        // ── Typography ───────────────────────────────────────────────────────
        tierNameSize: { type: 'select', label: 'Tier Name Size', options: [
          { label: 'Small (1rem)',      value: '1rem'    },
          { label: 'Medium (1.25rem)', value: '1.25rem' },
          { label: 'Large (1.5rem)',   value: '1.5rem'  },
          { label: 'X-Large (1.75rem)',value: '1.75rem' },
        ]},
        priceSize: { type: 'select', label: 'Price Size', options: [
          { label: 'Small (1.25rem)',  value: '1.25rem' },
          { label: 'Medium (1.5rem)', value: '1.5rem'  },
          { label: 'Large (1.75rem)', value: '1.75rem' },
          { label: 'X-Large (2rem)',  value: '2rem'    },
        ]},
        featureSize: { type: 'select', label: 'Feature Text Size', options: [
          { label: 'X-Small (0.8rem)', value: '0.8rem'  },
          { label: 'Small (0.9rem)',   value: '0.9rem'  },
          { label: 'Medium (0.95rem)', value: '0.95rem' },
          { label: 'Large (1.05rem)',  value: '1.05rem' },
        ]},
        // ── Modal ────────────────────────────────────────────────────────────
        modalTitle:    { type: 'text', label: 'Modal Title' },
        modalHeaderBg: colorField('Modal Header Background'),
        // ── Tiers ────────────────────────────────────────────────────────────
        tiers: {
          type: 'array',
          label: 'Pricing Tiers',
          arrayFields: {
            name:     { type: 'text',     label: 'Tier Name' },
            icon:     iconField('Icon (Font Awesome)'),
            price:    { type: 'text',     label: 'Price / Label' },
            featured: { type: 'radio',    label: 'Card Style', options: [{ label: 'Featured (accent header)', value: 'true' }, { label: 'Standard (dark header)', value: 'false' }] },
            features: { type: 'textarea', label: 'Features — one per line' },
            formSlug: { type: 'text',     label: 'Quote form slug (leave blank to hide button)' },
          },
          defaultItemProps: {
            name: 'New Tier', icon: 'fa-solid fa-star', price: 'Contact for Pricing',
            featured: 'false', features: 'Feature one\nFeature two\nFeature three', formSlug: '',
          },
        },
        pricingNote: { type: 'textarea', label: 'Pricing Note (leave blank to hide)' },
      },
      defaultProps: {
        accentColor:      '#C9A227',
        standardHeaderBg: '#0A1F3D',
        headerTextColor:  '#ffffff',
        priceColor:       '',
        cardBodyBg:       '#ffffff',
        featureTextColor: '#444444',
        bulletColor:      '',
        sectionBg:        'transparent',
        noteBgColor:      '#f5f5f5',
        noteTextColor:    '#555555',
        cardRadius:       '0px',
        btnRadius:        '50px',
        tierNameSize:     '1.25rem',
        priceSize:        '1.5rem',
        featureSize:      '0.95rem',
        modalTitle:       'Join the Foundation',
        modalHeaderBg:    '#C9A227',
        tiers: [
          { name: 'Bronze Membership', icon: 'fa-solid fa-id-card',  price: '$40/year',  featured: 'true',  formSlug: '', features: 'Personalized membership card\n1 window decal\nRecognition in annual report' },
          { name: 'Silver Membership', icon: 'fa-solid fa-award',    price: '$110/year', featured: 'false', formSlug: '', features: 'Personalized membership card\nSet of window decals\nOfficial badge lapel pin\nRecognition in annual report' },
          { name: 'Gold & Diamond',    icon: 'fa-solid fa-gem',      price: 'From $250', featured: 'false', formSlug: '', features: 'Multiple membership cards\nEnhanced recognition\nSpecial event invitations\nDiamond level from $1,000' },
        ],
        pricingNote: 'Allow 4–6 weeks for fulfillment of physical membership materials. Lifetime membership also available — call (805) 492-4398 for details.',
      },
      render: PricingTableBlock,
    },

    // ── Aircraft Hero ─────────────────────────────────────────────────────────
    AircraftHero: {
      label: 'Aircraft Hero',
      fields: {
        logoImage:         imageField('Logo Image URL'),
        logoHeight:        { type: 'number', label: 'Logo Height (px)' },
        badge:             { type: 'text', label: 'Badge Text' },
        badgeBg:           colorField('Badge Background'),
        badgeTextColor:    colorField('Badge Text Color'),
        headline:          { type: 'text', label: 'Headline (line 1)' },
        headlineColor:     colorField('Headline Color'),
        headlineSpan:      { type: 'text', label: 'Headline Line 2 (colored span)' },
        headlineSpanColor: colorField('Headline Span Color'),
        subtext:           { type: 'textarea', label: 'Subtext / Description' },
        subtextColor:      colorField('Subtext Color'),
        bgImage:           imageField('Background Image URL'),
        overlay:           { type: 'number', label: 'Dark Overlay Strength (0–1)' },
        bgColor:           colorField('Background Color (fallback)'),
        btn1Text:          { type: 'text', label: 'Button 1 Text' },
        btn1Url:           urlField('Button 1 URL'),
        btn1BgColor:       colorField('Button 1 Background'),
        btn1TextColor:     colorField('Button 1 Text Color'),
        btn2Text:          { type: 'text', label: 'Button 2 Text' },
        btn2Url:           urlField('Button 2 URL'),
        btn2TextColor:     colorField('Button 2 Text Color'),
        btnRadius:         btnRadiusField(),
      },
      defaultProps: {
        logoImage: '', logoHeight: 110,
        badge: 'EST. 2005 • 501(c)(3) NONPROFIT', badgeBg: '#C9A227', badgeTextColor: '#0A1F3D',
        headline: 'Supporting Our Deputies.', headlineColor: '#ffffff',
        headlineSpan: 'Strengthening Our Community.', headlineSpanColor: '#c8d0e0',
        subtext: 'Building community partnerships to enhance public safety in Ventura County.',
        subtextColor: 'rgba(255,255,255,0.75)',
        bgImage: '', overlay: 0.85, bgColor: '#0A1F3D',
        btn1Text: 'Donate Today', btn1Url: '/support', btn1BgColor: '#C9A227', btn1TextColor: '#0A1F3D',
        btn2Text: 'Our Programs', btn2Url: '/programs', btn2TextColor: '#ffffff',
        btnRadius: '50px',
      },
      render: AircraftHeroBlock,
    },

    // ── Image Text Split ──────────────────────────────────────────────────────
    ImageTextSplit: {
      label: 'Image + Text Split',
      fields: {
        image:          imageField('Section Image URL'),
        imagePosition:  { type: 'select', label: 'Image Position', options: [{ label: 'Image Left', value: 'left' }, { label: 'Image Right', value: 'right' }] },
        imageRadius:    imageRadiusField(),
        logoImage:      imageField('Logo Image URL (optional)'),
        logoHeight:     { type: 'number', label: 'Logo Height (px)' },
        accentColor:    colorField('Accent Bar Color'),
        heading:        { type: 'text', label: 'Heading' },
        headingColor:   colorField('Heading Color'),
        body:           { type: 'textarea', label: 'Body Text (blank line = paragraph break)' },
        textColor:      colorField('Text Color'),
        bgColor:        colorField('Section Background'),
        panelBg:        colorField('Text Panel Background'),
        statValueColor: colorField('Stat Value Color'),
        statLabelColor: colorField('Stat Label Color'),
        statItems: {
          type: 'array', label: 'Stat Badges',
          arrayFields: {
            value: { type: 'text', label: 'Value' },
            label: { type: 'text', label: 'Label' },
          },
          getItemSummary: (item) => item.value || 'Stat',
        },
      },
      defaultProps: {
        image: '', imagePosition: 'left', imageRadius: '0px',
        logoImage: '', logoHeight: 64,
        accentColor: '#C9A227', heading: 'Section Heading', headingColor: '#0d1b2a',
        body: 'First paragraph here.\n\nSecond paragraph here.',
        textColor: '#475569', bgColor: '#ffffff', panelBg: '#ffffff',
        statValueColor: '#1a2e45', statLabelColor: '#94a3b8',
        statItems: [{ value: '6G', label: 'Rated' }, { value: '27', label: 'Gal Fuel' }],
      },
      render: ImageTextSplitBlock,
    },

    // ── Specs Comparison ──────────────────────────────────────────────────────
    SpecsComparison: {
      label: 'Specs Comparison (2 Cards)',
      fields: {
        heading:    { type: 'text', label: 'Section Heading' },
        subtext:    { type: 'text', label: 'Section Subtext' },
        bgColor:    colorField('Section Background'),
        accentColor: colorField('Accent Color'),
        labelColor: colorField('Spec Label Color'),
        valueColor: colorField('Spec Value Color'),
        cardRadius: cardRadiusField(),
        card1Title: { type: 'text', label: 'Card 1 Title' },
        card1Label: { type: 'text', label: 'Card 1 Tag' },
        card1Bg:    colorField('Card 1 Background'),
        card1Specs: {
          type: 'array', label: 'Card 1 Spec Rows',
          arrayFields: {
            label: { type: 'text', label: 'Label' },
            value: { type: 'text', label: 'Value' },
          },
          getItemSummary: (item) => item.label || 'Row',
        },
        card2Title: { type: 'text', label: 'Card 2 Title' },
        card2Label: { type: 'text', label: 'Card 2 Tag' },
        card2Bg:    colorField('Card 2 Background'),
        card2Specs: {
          type: 'array', label: 'Card 2 Spec Rows',
          arrayFields: {
            label: { type: 'text', label: 'Label' },
            value: { type: 'text', label: 'Value' },
          },
          getItemSummary: (item) => item.label || 'Row',
        },
      },
      defaultProps: {
        heading: 'Model Comparison', subtext: 'Two configurations, same proven DNA.',
        bgColor: '#f8fafc', accentColor: '#C9A227', labelColor: '#94b4d4', valueColor: '#ffffff', cardRadius: '12px',
        card1Title: 'Performance Build', card1Label: 'Sport Version', card1Bg: '#0d1b2a',
        card1Specs: [{ label: 'Engine', value: 'Rotax 912 ULS (100HP)' }, { label: 'Empty Weight', value: '~450 lbs' }],
        card2Title: 'Light Sport Legal', card2Label: 'LSA Version', card2Bg: '#1a2e45',
        card2Specs: [{ label: 'Engine', value: 'Rotax 912 iS (100HP)' }, { label: 'Empty Weight', value: '~430 lbs' }],
      },
      render: SpecsComparisonBlock,
    },

    // ── Feature Checklist ─────────────────────────────────────────────────────
    FeatureChecklist: {
      label: 'Feature Checklist (Dark)',
      fields: {
        heading:      { type: 'text', label: 'Heading' },
        subtext:      { type: 'textarea', label: 'Subtext / Description' },
        headingColor: colorField('Heading Color'),
        subtextColor: colorField('Subtext Color'),
        bgImage:      imageField('Background Image URL'),
        overlay:      { type: 'number', label: 'Dark Overlay (0–1)' },
        bgColor:      colorField('Background Color (if no image)'),
        accentColor:  colorField('Accent Bar Color'),
        checkColor:   colorField('Check Icon Color'),
        itemColor:    colorField('Item Text Color'),
        items: {
          type: 'array', label: 'Checklist Items',
          arrayFields: { text: { type: 'text', label: 'Item text' } },
          getItemSummary: (item) => item.text || 'Item',
        },
      },
      defaultProps: {
        heading: 'Flight Performance', subtext: 'Engineered for capable, confident flying.',
        headingColor: '#ffffff', subtextColor: 'rgba(255,255,255,0.65)',
        bgImage: '', overlay: 0.88, bgColor: '#0d1b2a', accentColor: '#C9A227',
        checkColor: '#C9A227', itemColor: 'rgba(255,255,255,0.88)',
        items: [{ text: 'Easy to fly with low stall and landing speed' }, { text: 'Positively stable in all axes' }],
      },
      render: FeatureChecklistBlock,
    },

    // ── Construction / Data Table ─────────────────────────────────────────────
    ConstructionBlock: {
      label: 'Construction / Data Table',
      fields: {
        heading:           { type: 'text', label: 'Heading' },
        headingColor:      colorField('Heading Color'),
        body:              { type: 'textarea', label: 'Body Text' },
        textColor:         colorField('Text Color'),
        bgColor:           colorField('Section Background'),
        accentColor:       colorField('Accent Bar Color'),
        tableHeadingColor: colorField('Table Label Color'),
        tableValueColor:   colorField('Table Value Color'),
        cardRadius:        cardRadiusField(),
        rows: {
          type: 'array', label: 'Table Rows',
          arrayFields: {
            label: { type: 'text', label: 'Label' },
            value: { type: 'text', label: 'Value' },
          },
          getItemSummary: (item) => item.label || 'Row',
        },
      },
      defaultProps: {
        heading: 'Built to Last', headingColor: '#0d1b2a',
        body: 'Aircraft-grade aluminum construction with modern techniques.',
        textColor: '#64748b', bgColor: '#f8fafc', accentColor: '#C9A227',
        tableHeadingColor: '#64748b', tableValueColor: '#0d1b2a', cardRadius: '12px',
        rows: [{ label: 'Primary Structure', value: '6061-T6 Aluminum' }, { label: 'Wing Span', value: '27.5 ft' }],
      },
      render: ConstructionBlock,
    },

    // ── Specs Strip ───────────────────────────────────────────────────────────
    SpecsStrip: {
      label: 'Specs Strip (Dark Tiles)',
      fields: {
        bgColor:    colorField('Background Color'),
        labelColor: colorField('Label Color'),
        valueColor: colorField('Value Color'),
        cardRadius: cardRadiusField(),
        items: {
          type: 'array', label: 'Spec Tiles',
          arrayFields: {
            label: { type: 'text', label: 'Label' },
            value: { type: 'text', label: 'Value' },
          },
          getItemSummary: (item) => item.label || 'Tile',
        },
      },
      defaultProps: {
        bgColor: '#0d1433', labelColor: '#94b4d4', valueColor: '#ffffff', cardRadius: '8px',
        items: [{ label: 'Configuration', value: 'Side-by-Side Two-Place' }, { label: 'Construction', value: 'Aluminum' }],
      },
      render: SpecsStripBlock,
    },

    // ── Timeline ──────────────────────────────────────────────────────────────
    Timeline: {
      label: 'Timeline / Process Steps',
      fields: {
        eyebrow:      { type: 'text', label: 'Eyebrow Label (small text above heading)' },
        heading:      { type: 'text', label: 'Heading' },
        subtext:      { type: 'text', label: 'Subtext' },
        headingColor: colorField('Heading Color'),
        subtextColor: colorField('Subtext Color'),
        bgColor:      colorField('Background Color'),
        accentColor:  colorField('Accent / Active Color'),
        layout:       { type: 'select', label: 'Layout', options: [{ label: 'Vertical (cards, connecting line)', value: 'vertical' }, { label: 'Horizontal (numbered circles in a row)', value: 'horizontal' }] },
        cardRadius:   cardRadiusField('Milestone Card Corner Style (vertical layout only)'),
        milestones: {
          type: 'array', label: 'Milestones',
          arrayFields: {
            phase:  { type: 'text', label: 'Phase #' },
            title:  { type: 'text', label: 'Title' },
            status: { type: 'select', label: 'Status', options: [
              { label: 'Complete',    value: 'done'     },
              { label: 'In Progress', value: 'active'   },
              { label: 'Upcoming',    value: 'upcoming' },
            ]},
            desc:   { type: 'textarea', label: 'Description' },
            img:    imageField('Image (optional)'),
          },
          getItemSummary: (item) => item.title || 'Milestone',
        },
      },
      defaultProps: {
        eyebrow: 'Our Process',
        heading: 'How We Deliver Results', subtext: 'A structured, milestone-by-milestone approach.',
        headingColor: '#ffffff', subtextColor: '', bgColor: '#0a0f1e', accentColor: '#C9A227', layout: 'vertical', cardRadius: '12px',
        milestones: [
          { phase: '01', title: 'Discovery',       status: 'done',     desc: 'Understand your goals and current environment.', img: '' },
          { phase: '02', title: 'Implementation',  status: 'active',   desc: 'Deploy and configure the solution.', img: '' },
          { phase: '03', title: 'Ongoing Support', status: 'upcoming', desc: 'Continuous monitoring and optimization.', img: '' },
        ],
      },
      render: TimelineBlock,
    },

    // ── Logo Showcase ─────────────────────────────────────────────────────────
    LogoShowcase: {
      label: 'Logo Showcase (Dark)',
      fields: {
        logoImage:    imageField('Logo Image URL'),
        logoHeight:   { type: 'number', label: 'Logo Height (px)' },
        logoAlt:      { type: 'text', label: 'Logo Alt Text' },
        caption:      { type: 'text', label: 'Caption / Tagline' },
        captionColor: colorField('Caption Color'),
        bg1:          colorField('Gradient Start Color'),
        bg2:          colorField('Gradient End Color'),
      },
      defaultProps: {
        logoImage: '', logoHeight: 140, logoAlt: 'Logo',
        caption: 'Sport Performance Aviation',
        captionColor: 'rgba(255,255,255,0.45)',
        bg1: '#0d1b2a', bg2: '#1a2e45',
      },
      render: LogoShowcaseBlock,
    },

    // ── Sponsor Logo Grid ─────────────────────────────────────────────────────
    SponsorLogoGrid: {
      label: 'Sponsor / Partner Logo Grid',
      fields: {
        eyebrow:        { type: 'text', label: 'Eyebrow Label' },
        heading:        { type: 'text', label: 'Heading' },
        ctaText:        { type: 'text', label: 'CTA Link Text (optional)' },
        ctaUrl:         urlField('CTA Link URL'),
        bgColor:        colorField('Background Color'),
        textColor:      colorField('Text Color'),
        columns:        { type: 'select', label: 'Columns', options: [{ label: '3', value: 3 }, { label: '4', value: 4 }, { label: '6', value: 6 }] },
        grayscaleHover: { type: 'select', label: 'Grayscale logos (color on hover)', options: [{ label: 'Yes', value: true }, { label: 'No', value: false }] },
        footnoteText:   { type: 'text', label: 'Footnote (optional, small text below grid)' },
        logos: {
          type: 'array',
          label: 'Sponsors',
          arrayFields: {
            name:  { type: 'text', label: 'Name (shown if no logo image)' },
            image: imageField('Logo Image (optional — shown instead of name)'),
            url:   urlField('Link URL (optional)'),
          },
          defaultItemProps: { name: 'Sponsor Name', image: '', url: '' },
        },
      },
      defaultProps: {
        eyebrow: 'PROUDLY SUPPORTED BY', heading: 'Our Community Partners',
        ctaText: '', ctaUrl: '', bgColor: '#0A1F3D', textColor: '#ffffff',
        columns: 6, grayscaleHover: false, footnoteText: '',
        logos: [
          { name: 'Sponsor One', image: '', url: '' },
          { name: 'Sponsor Two', image: '', url: '' },
          { name: 'Sponsor Three', image: '', url: '' },
        ],
      },
      render: SponsorLogoGridBlock,
    },

    // ── Page Hero Banner ──────────────────────────────────────────────────────
    PageHeroBanner: {
      label: 'Page Hero Banner',
      fields: {
        bgImage:      imageField('Background Image URL'),
        overlay:      { type: 'number', label: 'Gradient Overlay Darkness (0–1, 0 = none)', min: 0, max: 1, step: 0.05 },
        minHeight:    { type: 'number', label: 'Min Height (px)' },
        eyebrow:      { type: 'text', label: 'Eyebrow (optional, above headline)' },
        eyebrowColor: colorField('Eyebrow Color'),
        headline:     { type: 'text', label: 'Headline' },
        headlineBg:   colorField('Headline Box Background (set to "transparent" for no box)'),
        headlineColor: colorField('Headline Text Color'),
        borderColor:  colorField('Bottom Border Color (set to "transparent" for none)'),
        boxPosition:  { type: 'select', label: 'Box Position', options: [{ label: 'Bottom Left', value: 'bottom-left' }, { label: 'Centered', value: 'center' }] },
        cardRadius:   cardRadiusField('Headline Box Corner Style'),
      },
      defaultProps: {
        bgImage: '', overlay: 0, minHeight: 420,
        eyebrow: '', eyebrowColor: '#C9A227',
        headline: 'Page Title',
        headlineBg: 'rgba(180,20,20,0.82)', headlineColor: '#ffffff',
        borderColor: '#E85800', boxPosition: 'bottom-left', cardRadius: '4px',
      },
      render: PageHeroBannerBlock,
    },

    // ── Team Grid ─────────────────────────────────────────────────────────────
    TeamGrid: {
      label: 'Team Grid',
      fields: {
        heading:          { type: 'text', label: 'Section Heading' },
        subheading:       { type: 'text', label: 'Section Subheading' },
        headingColor:     colorField('Heading Color'),
        subheadingColor:  colorField('Subheading Color'),
        bgColor:          colorField('Section Background'),
        accentColor:      colorField('Accent Color (borders, names)'),
        cardStyle:        { type: 'select', label: 'Card Style', options: [{ label: 'Simple (round photo)', value: 'simple' }, { label: 'Card (gradient avatar box, hover lift)', value: 'card' }] },
        avatarColor1:     colorField('Avatar Gradient Start (card style only)'),
        avatarColor2:     colorField('Avatar Gradient End (card style only)'),
        cardRadius:       cardRadiusField('Card Corner Style'),
        members: {
          type: 'array', label: 'Team Members',
          arrayFields: {
            name:  { type: 'text', label: 'Name' },
            title: { type: 'text', label: 'Title / Role' },
            img:   imageField('Photo (or type an emoji for a placeholder avatar)'),
            email: { type: 'text', label: 'Email (optional)' },
            phone: { type: 'text', label: 'Phone (optional)' },
            bio:   { type: 'textarea', label: 'Bio' },
          },
          getItemSummary: (item) => item.name || 'Team Member',
        },
      },
      defaultProps: {
        heading: 'Meet the Team', subheading: 'The people behind your build support.',
        headingColor: '#0d1b2a', subheadingColor: '#6c757d',
        bgColor: '#f0f4f8', accentColor: '#E85800', cardStyle: 'simple',
        avatarColor1: '#0A1F3D', avatarColor2: '#C9A227', cardRadius: '8px',
        members: [{ name: 'Team Member', title: 'Role', img: '', email: '', phone: '', bio: 'Bio here.' }],
      },
      render: TeamGridBlock,
    },

    // ── Values Grid ───────────────────────────────────────────────────────────
    ValuesGrid: {
      label: 'Values Grid',
      fields: {
        heading:     { type: 'text', label: 'Section Heading' },
        subheading:  { type: 'text', label: 'Section Subheading' },
        headingColor: colorField('Heading Color'),
        subheadingColor: colorField('Subheading Color'),
        bgColor:     colorField('Section Background'),
        accentColor: colorField('Accent Color (top border or icon-card hover)'),
        cardStyle:   { type: 'select', label: 'Card Style', options: [{ label: 'Top Border', value: 'topBorder' }, { label: 'Icon Card (centered icon, hover lift)', value: 'iconCard' }] },
        cardRadius:  cardRadiusField('Icon Card Corner Style (icon card style only)'),
        values: {
          type: 'array', label: 'Values',
          arrayFields: {
            icon:  iconField('Icon (Font Awesome, or paste an emoji — icon card style only)'),
            title: { type: 'text', label: 'Title' },
            desc:  { type: 'textarea', label: 'Description' },
          },
          getItemSummary: (item) => item.title || 'Value',
        },
      },
      defaultProps: {
        heading: 'Our Values', subheading: 'What drives every decision we make.',
        headingColor: '#0d1b2a', subheadingColor: '#6c757d', bgColor: '#ffffff', accentColor: '#E85800', cardStyle: 'topBorder', cardRadius: '20px',
        values: [{ icon: '🏆', title: 'Value', desc: 'Description here.' }],
      },
      render: ValuesGridBlock,
    },

    // ── Full Width Image ──────────────────────────────────────────────────────
    FullWidthImage: {
      label: 'Full Width Image',
      fields: {
        image:     imageField('Image URL'),
        alt:       { type: 'text', label: 'Alt Text' },
        maxHeight: { type: 'number', label: 'Max Height px (leave blank for natural height)' },
      },
      defaultProps: { image: '', alt: '', maxHeight: 0 },
      render: FullWidthImageBlock,
    },

    // ── Video Gallery ─────────────────────────────────────────────────────────
    VideoGallery: {
      label: 'Video Gallery',
      fields: {
        heading:         { type: 'text',   label: 'Section Heading' },
        subheading:      { type: 'text',   label: 'Subheading' },
        vimeoFolderUrl:  { type: 'text',   label: 'Vimeo Folder URL (overrides Tags — paste https://vimeo.com/user/…/folder/…)' },
        tags:            { type: 'text',   label: 'Show Videos Tagged (comma-separated, blank = all, ignored when Vimeo Folder set)' },
        platform:        { type: 'select', label: 'Platform Filter (ignored when Vimeo Folder set)', options: [
          { label: 'All Platforms', value: 'all' },
          { label: 'YouTube Only',  value: 'youtube' },
          { label: 'Vimeo Only',    value: 'vimeo' },
        ]},
        columns:      { type: 'select', label: 'Columns', options: [
          { label: '2', value: 2 }, { label: '3', value: 3 }, { label: '4', value: 4 },
        ]},
        accentColor:  colorField('Accent / Play Button Color'),
        bgColor:      colorField('Section Background'),
        headingColor: colorField('Heading Color'),
        showDesc:     { type: 'select', label: 'Show Description', options: [
          { label: 'Yes', value: 'yes' }, { label: 'No', value: 'no' },
        ]},
        displayMode:  { type: 'select', label: 'Display Mode', options: [
          { label: 'Flat grid (tag filter bar)', value: 'flat' },
          { label: 'Grouped by tag (sections)', value: 'grouped' },
        ]},
        groupOrder:   { type: 'text', label: 'Group Order (comma-separated slugs)' },
        cardRadius:   cardRadiusField(),
      },
      defaultProps: {
        heading: 'Video Gallery', subheading: '', vimeoFolderUrl: '', tags: '', platform: 'all',
        columns: 3, accentColor: '#E85800', bgColor: '#f0f4f8',
        headingColor: '#0d1b2a', showDesc: 'yes', displayMode: 'flat', groupOrder: '', cardRadius: '10px',
      },
      render: function VideoGalleryBlock({ heading, subheading, vimeoFolderUrl, tags: tagsProp, platform, columns, accentColor, bgColor, headingColor, showDesc, displayMode, groupOrder, cardRadius }) {
        const accent   = accentColor  || '#E85800';
        const cols     = Number(columns) || 3;
        const colClass = { 2: 'col-sm-6', 3: 'col-sm-6 col-lg-4', 4: 'col-sm-6 col-xl-3' }[cols] || 'col-sm-6 col-lg-4';

        const [all,      setAll]      = useState([]);
        const [loading,  setLoading]  = useState(true);
        const [fetchErr, setFetchErr] = useState('');
        const [activeTag, setActiveTag] = useState('');
        const [query,    setQuery]    = useState('');
        const [modal,    setModal]    = useState(null); // { platform, video_id, title }

        useEffect(() => {
          setLoading(true);
          setFetchErr('');
          setActiveTag('');
          const folder = (vimeoFolderUrl || '').trim();
          let fetchUrl;
          if (folder) {
            fetchUrl = `${API_BASE}/pub/vimeo/folder?url=${encodeURIComponent(folder)}`;
          } else {
            const qs = new URLSearchParams();
            const t = (tagsProp || '').trim();
            if (t) qs.set('tags', t);
            if (platform && platform !== 'all') qs.set('platform', platform);
            fetchUrl = `${API_BASE}/videos/public?${qs}`;
          }
          fetch(fetchUrl)
            .then(r => r.json())
            .then(d => {
              if (Array.isArray(d)) { setAll(d); }
              else { setAll([]); setFetchErr(d?.error || JSON.stringify(d)); }
            })
            .catch(e => { setAll([]); setFetchErr(e.message); })
            .finally(() => setLoading(false));
        }, [vimeoFolderUrl, tagsProp, platform]);

        const availTags = (() => {
          const s = new Set();
          all.forEach(v => { (Array.isArray(v.tags) ? v.tags : []).forEach(t => s.add(t)); });
          return Array.from(s).sort();
        })();

        const filtered = all.filter(v => {
          if (displayMode !== 'grouped' && activeTag) {
            const vt = Array.isArray(v.tags) ? v.tags : [];
            if (!vt.includes(activeTag)) return false;
          }
          if (query) {
            const q = query.toLowerCase();
            if (!v.title.toLowerCase().includes(q) && !(v.description || '').toLowerCase().includes(q)) return false;
          }
          return true;
        });

        const groupedSections = displayMode === 'grouped' ? (() => {
          const orderList = (groupOrder || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
          const allTagSet = new Set();
          filtered.forEach(v => { (Array.isArray(v.tags) ? v.tags : []).forEach(t => allTagSet.add(t.toLowerCase())); });
          const seen = new Set();
          const ordered = [];
          orderList.forEach(t => { if (allTagSet.has(t)) { ordered.push(t); seen.add(t); } });
          Array.from(allTagSet).sort().forEach(t => { if (!seen.has(t)) ordered.push(t); });
          return ordered;
        })() : null;

        function formatDuration(secs) {
          if (!secs) return '';
          const m = Math.floor(secs / 60);
          const s = secs % 60;
          return `${m}:${String(s).padStart(2, '0')}`;
        }

        function fmtTag(t) { return t.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()); }

        function thumbUrl(v) {
          if (v.thumbnail_url) return v.thumbnail_url;
          if (v.platform === 'youtube') return `https://img.youtube.com/vi/${v.video_id}/hqdefault.jpg`;
          return '';
        }

        function embedUrl(v) {
          if (v.platform === 'youtube') return `https://www.youtube.com/embed/${v.video_id}?autoplay=1&rel=0`;
          if (v.platform === 'vimeo')   return `https://player.vimeo.com/video/${v.video_id}?autoplay=1`;
          return '';
        }

        const PLATFORM_LABEL = { youtube: 'YouTube', vimeo: 'Vimeo' };
        const PLATFORM_COLOR = { youtube: '#ff0000', vimeo: '#1ab7ea' };

        function renderCard(v) {
          const thumb = thumbUrl(v);
          const dur   = formatDuration(v.duration);
          return (
            <div key={v.video_id || v.id} className={colClass}>
              <div
                style={{ background: '#fff', borderRadius: cardRadius ?? 10, overflow: 'hidden', boxShadow: '0 2px 12px rgba(0,0,0,0.08)', cursor: 'pointer', transition: 'transform 0.18s, box-shadow 0.18s', height: '100%', display: 'flex', flexDirection: 'column' }}
                onClick={() => setModal(v)}
                onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-3px)'; e.currentTarget.style.boxShadow = '0 10px 28px rgba(0,0,0,0.14)'; }}
                onMouseLeave={e => { e.currentTarget.style.transform = ''; e.currentTarget.style.boxShadow = '0 2px 12px rgba(0,0,0,0.08)'; }}
              >
                <div style={{ position: 'relative', paddingTop: '56.25%', background: '#1a1a1a', overflow: 'hidden', flexShrink: 0 }}>
                  {thumb && (
                    <img src={resolveUrl(thumb)} alt={v.title} loading="lazy"
                      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
                  )}
                  <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <div style={{ width: 52, height: 52, borderRadius: '50%', background: accent, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 4px 16px rgba(0,0,0,0.4)' }}>
                      <svg viewBox="0 0 24 24" fill="#fff" width="22" height="22" style={{ marginLeft: 3 }}>
                        <path d="M8 5v14l11-7z"/>
                      </svg>
                    </div>
                  </div>
                  <div style={{ position: 'absolute', bottom: 8, right: 8 }}>
                    <span style={{ background: PLATFORM_COLOR[v.platform] || '#333', color: '#fff', fontSize: '0.68rem', fontWeight: 700, padding: '2px 7px', borderRadius: 3, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                      {PLATFORM_LABEL[v.platform] || v.platform}
                    </span>
                  </div>
                  {dur && (
                    <div style={{ position: 'absolute', bottom: 8, left: 8 }}>
                      <span style={{ background: 'rgba(0,0,0,0.72)', color: '#fff', fontSize: '0.72rem', fontWeight: 600, padding: '2px 6px', borderRadius: 3 }}>
                        {dur}
                      </span>
                    </div>
                  )}
                </div>
                <div style={{ padding: '14px 16px 16px', flex: 1, display: 'flex', flexDirection: 'column' }}>
                  <h5 style={{ fontWeight: 700, fontSize: '0.95rem', color: '#0d1b2a', marginBottom: 6, lineHeight: 1.3 }}>{v.title}</h5>
                  {showDesc !== 'no' && v.description && (
                    <p style={{ fontSize: '0.82rem', color: '#6c757d', marginBottom: 8, flex: 1, lineHeight: 1.5 }}>
                      {v.description.length > 100 ? v.description.slice(0, 100) + '…' : v.description}
                    </p>
                  )}
                  {displayMode !== 'grouped' && Array.isArray(v.tags) && v.tags.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 'auto', paddingTop: 8 }}>
                      {v.tags.map(t => (
                        <span key={t} style={{ background: '#f0f4f8', borderRadius: 3, padding: '1px 7px', fontSize: '0.7rem', color: '#6c757d', cursor: 'pointer', textTransform: 'capitalize' }}
                          onClick={e => { e.stopPropagation(); setActiveTag(activeTag === t ? '' : t); }}
                        >{t}</span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        }

        return (
          <section style={{ backgroundColor: bgColor || '#f0f4f8', padding: '4rem 0' }}>
            <div className="container">
              {(heading || subheading) && (
                <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
                  {heading   && <h2 style={{ fontWeight: 700, color: headingColor || '#0d1b2a', marginBottom: '0.5rem' }}>{heading}</h2>}
                  {subheading && <p style={{ color: '#6c757d', maxWidth: 600, margin: '0 auto' }}>{subheading}</p>}
                </div>
              )}

              {((displayMode !== 'grouped' && availTags.length > 1) || all.length > 6) && (
                <div style={{ background: '#fff', borderRadius: 8, padding: '12px 16px', marginBottom: '1.5rem', display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', boxShadow: '0 1px 4px rgba(0,0,0,0.08)' }}>
                  {displayMode !== 'grouped' && availTags.length > 1 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      <button
                        onClick={() => setActiveTag('')}
                        style={{ padding: '4px 12px', borderRadius: 20, border: `2px solid ${!activeTag ? accent : '#dee2e6'}`, background: !activeTag ? accent : 'transparent', color: !activeTag ? '#fff' : '#555', fontWeight: 600, fontSize: '0.8rem', cursor: 'pointer', transition: 'all 0.15s' }}
                      >All</button>
                      {availTags.map(t => (
                        <button
                          key={t}
                          onClick={() => setActiveTag(activeTag === t ? '' : t)}
                          style={{ padding: '4px 12px', borderRadius: 20, border: `2px solid ${activeTag === t ? accent : '#dee2e6'}`, background: activeTag === t ? accent : 'transparent', color: activeTag === t ? '#fff' : '#555', fontWeight: 600, fontSize: '0.8rem', cursor: 'pointer', textTransform: 'capitalize', transition: 'all 0.15s' }}
                        >{t}</button>
                      ))}
                    </div>
                  )}
                  {all.length > 6 && (
                    <input
                      type="search"
                      placeholder="Search videos…"
                      value={query}
                      onChange={e => setQuery(e.target.value)}
                      style={{ marginLeft: 'auto', padding: '5px 12px', borderRadius: 6, border: '1px solid #dee2e6', fontSize: '0.85rem', minWidth: 160 }}
                    />
                  )}
                  <span style={{ marginLeft: 'auto', fontSize: '0.8rem', color: '#999', whiteSpace: 'nowrap' }}>
                    {filtered.length} video{filtered.length !== 1 ? 's' : ''}
                  </span>
                </div>
              )}

              {loading ? (
                <div style={{ textAlign: 'center', padding: '3rem 0' }}>
                  <div className="spinner-border" style={{ color: accent }} />
                </div>
              ) : filtered.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '3rem 0', color: '#999' }}>
                  {fetchErr
                    ? <><strong style={{ color: '#E85800' }}>Error:</strong> {fetchErr}</>
                    : 'No videos found.'}
                </div>
              ) : groupedSections ? (
                <>
                  {groupedSections.map(tag => {
                    const tagVideos = filtered.filter(v => (Array.isArray(v.tags) ? v.tags : []).map(t => t.toLowerCase()).includes(tag));
                    if (!tagVideos.length) return null;
                    return (
                      <div key={tag} style={{ marginBottom: '3rem' }}>
                        <div style={{ marginBottom: '1.25rem' }}>
                          <h3 style={{ fontWeight: 700, color: headingColor || '#0d1b2a', marginBottom: 6, fontSize: '1.4rem' }}>{fmtTag(tag)}</h3>
                          <div style={{ width: 48, height: 3, background: accent, borderRadius: 2 }} />
                        </div>
                        <div className="row g-4">
                          {tagVideos.map(v => renderCard(v))}
                        </div>
                      </div>
                    );
                  })}
                </>
              ) : (
                <div className="row g-4">
                  {filtered.map(v => renderCard(v))}
                </div>
              )}
            </div>

            {/* Lightbox modal */}
            {modal && (
              <div
                style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.88)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}
                onClick={() => setModal(null)}
              >
                <div style={{ width: '100%', maxWidth: 900, position: 'relative' }} onClick={e => e.stopPropagation()}>
                  <button
                    onClick={() => setModal(null)}
                    style={{ position: 'absolute', top: -36, right: 0, background: 'none', border: 'none', color: '#fff', fontSize: '1.5rem', cursor: 'pointer', lineHeight: 1 }}
                  >✕</button>
                  <div style={{ paddingTop: '56.25%', position: 'relative', borderRadius: 8, overflow: 'hidden', background: '#000' }}>
                    <iframe
                      src={embedUrl(modal)}
                      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', border: 0 }}
                      allow="autoplay; fullscreen; picture-in-picture"
                      allowFullScreen
                      title={modal.title}
                    />
                  </div>
                  <div style={{ color: '#fff', textAlign: 'center', marginTop: 12, fontSize: '1rem', fontWeight: 600 }}>{modal.title}</div>
                </div>
              </div>
            )}
          </section>
        );
      },
    },

    // ── Testimonials ─────────────────────────────────────────────────────────
    Testimonials: {
      label: 'Testimonials',
      fields: {
        logo:      imageField('Logo / Top Image (optional, centered above heading)'),
        logoWidth: { type: 'text', label: 'Logo Width (e.g. 120px)' },
        heading:   { type: 'text', label: 'Section Heading' },
        subtext:   { type: 'text', label: 'Subtext' },
        items: {
          type: 'array', label: 'Testimonials',
          arrayFields: {
            quote:    { type: 'textarea', label: 'Quote' },
            author:   { type: 'text', label: 'Author Name' },
            role:     { type: 'text', label: 'Title / Role' },
            avatar:   { type: 'text', label: 'Avatar URL (optional)' },
            rating:   { type: 'number', label: 'Star Rating (1-5, 0 to hide)' },
            tags:     { type: 'text', label: 'Service Tags (comma separated, slider layout only)' },
          },
          defaultItemProps: { quote: 'This is a great product!', author: 'Customer Name', role: 'Role', avatar: '', rating: 5, tags: '' },
        },
        layout:    { type: 'select', label: 'Layout', options: [{ label: 'Grid', value: 'grid' }, { label: 'Slider (dark, one at a time)', value: 'slider' }] },
        columns:   { type: 'select', label: 'Columns (grid layout only)', options: [{ label: '1', value: '1' }, { label: '2', value: '2' }, { label: '3', value: '3' }] },
        bgColor:   colorField('Background Color'),
        cardBg:    colorField('Card Background'),
        textColor: colorField('Text Color'),
        accentColor: colorField('Star / Accent Color'),
        padding:   { type: 'text', label: 'Section Padding' },
        cardRadius: cardRadiusField(),
        animation: animField(),
        animDelay: animDelayField(),
      },
      defaultProps: {
        logo: '', logoWidth: '120px',
        heading: 'What Our Community Says', subtext: '', layout: 'grid', cardRadius: '12px',
        items: [
          { quote: 'The Foundation gives our community a direct way to say thank you and to invest in the safety of the people who protect us every day.', author: 'Local Business Owner', role: 'Longtime VCSF Supporter', avatar: '', rating: 5, tags: '' },
          { quote: 'Shop with a Cop gave my kids a holiday memory they will never forget — and a friend in uniform.', author: 'Camarillo Parent', role: 'Program Family', avatar: '', rating: 5, tags: '' },
          { quote: 'Coppers and Choppers is our favorite free family event of the year. The deputies make everyone feel welcome.', author: 'Ventura Resident', role: 'Event Attendee', avatar: '', rating: 5, tags: '' },
        ],
        columns: '3', bgColor: '#f8f9fa', cardBg: '#ffffff', textColor: '#333', accentColor: '#f59e0b',
        padding: '4rem 2rem', animation: 'none', animDelay: '0',
      },
      render: function TestimonialsBlock({ logo, logoWidth, heading, subtext, items, layout, columns, bgColor, cardBg, textColor, accentColor, padding, cardRadius, animation, animDelay }) {
        const list = items || [];
        const cols = Number(columns) || 3;
        const accent = accentColor || '#f59e0b';
        const [idx, setIdx] = useState(0);

        if (layout === 'slider') {
          const n = list.length || 1;
          const go = (i) => setIdx(((i % n) + n) % n);
          const t = list[idx] || {};
          const tagList = typeof t.tags === 'string' ? t.tags.split(',').map(s => s.trim()).filter(Boolean) : [];
          return (
            <AnimatedBlock animation={animation} delay={Number(animDelay) || 0} style={{ background: bgColor || '#0A1F3D', padding }}>
              <div style={{ maxWidth: 1200, margin: '0 auto', textAlign: 'center' }}>
                {logo && <img src={resolveUrl(logo)} alt="" style={{ width: logoWidth || '120px', margin: '0 auto 2rem', display: 'block' }} />}
                {heading && <h2 style={{ fontWeight: 800, marginBottom: '3rem', color: textColor || '#ffffff' }}>{heading}</h2>}
                <div style={{ position: 'relative', overflow: 'hidden' }}>
                  <div style={{ background: cardBg || 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: cardRadius ?? 28, padding: '3rem', maxWidth: 800, margin: '0 auto', textAlign: 'center' }}>
                    <p style={{ fontSize: '1.25rem', fontStyle: 'italic', color: textColor || '#e5e5e5', lineHeight: 1.7, marginBottom: '2rem' }}>{t.quote}</p>
                    <div style={{ fontWeight: 700, color: '#ffffff', marginBottom: 4 }}>{t.author}</div>
                    {t.role && <div style={{ fontSize: '0.85rem', color: '#9ca3af' }}>{t.role}</div>}
                    {tagList.length > 0 && (
                      <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 12, flexWrap: 'wrap' }}>
                        {tagList.map((tag, ti) => (
                          <span key={ti} style={{ fontSize: '0.7rem', padding: '4px 12px', background: `${accent}1a`, color: accent, borderRadius: 50, fontWeight: 600 }}>{tag}</span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
                {list.length > 1 && (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 16, marginTop: '2rem' }}>
                    <button onClick={() => go(idx - 1)} aria-label="Previous testimonial" style={{ width: 48, height: 48, borderRadius: '50%', border: '1px solid rgba(255,255,255,0.2)', background: 'transparent', color: '#fff', fontSize: '1.25rem', cursor: 'pointer' }}>←</button>
                    <div style={{ display: 'flex', gap: 8 }}>
                      {list.map((_, di) => (
                        <button key={di} onClick={() => go(di)} aria-label={`Testimonial ${di + 1}`}
                          style={{ width: di === idx ? 28 : 10, height: 10, borderRadius: di === idx ? 5 : '50%', background: di === idx ? accent : 'rgba(255,255,255,0.2)', border: 'none', cursor: 'pointer', transition: 'all 0.35s cubic-bezier(0.4,0,0.2,1)' }} />
                      ))}
                    </div>
                    <button onClick={() => go(idx + 1)} aria-label="Next testimonial" style={{ width: 48, height: 48, borderRadius: '50%', border: '1px solid rgba(255,255,255,0.2)', background: 'transparent', color: '#fff', fontSize: '1.25rem', cursor: 'pointer' }}>→</button>
                  </div>
                )}
              </div>
            </AnimatedBlock>
          );
        }

        return (
          <AnimatedBlock animation={animation} delay={Number(animDelay) || 0}
            style={{ background: bgColor || '#f8f9fa', padding }}>
            <div style={{ maxWidth: 1200, margin: '0 auto' }}>
              {logo && <img src={resolveUrl(logo)} alt="" style={{ width: logoWidth || '120px', margin: '0 auto 2rem', display: 'block' }} />}
              {heading && <h2 style={{ textAlign: 'center', fontWeight: 800, marginBottom: subtext ? '0.5rem' : '2rem', color: textColor || '#0d1b2a' }}>{heading}</h2>}
              {subtext && <p style={{ textAlign: 'center', color: textColor ? textColor + 'bb' : '#666', marginBottom: '2rem', fontSize: '1.05rem' }}>{subtext}</p>}
              <div className="lit-responsive-grid" style={{ display: 'grid', gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: '1.5rem' }}>
                {list.map((t, i) => (
                  <div key={i} style={{ background: cardBg || '#fff', borderRadius: cardRadius ?? 12, padding: '1.5rem', boxShadow: '0 2px 12px rgba(0,0,0,0.07)', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                    {(t.rating > 0) && (
                      <div style={{ color: accent }}>{Array.from({ length: Math.min(5, t.rating || 0) }).map((_, s) => <span key={s} style={{ fontSize: '1.1rem' }}>★</span>)}</div>
                    )}
                    <p style={{ color: textColor || '#444', lineHeight: 1.65, fontStyle: 'italic', margin: 0, flex: 1 }}>"{t.quote}"</p>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                      {t.avatar && <img src={resolveUrl(t.avatar)} alt={t.author} style={{ width: 44, height: 44, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} onError={e => { e.target.style.display = 'none'; }} />}
                      <div>
                        <div style={{ fontWeight: 700, color: accentColor || textColor || '#0d1b2a', fontSize: '0.95rem' }}>{t.author}</div>
                        {t.role && <div style={{ fontSize: '0.82rem', color: textColor ? textColor + '99' : '#888' }}>{t.role}</div>}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </AnimatedBlock>
        );
      },
    },

    // ── Stats Row ────────────────────────────────────────────────────────────
    StatsRow: {
      label: 'Stats Row',
      fields: {
        items: {
          type: 'array', label: 'Stats',
          arrayFields: {
            icon:   iconField('Icon (Font Awesome, or paste an emoji — optional)'),
            value:  { type: 'text',   label: 'Value' },
            label:  { type: 'text',   label: 'Label' },
            prefix: { type: 'text',   label: 'Prefix' },
            suffix: { type: 'text',   label: 'Suffix' },
          },
          defaultItemProps: { icon: '', value: '500', label: 'Label', prefix: '', suffix: '+' },
        },
        bgColor:     colorField('Background Color'),
        textColor:   colorField('Number Color'),
        suffixColor: colorField('Suffix Color (defaults to Number Color)'),
        labelColor:  colorField('Label Color'),
        padding:     { type: 'text', label: 'Section Padding' },
        divider:     { type: 'select', label: 'Divider between stats', options: [{ label: 'None', value: 'none' }, { label: 'Line', value: 'line' }, { label: 'Dot', value: 'dot' }] },
        cardStyle:   { type: 'select', label: 'Card Style', options: [{ label: 'Plain (with dividers)', value: 'none' }, { label: 'Bordered Cards', value: 'card' }] },
        cardBg:              colorField('Card Background (card style only)'),
        cardBorderColor:     colorField('Card Border Color (card style only)'),
        cardHoverBg:         colorField('Card Hover Background (card style only)'),
        cardHoverBorderColor: colorField('Card Hover Border Color (card style only)'),
        cardRadius: cardRadiusField('Card Corner Style (card style only)'),
        anchorId:  { type: 'text', label: 'Anchor ID (optional, e.g. "impact" — lets a link elsewhere on the page scroll to here as #impact)' },
        animation: animField(),
        animDelay: animDelayField(),
      },
      defaultProps: {
        items: [
          { icon: '', value: '500', label: 'Flights Completed',  prefix: '', suffix: '+' },
          { icon: '', value: '98',  label: 'Customer Satisfaction', prefix: '', suffix: '%' },
          { icon: '', value: '10',  label: 'Years of Service',   prefix: '', suffix: '+' },
          { icon: '', value: '24',  label: 'Hour Support',       prefix: '', suffix: '/7' },
        ],
        bgColor: '#0A1F3D', textColor: '#ffffff', suffixColor: '', labelColor: '#aab4c8',
        padding: '3rem 2rem', divider: 'line', cardStyle: 'none',
        cardBg: 'rgba(255,255,255,0.04)', cardBorderColor: 'rgba(255,255,255,0.08)',
        cardHoverBg: 'rgba(255,255,255,0.08)', cardHoverBorderColor: 'rgba(201,162,39,0.3)', cardRadius: '20px',
        anchorId: '',
        animation: 'none', animDelay: '0',
      },
      render: ({ items, bgColor, textColor, suffixColor, labelColor, padding, divider, cardStyle,
                 cardBg, cardBorderColor, cardHoverBg, cardHoverBorderColor, cardRadius, anchorId, animation, animDelay }) => {
        const total = (items || []).length;
        const bg = /^(linear|radial)-gradient\(/.test((bgColor || '').trim()) ? { background: bgColor } : { backgroundColor: bgColor || '#0A1F3D' };
        const isCard = cardStyle === 'card';
        return (
          <AnimatedBlock animation={animation} delay={Number(animDelay) || 0}
            id={anchorId || undefined}
            style={{ ...bg, padding, position: 'relative' }}>
            <style>{`
              @media (max-width: 640px) {
                .lit-statsrow-grid { grid-template-columns: repeat(${Math.min(2, total || 1)}, 1fr) !important; row-gap: 1.5rem !important; }
              }
              ${isCard ? `
                .lit-stat-card { transition: background 0.35s cubic-bezier(0.4,0,0.2,1), border-color 0.35s cubic-bezier(0.4,0,0.2,1), transform 0.35s cubic-bezier(0.4,0,0.2,1); }
                .lit-stat-card:hover { background: ${cardHoverBg || 'rgba(255,255,255,0.08)'} !important; border-color: ${cardHoverBorderColor || 'rgba(201,162,39,0.3)'} !important; transform: translateY(-4px); }
              ` : ''}
            `}</style>
            <div className="lit-statsrow-grid" style={{ maxWidth: 1100, margin: '0 auto', position: 'relative', display: 'grid', gridTemplateColumns: `repeat(${total}, 1fr)`, alignItems: 'stretch', gap: isCard ? '2rem' : '1rem' }}>
              {(items || []).map((s, i) => (
                <div key={i} className={isCard ? 'lit-stat-card' : undefined}
                  style={isCard
                    ? { textAlign: 'center', padding: '2rem 1.25rem', background: cardBg || 'rgba(255,255,255,0.04)', border: `1px solid ${cardBorderColor || 'rgba(255,255,255,0.08)'}`, borderRadius: cardRadius ?? 20 }
                    : { textAlign: 'center', position: 'relative', padding: '0 1rem' }}>
                  {!isCard && divider === 'line' && i > 0 && <div style={{ position: 'absolute', left: 0, top: '15%', height: '70%', width: 1, background: (textColor || '#fff') + '33' }} />}
                  {!isCard && divider === 'dot'  && i > 0 && <div style={{ position: 'absolute', left: -4, top: '50%', transform: 'translateY(-50%)', width: 8, height: 8, borderRadius: '50%', background: (textColor || '#fff') + '55' }} />}
                  {isCard && s.icon && <div style={{ fontSize: '2rem', marginBottom: 12 }}>{renderIconValue(s.icon, { fontSize: '2rem' })}</div>}
                  <div style={{ fontSize: isCard ? 'clamp(2rem, 4vw, 3rem)' : '2.5rem', fontWeight: isCard ? 800 : 900, color: textColor || '#fff', lineHeight: 1 }}>
                    {s.prefix}{s.value}<span style={{ color: suffixColor || textColor || '#fff' }}>{s.suffix}</span>
                  </div>
                  <div style={{ fontSize: isCard ? '0.9rem' : '0.88rem', color: labelColor || '#aab4c8', marginTop: isCard ? '0.5rem' : '0.4rem', fontWeight: 500 }}>{s.label}</div>
                </div>
              ))}
            </div>
          </AnimatedBlock>
        );
      },
    },

    // ── Icon Feature Grid ────────────────────────────────────────────────────
    IconFeatureGrid: {
      label: 'Icon Feature Grid',
      fields: {
        heading:  { type: 'text', label: 'Section Heading' },
        subtext:  { type: 'text', label: 'Subtext' },
        columns:  { type: 'select', label: 'Columns', options: [{ label: '2', value: '2' }, { label: '3', value: '3' }, { label: '4', value: '4' }] },
        items: {
          type: 'array', label: 'Features',
          arrayFields: {
            icon:    iconField('Icon (Font Awesome — e.g. fa-solid fa-star)'),
            title:   { type: 'text', label: 'Title' },
            body:    { type: 'textarea', label: 'Description' },
          },
          defaultItemProps: { icon: 'fa-solid fa-star', title: 'Feature Title', body: 'Describe this feature in a sentence or two.' },
        },
        iconBg:    colorField('Icon Background'),
        iconColor: colorField('Icon Color'),
        bgColor:   colorField('Section Background'),
        textColor: colorField('Text Color'),
        padding:   { type: 'text', label: 'Section Padding' },
        centered:  { type: 'select', label: 'Alignment', options: [{ label: 'Left', value: 'left' }, { label: 'Center', value: 'center' }] },
        cardStyle:       { type: 'select', label: 'Card Style', options: [{ label: 'Plain', value: 'plain' }, { label: 'Bordered Card (dark, hover-fill)', value: 'card' }] },
        cardBg:          colorField('Card Background (card style only)'),
        cardBorderColor: colorField('Card Border Color (card style only)'),
        cardRadius:      cardRadiusField('Card Corner Style (card style only)'),
        subtextColor:    colorField('Subtext / Body Color'),
        animation: animField(),
        animDelay: animDelayField(),
      },
      defaultProps: {
        heading: 'Why Choose Us', subtext: '', columns: '3', cardRadius: '20px',
        items: [
          { icon: 'fa-solid fa-shield-halved', title: 'Direct Support', body: 'Every dollar goes directly to VCSO — equipment, training, scholarships, and community programs.' },
          { icon: 'fa-solid fa-people-group', title: 'Community First', body: 'Programs that put deputies and residents side-by-side in positive, humanizing settings.' },
          { icon: 'fa-solid fa-scale-balanced', title: 'Transparency', body: 'An independent 501(c)(3) with measurable impact and full accountability.' },
        ],
        iconBg: '#eff6ff', iconColor: '#2563eb', bgColor: '#ffffff', textColor: '#333333', subtextColor: '',
        padding: '4rem 2rem', centered: 'center', cardStyle: 'plain',
        cardBg: 'rgba(255,255,255,0.04)', cardBorderColor: 'rgba(255,255,255,0.08)',
        animation: 'none', animDelay: '0',
      },
      render: ({ heading, subtext, columns, items, iconBg, iconColor, bgColor, textColor, subtextColor, padding, centered, cardStyle, cardBg, cardBorderColor, cardRadius, animation, animDelay }) => {
        const cols = Number(columns) || 3;
        const align = centered === 'center' ? 'center' : 'left';
        const isCard = cardStyle === 'card';
        const acc = iconColor || '#2563eb';
        return (
          <AnimatedBlock animation={animation} delay={Number(animDelay) || 0}
            style={{ background: bgColor || '#fff', padding, position: 'relative' }}>
            {isCard && (
              <style>{`
                .lit-why-card { position: relative; overflow: hidden; transition: transform 0.35s cubic-bezier(0.4,0,0.2,1), border-color 0.35s cubic-bezier(0.4,0,0.2,1); }
                .lit-why-card::after { content: ''; position: absolute; bottom: 0; left: 0; right: 0; height: 0; background: linear-gradient(135deg, ${acc}, ${acc}); opacity: 0.08; transition: height 0.35s cubic-bezier(0.4,0,0.2,1); }
                .lit-why-card:hover { transform: translateY(-6px); border-color: ${acc}4d !important; }
                .lit-why-card:hover::after { height: 100%; }
                .lit-why-card > * { position: relative; z-index: 1; }
              `}</style>
            )}
            <div style={{ maxWidth: 1200, margin: '0 auto', position: 'relative' }}>
              {heading && <h2 style={{ textAlign: 'center', fontWeight: 800, marginBottom: subtext ? '0.5rem' : '2.5rem', color: textColor || '#0d1b2a' }}>{heading}</h2>}
              {subtext && <p style={{ textAlign: 'center', color: subtextColor || '#666', marginBottom: '2.5rem', fontSize: '1.05rem', maxWidth: 640, marginLeft: 'auto', marginRight: 'auto' }}>{subtext}</p>}
              <div className="lit-responsive-grid" style={{ display: 'grid', gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: isCard ? '1.5rem' : '2rem' }}>
                {(items || []).map((f, i) => {
                  return (
                    <div key={i} className={isCard ? 'lit-why-card' : undefined}
                      style={isCard
                        ? { padding: '2.25rem 1.75rem', background: cardBg || 'rgba(255,255,255,0.04)', border: `1px solid ${cardBorderColor || 'rgba(255,255,255,0.08)'}`, borderRadius: cardRadius ?? 20, textAlign: align, display: 'flex', flexDirection: 'column', alignItems: align === 'center' ? 'center' : 'flex-start', gap: '0.75rem' }
                        : { textAlign: align, display: 'flex', flexDirection: 'column', alignItems: align === 'center' ? 'center' : 'flex-start', gap: '0.75rem' }}>
                      <div style={{ width: 56, height: 56, borderRadius: 12, background: iconBg || '#eff6ff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        {renderIconValue(f.icon || '⭐', { fontSize: '1.5rem', color: acc })}
                      </div>
                      <h3 style={{ fontWeight: 700, fontSize: '1.05rem', color: textColor || '#0d1b2a', margin: 0 }}>{f.title}</h3>
                      <p style={{ color: subtextColor || (textColor ? textColor + 'cc' : '#666'), lineHeight: 1.6, margin: 0, fontSize: '0.92rem' }}>{f.body}</p>
                    </div>
                  );
                })}
              </div>
            </div>
          </AnimatedBlock>
        );
      },
    },

    // ── Tech Stack Tabs ──────────────────────────────────────────────────────
    TechStackTabs: {
      label: 'Tech Stack Tabs',
      fields: {
        eyebrow:      { type: 'text', label: 'Eyebrow Label' },
        heading:      { type: 'text', label: 'Heading' },
        subtext:      { type: 'text', label: 'Subtext' },
        bgColor:      colorField('Background Color'),
        headingColor: colorField('Heading Color'),
        subtextColor: colorField('Subtext Color'),
        accentColor:  colorField('Accent Color'),
        tabs: {
          type: 'array', label: 'Tabs',
          arrayFields: {
            label: { type: 'text', label: 'Tab Label' },
            items: {
              type: 'array', label: 'Items',
              arrayFields: {
                icon:  { type: 'text', label: 'Icon (short text/glyph, e.g. "A" or "3CX")' },
                label: { type: 'text', label: 'Label' },
              },
              defaultItemProps: { icon: 'A', label: 'Item' },
            },
          },
          defaultItemProps: { label: 'Tab', items: [{ icon: 'A', label: 'Item' }] },
          getItemSummary: (item) => item.label || 'Tab',
        },
        cardRadius: cardRadiusField('Item Corner Style'),
        animation: animField(),
        animDelay: animDelayField(),
      },
      defaultProps: {
        eyebrow: 'Partners & Certifications', heading: 'Technologies We Master',
        subtext: 'Certified expertise across industry-leading platforms, vendors, and security frameworks.',
        bgColor: '#0A1F3D', headingColor: '#ffffff', subtextColor: '#9ca3af', accentColor: '#C9A227', cardRadius: '12px',
        tabs: [
          { label: 'Software Vendors', items: [{ icon: 'A', label: 'Acronis' }, { icon: '3', label: '3CX' }] },
          { label: 'Hardware Vendors', items: [{ icon: 'H', label: 'HP' }] },
          { label: 'Certifications', items: [{ icon: 'S+', label: 'CompTIA Security+' }] },
        ],
        animation: 'none', animDelay: '0',
      },
      render: function TechStackTabsBlock({ eyebrow, heading, subtext, bgColor, headingColor, subtextColor, accentColor, tabs, cardRadius, animation, animDelay }) {
        const list = Array.isArray(tabs) ? tabs : [];
        const [active, setActive] = useState(0);
        const acc = accentColor || '#C9A227';
        const activeItems = (list[active]?.items) || [];
        return (
          <AnimatedBlock animation={animation} delay={Number(animDelay) || 0} style={{ background: bgColor || '#0A1F3D', padding: '6rem 0' }}>
            <style>{`
              .lit-tech-tab { transition: color 0.35s cubic-bezier(0.4,0,0.2,1), border-color 0.35s cubic-bezier(0.4,0,0.2,1), background 0.35s cubic-bezier(0.4,0,0.2,1); }
              .lit-tech-tab:hover:not(.active) { color: ${acc}; border-color: ${acc}; }
              .lit-tech-item { transition: background 0.35s cubic-bezier(0.4,0,0.2,1), transform 0.35s cubic-bezier(0.4,0,0.2,1), border-color 0.35s cubic-bezier(0.4,0,0.2,1); }
              .lit-tech-item:hover { background: rgba(255,255,255,0.08); transform: translateY(-4px); border-color: ${acc}4d; }
              @keyframes lit-tech-fade { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: translateY(0); } }
            `}</style>
            <div className="container" style={{ maxWidth: 1200, margin: '0 auto', padding: '0 1.5rem' }}>
              <div style={{ textAlign: 'center', marginBottom: '2.5rem' }}>
                {eyebrow && (
                  <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
                    <span style={{ color: acc, fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.15em' }}>{eyebrow}</span>
                  </div>
                )}
                {heading && <h2 style={{ color: headingColor || '#fff', fontWeight: 800, fontSize: 'clamp(1.6rem, 3vw, 2.4rem)', marginBottom: '0.75rem' }}>{heading}</h2>}
                {subtext && <p style={{ color: subtextColor || '#9ca3af', maxWidth: 640, margin: '0 auto' }}>{subtext}</p>}
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center', marginBottom: '2.5rem' }}>
                {list.map((tab, i) => (
                  <button key={i} onClick={() => setActive(i)} className={`lit-tech-tab${i === active ? ' active' : ''}`}
                    style={{
                      padding: '10px 20px', fontSize: '0.85rem', fontWeight: 600, borderRadius: 50, cursor: 'pointer',
                      border: `1px solid ${i === active ? 'transparent' : '#4a4a4a'}`,
                      background: i === active ? `linear-gradient(135deg, #DDBC4E, ${acc})` : 'transparent',
                      color: i === active ? '#fff' : '#9ca3af',
                    }}>{tab.label}</button>
                ))}
              </div>
              <div key={active} className="lit-responsive-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 16, animation: 'lit-tech-fade 0.4s ease' }}>
                {activeItems.map((item, i) => (
                  <div key={i} className="lit-tech-item" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, padding: '24px 16px', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: cardRadius ?? 12, textAlign: 'center' }}>
                    <div style={{ width: 48, height: 48, background: `${acc}1a`, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.1rem', fontWeight: 800, color: acc }}>{item.icon}</div>
                    <span style={{ fontSize: '0.8rem', fontWeight: 600, color: '#e5e5e5' }}>{item.label}</span>
                  </div>
                ))}
              </div>
            </div>
          </AnimatedBlock>
        );
      },
    },

    // ── Blog Feed ────────────────────────────────────────────────────────────
    BlogFeed: {
      label: 'Blog Feed',
      fields: {
        heading:  { type: 'text', label: 'Section Heading' },
        subtext:  { type: 'text', label: 'Subtext (optional)' },
        maxPosts: { type: 'number', label: 'Max Posts (0 = show all)' },
        columns:  { type: 'select', label: 'Columns', options: [{ label: '2', value: '2' }, { label: '3', value: '3' }] },
        bgColor:  colorField('Background Color'),
        padding:  { type: 'text', label: 'Section Padding' },
        cardRadius: cardRadiusField(),
      },
      defaultProps: {
        id: '',
        heading: 'News & Updates',
        subtext: '',
        maxPosts: 0,
        columns: '3',
        bgColor: '',
        padding: '3rem 0',
        cardRadius: '20px',
      },
      render: function BlogFeedBlock({ heading, subtext, maxPosts, columns, bgColor, padding, cardRadius }) {
        const [posts,   setPosts]   = useState([]);
        const [loading, setLoading] = useState(true);
        const SPA_NAVY = '#0d1b2a';
        const cols = Number(columns) || 3;

        useEffect(() => {
          fetch(`${API_BASE}/cms/blog`)
            .then(r => r.ok ? r.json() : [])
            .then(data => {
              let list = (data || []).filter(p => p.status === 'published');
              if (maxPosts > 0) list = list.slice(0, maxPosts);
              setPosts(list);
            })
            .catch(() => {})
            .finally(() => setLoading(false));
        }, [maxPosts]);

        function fmtDate(d) {
          if (!d) return '';
          return new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
        }

        return (
          <section style={{ background: bgColor || 'transparent', padding: padding || '3rem 0' }}>
            <div className="container">
              {heading && (
                <div className="text-center mb-4">
                  <h2 className="fw-bold" style={{ color: SPA_NAVY }}>{heading}</h2>
                  {subtext && <p className="text-muted mt-2">{subtext}</p>}
                </div>
              )}
              {loading ? (
                <div className="text-center py-5"><span className="spinner-border text-primary" /></div>
              ) : posts.length === 0 ? (
                <div className="text-center py-5">
                  <div style={{ fontSize: '3rem' }}>📝</div>
                  <p className="text-muted mt-2">No posts yet. Check back soon.</p>
                </div>
              ) : (
                <div className={`row g-4 row-cols-1 row-cols-md-2 row-cols-lg-${cols}`}>
                  {posts.map(post => (
                    <div key={post.id} className="col">
                      <a href={`/blog/${post.slug}`} style={{ textDecoration: 'none' }}>
                        <div
                          className="card h-100 border"
                          style={{ '--bs-card-border-radius': cardRadius ?? '20px', '--bs-card-inner-border-radius': cardRadius ?? '20px', borderColor: '#e5e5e5', overflow: 'hidden', boxShadow: 'none', transition: 'transform 0.35s cubic-bezier(0.4,0,0.2,1), box-shadow 0.35s cubic-bezier(0.4,0,0.2,1)' }}
                          onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-6px)'; e.currentTarget.style.boxShadow = '0 20px 60px rgba(201,162,39,0.22)'; }}
                          onMouseLeave={e => { e.currentTarget.style.transform = ''; e.currentTarget.style.boxShadow = 'none'; }}
                        >
                          {post.og_image ? (
                            <img
                              src={post.og_image}
                              alt={post.title}
                              className="card-img-top"
                              style={{ height: 180, objectFit: 'cover' }}
                              onError={e => { e.target.style.display = 'none'; }}
                            />
                          ) : (
                            <div style={{ height: 180, background: 'linear-gradient(135deg, #0A1F3D, #C9A227)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '3rem' }}>📝</div>
                          )}
                          <div className="card-body p-4">
                            <p className="small mb-2" style={{ color: 'var(--brand-primary)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                              {fmtDate(post.published_at)}
                              {post.author_name && <> &bull; {post.author_name}</>}
                            </p>
                            <h5 className="card-title fw-bold mb-2" style={{ color: SPA_NAVY, lineHeight: 1.3 }}>
                              {post.title}
                            </h5>
                            {post.excerpt && (
                              <p className="card-text text-muted small" style={{ display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                                {post.excerpt}
                              </p>
                            )}
                          </div>
                          <div className="card-footer bg-transparent border-0 px-4 pb-4">
                            <span style={{ color: 'var(--brand-primary)', fontWeight: 600, fontSize: '0.875rem' }}>Read more &rarr;</span>
                          </div>
                        </div>
                      </a>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>
        );
      },
    },

    // ── Video Hero ───────────────────────────────────────────────────────────
    VideoHero: {
      label: 'Video Hero',
      fields: {
        video_url:    { type: 'text',   label: 'Video URL', description: 'YouTube, Vimeo, or direct MP4 URL' },
        video_type:   { type: 'select', label: 'Video Type', options: [{ label: 'YouTube', value: 'youtube' }, { label: 'Vimeo', value: 'vimeo' }, { label: 'MP4 / Direct', value: 'mp4' }] },
        headline:     { type: 'text',   label: 'Headline' },
        subheadline:  { type: 'text',   label: 'Sub-headline' },
        cta_text:     { type: 'text',   label: 'Primary CTA Label' },
        cta_url:      { type: 'text',   label: 'Primary CTA URL' },
        cta2_text:    { type: 'text',   label: 'Secondary CTA Label (optional)' },
        cta2_url:     { type: 'text',   label: 'Secondary CTA URL' },
        overlay_opacity: { type: 'number', label: 'Overlay Opacity (0–90)', min: 0, max: 90 },
        overlay_color:   colorField('Overlay Color'),
        text_color:      colorField('Text Color'),
        height:       { type: 'select', label: 'Section Height', options: [{ label: 'Full screen', value: 'screen' }, { label: 'Large (80vh)', value: 'large' }, { label: 'Medium (60vh)', value: 'medium' }] },
        text_align:   { type: 'select', label: 'Text Alignment', options: [{ label: 'Center', value: 'center' }, { label: 'Left', value: 'left' }] },
        cta_bg:       colorField('Primary CTA Background'),
      },
      defaultProps: {
        video_url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        video_type: 'youtube',
        headline: 'Supporting Our Deputies. Strengthening Our Community.',
        subheadline: 'The Ventura County Sheriff\'s Foundation builds partnerships between the community and the VCSO.',
        cta_text: 'Donate Today', cta_url: '/support',
        cta2_text: 'Explore Programs', cta2_url: '/programs',
        overlay_opacity: 55, overlay_color: '#000000',
        text_color: '#ffffff', height: 'screen', text_align: 'center',
        cta_bg: '#C9A227',
      },
      render: ({ video_url, video_type, headline, subheadline, cta_text, cta_url,
                 cta2_text, cta2_url, overlay_opacity, overlay_color, text_color,
                 height, text_align, cta_bg }) => {
        const heightMap = { screen: '100vh', large: '80vh', medium: '60vh' };
        const sectionH  = heightMap[height] || '100vh';
        const overlayA  = Math.min(90, Math.max(0, Number(overlay_opacity) || 55)) / 100;
        const overlayC  = overlay_color || '#000';

        let embedSrc = '';
        if (video_type === 'youtube' && video_url) {
          const m = video_url.match(/(?:youtu\.be\/|v=|embed\/)([A-Za-z0-9_-]{11})/);
          const vid = m?.[1] || '';
          embedSrc = vid ? `https://www.youtube.com/embed/${vid}?autoplay=1&mute=1&loop=1&playlist=${vid}&controls=0&showinfo=0&rel=0&enablejsapi=0` : '';
        } else if (video_type === 'vimeo' && video_url) {
          const m = video_url.match(/vimeo\.com\/(\d+)/);
          const vid = m?.[1] || '';
          embedSrc = vid ? `https://player.vimeo.com/video/${vid}?autoplay=1&muted=1&loop=1&background=1` : '';
        }

        return (
          <section style={{ position: 'relative', height: sectionH, overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: text_align === 'left' ? 'flex-start' : 'center' }}>
            {/* Video background */}
            {video_type === 'mp4' && video_url ? (
              <video autoPlay muted loop playsInline style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', zIndex: 0 }}>
                <source src={resolveUrl(video_url)} type="video/mp4" />
              </video>
            ) : embedSrc ? (
              <iframe src={embedSrc} allow="autoplay; encrypted-media" frameBorder="0"
                style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', width: '177.78vh', height: '100vh', minWidth: '100%', minHeight: '56.25vw', zIndex: 0, pointerEvents: 'none' }} />
            ) : (
              <div style={{ position: 'absolute', inset: 0, background: '#1a1a2e', zIndex: 0 }} />
            )}

            {/* Overlay */}
            <div style={{ position: 'absolute', inset: 0, background: overlayC, opacity: overlayA, zIndex: 1 }} />

            {/* Content */}
            <div style={{ position: 'relative', zIndex: 2, padding: '0 1.5rem', maxWidth: 800, textAlign: text_align || 'center', marginLeft: text_align === 'left' ? '8vw' : 'auto', marginRight: 'auto' }}>
              {headline && (
                <h1 style={{ color: text_color || '#fff', fontSize: 'clamp(2rem, 5vw, 3.5rem)', fontWeight: 900, lineHeight: 1.1, marginBottom: '1rem', textShadow: '0 2px 16px rgba(0,0,0,0.4)' }}>
                  {headline}
                </h1>
              )}
              {subheadline && (
                <p style={{ color: text_color || '#fff', fontSize: 'clamp(1rem, 2.2vw, 1.4rem)', opacity: 0.92, marginBottom: '2.2rem', textShadow: '0 1px 8px rgba(0,0,0,0.4)', lineHeight: 1.5 }}>
                  {subheadline}
                </p>
              )}
              <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', justifyContent: text_align === 'left' ? 'flex-start' : 'center' }}>
                {cta_text && (
                  <a href={cta_url || '#'} style={{ display: 'inline-block', background: cta_bg || '#C9A227', color: '#fff', padding: '0.85rem 2rem', borderRadius: 50, fontWeight: 700, fontSize: '1rem', textDecoration: 'none', letterSpacing: '0.03em', boxShadow: '0 4px 16px rgba(0,0,0,0.25)' }}>
                    {cta_text}
                  </a>
                )}
                {cta2_text && (
                  <a href={cta2_url || '#'} style={{ display: 'inline-block', background: 'rgba(255,255,255,0.15)', color: text_color || '#fff', padding: '0.85rem 2rem', borderRadius: 50, fontWeight: 600, fontSize: '1rem', textDecoration: 'none', border: `1px solid rgba(255,255,255,0.5)`, backdropFilter: 'blur(4px)' }}>
                    {cta2_text}
                  </a>
                )}
              </div>
            </div>
          </section>
        );
      },
    },

    // ── Services List ────────────────────────────────────────────────────────
    ServicesList: {
      label: 'Services List',
      fields: {
        heading:    { type: 'text',   label: 'Section Heading' },
        subheading: { type: 'text',   label: 'Sub-heading' },
        layout:     { type: 'select', label: 'Layout', options: [{ label: 'Cards (grid)', value: 'cards' }, { label: 'Rows (left icon)', value: 'rows' }, { label: 'Featured (alternating)', value: 'featured' }] },
        columns:    { type: 'select', label: 'Columns (cards only)', options: [{ label: '2 Columns', value: '2' }, { label: '3 Columns', value: '3' }, { label: '4 Columns', value: '4' }] },
        services:   { type: 'array',  label: 'Services', arrayFields: {
          icon:        iconField('Icon (Font Awesome, or paste an emoji)'),
          badge:       { type: 'text',     label: 'Badge / Eyebrow (optional, e.g. "COMMUNITY ENGAGEMENT" — featured layout only)' },
          title:       { type: 'text',     label: 'Service Title' },
          description: { type: 'textarea', label: 'Description (blank line = paragraph break)' },
          highlight:   { type: 'textarea', label: 'Bold Closing Sentence (optional, featured layout only)' },
          tags:        { type: 'text',     label: 'Tags (comma separated, cards layout only)' },
          price:       { type: 'text',     label: 'Price / Starting From (optional)' },
          link_url:    { type: 'text',     label: 'Learn More URL (optional)' },
          link_text:   { type: 'text',     label: 'Link Label' },
          link_style:  { type: 'select',   label: 'Link Style (featured layout only)', options: [{ label: 'Filled Button', value: 'button' }, { label: 'Text Link', value: 'text' }] },
          image_url:   imageField('Image (featured layout)'),
        }},
        bg_color:     colorField('Background Color'),
        text_color:   colorField('Text Color'),
        accent_color: colorField('Accent / Card Top Color'),
        showNumbers:  { type: 'select', label: 'Show Numbered Badge (cards layout)', options: [{ label: 'Yes', value: 'yes' }, { label: 'No', value: 'no' }] },
        cta_text:     { type: 'text', label: 'Section CTA Button Label' },
        cta_url:      { type: 'text', label: 'Section CTA URL' },
        cardRadius:   cardRadiusField('Card Corner Style (cards layout only)'),
        imageRadius:  imageRadiusField('Image Corner Style (featured layout only)'),
        itemCard:     { type: 'select', label: 'Each Item Card (featured layout only)', options: [{ label: 'None (flush with page background)', value: 'none' }, { label: 'Bordered White Card', value: 'card' }] },
        itemCardRadius: cardRadiusField('Item Card Corner Style (featured layout only)'),
        itemImageMinHeight: { type: 'text', label: 'Image Min Height (featured layout only, e.g. 320px)' },
        anim_type:    animField(),
        anim_delay:   animDelayField(),
      },
      defaultProps: {
        heading: 'Programs & Impact', subheading: 'How we support our deputies and community.',
        layout: 'cards', columns: '3', cardRadius: '20px', imageRadius: '12px',
        itemCard: 'none', itemCardRadius: '24px', itemImageMinHeight: '240px',
        services: [
          { icon: '🎁', badge: '', title: 'Shop with a Cop', description: 'Annual holiday program pairing deputies with under-resourced children for shopping, meals, and relationship building.', price: '', link_url: '/programs', link_text: 'Learn More', link_style: 'button', image_url: '' },
          { icon: '🚁', badge: '', title: 'Coppers and Choppers', description: 'Free annual family event at Camarillo Airport showcasing SWAT, K9, Air Unit, Search & Rescue, and more.', price: '', link_url: '/programs', link_text: 'Learn More', link_style: 'button', image_url: '' },
          { icon: '🎓', badge: '', title: 'Grossman Scholarship', description: '$2,500 scholarships for children of VCSO employees, plus grants for equipment and training.', price: '', link_url: '/programs', link_text: 'Learn More', link_style: 'button', image_url: '' },
        ],
        bg_color: '#ffffff', text_color: '#1a202c', accent_color: '#C9A227', showNumbers: 'no',
        cta_text: '', cta_url: '', anim_type: 'none', anim_delay: '0',
      },
      render: ({ heading, subheading, layout, columns, services, bg_color, text_color, accent_color, showNumbers, cta_text, cta_url, cardRadius, imageRadius, itemCard, itemCardRadius, itemImageMinHeight, anim_type, anim_delay }) => {
        const list  = Array.isArray(services) ? services : [];
        const cols  = Number(columns) || 3;
        const acc   = accent_color || '#C9A227';

        if (layout === 'featured') {
          return (
            <AnimatedBlock animation={anim_type} delay={Number(anim_delay) || 0} style={{ background: bg_color || '#fff', padding: '5rem 0', color: text_color || '#1a202c' }} className="spa-section">
              <style>{`
                @media (max-width: 768px) {
                  .lit-services-split { grid-template-columns: 1fr !important; }
                }
              `}</style>
              <div className="site-container">
                {heading && <h2 style={{ textAlign: 'center', fontSize: 'clamp(1.6rem,3vw,2.5rem)', fontWeight: 800, marginBottom: subheading ? '0.5rem' : '3rem', color: text_color || '#1a202c' }}>{heading}</h2>}
                {subheading && <p style={{ textAlign: 'center', color: '#6c757d', marginBottom: '3rem' }}>{subheading}</p>}
                {list.map((s, i) => {
                  const isCardMode = itemCard === 'card';
                  const minH = itemImageMinHeight || '240px';
                  // Card mode: the image is edge-to-edge in its half of the card
                  // (no radius/padding of its own) — the OUTER card's
                  // overflow:hidden + border-radius clips its outer corners,
                  // matching the reference's bg-white rounded-3xl overflow-hidden
                  // wrapper with a flush h-full image column. Non-card mode keeps
                  // its own rounded image (no outer card to clip against).
                  const imgBox = <div style={{ background: '#f0f2f5', borderRadius: isCardMode ? 0 : (imageRadius ?? 12), minHeight: minH, height: '100%', overflow: 'hidden' }}>
                    {s.image_url ? <img src={resolveUrl(s.image_url)} alt={s.title} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: minH, fontSize: '4rem' }}>{renderIconValue(s.icon, { fontSize: '4rem' })}</div>}
                  </div>;
                  const textBox = <div style={{ padding: isCardMode ? 'clamp(2.25rem, 4vw, 3rem)' : 0 }}>
                    <div style={{ fontSize: '2.5rem', marginBottom: '1rem' }}>{renderIconValue(s.icon, { fontSize: '2.5rem' })}</div>
                    {s.badge && <div style={{ display: 'inline-block', padding: '0.35rem 0.85rem', background: acc, color: '#0A1F3D', fontSize: '0.75rem', fontWeight: 700, borderRadius: 4, marginBottom: '0.75rem' }}>{s.badge}</div>}
                    <h3 style={{ fontSize: '1.6rem', fontWeight: 800, color: text_color || '#1a202c', marginBottom: '1rem' }}>{s.title}</h3>
                    <p style={{ color: '#555', lineHeight: 1.7, marginBottom: s.highlight ? '0.75rem' : '1.2rem', whiteSpace: 'pre-line' }}>{s.description}</p>
                    {s.highlight && <p style={{ color: text_color || '#0A1F3D', fontWeight: 600, lineHeight: 1.7, marginBottom: '1.2rem' }}>{s.highlight}</p>}
                    {s.price && <p style={{ fontWeight: 700, color: acc, fontSize: '1.1rem', marginBottom: '1rem' }}>{s.price}</p>}
                    {s.link_url && (s.link_style === 'text'
                      ? <a href={s.link_url} style={{ color: acc, fontWeight: 600, fontSize: '0.95rem', textDecoration: 'none' }}>{s.link_text || 'Learn More'}</a>
                      : <a href={s.link_url} style={{ display: 'inline-block', padding: '0.65rem 1.5rem', background: acc, color: '#fff', borderRadius: 50, fontWeight: 700, fontSize: '0.9rem', textDecoration: 'none' }}>{s.link_text || 'Learn More'}</a>
                    )}
                  </div>;
                  const row = i % 2 === 0
                    ? <div className="lit-services-split" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: isCardMode ? 0 : '3rem', alignItems: 'stretch' }}>{textBox}{imgBox}</div>
                    : <div className="lit-services-split" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: isCardMode ? 0 : '3rem', alignItems: 'stretch' }}>{imgBox}{textBox}</div>;
                  return isCardMode ? (
                    <div key={i} style={{ background: '#fff', border: '1px solid #e5e5e5', borderRadius: itemCardRadius || '24px', marginBottom: '2rem', overflow: 'hidden' }}>{row}</div>
                  ) : (
                    <div key={i} style={{ marginBottom: '4rem' }}>{row}</div>
                  );
                })}
                {cta_text && <div style={{ textAlign: 'center', marginTop: '1rem' }}><a href={cta_url || '#'} style={{ display: 'inline-block', padding: '0.85rem 2.5rem', background: acc, color: '#fff', borderRadius: 50, fontWeight: 700, fontSize: '1rem', textDecoration: 'none' }}>{cta_text}</a></div>}
              </div>
            </AnimatedBlock>
          );
        }

        if (layout === 'rows') {
          return (
            <AnimatedBlock animation={anim_type} delay={Number(anim_delay) || 0} style={{ background: bg_color || '#fff', padding: '5rem 1.5rem', color: text_color || '#1a202c' }} className="spa-section">
              <div style={{ maxWidth: 900, margin: '0 auto' }}>
                {heading && <h2 style={{ textAlign: 'center', fontSize: 'clamp(1.6rem,3vw,2.5rem)', fontWeight: 800, marginBottom: subheading ? '0.5rem' : '2.5rem', color: text_color || '#1a202c' }}>{heading}</h2>}
                {subheading && <p style={{ textAlign: 'center', color: '#6c757d', marginBottom: '2.5rem' }}>{subheading}</p>}
                {list.map((s, i) => (
                  <div key={i} style={{ display: 'flex', gap: '1.5rem', alignItems: 'flex-start', padding: '1.5rem 0', borderBottom: i < list.length - 1 ? '1px solid #e9ecef' : 'none' }}>
                    <div style={{ flexShrink: 0, width: 52, height: 52, background: `${acc}18`, borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.5rem' }}>{renderIconValue(s.icon, { fontSize: '1.5rem', color: acc })}</div>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap', marginBottom: '0.4rem' }}>
                        <h3 style={{ fontSize: '1.1rem', fontWeight: 700, color: text_color || '#1a202c', margin: 0 }}>{s.title}</h3>
                        {s.price && <span style={{ fontWeight: 700, color: acc, fontSize: '0.95rem', whiteSpace: 'nowrap' }}>{s.price}</span>}
                      </div>
                      <p style={{ color: '#555', lineHeight: 1.6, margin: '0 0 0.5rem' }}>{s.description}</p>
                      {s.link_url && <a href={s.link_url} style={{ color: acc, fontWeight: 600, fontSize: '0.88rem', textDecoration: 'none' }}>{s.link_text || 'Learn More'} →</a>}
                    </div>
                  </div>
                ))}
                {cta_text && <div style={{ textAlign: 'center', marginTop: '2rem' }}><a href={cta_url || '#'} style={{ display: 'inline-block', padding: '0.85rem 2.5rem', background: acc, color: '#fff', borderRadius: 50, fontWeight: 700, fontSize: '1rem', textDecoration: 'none' }}>{cta_text}</a></div>}
              </div>
            </AnimatedBlock>
          );
        }

        // Default: cards
        const showNums = showNumbers === 'yes';
        return (
          <AnimatedBlock animation={anim_type} delay={Number(anim_delay) || 0} style={{ background: bg_color || '#fff', padding: '5rem 1.5rem', color: text_color || '#1a202c' }} className="spa-section">
            <style>{`
              .lit-svc-card { position: relative; overflow: hidden; cursor: pointer; border: 1px solid #e5e5e5; transition: transform 0.35s cubic-bezier(0.4,0,0.2,1), box-shadow 0.35s cubic-bezier(0.4,0,0.2,1), border-color 0.35s ease; }
              .lit-svc-card:hover { transform: translateY(-8px); box-shadow: 0 20px 60px rgba(201,162,39,0.22); border-color: transparent; }
              .lit-svc-card-bar { transform: scaleX(0); transform-origin: left; transition: transform 0.35s cubic-bezier(0.4,0,0.2,1); }
              .lit-svc-card:hover .lit-svc-card-bar { transform: scaleX(1); }
              .lit-svc-card-icon { transition: transform 0.35s cubic-bezier(0.4,0,0.2,1), background 0.35s ease; }
              .lit-svc-card:hover .lit-svc-card-icon { transform: scale(1.1) rotate(-5deg); }
              .lit-svc-card-number { transition: color 0.35s ease; }
              .lit-svc-card:hover .lit-svc-card-number { color: ${acc}26 !important; }
              .lit-svc-tag { font-size: 0.7rem; font-weight: 600; padding: 4px 10px; background: #fafafa; color: #4b5563; border-radius: 50px; border: 1px solid #e5e5e5; }
            `}</style>
            <div style={{ maxWidth: 1200, margin: '0 auto' }}>
              {heading && <h2 style={{ textAlign: 'center', fontSize: 'clamp(1.6rem,3vw,2.5rem)', fontWeight: 800, marginBottom: subheading ? '0.5rem' : '2.5rem', color: text_color || '#1a202c' }}>{heading}</h2>}
              {subheading && <p style={{ textAlign: 'center', color: '#6c757d', marginBottom: '2.5rem' }}>{subheading}</p>}
              <div className="lit-responsive-grid" style={{ display: 'grid', gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: '1.5rem' }}>
                {list.map((s, i) => {
                  const tagList = typeof s.tags === 'string' ? s.tags.split(',').map(t => t.trim()).filter(Boolean) : [];
                  return (
                    <div key={i} className="lit-svc-card" style={{ background: '#fff', borderRadius: cardRadius ?? 20, padding: '2rem', display: 'flex', flexDirection: 'column' }}>
                      <div className="lit-svc-card-bar" style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: `linear-gradient(135deg, ${acc}cc, ${acc})` }} />
                      {showNums && <div className="lit-svc-card-number" style={{ fontSize: '3rem', fontWeight: 900, color: '#f4f4f4', lineHeight: 1, marginBottom: '1rem' }}>{String(i + 1).padStart(2, '0')}</div>}
                      <div className="lit-svc-card-icon" style={{ width: 52, height: 52, borderRadius: 12, background: `linear-gradient(135deg, ${acc}1f, ${acc}14)`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.5rem', marginBottom: '1rem' }}>{renderIconValue(s.icon, { fontSize: '1.5rem', color: acc })}</div>
                      <h3 style={{ fontSize: '1.15rem', fontWeight: 700, color: text_color || '#1a202c', marginBottom: '0.5rem' }}>{s.title}</h3>
                      <p style={{ color: '#6b7280', lineHeight: 1.6, fontSize: '0.875rem', flex: 1, marginBottom: tagList.length ? '1rem' : '0.75rem' }}>{s.description}</p>
                      {tagList.length > 0 && (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: (s.price || s.link_url) ? '0.75rem' : 0 }}>
                          {tagList.map((t, ti) => <span key={ti} className="lit-svc-tag">{t}</span>)}
                        </div>
                      )}
                      {s.price && <p style={{ fontWeight: 700, color: acc, fontSize: '0.95rem', marginBottom: '0.75rem' }}>{s.price}</p>}
                      {s.link_url && <a href={s.link_url} style={{ color: acc, fontWeight: 600, fontSize: '0.88rem', textDecoration: 'none' }}>{s.link_text || 'Learn More'} →</a>}
                    </div>
                  );
                })}
              </div>
              {cta_text && <div style={{ textAlign: 'center', marginTop: '2.5rem' }}><a href={cta_url || '#'} style={{ display: 'inline-block', padding: '0.85rem 2.5rem', background: acc, color: '#fff', borderRadius: 50, fontWeight: 700, fontSize: '1rem', textDecoration: 'none' }}>{cta_text}</a></div>}
            </div>
          </AnimatedBlock>
        );
      },
    },

    // ── Payment Block ────────────────────────────────────────────────────────
    PaymentBlock: {
      label: 'Payment Block',
      fields: {
        heading:         { type: 'text',   label: 'Heading' },
        subtext:         { type: 'textarea', label: 'Description' },
        product_name:    { type: 'text',   label: 'Product / Service Name (shown on form)' },
        amount_mode:     { type: 'select', label: 'Amount Mode', options: [{ label: 'Fixed amount', value: 'fixed' }, { label: 'Customer enters amount', value: 'variable' }] },
        fixed_amount:    { type: 'number', label: 'Fixed Amount ($)', min: 0 },
        min_amount:      { type: 'number', label: 'Min Amount (variable mode)', min: 1 },
        max_amount:      { type: 'number', label: 'Max Amount (variable mode)' },
        currency:        { type: 'text',   label: 'Currency Code (e.g. USD)' },
        show_company:    { type: 'select', label: 'Show Company Field', options: [{ label: 'No', value: 'no' }, { label: 'Yes', value: 'yes' }] },
        success_message: { type: 'textarea', label: 'Success Message' },
        success_url:     { type: 'text',   label: 'Redirect URL after payment (optional)' },
        bg_color:        colorField('Section Background'),
        card_bg:         colorField('Card Background'),
        accent_color:    colorField('Accent Color'),
        cardRadius:      cardRadiusField(),
      },
      defaultProps: {
        heading: 'Secure Payment', subtext: 'Complete your payment below. Card data is encrypted and never stored on our servers.',
        product_name: '', amount_mode: 'fixed', fixed_amount: 500,
        min_amount: 1, max_amount: 50000, currency: 'USD',
        show_company: 'no',
        success_message: 'Thank you! Your payment has been received. A receipt will be emailed to you.',
        success_url: '',
        bg_color: '#f0f2f5', card_bg: '#ffffff', accent_color: '#C9A227', cardRadius: '12px',
      },
      render: ({ heading, subtext, product_name, amount_mode, fixed_amount, min_amount, max_amount,
                 currency, show_company, success_message, success_url, bg_color, card_bg, accent_color, cardRadius }) => {

        const isEditor = typeof window !== 'undefined' && window.location.pathname.includes('/edit');

        // ── Editor preview ──────────────────────────────────────────────────
        if (isEditor) {
          const acc = accent_color || '#C9A227';
          return (
            <section style={{ background: bg_color || '#f0f2f5', padding: '4rem 1.5rem' }}>
              <div style={{ maxWidth: 560, margin: '0 auto' }}>
                {heading && <h2 style={{ textAlign: 'center', fontWeight: 800, fontSize: '1.75rem', color: '#1a202c', marginBottom: '0.5rem' }}>{heading}</h2>}
                {subtext && <p style={{ textAlign: 'center', color: '#6c757d', fontSize: '0.95rem', marginBottom: '1.5rem' }}>{subtext}</p>}
                <div style={{ background: card_bg || '#fff', borderRadius: cardRadius ?? 12, padding: '2rem', boxShadow: '0 4px 24px rgba(0,0,0,0.08)', border: '1px solid #e9ecef' }}>
                  {/* CC Brand row */}
                  <div style={{ display: 'flex', gap: 8, marginBottom: '1.5rem', justifyContent: 'center' }}>
                    {CARD_BRANDS.map(brand => <CardBrandIcon key={brand} brand={brand} size={36} />)}
                  </div>
                  {/* Amount display */}
                  {amount_mode === 'fixed' && (
                    <div style={{ textAlign: 'center', marginBottom: '1.5rem' }}>
                      <span style={{ fontSize: '0.75rem', color: '#718096', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 2 }}>Amount</span>
                      <span style={{ fontSize: '2rem', fontWeight: 900, color: acc }}>{currency || 'USD'} {Number(fixed_amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                    </div>
                  )}
                  {/* Mock form fields */}
                  <div className="lit-responsive-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '0.75rem' }}>
                    {['First Name', 'Last Name'].map(p => (
                      <div key={p} style={{ height: 38, background: '#f7fafc', border: '1px solid #dde1e7', borderRadius: 6 }} title={p} />
                    ))}
                  </div>
                  {['Email', 'Phone'].map(p => <div key={p} style={{ height: 38, background: '#f7fafc', border: '1px solid #dde1e7', borderRadius: 6, marginBottom: '0.75rem' }} title={p} />)}
                  {show_company === 'yes' && <div style={{ height: 38, background: '#f7fafc', border: '1px solid #dde1e7', borderRadius: 6, marginBottom: '0.75rem' }} title="Company" />}
                  <div style={{ height: 160, background: '#f7fafc', border: '1px solid #dde1e7', borderRadius: 6, marginBottom: '1rem', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#a0aec0', fontSize: '0.85rem' }}>🔒 Secure card entry (Valor / Passage.js)</div>
                  <div style={{ height: 44, background: acc, borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 700, fontSize: '0.95rem' }}>
                    Pay Now
                  </div>
                  <p style={{ textAlign: 'center', fontSize: '0.72rem', color: '#a0aec0', marginTop: '0.75rem', marginBottom: 0 }}>
                    🔒 256-bit TLS encryption &nbsp;·&nbsp; PCI-compliant &nbsp;·&nbsp; Card data never stored
                  </p>
                </div>
              </div>
            </section>
          );
        }

        // ── Live component ──────────────────────────────────────────────────
        function LivePaymentBlock() {
          const acc = accent_color || '#C9A227';
          const [step, setStep]         = useState('info');
          const [info, setInfo]         = useState({ firstName: '', lastName: '', email: '', phone: '', company: '', amount: '' });
          const [clientToken, setCT]    = useState(null);
          const [epi, setEpi]           = useState(null);
          const [gMode, setGMode]       = useState('sandbox');
          const [tokenErr, setTokenErr] = useState('');
          const [charging, setCharging] = useState(false);
          const [error, setError]       = useState('');
          const [txnResult, setTxn]     = useState(null);
          const [iframeH, setIframeH]   = useState(480);
          const cur = currency || 'USD';

          const displayAmt = amount_mode === 'fixed'
            ? Number(fixed_amount || 0)
            : Number(info.amount) || 0;

          // Fetch client token when advancing to payment step
          useEffect(() => {
            if (step !== 'payment') return;
            setTokenErr('');
            const apiBase = import.meta.env.VITE_API_URL
              ? `${import.meta.env.VITE_API_URL.replace(/\/$/, '')}/api`
              : '/api';
            fetch(`${apiBase}/pub/payment/client-token`)
              .then(r => r.json())
              .then(d => { setCT(d.clientToken); setEpi(d.epi); setGMode(d.mode || 'sandbox'); })
              .catch(() => setTokenErr('Could not load payment form. Please try again.'));
          }, [step]);

          // Passage.js postMessage listener
          useEffect(() => {
            if (step !== 'payment') return;
            async function onMsg(event) {
              const msg = event.data;
              if (!msg || typeof msg !== 'object') return;
              if (msg.type === 'PASSAGE_HEIGHT' && msg.height > 0) {
                setIframeH(Math.max(400, msg.height + 24));
              }
              if (msg.type === 'PASSAGE_TOKEN') {
                setCharging(true);
                setError('');
                try {
                  const apiBase = import.meta.env.VITE_API_URL
                    ? `${import.meta.env.VITE_API_URL.replace(/\/$/, '')}/api`
                    : '/api';
                  const res = await fetch(`${apiBase}/pub/payment/charge`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      card_token:      msg.card_token,
                      cardholder_name: msg.cardholder_name || `${info.firstName} ${info.lastName}`.trim(),
                      last4:           msg.last4,
                      card_brand:      msg.card_brand,
                      expiry:          msg.expiry,
                      amount:          displayAmt,
                      description:     product_name || heading || 'Payment page charge',
                      customer: {
                        firstName:   info.firstName,
                        lastName:    info.lastName,
                        email:       info.email,
                        phone:       info.phone,
                        companyName: info.company || undefined,
                      },
                    }),
                  });
                  const data = await res.json();
                  if (data.status === 'captured') {
                    setTxn(data);
                    setStep('success');
                    if (success_url) {
                      setTimeout(() => { window.location.href = success_url; }, 3000);
                    }
                  } else {
                    setError(data.error || 'Payment declined. Please try a different card.');
                  }
                } catch { setError('A network error occurred. Please try again.'); }
                finally { setCharging(false); }
              }
              if (msg.type === 'PASSAGE_ERROR') {
                setError(msg.error || 'Payment form error.');
                setCharging(false);
              }
            }
            window.addEventListener('message', onMsg);
            return () => window.removeEventListener('message', onMsg);
          }, [step, info, displayAmt]);

          function validateInfo() {
            if (!info.firstName.trim()) return 'First name is required';
            if (!info.email.trim() || !info.email.includes('@')) return 'Valid email is required';
            if (amount_mode === 'variable') {
              const v = Number(info.amount);
              if (!v || v < (Number(min_amount) || 1)) return `Minimum amount is $${min_amount || 1}`;
              if (max_amount && v > Number(max_amount)) return `Maximum amount is $${max_amount}`;
            }
            return null;
          }

          function handleNext(e) {
            e.preventDefault();
            const err = validateInfo();
            if (err) { setError(err); return; }
            setError('');
            setStep('payment');
          }

          const iframeSrc = clientToken
            ? `/passage-pay.html?clientToken=${encodeURIComponent(clientToken)}&epi=${encodeURIComponent(epi || '')}&mode=${gMode}`
            : null;

          const fmtAmt = (n) => `${cur} ${Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

          const cardStyle = { background: card_bg || '#fff', borderRadius: cardRadius ?? 12, padding: '2rem', boxShadow: '0 4px 24px rgba(0,0,0,0.08)', border: '1px solid #e9ecef' };
          const inputStyle = { width: '100%', padding: '0.55rem 0.8rem', border: '1px solid #dde1e7', borderRadius: 6, fontSize: '0.95rem', outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit' };
          const labelStyle = { display: 'block', fontSize: '0.75rem', fontWeight: 700, color: '#718096', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 };

          if (step === 'success') {
            return (
              <section style={{ background: bg_color || '#f0f2f5', padding: '5rem 1.5rem' }}>
                <div style={{ maxWidth: 540, margin: '0 auto', ...cardStyle, textAlign: 'center' }}>
                  <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>✅</div>
                  <h2 style={{ fontWeight: 800, fontSize: '1.6rem', color: '#276749', marginBottom: '0.75rem' }}>Payment Received!</h2>
                  <p style={{ color: '#4a5568', lineHeight: 1.7, marginBottom: '1.5rem' }}>{success_message}</p>
                  {txnResult?.txnId && <p style={{ fontSize: '0.82rem', color: '#a0aec0' }}>Transaction ID: <strong style={{ fontFamily: 'monospace' }}>{txnResult.txnId}</strong></p>}
                  {txnResult?.last4 && <p style={{ fontSize: '0.82rem', color: '#a0aec0' }}>Card ending in: <strong>{txnResult.last4}</strong></p>}
                  {success_url && <p style={{ fontSize: '0.82rem', color: '#a0aec0', marginTop: '0.5rem' }}>Redirecting you shortly…</p>}
                </div>
              </section>
            );
          }

          return (
            <section style={{ background: bg_color || '#f0f2f5', padding: '4rem 1.5rem' }}>
              <div style={{ maxWidth: 560, margin: '0 auto' }}>
                {heading && <h2 style={{ textAlign: 'center', fontWeight: 800, fontSize: '1.75rem', color: '#1a202c', marginBottom: '0.4rem' }}>{heading}</h2>}
                {subtext && <p style={{ textAlign: 'center', color: '#6c757d', fontSize: '0.95rem', marginBottom: '1.5rem' }}>{subtext}</p>}

                <div style={cardStyle}>
                  {/* CC brand badges */}
                  <div style={{ display: 'flex', gap: 6, marginBottom: '1.5rem', justifyContent: 'center', alignItems: 'center' }}>
                    {CARD_BRANDS.map(brand => <CardBrandIcon key={brand} brand={brand} size={34} />)}
                    <span style={{ background: '#f7fafc', color: '#718096', fontSize: '0.55rem', fontWeight: 700, borderRadius: 4, padding: '4px 8px', border: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', gap: 3, marginLeft: 4 }}>🔒 SECURE</span>
                  </div>

                  {/* Product + Amount display */}
                  {(product_name || amount_mode === 'fixed') && (
                    <div style={{ background: `${acc}0f`, border: `1px solid ${acc}30`, borderRadius: 8, padding: '0.85rem 1rem', marginBottom: '1.5rem', textAlign: 'center' }}>
                      {product_name && <p style={{ margin: '0 0 2px', fontSize: '0.85rem', fontWeight: 600, color: '#4a5568' }}>{product_name}</p>}
                      {amount_mode === 'fixed' && displayAmt > 0 && (
                        <p style={{ margin: 0, fontSize: '1.6rem', fontWeight: 900, color: acc }}>{fmtAmt(displayAmt)}</p>
                      )}
                    </div>
                  )}

                  {/* Step 1: Customer info */}
                  {step === 'info' && (
                    <form onSubmit={handleNext}>
                      {error && <div style={{ background: '#fff5f5', border: '1px solid #fed7d7', color: '#c53030', borderRadius: 6, padding: '0.6rem 0.8rem', marginBottom: '1rem', fontSize: '0.88rem' }}>{error}</div>}
                      <div className="lit-responsive-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '0.75rem' }}>
                        <div>
                          <label style={labelStyle}>First Name *</label>
                          <input style={inputStyle} placeholder="John" value={info.firstName} onChange={e => setInfo(p => ({ ...p, firstName: e.target.value }))} required />
                        </div>
                        <div>
                          <label style={labelStyle}>Last Name</label>
                          <input style={inputStyle} placeholder="Doe" value={info.lastName} onChange={e => setInfo(p => ({ ...p, lastName: e.target.value }))} />
                        </div>
                      </div>
                      <div style={{ marginBottom: '0.75rem' }}>
                        <label style={labelStyle}>Email Address *</label>
                        <input type="email" style={inputStyle} placeholder="john@example.com" value={info.email} onChange={e => setInfo(p => ({ ...p, email: e.target.value }))} required />
                      </div>
                      <div style={{ marginBottom: '0.75rem' }}>
                        <label style={labelStyle}>Phone Number</label>
                        <input type="tel" style={inputStyle} placeholder="(555) 555-5555" value={info.phone} onChange={e => setInfo(p => ({ ...p, phone: e.target.value }))} />
                      </div>
                      {show_company === 'yes' && (
                        <div style={{ marginBottom: '0.75rem' }}>
                          <label style={labelStyle}>Company / Organization</label>
                          <input style={inputStyle} placeholder="Acme Corp" value={info.company} onChange={e => setInfo(p => ({ ...p, company: e.target.value }))} />
                        </div>
                      )}
                      {amount_mode === 'variable' && (
                        <div style={{ marginBottom: '0.75rem' }}>
                          <label style={labelStyle}>Payment Amount ({cur}) *</label>
                          <input type="number" step="0.01" min={min_amount || 1} max={max_amount || undefined} style={inputStyle} placeholder="Enter amount" value={info.amount} onChange={e => setInfo(p => ({ ...p, amount: e.target.value }))} required />
                          {(min_amount || max_amount) && <span style={{ fontSize: '0.75rem', color: '#a0aec0' }}>Min: ${min_amount || 1}{max_amount ? ` · Max: $${max_amount}` : ''}</span>}
                        </div>
                      )}
                      <button type="submit" style={{ width: '100%', padding: '0.85rem', background: acc, color: '#fff', border: 'none', borderRadius: 50, fontWeight: 700, fontSize: '1rem', cursor: 'pointer', marginTop: '0.25rem' }}>
                        Continue to Payment →
                      </button>
                    </form>
                  )}

                  {/* Step 2: Passage.js card form */}
                  {step === 'payment' && (
                    <div>
                      <button onClick={() => { setStep('info'); setError(''); }} style={{ background: 'none', border: 'none', color: '#718096', fontSize: '0.85rem', cursor: 'pointer', marginBottom: '1rem', padding: 0 }}>← Back</button>
                      <div style={{ background: '#f7fafc', borderRadius: 8, padding: '0.75rem 1rem', marginBottom: '1rem' }}>
                        <span style={{ fontSize: '0.82rem', color: '#4a5568' }}>Paying as: <strong>{info.firstName} {info.lastName}</strong> &nbsp;·&nbsp; {info.email}</span>
                        {amount_mode === 'fixed' && displayAmt > 0 && <span style={{ float: 'right', fontWeight: 700, color: acc }}>{fmtAmt(displayAmt)}</span>}
                        {amount_mode === 'variable' && displayAmt > 0 && <span style={{ float: 'right', fontWeight: 700, color: acc }}>{fmtAmt(displayAmt)}</span>}
                      </div>
                      {tokenErr && <div style={{ background: '#fff5f5', border: '1px solid #fed7d7', color: '#c53030', borderRadius: 6, padding: '0.6rem 0.8rem', marginBottom: '1rem', fontSize: '0.88rem' }}>{tokenErr}</div>}
                      {error && <div style={{ background: '#fff5f5', border: '1px solid #fed7d7', color: '#c53030', borderRadius: 6, padding: '0.6rem 0.8rem', marginBottom: '1rem', fontSize: '0.88rem' }}>{error}</div>}
                      {!tokenErr && (
                        <div style={{ position: 'relative', borderRadius: 6, overflow: 'hidden' }}>
                          {charging && (
                            <div style={{ position: 'absolute', inset: 0, background: 'rgba(255,255,255,0.9)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', zIndex: 10, borderRadius: 6 }}>
                              <div style={{ width: 32, height: 32, border: `3px solid ${acc}`, borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite', marginBottom: 8 }} />
                              <span style={{ fontSize: '0.88rem', color: '#4a5568' }}>Processing payment…</span>
                            </div>
                          )}
                          {iframeSrc ? (
                            <iframe src={iframeSrc} title="Secure card entry" width="100%" height={iframeH} frameBorder="0" scrolling="no" style={{ display: 'block', border: 'none' }} />
                          ) : (
                            <div style={{ height: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#a0aec0', fontSize: '0.88rem' }}>
                              <div style={{ width: 20, height: 20, border: `2px solid ${acc}`, borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite', marginRight: 8 }} />
                              Loading secure payment form…
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  <p style={{ textAlign: 'center', fontSize: '0.7rem', color: '#c4cad6', marginTop: '0.85rem', marginBottom: 0 }}>
                    🔒 256-bit TLS &nbsp;·&nbsp; PCI DSS Compliant &nbsp;·&nbsp; Powered by Valor PayTech
                  </p>
                </div>
                <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
              </div>
            </section>
          );
        }

        return <LivePaymentBlock />;
      },
    },

    // ── Announcement Banner ──────────────────────────────────────────────────
    AnnouncementBanner: {
      label: 'Announcement Banner',
      fields: {
        text:      { type: 'text', label: 'Message Text' },
        ctaText:   { type: 'text', label: 'CTA Button Text (optional)' },
        ctaUrl:    { type: 'text', label: 'CTA URL' },
        bgColor:   colorField('Background Color'),
        textColor: colorField('Text Color'),
        ctaBg:     colorField('Button Background'),
        dismissable: { type: 'select', label: 'Dismissable', options: [{ label: 'Yes (shows ✕ button)', value: 'yes' }, { label: 'No', value: 'no' }] },
        sticky:    { type: 'select', label: 'Sticky to top', options: [{ label: 'No', value: 'no' }, { label: 'Yes (fixed)', value: 'yes' }] },
      },
      defaultProps: {
        text: '🎉 Limited time offer — request a quote today!',
        ctaText: 'Get a Quote', ctaUrl: '#', bgColor: '#C9A227', textColor: '#ffffff',
        ctaBg: '#ffffff', dismissable: 'yes', sticky: 'no',
      },
      render: ({ text, ctaText, ctaUrl, bgColor, textColor, ctaBg, dismissable, sticky }) => {
        const [hidden, setHidden] = React.useState(false);
        if (hidden) return null;
        return (
          <div style={{
            background: bgColor || '#C9A227', color: textColor || '#fff',
            padding: '0.6rem 1.5rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '1rem', flexWrap: 'wrap',
            position: sticky === 'yes' ? 'sticky' : 'static', top: 0, zIndex: sticky === 'yes' ? 999 : 'auto',
          }}>
            <span style={{ fontSize: '0.9rem', fontWeight: 500 }}>{text}</span>
            {ctaText && (
              <a href={ctaUrl || '#'} style={{ background: ctaBg || '#fff', color: bgColor || '#C9A227', padding: '0.25rem 1rem', borderRadius: 50, fontWeight: 700, fontSize: '0.85rem', textDecoration: 'none', whiteSpace: 'nowrap' }}>
                {ctaText}
              </a>
            )}
            {dismissable === 'yes' && (
              <button onClick={() => setHidden(true)} style={{ background: 'none', border: 'none', color: textColor || '#fff', cursor: 'pointer', fontSize: '1.1rem', lineHeight: 1, padding: '0 0.25rem', marginLeft: 'auto', opacity: 0.8 }}>✕</button>
            )}
          </div>
        );
      },
    },

  },

  root: {
    fields: {
      pageTitle: { type: 'text', label: 'Page Title (browser tab)' },
    },
    defaultProps: { pageTitle: '' },
    render: ({ children }) => <div className="spa-puck-page">{children}</div>,
  },
};
