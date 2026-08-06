import { useState, useEffect, useCallback, useRef, Component } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Puck, usePuck } from '@measured/puck';

// ── Error boundary so a bad block shows an error card, not a blank screen ──────
class EditorErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error, info) { console.error('[PageEditor] render error', error, info); }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: '3rem 2rem', maxWidth: 600, margin: '0 auto', textAlign: 'center' }}>
          <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>⚠️</div>
          <h3 style={{ color: '#c53030', marginBottom: '0.75rem' }}>Page editor crashed</h3>
          <p style={{ color: '#4a5568', marginBottom: '1rem' }}>
            A block on this page threw a render error. The page data may be corrupted or contain an unrecognised block type.
          </p>
          <pre style={{ background: '#fff5f5', border: '1px solid #fed7d7', borderRadius: 8, padding: '1rem', textAlign: 'left', fontSize: '0.8rem', color: '#c53030', overflowX: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
            {this.state.error?.message || String(this.state.error)}
          </pre>
          <button
            className="btn btn-sm btn-outline-danger mt-3"
            onClick={() => {
              this.setState({ error: null });
              this.props.onReset?.();
            }}
          >
            Clear page data and retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
import puckCssUrl from '@measured/puck/puck.css?url';
import { puckConfig } from '../builder/puckConfig.jsx';
import SitePreviewShell from '../builder/SitePreviewShell.jsx';
import DataTablePanel from '../builder/DataTablePanel.jsx';
import { DATA_TYPES } from '../builder/dataTypes.js';
import { BuilderPalette, FieldsOverride } from '../builder/BuilderPalette.jsx';
import api from '../../api/client.js';

// Maps data_type → the React component that renders the public page.
// Empty for now — add entries here as LIT-CRM builds its own dynamic
// data-driven page types (mirrors the pattern, not tied to any one page).
const DATA_PAGE_COMPONENTS = {};


// ── Version History Panel ─────────────────────────────────────────────────────
function VersionPanel({ pageId, onRestore }) {
  const [versions, setVersions] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get(`/website/pages/${pageId}/versions`)
      .then(r => setVersions(r.data))
      .finally(() => setLoading(false));
  }, [pageId]);

  async function restore(vid) {
    if (!window.confirm('Restore this version? Your current content will be saved as a new version first.')) return;
    await api.post(`/website/versions/${vid}/restore`);
    onRestore();
  }

  if (loading) return <div className="p-3 text-center"><span className="spinner-border spinner-border-sm" /></div>;
  if (!versions.length) return <div className="p-3 text-muted small">No previous versions saved yet.</div>;

  return (
    <div style={{ maxHeight: 400, overflowY: 'auto' }}>
      {versions.map(v => (
        <div key={v.id} style={{ padding: '8px 12px', borderBottom: '1px solid #eee', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: '0.82rem', fontWeight: 600 }}>{v.snapshot_label || 'Auto-save'}</div>
            <div style={{ fontSize: '0.74rem', color: '#888' }}>{new Date(v.created_at).toLocaleString()}</div>
            {v.user_name && <div style={{ fontSize: '0.72rem', color: '#4a2d82', fontWeight: 500 }}>by {v.user_name}</div>}
          </div>
          <button className="btn btn-sm btn-outline-primary py-0 px-2" style={{ fontSize: '0.74rem' }} onClick={() => restore(v.id)}>Restore</button>
        </div>
      ))}
    </div>
  );
}

// ── Main Editor ────────────────────────────────────────────────────────────────
const EMPTY_PUCK = { content: [], root: { props: { pageTitle: '' } } };

// Puck 0.20.x requires block id inside props (props.id). Old saves stored it at
// the top level. Normalize on load so walkAppState can correctly index each block.
function normalizePuckData(data) {
  if (!data || !Array.isArray(data.content)) return data;
  return {
    ...data,
    content: data.content.map((block) => {
      if (block.props && block.props.id) return block;
      const id = block.id || `${block.type}-${Math.random().toString(36).slice(2, 10)}`;
      return { ...block, props: { id, ...(block.props || {}) } };
    }),
  };
}

