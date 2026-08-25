// The builder route: /website/pages/:id/edit (and /builder/:id fullscreen).
//
// Owns the page record and the save cycle; Craft owns the node tree. The
// canvas lives in an iframe (see CanvasFrame) so site CSS and admin CSS can
// never reach each other.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Editor, Frame, useEditor } from '@craftjs/core';
import api from '../../api/client.js';
import PublicLayout from '../../components/PublicLayout.jsx';
import { fetchSiteSettings } from '../../frontend/theme/siteTheme.js';
import { formatHtmlNode } from '../code/rawHtml.js';
import { BLANK_PAGE, NODES } from '../nodes/index.jsx';
import CanvasFrame from './CanvasFrame.jsx';
import CodeDrawer from './CodeDrawer.jsx';
import LayersPanel from './LayersPanel.jsx';
import PageSettingsDrawer from './PageSettingsDrawer.jsx';
import RenderNode from './RenderNode.jsx';
import SettingsPanel from './SettingsPanel.jsx';
import ThemeDrawer from './ThemeDrawer.jsx';
import Toolbox from './Toolbox.jsx';
import Topbar, { DEVICES } from './Topbar.jsx';
import './builder.css';

export default function BuilderPage() {
  const { id } = useParams();
  const [page, setPage] = useState(null);
  const [settings, setSettings] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    Promise.all([api.get(`/website/pages/${id}`), fetchSiteSettings({ force: true })])
      .then(([{ data }, resolved]) => {
        if (!alive) return;
        setPage({
          ...data,
          page_mode: data.page_mode || 'visual',
          code_html: data.code_html || '',
          custom_css: data.custom_css || '',
          custom_js: data.custom_js || '',
        });
        setSettings(resolved);
      })
      .catch((e) => alive && setError(e.response?.data?.error || 'Could not load this page.'));
    return () => { alive = false; };
  }, [id]);

  if (error) return <div className="alert alert-danger m-4">{error}</div>;
  if (!page) {
    return (
      <div className="d-flex justify-content-center align-items-center" style={{ height: '60vh' }}>
        <span className="spinner-border text-primary" />
      </div>
    );
  }

  return (
    <Editor resolver={NODES} onRender={RenderNode} enabled indicator={{ success: '#2f9e44', error: '#c92a2a' }}>
      <BuilderShell initialPage={page} settings={settings} onSettingsChange={setSettings} />
    </Editor>
  );
}

/**
 * Renders the page's raw HTML in the canvas while in code mode. Scripts are
 * deliberately not executed here — a third-party widget booting inside the
 * canvas can hijack the editor.
 */
function CodeCanvasPreview({ html }) {
  const host = useRef(null);
  useEffect(() => {
    if (host.current) host.current.innerHTML = html || '';
  }, [html]);
  return <div className="bx-page" ref={host} />;
}

