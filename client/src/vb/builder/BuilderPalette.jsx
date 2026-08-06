import { useState, useEffect, useMemo, useRef, Component as ReactComponent } from 'react';
import { createPortal } from 'react-dom';
import { Drawer, usePuck } from '@measured/puck';
import api from '../../api/client.js';
import { puckConfig } from './puckConfig.jsx';

// ── Static data ───────────────────────────────────────────────────────────────

const CATEGORIES = [
  { key: 'site',     label: 'Site Chrome',      items: ['Header', 'Footer', 'AnnouncementBanner'] },
  { key: 'hero',     label: 'Hero & Banners',   items: ['HeroBanner', 'AircraftHero', 'PageHeroBanner', 'CTABanner', 'VideoHero'] },
  { key: 'layout',   label: 'Layout',           items: ['TwoColumn', 'ImageTextSplit', 'FullWidthImage', 'Divider', 'RawHTML'] },
  { key: 'content',  label: 'Content',          items: ['TextBlock', 'ImageBlock', 'Timeline', 'LogoShowcase'] },
  { key: 'cards',    label: 'Cards & Grids',    items: ['CardGrid', 'IconFeatureGrid', 'TeamGrid', 'ValuesGrid', 'StatsRow', 'ServicesList', 'TechStackTabs'] },
  { key: 'social',   label: 'Social Proof',     items: ['Testimonials', 'FAQAccordion', 'BlogFeed', 'SponsorLogoGrid'] },
  { key: 'pricing',  label: 'Pricing & Specs',  items: ['PricingTable', 'SpecsComparison', 'FeatureChecklist', 'SpecsStrip', 'ConstructionBlock'] },
  { key: 'media',    label: 'Media',            items: ['PhotoGallery', 'VideoGallery'] },
  { key: 'forms',    label: 'Forms & Contact',  items: ['FormEmbed', 'ContactSection', 'GoogleMap', 'DonationCard', 'MembershipCard', 'MembershipTierGrid', 'EventRegistrationCard'] },
  { key: 'commerce', label: 'Commerce',         items: ['ShopListing', 'ProductList', 'ProductDetail', 'PaymentBlock', 'EventsListBlock'] },
];

const COMP_INFO = {
  Header:            'Site navigation with logo and menu links',
  Footer:            'Footer columns, links, and social icons',
  AnnouncementBanner:'Thin dismissible top-of-page announcement bar',
  HeroBanner:        'Full-width hero: headline, subtext, background image, CTA button',
  AircraftHero:      'Aircraft product hero with gallery, specs and buy button',
  PageHeroBanner:    'Page banner with title and optional breadcrumb',
  CTABanner:         'Call-to-action bar with heading and up to two buttons',
  VideoHero:         'Full-width hero with a video background (YouTube, Vimeo, or MP4)',
  TwoColumn:         'Side-by-side layout: image on one side, content on the other',
  ImageTextSplit:    'Alternating image + text rows for feature showcases',
  FullWidthImage:    'Edge-to-edge image with optional overlay text',
  Divider:           'Horizontal separator line or vertical spacer',
  RawHTML:           'Inject custom HTML, embeds, or third-party scripts',
  TextBlock:         'Rich text content with heading and paragraph body',
  ImageBlock:        'Single image with optional caption and link',
  Timeline:          'Vertical timeline of events or milestones',
  LogoShowcase:      'Logo grid or strip for partners and clients',
  CardGrid:          'Responsive grid of image + title + text cards',
  IconFeatureGrid:   'Grid of icon + heading + description feature cards',
  TeamGrid:          'Team member cards with photo, name, title and bio',
  ValuesGrid:        'Company values or mission statement points grid',
  StatsRow:          'Horizontal strip of key statistics or metrics',
  ServicesList:      'Services grid with numbered badges, icons, and tags (or rows/featured layout)',
  TechStackTabs:     'Tabbed grid of technology partners, vendors, or certifications',
  Testimonials:      'Customer quotes with star ratings and avatar',
  FAQAccordion:      'Expandable frequently-asked-questions accordion',
  BlogFeed:          'Latest blog posts feed with thumbnail and excerpt',
  SponsorLogoGrid:   'Grid of sponsor/partner logos or names on a dark band',
  PricingTable:      'Pricing tiers with feature list and CTA buttons',
  SpecsComparison:   'Side-by-side specification comparison table',
  FeatureChecklist:  'Bulleted feature list with checkmarks or icons',
  SpecsStrip:        'Horizontal strip of key specification highlights',
  ConstructionBlock: 'Build phase or construction progress section',
  PhotoGallery:      'Masonry or grid photo gallery with lightbox',
  VideoGallery:      'Video gallery grid with thumbnails and player',
  FormEmbed:         'Embed a form from the Forms module by name',
  DonationCard:      'Two-column quick-donate card: amounts, fund designation, donor info — charges through whichever payment gateway is active',
  MembershipCard:    'Membership tier picker + signup — vaults the card and auto-renews via the subscriptions engine',
  MembershipTierGrid: 'One bordered pricing card per membership tier, side-by-side, each with its own "Join as X" checkout',
  EventRegistrationCard: 'Ticket picker for one event (or driven by a ?event= URL param) — adds to the shared shopping cart; free tickets check out with one click, paid tickets go through normal payment',
  ContactSection:    'Contact form with info, hours, and map on the right',
  GoogleMap:         'Google Maps embed with configurable height and location',
  ShopListing:       'Full shop product grid with category filters and cart',
  ProductList:       'Simple product listing grid',
  ProductDetail:     'Single product detail view with add-to-cart',
  PaymentBlock:      'Standalone payment form for a fixed or customer-entered amount',
  EventsListBlock:   'Grid of upcoming events, each card linking to a ticket-purchase page — pairs with EventRegistrationCard',
};