export default function WebsitePageEditor() {
  const { id } = useParams();
  const navigate = useNavigate();

  const puckDataRef  = useRef(EMPTY_PUCK);
  // Puck unmounts its own left/right sidebar wrappers below 638px and force-
  // closes its internal ui.leftSideBarVisible on mount at that width — our
  // "Panel" button's sidebarHidden state is a separate, app-level toggle
  // that only controls whether BuilderPalette renders its content, so on
  // mobile it had no way to ask Puck to remount the wrapper it had already
  // hidden. This ref (populated by usePuck() inside overrides.puck below,
  // which — unlike the drawer override — always renders) lets the button
  // reach into Puck's own dispatch to bring the wrapper back.
  const puckDispatchRef = useRef(null);
  // Match Puck's own initial state below 638px so the button's label ("Show"
  // vs "Hide") is right from the first render — otherwise it claims the
  // panel is showing when Puck already closed it, and the first tap hides
  // it further instead of bringing it back.
  const [sidebarHidden, setSidebarHidden] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia('(max-width: 637px)').matches
  );
  const [page,         setPage]         = useState(null);
  const [puckData,     setPuckData]     = useState(EMPTY_PUCK);
  const [status,       setStatus]       = useState('published');
  const [pageTitle,    setPageTitle]    = useState('');
  const [pageSlug,     setPageSlug]     = useState('');
  const [metaTitle,    setMetaTitle]    = useState('');
  const [metaDesc,     setMetaDesc]     = useState('');
  const [metaKeywords, setMetaKeywords] = useState('');
  const [ogImage,      setOgImage]      = useState('');
  const [customCss,    setCustomCss]    = useState('');
  const [customJs,     setCustomJs]     = useState('');
  const [loading,      setLoading]      = useState(true);
  const [saving,       setSaving]       = useState(false);
  const [msg,          setMsg]          = useState('');
  const [showVersions, setShowVersions] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showData,     setShowData]     = useState(false);
  const [versionKey,   setVersionKey]   = useState(0);
  const [topOffset,    setTopOffset]    = useState(0);
  const [deviceView,   setDeviceView]   = useState('desktop');

  // Measure the dashboard's own topbar so the editor fills exactly the
  // remaining viewport height instead of a flat 100vh, which overflows the
  // page by the topbar's height and pushes the canvas bottom below the fold.
  useEffect(() => {
    const measure = () => {
      const h = document.querySelector('.topbar')?.offsetHeight || 0;
      setTopOffset(h);
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  // Inject Puck CSS + our overrides only while editor is mounted
  useEffect(() => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = puckCssUrl;
    link.id = 'puck-editor-css';
    document.head.appendChild(link);

    // Override Puck's pink/rose defaults and fix body background bleed-through.
    // Must be an inline <style> (not a <link>) so variables resolve immediately,
    // before the async Puck CSS file finishes loading.
    const style = document.createElement('style');
    style.id = 'puck-overrides';
    style.textContent = `
      body { background: #f5f5f5 !important; }

      /* Collapse the Puck header row — our custom topbar replaces it */
      [class*="_PuckLayout-header_"] {
        display: none !important;
      }
      /* Puck's own outer wrapper is flex-grow:0 by default, so it shrink-wraps
         to content instead of filling its flex parent — this is what makes the
         canvas collapse to a sliver whenever the sidebar's content gets short
         (e.g. hidden), since every height:100% below depends on this. */
      .Puck {
        flex: 1 1 auto !important;
        min-height: 0 !important;
      }
      /* Two unlabeled wrapper divs sit between .Puck and _PuckLayout_ (verified
         against @measured/puck 0.20.2's real DOM — no class hooks exist for
         them). They default to shrink-wrap-to-content, and since the actual
         page preview renders inside an absolutely-positioned #puck-canvas-root
         (out of flow, contributing nothing to auto-height), these wrappers
         collapse to near-zero content height whenever nothing else props them
         open. Puck's own zoom system then measures that collapsed height via
         ResizeObserver and writes it back as the new canvas height — a
         self-reinforcing feedback loop that latches onto whatever small value
         it first samples (e.g. right after the sidebar-toggle grid reflow).
         Forcing height:100% here breaks the loop by keeping every link in the
         chain definite, anchored to .Puck's own reliable flex-computed size. */
      .Puck > div,
      .Puck > div > div {
        height: 100% !important;
        min-height: 0 !important;
      }
      /* Puck root + inner fill the available height */
      [class*="_PuckLayout_"]:not([class*="-header_"]):not([class*="-inner_"]) {
        flex: 1 !important;
        min-height: 0 !important;
        height: 100% !important;
        display: flex !important;
        flex-direction: column !important;
      }
      /* Inner grid has two template-area rows (header, left/editor/right) — size
         both explicitly, or the hidden header row's 1fr grabs the leftover
         space that should go to the canvas row. */
      [class*="_PuckLayout-inner_"] {
        flex: 1 !important;
        min-height: 0 !important;
        height: 100% !important;
        grid-template-rows: min-content minmax(0, 1fr) !important;
      }
      [class*="_PuckLayout-inner_"] > * {
        min-height: 0 !important;
      }
      /* Left sidebar: full height, no extra padding */
      [class*="_PuckLayout-inner_"] > [class*="_Sidebar_"]:first-child {
        padding: 0 !important;
        overflow: hidden !important;
        height: 100% !important;
        display: flex !important;
        flex-direction: column !important;
      }
      /* Puck's drawer wrapper must fill its sidebar slot */
      [class*="_Drawer_"] {
        height: 100% !important;
        display: flex !important;
        flex-direction: column !important;
      }
      /* Hide Puck's built-in "COMPONENTS" section title above our palette */
      [class*="_PuckLayout-inner_"] > [class*="_Sidebar_"]:first-child [class*="_SidebarSection-title_"],
      [class*="_PuckLayout-inner_"] > [class*="_Sidebar_"]:first-child [class*="_SidebarSection_title_"] {
        display: none !important;
      }
      /* Hide the Outline section so our palette fills 100% of the sidebar */
      [class*="_PuckLayout-inner_"] > [class*="_Sidebar_"]:first-child [class*="_Outline_"] {
        display: none !important;
      }

      /* ── Properties panel: modern dashboard-style fields ─────────────────── */

      .puck-props-panel {
        --puck-font-size-xxs: 0.7rem;
        --puck-font-size-xxxs: 0.7rem;
      }

      /* ── Sidebar sections rendered as white cards ───────────────────────────── */
      .puck-props-panel [class*="_SidebarSection_"]:not([class*="-title_"]):not([class*="-inner_"]) {
        background: #fff !important;
        border: 1px solid #e2e8f0 !important;
        border-radius: 10px !important;
        padding: 16px 16px 4px !important;
        margin-bottom: 10px !important;
        box-shadow: 0 1px 3px rgba(0,0,0,0.04) !important;
      }

      /* ── All inputs / selects / textareas — 100% width, readable sizing ──── */
      .puck-props-panel input[type="text"],
      .puck-props-panel input[type="number"],
      .puck-props-panel input[type="url"],
      .puck-props-panel input[type="email"],
      .puck-props-panel input[type="search"],
      .puck-props-panel textarea,
      .puck-props-panel select {
        display: block !important;
        width: 100% !important;
        box-sizing: border-box !important;
        padding: 0.44rem 0.75rem !important;
        font-size: 0.83rem !important;
        line-height: 1.5 !important;
        color: #1f2937 !important;
        background: #fff !important;
        border: 1px solid #dee2e6 !important;
        border-radius: 6px !important;
        transition: border-color 0.15s, box-shadow 0.15s !important;
      }
      .puck-props-panel input:focus,
      .puck-props-panel textarea:focus,
      .puck-props-panel select:focus {
        border-color: var(--brand, #20507c) !important;
        outline: 0 !important;
        box-shadow: 0 0 0 3px rgba(32,80,124,0.13) !important;
      }
      .puck-props-panel textarea {
        min-height: 88px !important;
        resize: vertical !important;
      }
      .puck-props-panel select { appearance: auto !important; cursor: pointer !important; }
      .puck-props-panel input[type="checkbox"] {
        width: 15px !important; height: 15px !important;
        accent-color: var(--brand, #20507c) !important; cursor: pointer !important;
      }

      /* Ensure every wrapper div is also full-width */
      .puck-props-panel [class*="_InputWrapper_"],
      .puck-props-panel [class*="_Input_"]:not([class*="_Input-"]):not([class*="_InputWrapper_"]) {
        width: 100% !important;
        box-sizing: border-box !important;
      }

      /* ── Native Puck field labels ──────────────────────────────────────────── */
      .puck-props-panel [class*="_Input-label_"] {
        font-size: 0.7rem !important;
        font-weight: 600 !important;
        color: #4b5563 !important;
        text-transform: uppercase !important;
        letter-spacing: 0.05em !important;
        padding-bottom: 7px !important;
        line-height: 1.2 !important;
        display: block !important;
      }
      .puck-props-panel [class*="_Input-labelIcon_"] {
        display: none !important;
      }

      /* ── Custom field labels ───────────────────────────────────────────────── */
      .puck-props-panel label:not([class*="_Input"]) {
        font-size: 0.7rem !important;
        font-weight: 600 !important;
        color: #4b5563 !important;
        text-transform: uppercase !important;
        letter-spacing: 0.05em !important;
        margin-bottom: 7px !important;
        display: block !important;
        line-height: 1.2 !important;
      }

      /* ── Field row spacing ──────────────────────────────────────────────────── */
      .puck-props-panel [class*="_Input_"]:not([class*="_Input-"]):not([class*="_InputWrapper_"]) {
        margin-bottom: 20px !important;
      }
      .puck-props-panel [class*="_FieldWrapper_"] {
        margin-bottom: 20px !important;
      }

      /* ── Array item cards ───────────────────────────────────────────────────── */
      .puck-props-panel [class*="_ArrayFieldItem_"] {
        border: 1px solid #e2e8f0 !important;
        border-radius: 8px !important;
        padding: 12px 14px !important;
        margin-bottom: 8px !important;
        background: #f8fafc !important;
        box-shadow: 0 1px 2px rgba(0,0,0,0.04) !important;
      }
      .puck-props-panel [class*="_ArrayField_"] > button,
      .puck-props-panel [class*="_ArrayField-addButton_"] {
        font-size: 0.78rem !important;
        margin-top: 6px !important;
        width: 100% !important;
      }

      /* ── Section headings ───────────────────────────────────────────────────── */
      .puck-props-panel [class*="_SidebarSection-title_"],
      .puck-props-panel [class*="_SidebarSection_title_"] {
        font-size: 0.68rem !important;
        font-weight: 700 !important;
        text-transform: uppercase !important;
        letter-spacing: 0.07em !important;
        color: #374151 !important;
        padding: 0 0 10px !important;
        border-bottom: 1px solid #e9ecef !important;
        margin-bottom: 14px !important;
      }

      /* ── Tooltip from FieldHelp ─────────────────────────────────────────────── */
      .puck-fieldhelp-tip { z-index: 9999999 !important; }

      :root {
        --puck-color-grey-01: #181818;
        --puck-color-grey-02: #292929;
        --puck-color-grey-03: #404040;
        --puck-color-grey-04: #5a5a5a;
        --puck-color-grey-05: #767676;
        --puck-color-grey-06: #949494;
        --puck-color-grey-07: #ababab;
        --puck-color-grey-08: #c3c3c3;
        --puck-color-grey-09: #dcdcdc;
        --puck-color-grey-10: #efefef;
        --puck-color-grey-11: #f5f5f5;
        --puck-color-grey-12: #fafafa;
        --puck-color-rose-01: #4a001c;
        --puck-color-rose-02: #670833;
        --puck-color-rose-03: #87114c;
        --puck-color-rose-04: #a81a66;
        --puck-color-rose-05: #bc5089;
        --puck-color-rose-06: #6c757d;
        --puck-color-rose-07: #495057;
        --puck-color-rose-08: #343a40;
        --puck-color-rose-09: #dcdcdc;
        --puck-color-rose-10: #efefef;
        --puck-color-rose-11: #f5f5f5;
        --puck-color-rose-12: #fafafa;
        --puck-color-azure-01: #00175d;
        --puck-color-azure-02: #002c77;
        --puck-color-azure-03: #014292;
        --puck-color-azure-04: #0158ad;
        --puck-color-azure-05: #3479be;
        --puck-color-azure-06: #6c757d;
        --puck-color-azure-07: #495057;
        --puck-color-azure-08: #343a40;
        --puck-color-azure-09: #dcdcdc;
        --puck-color-azure-10: #efefef;
        --puck-color-azure-11: #f5f5f5;
        --puck-color-azure-12: #fafafa;

        /* Remove right sidebar from grid — we overlay it via fixed positioning */
        --puck-user-right-side-bar-width: 0px;
      }

      /* ── Action bar: anchor to LEFT so properties panel on right doesn't cover it */
      [class*="_DraggableComponent-actions_"] {
        right: auto !important;
        left: 0 !important;
        transform-origin: left top !important;
      }

      /* ── Left sidebar panel toggle (attr selectors — no hashed class names) ──
         display:none would remove the sidebar from CSS Grid auto-placement,
         shifting the canvas into column 1 (which we set to 0) and collapsing
         it. Keep the sidebar in the grid — just make it invisible/zero-width. */
      .puck-hide-left-sidebar [class*="_PuckLayout-inner_"] {
        grid-template-columns: 0 1fr 0 !important;
      }
      .puck-hide-left-sidebar [class*="_Sidebar_"]:first-child {
        visibility: hidden !important;
        overflow: hidden !important;
        min-width: 0 !important;
        pointer-events: none !important;
      }

      /* ── Layout grid: left panel + canvas + 0 (right panel is a portal) ─────
         min() caps the palette at 85% of viewport width so it can't push the
         canvas off-screen on a narrow (e.g. phone-width) browser window. */
      [class*="_PuckLayout-inner_"] {
        grid-template-columns: min(var(--puck-left-side-bar-width, 300px), 85vw) 1fr 0 !important;
      }
      /* Puck itself unmounts _Sidebar--left_ from the DOM entirely below
         638px (its own internal breakpoint, not ours) — but --puck-left-
         side-bar-width still resolves to a non-zero value, so without this
         override the grid kept reserving that column for a sidebar that no
         longer exists, leaving the canvas squeezed into a sliver next to a
         blank strip. :has() scopes this to when the sidebar is genuinely
         absent — our "Panel" button can ask Puck to remount it even below
         638px (see puckDispatchRef in the component), and when it does,
         this must NOT also collapse the column it just remounted into. */
      @media (max-width: 600px) {
        [class*="_PuckLayout-inner_"]:not(:has([class*="_Sidebar--left_"])) {
          grid-template-columns: 0 1fr 0 !important;
        }
      }

      /* ── Canvas column: scrollable so full-page content is visible ────────── */
      /* Target the middle grid item (not a sidebar) — Puck defaults to overflow:hidden.
         (Verified against @measured/puck 0.20.2's real class names — it's
         "PuckCanvas", not "Canvas"/"Frame"/"Preview"/"iFrameWrapper", none of
         which exist in this version and never matched anything.) */
      [class*="_PuckCanvas_"],
      [class*="_PuckCanvas-inner_"],
      [class*="_PuckLayout-inner_"] > div:not([class*="_Sidebar_"]) {
        overflow-y: auto !important;
        height: 100% !important;
      }
      /* Puck's own stylesheet positions #puck-canvas-root as position:
         absolute, top:0, bottom:0 on _PuckCanvas-inner_ (position: relative)
         — that pin is what's supposed to stretch it to fill the canvas, no
         percentage math needed. But Puck's React component also sets an
         inline style.height = zoomConfig.rootHeight (a measured pixel value)
         on every render, and top+bottom+height together is an
         over-constrained box per spec — the browser drops bottom and uses
         the JS height instead, which is what produces the small boxed-in,
         iframe-looking scroll area when that measurement lags or is stale.
         Force height back to auto (not a percentage — percentages need a
         definite containing-block height to resolve and can silently
         collapse to auto anyway) so top:0/bottom:0 are free to win again. */
      #puck-canvas-root {
        height: auto !important;
        top: 0 !important;
        bottom: 0 !important;
      }

      /* Hide Puck's native right sidebar — FieldsOverride renders via portal */
      [class*="_PuckLayout-inner_"] > [class*="_Sidebar_"]:last-child:not(:first-child) {
        display: none !important;
      }

      /* ── Device preview frame (Tablet / Mobile) ──────────────────────────────
         Desktop mode is untouched — #puck-canvas-root keeps Puck's own
         absolute top:0/bottom:0 stretch-to-fill behavior exactly as before.
         Tablet/Mobile switch it to a normal-flow, width-capped, centered box
         so it reads as a device frame. Note this is a visual approximation:
         it does NOT re-evaluate the public site's @media (viewport-width)
         rules, since there's no iframe boundary here — real breakpoint-driven
         layout changes (e.g. nav collapsing to a hamburger) won't trigger,
         only content that responds to its own box width (flex-wrap, percentage
         widths, etc.) will visibly reflow. */
      .puck-device-tablet [class*="_PuckCanvas-inner_"],
      .puck-device-mobile [class*="_PuckCanvas-inner_"] {
        background: #dde3ea !important;
        padding: 24px 0 !important;
      }
      .puck-device-tablet #puck-canvas-root,
      .puck-device-mobile #puck-canvas-root {
        position: relative !important;
        top: auto !important;
        bottom: auto !important;
        left: auto !important;
        right: auto !important;
        margin: 0 auto !important;
        min-height: calc(100% - 48px) !important;
        box-shadow: 0 0 0 1px rgba(0,0,0,0.08), 0 12px 32px rgba(0,0,0,0.18) !important;
        background: #fff !important;
      }
      .puck-device-tablet #puck-canvas-root { width: 768px !important; max-width: 768px !important; }
      .puck-device-mobile #puck-canvas-root { width: 390px !important; max-width: 390px !important; }
    `;
    document.head.appendChild(style);

    return () => {
      document.getElementById('puck-editor-css')?.remove();
      document.getElementById('puck-overrides')?.remove();
      // Restore body background when leaving the editor
      document.body.style.removeProperty('background');
    };
  }, []);

  useEffect(() => {
    setLoading(true);
    api.get(`/website/pages/${id}`).then(({ data }) => {
      setPage(data);
      setStatus(data.status || 'draft');
      setPageTitle(data.title || '');
      setPageSlug(data.slug || '');
      setMetaTitle(data.meta_title || '');
      setMetaDesc(data.meta_desc || '');
      setMetaKeywords(data.meta_keywords || '');
      setOgImage(data.og_image || '');
      setCustomCss(data.custom_css || '');
      setCustomJs(data.custom_js || '');
      if (data.puck_data && data.puck_data.content) {
        const normalized = normalizePuckData(data.puck_data);
        puckDataRef.current = normalized;
        setPuckData(normalized);
      } else {
        puckDataRef.current = EMPTY_PUCK;
        setPuckData(EMPTY_PUCK);
      }
      setLoading(false);
    }).catch(() => {
      setMsg('Failed to load page.');
      setLoading(false);
    });
  }, [id, versionKey]);

  const save = useCallback(async (snapshotLabel) => {
    setSaving(true);
    setMsg('');
    try {
      await api.put(`/website/pages/${id}`, {
        title:      pageTitle,
        slug:       pageSlug,
        status,
        puck_data:  puckDataRef.current,
        meta_title:     metaTitle,
        meta_desc:      metaDesc,
        meta_keywords:  metaKeywords,
        og_image:       ogImage,
        custom_css: customCss,
        custom_js:  customJs,
        snapshot_label: snapshotLabel || null,
      });
      setMsg('Saved');
      setTimeout(() => setMsg(''), 3000);
    } catch (e) {
      setMsg(e.response?.data?.error || 'Save failed');
    } finally {
      setSaving(false);
    }
  }, [id, pageTitle, pageSlug, status, puckData, metaTitle, metaDesc, metaKeywords, ogImage, customCss, customJs]);

  if (loading) return <div className="d-flex justify-content-center align-items-center" style={{ height: '100vh' }}><span className="spinner-border text-primary" /></div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: `calc(100vh - ${topOffset}px)`, overflow: 'hidden', margin: topOffset > 0 ? '-1rem' : 0 }}>

      {/* Top bar — scrolls horizontally instead of clipping buttons off-screen
          on narrow viewports, since every action here (Save chief among them)
          must stay reachable regardless of screen width. */}
      <div data-builder-topbar style={{ background: '#1e1e2e', color: 'white', padding: '0.5rem 1rem', display: 'flex', alignItems: 'center', gap: '0.75rem', flexShrink: 0, zIndex: 100, overflowX: 'auto', overflowY: 'hidden' }}>
        <button className="btn btn-sm btn-outline-light py-0 px-2" style={{ flexShrink: 0 }} onClick={() => navigate('/admin/website/pages')}>&#8592; Pages</button>
        <span style={{ fontWeight: 600, fontSize: '0.9rem', flex: 1, minWidth: 120, whiteSpace: 'nowrap' }}>{pageTitle || page?.title}</span>

        <select
          value={status}
          onChange={e => setStatus(e.target.value)}
          style={{ background: status === 'published' ? '#198754' : '#6c757d', color: 'white', border: 'none', padding: '0.25rem 0.6rem', borderRadius: 4, fontSize: '0.82rem', cursor: 'pointer', flexShrink: 0 }}
        >
          <option value="draft">Draft</option>
          <option value="published">Published</option>
        </select>

        <div style={{ display: 'flex', gap: 2, background: 'rgba(255,255,255,0.1)', borderRadius: 6, padding: 2, flexShrink: 0 }}>
          {[
            { key: 'desktop', icon: 'solar:monitor-linear', label: 'Desktop view' },
            { key: 'tablet',  icon: 'solar:tablet-linear',  label: 'Tablet view' },
            { key: 'mobile',  icon: 'solar:iphone-linear',  label: 'Mobile view' },
          ].map((d) => (
            <button
              key={d.key}
              type="button"
              className="btn btn-sm py-0 px-2"
              title={d.label}
              onClick={() => setDeviceView(d.key)}
              style={{
                background: deviceView === d.key ? '#fff' : 'transparent',
                color: deviceView === d.key ? '#1e1e2e' : 'rgba(255,255,255,0.85)',
                border: 'none',
                borderRadius: 4,
                lineHeight: 1,
              }}
            >
              <iconify-icon icon={d.icon} style={{ fontSize: '1rem', display: 'block' }}></iconify-icon>
            </button>
          ))}
        </div>

        <button
          className="btn btn-sm btn-outline-light py-0 px-2"
          style={{ flexShrink: 0 }}
          title={sidebarHidden ? 'Show components panel' : 'Hide components panel'}
          onClick={() => setSidebarHidden(h => {
            const next = !h;
            // Below 638px, Puck's own ui.leftSideBarVisible is force-closed on
            // mount/resize — ask Puck to remount its sidebar wrapper too, or
            // toggling our own state alone would show an empty panel on mobile.
            puckDispatchRef.current?.({ type: 'setUi', ui: { leftSideBarVisible: !next } });
            return next;
          })}
        >
          {sidebarHidden ? '☰ Panel' : '◀ Panel'}
        </button>

        <button className="btn btn-sm btn-outline-light py-0 px-2" style={{ flexShrink: 0 }} onClick={() => setShowVersions(v => !v)}>
          {showVersions ? 'Close History' : 'History'}
        </button>

        <button className="btn btn-sm btn-outline-light py-0 px-2" style={{ flexShrink: 0 }} onClick={() => setShowSettings(v => !v)}>
          {showSettings ? 'Close Settings' : 'Settings'}
        </button>

        {page?.data_type && DATA_TYPES[page.data_type] && (
          <button
            className="btn btn-sm py-0 px-2"
            style={{ background: showData ? '#cc1122' : 'transparent', border: '1px solid #cc1122', color: showData ? '#fff' : '#cc1122', flexShrink: 0 }}
            onClick={() => setShowData(v => !v)}
          >
            {showData ? 'Close Data' : '⊞ Data'}
          </button>
        )}

        <button
          className="btn btn-sm btn-outline-light py-0 px-2"
          style={{ flexShrink: 0 }}
          title="Open editor in its own window for more space"
          onClick={() => window.open(`/builder/${id}`, '_blank', 'width=1440,height=900,menubar=no,toolbar=no,location=no,status=no')}
        >
          ⊞ Window
        </button>

        <a href={`/${pageSlug || page?.slug}`} target="_blank" rel="noopener noreferrer" className="btn btn-sm btn-outline-light py-0 px-2" style={{ flexShrink: 0 }}>Preview</a>

        {msg && <span style={{ fontSize: '0.8rem', color: msg === 'Saved' ? '#6fcf97' : '#eb5757', flexShrink: 0 }}>{msg}</span>}

        <button className="btn btn-sm btn-primary py-0 px-3" style={{ flexShrink: 0 }} onClick={() => save()} disabled={saving}>
          {saving ? 'Saving...' : 'Save'}
        </button>
      </div>

      {/* Side panels + editor */}
      <div style={{ display: 'flex', flex: 1, minHeight: 0, overflow: 'hidden' }}>

        {/* Version history panel */}
        {showVersions && (
          <div style={{ width: 'min(280px, 85vw)', background: '#fff', borderRight: '1px solid #dee2e6', flexShrink: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
            <div style={{ padding: '0.75rem 1rem', background: '#f8f9fa', borderBottom: '1px solid #dee2e6', fontWeight: 600, fontSize: '0.85rem' }}>Version History</div>
            <VersionPanel pageId={id} onRestore={() => { setShowVersions(false); setVersionKey(k => k + 1); }} />
          </div>
        )}

        {/* Data panel */}
        {showData && page?.data_type && DATA_TYPES[page.data_type] && (
          <div style={{ width: 'min(320px, 85vw)', background: '#fff', borderRight: '1px solid #dee2e6', flexShrink: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div style={{ padding: '10px 14px', background: '#1a1a2e', borderBottom: '1px solid #dee2e6', fontWeight: 700, fontSize: '0.85rem', color: '#fff', flexShrink: 0 }}>
              {DATA_TYPES[page.data_type].label}
            </div>
            <DataTablePanel cfg={DATA_TYPES[page.data_type]} />
          </div>
        )}

        {/* Settings panel */}
        {showSettings && (
          <div style={{ width: 'min(320px, 85vw)', background: '#fff', borderRight: '1px solid #dee2e6', flexShrink: 0, overflowY: 'auto', padding: '1rem' }}>
            <div style={{ fontWeight: 600, fontSize: '0.85rem', marginBottom: '1rem' }}>Page Settings</div>
            <label className="form-label form-label-sm">Page Title</label>
            <input className="form-control form-control-sm mb-2" value={pageTitle} onChange={e => setPageTitle(e.target.value)} />
            <label className="form-label form-label-sm">URL Slug</label>
            <div className="input-group input-group-sm mb-3">
              <span className="input-group-text">/</span>
              <input className="form-control font-monospace" value={pageSlug}
                onChange={e => setPageSlug(e.target.value.toLowerCase().replace(/[^a-z0-9/-]/g, '-').replace(/-+/g, '-'))}
                placeholder="page-url" />
            </div>
            <hr className="my-2" />
            <label className="form-label form-label-sm">Meta Title</label>
            <input className="form-control form-control-sm mb-2" value={metaTitle} onChange={e => setMetaTitle(e.target.value)} />
            <label className="form-label form-label-sm">Meta Description</label>
            <textarea className="form-control form-control-sm mb-1" rows={3} value={metaDesc} onChange={e => setMetaDesc(e.target.value)} />
            <div className="form-text mb-2" style={{ fontSize: '0.72rem' }}>Shown in Google search results. Aim for 150–160 characters.</div>
            <label className="form-label form-label-sm">Meta Keywords</label>
            <input className="form-control form-control-sm mb-1" value={metaKeywords} onChange={e => setMetaKeywords(e.target.value)} placeholder="aviation, kit aircraft, panther, experimental" />
            <div className="form-text mb-2" style={{ fontSize: '0.72rem' }}>Comma-separated. Google ignores this; Bing and others still read it.</div>
            <label className="form-label form-label-sm">OG Image URL</label>
            <input className="form-control form-control-sm mb-2" value={ogImage} onChange={e => setOgImage(e.target.value)} placeholder="https://…/image.jpg" />
            <hr />
            <label className="form-label form-label-sm">Custom CSS (this page only)</label>
            <textarea className="form-control form-control-sm mb-2 font-monospace" rows={6} value={customCss} onChange={e => setCustomCss(e.target.value)} placeholder=".my-class { color: red; }" style={{ fontSize: '0.76rem' }} />
            <label className="form-label form-label-sm">Custom JS (this page only)</label>
            <textarea className="form-control form-control-sm mb-3 font-monospace" rows={4} value={customJs} onChange={e => setCustomJs(e.target.value)} placeholder="console.log('page loaded');" style={{ fontSize: '0.76rem' }} />
            <button className="btn btn-sm btn-primary w-100" onClick={() => save()}>Save Settings</button>
          </div>
        )}

        {/* Puck editor canvas */}
        <EditorErrorBoundary onReset={() => { puckDataRef.current = EMPTY_PUCK; setPuckData(EMPTY_PUCK); setVersionKey(k => k + 1); }}>
        <div
          className={[sidebarHidden && 'puck-hide-left-sidebar', deviceView !== 'desktop' && `puck-device-${deviceView}`].filter(Boolean).join(' ')}
          style={{ flex: 1, minHeight: 0, overflow: 'auto', display: 'flex', flexDirection: 'column' }}
        >
          {page?.data_type && DATA_TYPES[page.data_type] && (
            <div style={{
              background: '#fff8e1', borderBottom: '2px solid #f0c040',
              padding: '14px 20px', display: 'flex', alignItems: 'center', gap: 14, flexShrink: 0,
            }}>
              <span style={{ fontSize: '1.5rem', lineHeight: 1 }}>📋</span>
              <div>
                <div style={{ fontWeight: 700, fontSize: '0.9rem', color: '#7a5c00' }}>
                  Data-Driven Page — content managed via the Data panel
                </div>
                <div style={{ fontSize: '0.8rem', color: '#9a7a20', marginTop: 2 }}>
                  This page renders {DATA_TYPES[page.data_type].label} from the database.
                  Click <strong>⊞ Data</strong> in the toolbar to add, edit, or reorder entries.
                  You can still use the Puck canvas below to add static blocks above or below the data grid.
                </div>
              </div>
            </div>
          )}
          <Puck
            key={`${id}-${versionKey}`}
            config={puckConfig}
            data={puckData}
            iframe={{ enabled: false }}
            onPublish={async (data) => {
              puckDataRef.current = data;
              await save('Published');
            }}
            onChange={(data) => { puckDataRef.current = data; }}
            overrides={{
              header: () => null,
              drawer: () => <BuilderPalette sidebarHidden={sidebarHidden} />,
              fields: ({ children, isLoading }) => (
                <FieldsOverride isLoading={isLoading}>{children}</FieldsOverride>
              ),
              puck: ({ children }) => {
                const { dispatch } = usePuck();
                useEffect(() => { puckDispatchRef.current = dispatch; }, [dispatch]);
                return (
                  <div style={{ position: 'relative', height: '100%' }}>
                    {children}
                  </div>
                );
              },
              preview: ({ children }) => {
                const DataComp = page?.data_type && DATA_PAGE_COMPONENTS[page.data_type];
                return (
                  <SitePreviewShell deviceView={deviceView}>
                    {customCss && <style>{customCss}</style>}
                    {DataComp ? <DataComp /> : children}
                  </SitePreviewShell>
                );
              },
            }}
          />
        </div>
        </EditorErrorBoundary>
      </div>
    </div>
  );
}