function BuilderShell({ initialPage, settings, onSettingsChange }) {
  const navigate = useNavigate();
  const { query, store } = useEditor();

  // Unsaved theme edits. While this is set the canvas renders from it instead
  // of the stored settings, which is what makes a colour change show up as the
  // picker moves rather than after a save-and-reload.
  const [themeDraft, setThemeDraft] = useState(null);
  const liveSettings = themeDraft || settings;

  // Which of the design's colour schemes the canvas renders in. Designs that
  // ship a dark mode need checking in both before publishing.
  const [canvasTheme, setCanvasTheme] = useState(
    () => (typeof localStorage !== 'undefined' && localStorage.getItem('site-theme')) || 'light',
  );

  const [page, setPage] = useState(initialPage);
  const [device, setDevice] = useState('desktop');
  const [panel, setPanel] = useState('blocks');
  const [drawer, setDrawer] = useState(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [dirty, setDirty] = useState(false);
  const canvasDoc = useRef(null);

  const deviceWidth = DEVICES.find((d) => d.key === device)?.width || '100%';
  const isCodeMode = page.page_mode === 'code';

  // Craft only reads <Frame data> on first mount, so the saved tree is passed
  // as the initial value and Craft owns it from then on.
  const initialTree = useMemo(() => {
    const stored = initialPage.puck_data;
    if (!stored) return null;
    const json = typeof stored === 'string' ? stored : JSON.stringify(stored);
    // A page saved by the old builder has a different shape entirely; treat
    // anything unrecognisable as an empty page rather than crashing the editor.
    return json.includes('"ROOT"') ? json : null;
  }, [initialPage.puck_data]);

  // Dirty tracking. Comparing the serialized tree against a baseline (rather
  // than latching a flag on the first change) means undoing back to the saved
  // state correctly clears the indicator, and Frame's own initial mount doesn't
  // register as an edit.
  const baseline = useRef(null);
  useEffect(() => {
    if (!store) return undefined;
    return store.subscribe(
      (state) => ({ nodes: state.nodes }),
      () => {
        // Craft dispatches some node updates from inside its own render, so
        // setting React state synchronously here warns about updating one
        // component while rendering another. A microtask defers it past the
        // commit without adding a visible delay.
        queueMicrotask(() => {
          const current = query.serialize();
          if (baseline.current === null) {
            baseline.current = current;
            return;
          }
          setDirty(current !== baseline.current);
        });
      },
    );
  }, [store, query]);

  const markDirty = useCallback(() => setDirty(true), []);

  const serializeCurrentDesign = useCallback(() => {
    const doc = canvasDoc.current;
    const root = doc?.querySelector('.bx-page');
    if (!root) return '';
    const clone = root.cloneNode(true);
    // Strip the editor's own plumbing — none of it belongs in published HTML.
    // `draggable` in particular is added by Craft to every connected node and
    // would make the live page's elements drag as images.
    for (const el of clone.querySelectorAll('[data-bx-selected], [data-bx-hovered], [contenteditable], [draggable]')) {
      el.removeAttribute('data-bx-selected');
      el.removeAttribute('data-bx-hovered');
      el.removeAttribute('contenteditable');
      el.removeAttribute('data-placeholder');
      el.removeAttribute('draggable');
    }
    for (const el of clone.querySelectorAll('.bx-node-toolbar, .bx-editor-note')) el.remove();
    // Indented, not the raw one-line innerHTML — this is going into an editor
    // a human has to read.
    return formatHtmlNode(clone);
  }, []);

  const save = useCallback(
    async (snapshotLabel) => {
      setSaving(true);
      setMessage('');
      const serialized = query.serialize();
      try {
        await api.put(`/website/pages/${page.id}`, {
          title: page.title,
          slug: page.slug,
          status: page.status,
          puck_data: JSON.parse(serialized),
          page_mode: page.page_mode,
          code_html: page.code_html,
          meta_title: page.meta_title,
          meta_desc: page.meta_desc,
          meta_keywords: page.meta_keywords,
          og_image: page.og_image,
          custom_css: page.custom_css,
          custom_js: page.custom_js,
          snapshot_label: snapshotLabel || null,
        });
        baseline.current = serialized;
        setDirty(false);
        setMessage('Saved');
        setTimeout(() => setMessage(''), 2500);
      } catch (e) {
        setMessage(e.response?.data?.error || 'Save failed');
      } finally {
        setSaving(false);
      }
    },
    [page, query],
  );

  // Ctrl/Cmd+S saves, because everyone tries it.
  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        save();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [save]);

  // Warn before losing unsaved work.
  useEffect(() => {
    if (!dirty) return undefined;
    const onLeave = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', onLeave);
    return () => window.removeEventListener('beforeunload', onLeave);
  }, [dirty]);

  return (
    <div className="bx-builder">
      <Topbar
        title={page.title}
        status={page.status}
        onStatusChange={(status) => { setPage((p) => ({ ...p, status })); markDirty(); }}
        onSave={save}
        saving={saving}
        message={message}
        device={device}
        onDeviceChange={setDevice}
        onOpenPageSettings={() => setDrawer('settings')}
        onOpenTheme={() => setDrawer('theme')}
        canvasTheme={canvasTheme}
        onCanvasThemeChange={setCanvasTheme}
        onOpenCode={() => setDrawer('code')}
        onBack={() => navigate('/website/pages')}
        onPreview={() => window.open(`/${page.slug}`, '_blank', 'noopener')}
        dirty={dirty}
      />

      <div className="bx-builder__body">
        <aside className="bx-builder__left">
          <div className="bx-tabbar">
            <button type="button" className={panel === 'blocks' ? 'is-active' : ''} onClick={() => setPanel('blocks')}>
              Blocks
            </button>
            <button type="button" className={panel === 'layers' ? 'is-active' : ''} onClick={() => setPanel('layers')}>
              Layers
            </button>
          </div>
          {panel === 'blocks' ? <Toolbox /> : <LayersPanel />}
        </aside>

        <main className="bx-builder__canvas">
          <CanvasFrame
            width={deviceWidth}
            settings={liveSettings}
            theme={canvasTheme}
            slug={page.slug}
            siteCustomCss={liveSettings?.site_custom_css}
            customCss={page.custom_css}
            onDocument={(doc) => { canvasDoc.current = doc; }}
          >
            {/* The real header and footer wrap the editable area so the page
                is edited in the context it will actually be seen in. `preview`
                suppresses every document-level side effect PublicLayout
                normally has — these effects run against the *admin* document,
                not the iframe, so without it opening the builder would inject
                GA4, Clarity and the site stylesheet into the dashboard. */}
            <PublicLayout preview>
              {/* In code mode the stored HTML is what visitors get, so that's
                  what the canvas must show — otherwise the preview lies about
                  the published page. The Craft tree stays mounted (just hidden)
                  so it survives untouched and `query.serialize()` still works
                  when saving. */}
              <div style={isCodeMode ? { display: 'none' } : undefined}>
                <Frame data={initialTree || undefined}>{BLANK_PAGE}</Frame>
              </div>
              {isCodeMode && <CodeCanvasPreview html={page.code_html} />}
            </PublicLayout>
          </CanvasFrame>
        </main>

        <aside className="bx-builder__right">
          <SettingsPanel />
        </aside>
      </div>

      {drawer === 'theme' && (
        <ThemeDrawer
          settings={settings}
          onPreview={setThemeDraft}
          onSaved={(next) => { setThemeDraft(null); onSettingsChange(next); }}
          onClose={() => setDrawer(null)}
        />
      )}
      {drawer === 'settings' && (
        <PageSettingsDrawer
          page={page}
          onChange={(next) => { setPage(next); markDirty(); }}
          onClose={() => setDrawer(null)}
        />
      )}
      {drawer === 'code' && (
        <CodeDrawer
          page={page}
          onChange={(next) => { setPage(next); markDirty(); }}
          onClose={() => setDrawer(null)}
          serializeCurrentDesign={serializeCurrentDesign}
        />
      )}
    </div>
  );
}