const VARIANTS = {
  HeroBanner: [
    { label: 'Dark + CTA',   props: { overlay: 0.5,  align: 'center' } },
    { label: 'Light minimal',props: { overlay: 0,    align: 'left'   } },
    { label: 'Full screen',  props: { height: '100vh', overlay: 0.55 } },
  ],
  TwoColumn: [
    { label: 'Image left',  props: { reversed: false } },
    { label: 'Image right', props: { reversed: true  } },
  ],
  CTABanner: [
    { label: 'Dark blue', props: { bgColor: '#1e40af', textColor: '#ffffff' } },
    { label: 'Brand red', props: { bgColor: '#cc1122', textColor: '#ffffff' } },
    { label: 'Light',     props: { bgColor: '#f8f9fa', textColor: '#1e1e2e' } },
  ],
  CardGrid: [
    { label: '3 columns', props: { columns: '3' } },
    { label: '2 columns', props: { columns: '2' } },
    { label: '4 columns', props: { columns: '4' } },
  ],
  IconFeatureGrid: [
    { label: '3 columns', props: { columns: '3' } },
    { label: '2 columns', props: { columns: '2' } },
    { label: '4 columns', props: { columns: '4' } },
  ],
  TextBlock: [
    { label: 'Left aligned', props: { textAlign: 'left'   } },
    { label: 'Centered',     props: { textAlign: 'center' } },
  ],
  TeamGrid: [
    { label: '3 columns', props: { columns: '3' } },
    { label: '4 columns', props: { columns: '4' } },
  ],
  FullWidthImage: [
    { label: 'With overlay', props: { overlay: 0.4 } },
    { label: 'No overlay',   props: { overlay: 0   } },
  ],
};

const ROOT_ZONE = 'root:default-zone';

function genId(type) {
  return `${type}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

// ── Live preview render ───────────────────────────────────────────────────────
// Renders the block's real Puck render function with its own defaultProps,
// scaled down to fit the modal. Always matches the current design — no
// screenshots to generate or go stale when a block is redesigned.

const PREVIEW_DESIGN_WIDTH = 1280; // matches the typical section width used across blocks
const PREVIEW_HEIGHT = 280; // fixed "peek" window — tall blocks just get cropped, not scrolled

class PreviewErrorBoundary extends ReactComponent {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error) { console.warn('Block preview failed to render:', this.props.name, error); }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 24, textAlign: 'center', color: '#94a3b8', fontSize: '0.8rem' }}>
          Preview unavailable for this block.
        </div>
      );
    }
    return this.props.children;
  }
}

function LiveBlockPreview({ name }) {
  const def = puckConfig.components[name];

  if (!def?.render) {
    return (
      <div style={{ padding: 24, textAlign: 'center', color: '#94a3b8', fontSize: '0.8rem' }}>
        No preview available.
      </div>
    );
  }

  const Render = def.render;
  const previewProps = { ...(def.defaultProps || {}), id: `preview-${name}` };

  return (
    <div style={{ height: PREVIEW_HEIGHT, overflow: 'hidden', background: '#fff', borderRadius: 8, border: '1px solid #3d3d5a', position: 'relative' }}>
      <PreviewScaler>
        <PreviewErrorBoundary name={name}>
          <Render {...previewProps} />
        </PreviewErrorBoundary>
      </PreviewScaler>
    </div>
  );
}

// Measures the modal's actual available width and scales the fixed-width
// design canvas to fit, so blocks render at their real proportions instead
// of being squished into a narrow column.
function PreviewScaler({ children }) {
  const [containerWidth, setContainerWidth] = useState(0);
  const ref = useRef(null);

  useEffect(() => {
    const el = ref.current;
    if (!el?.parentElement) return;
    const measure = () => setContainerWidth(el.parentElement.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el.parentElement);
    return () => ro.disconnect();
  }, []);

  const scale = containerWidth ? containerWidth / PREVIEW_DESIGN_WIDTH : 1;

  return (
    <div ref={ref} style={{ position: 'absolute', top: 0, left: 0, right: 0 }}>
      <div style={{ width: PREVIEW_DESIGN_WIDTH, transform: `scale(${scale})`, transformOrigin: 'top left', pointerEvents: 'none' }}>
        {children}
      </div>
    </div>
  );
}

// ── Preview / variant modal ───────────────────────────────────────────────────

function PreviewModal({ name, onClose, onAdd }) {
  const info = COMP_INFO[name] || 'Custom component';
  const variants = VARIANTS[name] || [];

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 200000, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={onClose}
    >
      <div
        style={{ background: '#1e1e2e', border: '1px solid #3d3d5a', borderRadius: 10, padding: 24, maxWidth: 640, width: '90vw', color: '#e2e8f0', boxShadow: '0 12px 40px rgba(0,0,0,0.5)' }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: '1rem', marginBottom: 4 }}>{name}</div>
            <div style={{ fontSize: '0.8rem', color: '#94a3b8', lineHeight: 1.5 }}>{info}</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', fontSize: 18, lineHeight: 1, padding: '0 0 0 12px' }}>✕</button>
        </div>

        <div style={{ marginBottom: 16 }}>
          <LiveBlockPreview name={name} />
        </div>

        {variants.length > 0 && (
          <>
            <div style={{ fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#64748b', marginBottom: 8 }}>Layout Variants</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 16 }}>
              {variants.map((v, i) => (
                <button
                  key={i}
                  onClick={() => { onAdd(name, v.props); onClose(); }}
                  style={{ background: '#2d2d4a', border: '1px solid #3d3d5a', borderRadius: 6, padding: '8px 14px', color: '#e2e8f0', cursor: 'pointer', fontSize: '0.82rem', textAlign: 'left', display: 'flex', justifyContent: 'space-between', alignItems: 'center', transition: 'background 0.12s' }}
                  onMouseEnter={e => e.currentTarget.style.background = '#3d3d5a'}
                  onMouseLeave={e => e.currentTarget.style.background = '#2d2d4a'}
                >
                  {v.label}
                  <span style={{ color: '#6366f1', fontSize: '0.75rem', fontWeight: 600 }}>Add →</span>
                </button>
              ))}
            </div>
          </>
        )}

        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={() => { onAdd(name, {}); onClose(); }}
            style={{ flex: 1, background: '#cc1122', border: 'none', borderRadius: 6, padding: '10px', color: '#fff', cursor: 'pointer', fontWeight: 600, fontSize: '0.85rem' }}
          >
            + Add Default
          </button>
          <button
            onClick={onClose}
            style={{ background: '#2d2d4a', border: '1px solid #3d3d5a', borderRadius: 6, padding: '10px 16px', color: '#94a3b8', cursor: 'pointer', fontSize: '0.82rem' }}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Save-component modal ──────────────────────────────────────────────────────

function SaveModal({ componentType, propsToSave, onClose, onSaved }) {
  const [label, setLabel] = useState(`My ${componentType}`);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  async function save() {
    if (!label.trim()) { setErr('Enter a name.'); return; }
    setSaving(true);
    try {
      await api.post('/website/saved-components', { label: label.trim(), component_type: componentType, props_json: propsToSave });
      onSaved();
      onClose();
    } catch (e) {
      setErr(e.response?.data?.error || 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 200001, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={onClose}>
      <div style={{ background: '#1e1e2e', border: '1px solid #3d3d5a', borderRadius: 10, padding: 24, maxWidth: 360, width: '90vw', color: '#e2e8f0' }} onClick={e => e.stopPropagation()}>
        <div style={{ fontWeight: 700, marginBottom: 12 }}>Save as Custom Component</div>
        <div style={{ fontSize: '0.8rem', color: '#94a3b8', marginBottom: 14 }}>Saving a copy of <strong>{componentType}</strong> with its current settings for reuse.</div>
        <input
          value={label}
          onChange={e => setLabel(e.target.value)}
          placeholder="My Hero — Dark Theme"
          style={{ width: '100%', background: '#2d2d4a', border: '1px solid #3d3d5a', borderRadius: 6, padding: '8px 12px', color: '#e2e8f0', fontSize: '0.85rem', marginBottom: 12, boxSizing: 'border-box' }}
          onKeyDown={e => e.key === 'Enter' && save()}
          autoFocus
        />
        {err && <div style={{ color: '#f87171', fontSize: '0.78rem', marginBottom: 8 }}>{err}</div>}
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={save} disabled={saving} style={{ flex: 1, background: '#6366f1', border: 'none', borderRadius: 6, padding: '9px', color: '#fff', cursor: 'pointer', fontWeight: 600, fontSize: '0.83rem' }}>
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button onClick={onClose} style={{ background: '#2d2d4a', border: '1px solid #3d3d5a', borderRadius: 6, padding: '9px 14px', color: '#94a3b8', cursor: 'pointer', fontSize: '0.82rem' }}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

// ── Category section ──────────────────────────────────────────────────────────

function CategorySection({ cat, items, isOpen, onToggle, onPreview, onAdd, globalItems }) {
  if (!items.length) return null;
  return (
    <div>
      <button
        onClick={onToggle}
        style={{ width: '100%', background: 'none', border: 'none', padding: '7px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', color: '#64748b', fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', borderBottom: '1px solid #e9ecef' }}
      >
        <span>{cat.label}</span>
        <span style={{ color: '#94a3b8', fontSize: '0.9rem', transform: isOpen ? 'rotate(0)' : 'rotate(-90deg)', transition: 'transform 0.15s', display: 'inline-block' }}>▾</span>
      </button>
      {isOpen && (
        <Drawer droppableId={cat.key} direction="vertical">
          {items.map(name => {
            const globalIndex = globalItems.indexOf(name);
            return (
              <PaletteItem
                key={name}
                name={name}
                globalIndex={globalIndex}
                onPreview={onPreview}
                onAdd={onAdd}
              />
            );
          })}
        </Drawer>
      )}
    </div>
  );
}

// ── Individual palette item ───────────────────────────────────────────────────

function PaletteItem({ name, globalIndex, onPreview, onAdd }) {
  const info = COMP_INFO[name];
  const hasVariants = !!(VARIANTS[name]?.length);

  return (
    <Drawer.Item name={name} label={name} id={`palette-${name}`}>
      {({ children }) => (
        <div
          style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 10px 5px 8px', borderBottom: '1px solid #f1f5f9', background: 'transparent', cursor: 'grab', transition: 'background 0.1s' }}
          onMouseEnter={e => e.currentTarget.style.background = '#f1f5f9'}
          onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
        >
          <span style={{ color: '#cbd5e1', fontSize: '0.75rem', flexShrink: 0, lineHeight: 1, pointerEvents: 'none', userSelect: 'none' }}>⠿</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: '0.78rem', fontWeight: 500, color: '#1e293b', lineHeight: 1.2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{name}</div>
            {info && <div style={{ fontSize: '0.67rem', color: '#94a3b8', lineHeight: 1.3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{info}</div>}
          </div>
          <button
            onMouseDown={e => e.stopPropagation()}
            onClick={e => { e.stopPropagation(); onPreview(name); }}
            title={hasVariants ? 'Preview & layout variants' : 'Info'}
            style={{ flexShrink: 0, background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', padding: '3px 5px', fontSize: '0.75rem', borderRadius: 4, lineHeight: 1 }}
          >
            {hasVariants ? '⊞' : 'ⓘ'}
          </button>
          <button
            onMouseDown={e => e.stopPropagation()}
            onClick={e => { e.stopPropagation(); onAdd(name, {}); }}
            title="Add to page"
            style={{ flexShrink: 0, background: '#eff6ff', border: '1px solid #bfdbfe', color: '#1d4ed8', cursor: 'pointer', padding: '2px 8px', fontSize: '0.72rem', borderRadius: 4, fontWeight: 600, lineHeight: 1.4 }}
          >
            +
          </button>
        </div>
      )}
    </Drawer.Item>
  );
}

// ── Saved component item ──────────────────────────────────────────────────────

function SavedItem({ saved, onDelete, onAdd }) {
  return (
    <Drawer.Item name={saved.component_type} label={saved.label} id={`saved-${saved.id}`}>
      {({ children }) => (
        <div
          style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 10px 5px 8px', borderBottom: '1px solid #f1f5f9', background: 'transparent', cursor: 'grab', transition: 'background 0.1s' }}
          onMouseEnter={e => e.currentTarget.style.background = '#f1f5f9'}
          onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
        >
          <span style={{ color: '#cbd5e1', fontSize: '0.75rem', flexShrink: 0, lineHeight: 1, pointerEvents: 'none', userSelect: 'none' }}>⠿</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: '0.78rem', fontWeight: 500, color: '#4f46e5', lineHeight: 1.2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{saved.label}</div>
            <div style={{ fontSize: '0.67rem', color: '#94a3b8', lineHeight: 1.3 }}>{saved.component_type}</div>
          </div>
          <button
            onMouseDown={e => e.stopPropagation()}
            onClick={e => { e.stopPropagation(); onAdd(saved.component_type, saved.props_json || {}); }}
            title="Add to page"
            style={{ flexShrink: 0, background: '#eff6ff', border: '1px solid #bfdbfe', color: '#1d4ed8', cursor: 'pointer', padding: '2px 8px', fontSize: '0.72rem', borderRadius: 4, fontWeight: 600, lineHeight: 1.4 }}
          >
            +
          </button>
          <button
            onMouseDown={e => e.stopPropagation()}
            onClick={e => { e.stopPropagation(); onDelete(saved.id); }}
            title="Remove saved component"
            style={{ flexShrink: 0, background: 'none', border: 'none', color: '#cbd5e1', cursor: 'pointer', padding: '3px 4px', fontSize: '0.75rem', lineHeight: 1 }}
          >
            ✕
          </button>
        </div>
      )}
    </Drawer.Item>
  );
}

// ── Main palette ──────────────────────────────────────────────────────────────

export function BuilderPalette({ sidebarHidden }) {
  const { dispatch, appState, selectedItem } = usePuck();
  const [search, setSearch] = useState('');
  // Start all categories collapsed — user opens the group they need
  const [collapsed, setCollapsed] = useState(() => {
    const init = { __saved: true };
    CATEGORIES.forEach(c => { init[c.key] = true; });
    return init;
  });
  const [preview, setPreview] = useState(null);
  const [saveModal, setSaveModal] = useState(null);
  const [savedComponents, setSavedComponents] = useState([]);

  useEffect(() => {
    api.get('/website/saved-components').then(r => setSavedComponents(r.data || [])).catch(() => {});
  }, []);

  function loadSaved() {
    api.get('/website/saved-components').then(r => setSavedComponents(r.data || [])).catch(() => {});
  }

  async function deleteSaved(id) {
    if (!window.confirm('Remove this saved component?')) return;
    await api.delete(`/website/saved-components/${id}`).catch(() => {});
    setSavedComponents(sc => sc.filter(s => s.id !== id));
  }

  function addComponent(componentType, extraProps = {}) {
    const id = genId(componentType);
    const contentLen = appState?.data?.content?.length ?? 0;
    dispatch({ type: 'insert', componentType, destinationIndex: contentLen, destinationZone: ROOT_ZONE, id });
    if (Object.keys(extraProps).length > 0) {
      setTimeout(() => {
        dispatch({
          type: 'setData',
          data: prev => ({
            ...prev,
            content: prev.content.map(item =>
              (item.id === id || item.props?.id === id)
                ? { ...item, props: { ...item.props, ...extraProps } }
                : item
            ),
          }),
        });
      }, 80);
    }
  }

  const query = search.toLowerCase().trim();

  const filteredCategories = useMemo(() => {
    if (!query) return CATEGORIES.map(c => ({ ...c, filtered: c.items }));
    return CATEGORIES.map(c => ({
      ...c,
      filtered: c.items.filter(name =>
        name.toLowerCase().includes(query) || (COMP_INFO[name] || '').toLowerCase().includes(query)
      ),
    })).filter(c => c.filtered.length > 0);
  }, [query]);

  const allGlobalItems = useMemo(() => CATEGORIES.flatMap(c => c.items), []);

  function toggleCollapsed(key) {
    setCollapsed(c => ({ ...c, [key]: !c[key] }));
  }

  function isCatOpen(key) {
    if (query) return true;
    return collapsed[key] === false; // only open when explicitly toggled open
  }

  if (sidebarHidden) return null;

  return (
    <div style={{ width: 300, background: '#fff', display: 'flex', flexDirection: 'column', height: '100%', borderRight: '1px solid #e2e8f0', flexShrink: 0, overflow: 'hidden' }}>

      {/* Header — search only, no duplicate "Components" label */}
      <div style={{ padding: '8px 10px', borderBottom: '1px solid #e9ecef', flexShrink: 0 }}>
        <div style={{ position: 'relative' }}>
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search components…"
            style={{ width: '100%', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 6, padding: '6px 28px 6px 10px', color: '#1e293b', fontSize: '0.8rem', outline: 'none', boxSizing: 'border-box' }}
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              style={{ position: 'absolute', right: 7, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', padding: 0, fontSize: 12, lineHeight: 1 }}
            >✕</button>
          )}
        </div>
      </div>

      {/* Scrollable component list */}
      <div style={{ flex: 1, overflowY: 'auto' }}>

        {/* Saved components */}
        {savedComponents.length > 0 && (
          <div>
            <button
              onClick={() => toggleCollapsed('__saved')}
              style={{ width: '100%', background: 'none', border: 'none', padding: '7px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', color: '#4f46e5', fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', borderBottom: '1px solid #e9ecef' }}
            >
              <span>💾 Saved</span>
              <span style={{ color: '#94a3b8', fontSize: '0.9rem', transform: !collapsed['__saved'] ? 'rotate(0)' : 'rotate(-90deg)', transition: 'transform 0.15s', display: 'inline-block' }}>▾</span>
            </button>
            {!collapsed['__saved'] && (
              <Drawer droppableId="saved-components" direction="vertical">
                {savedComponents.map(s => (
                  <SavedItem
                    key={s.id}
                    saved={s}
                    onDelete={deleteSaved}
                    onAdd={addComponent}
                  />
                ))}
              </Drawer>
            )}
          </div>
        )}

        {/* Categories */}
        {filteredCategories.map(cat => (
          <CategorySection
            key={cat.key}
            cat={cat}
            items={cat.filtered}
            isOpen={isCatOpen(cat.key)}
            onToggle={() => toggleCollapsed(cat.key)}
            onPreview={setPreview}
            onAdd={addComponent}
            globalItems={allGlobalItems}
          />
        ))}

        {filteredCategories.length === 0 && query && (
          <div style={{ padding: '20px 16px', color: '#555878', fontSize: '0.8rem', textAlign: 'center' }}>
            No components match "{search}"
          </div>
        )}
      </div>

      {/* Footer: save selected component */}
      <div style={{ padding: '10px 12px', borderTop: '1px solid #e9ecef', flexShrink: 0 }}>
        {selectedItem ? (
          <button
            onClick={() => setSaveModal({ componentType: selectedItem.type, props: selectedItem.props || {} })}
            style={{ width: '100%', background: '#f0f4ff', border: '1px solid #c7d2fe', borderRadius: 6, padding: '7px', color: '#4f46e5', fontSize: '0.78rem', cursor: 'pointer', fontWeight: 500 }}
          >
            💾 Save Selected as Preset
          </button>
        ) : (
          <div style={{ color: '#cbd5e1', fontSize: '0.72rem', textAlign: 'center' }}>
            Select a block to save it as a preset
          </div>
        )}
      </div>

      {/* Modals */}
      {preview && (
        <PreviewModal
          name={preview}
          onClose={() => setPreview(null)}
          onAdd={addComponent}
        />
      )}
      {saveModal && (
        <SaveModal
          componentType={saveModal.componentType}
          propsToSave={saveModal.props}
          onClose={() => setSaveModal(null)}
          onSaved={loadSaved}
        />
      )}
    </div>
  );
}

// ── Right inspector slide-out panel ──────────────────────────────────────────
// Rendered via portal directly into document.body so it is never a child of
// Puck's transformed sidebar (which would break position:fixed coordinates).
// Visibility is driven by React state (appState.ui.itemSelector), not CSS
// class names that change between Puck builds.

const FORMAT_GUIDE = [
  { k: 'Colors',  v: '#cc1122 · #fff · transparent · rgba(0,0,0,0.5)' },
  { k: 'Sizes',   v: '80vh · 500px · 100% · auto · clamp(1rem,4vw,3rem)' },
  { k: 'Padding', v: '4rem 0  ·  2rem 1rem  ·  1rem 2rem 4rem 2rem' },
  { k: 'Overlay', v: '0 = none · 0.3 = subtle · 0.5 = half · 1 = full dark' },
  { k: 'Radius',  v: '0 (sharp) · 4px · 12px · 24px · 50% (circle)' },
  { k: 'Align',   v: 'left · center · right · justify' },
  { k: 'Icons',   v: 'solar:star-bold · mdi:home · lucide:zap · fa-solid fa-plane' },
];

export function FieldsOverride({ children, isLoading }) {
  const { dispatch, appState } = usePuck();
  const isOpen = !!appState?.ui?.itemSelector;
  const [topOffset, setTopOffset] = useState(0);
  const [showGuide, setShowGuide] = useState(false);

  // Measure the app nav height AND the builder's own topbar (both are present
  // when the editor runs inside the dashboard) so the panel starts below both,
  // not overlapping either. In standalone mode only one of the two exists.
  useEffect(() => {
    const measure = () => {
      const appTopbar     = document.querySelector('.topbar')?.offsetHeight || 0;
      const builderTopbar = document.querySelector('[data-builder-topbar]')?.offsetHeight || 0;
      setTopOffset(appTopbar + builderTopbar);
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  function close() {
    dispatch({ type: 'setUi', ui: { itemSelector: null } });
  }

  return createPortal(
    <div className="puck-props-panel" style={{
      position: 'fixed',
      right: 0,
      top: topOffset,
      height: `calc(100vh - ${topOffset}px)`,
      width: 380,
      zIndex: 200000,
      background: '#fff',
      borderLeft: '1px solid #e2e8f0',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
      transform: isOpen ? 'translateX(0)' : 'translateX(110%)',
      transition: 'transform 0.24s cubic-bezier(0.4,0,0.2,1)',
      boxShadow: isOpen ? '-6px 0 28px rgba(0,0,0,0.18)' : 'none',
    }}>
      {/* Panel title bar */}
      <div style={{
        padding: '10px 14px',
        borderBottom: '1px solid #e9ecef',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        flexShrink: 0,
        background: '#f8f9fa',
      }}>
        <span style={{ fontWeight: 700, fontSize: '0.82rem', color: '#1e293b' }}>Properties</span>
        <button
          onClick={close}
          title="Close panel"
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#64748b', fontSize: '1rem', padding: '0 2px', lineHeight: 1 }}
        >
          ✕
        </button>
      </div>
      {/* Collapsible format reference — helps users know what to type */}
      <div style={{ borderBottom: '1px solid #e9ecef', flexShrink: 0 }}>
        <button
          onClick={() => setShowGuide(g => !g)}
          style={{ width: '100%', padding: '5px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.65rem', fontWeight: 600, color: '#64748b', letterSpacing: '0.03em' }}
        >
          <span>📋 Format Reference</span>
          <span style={{ transform: showGuide ? 'rotate(0)' : 'rotate(-90deg)', transition: 'transform 0.15s', display: 'inline-block', color: '#94a3b8' }}>▾</span>
        </button>
        {showGuide && (
          <div style={{ padding: '6px 14px 10px', background: '#f8faff', borderTop: '1px solid #e9ecef' }}>
            {FORMAT_GUIDE.map(({ k, v }) => (
              <div key={k} style={{ display: 'flex', gap: 6, marginBottom: 3, lineHeight: 1.45 }}>
                <span style={{ fontSize: '0.6rem', fontWeight: 700, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.04em', flexShrink: 0, width: 46, paddingTop: 1 }}>{k}</span>
                <span style={{ fontSize: '0.62rem', color: '#4b5563', fontFamily: 'monospace', wordBreak: 'break-word' }}>{v}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Scrollable fields */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '18px 16px 28px', background: '#f4f6f8' }}>
        {isLoading
          ? <div style={{ padding: 24, textAlign: 'center' }}><span className="spinner-border spinner-border-sm text-secondary" /></div>
          : children}
      </div>
    </div>,
    document.body
  );
}
