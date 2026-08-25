// Renders a saved page on the public site.
//
// Two modes coexist so code-authored pages and visual pages can live side by
// side in the same site:
//   visual → replay the Craft tree read-only
//   code   → render the stored HTML verbatim
//
// Craft's own <Editor enabled={false}> is what makes the visual mode render
// with zero editor chrome while still using the exact same components as the
// builder — one implementation, so the preview can't drift from the live page.

import { useEffect, useRef } from 'react';
import { Editor, Frame } from '@craftjs/core';
import { NODES } from '../../builder/nodes/index.jsx';
import { injectHtml } from '../../builder/code/rawHtml.js';
import { notifyContentRendered } from '../theme/contentSignal.js';
import { appendScript } from '../../builder/code/rawHtml.js';

export default function PageRenderer({ page }) {
  const mode = page?.page_mode === 'code' ? 'code' : 'visual';

  // Per-page CSS as a <style>, per-page JS as a real <script>. JS assigned via
  // innerHTML never executes — the browser marks those script tags as already
  // run — so it has to be created as an element.
  useEffect(() => {
    if (!page?.custom_js) return undefined;
    return appendScript(page.custom_js);
  }, [page?.custom_js]);

  if (!page) return null;

  // Only code mode needs the `.bx-page` wrapper — in visual mode PageRoot is
  // the page root and renders it itself. Adding it here too nested one inside
  // the other, doubling the page background and padding.
  return (
    <>
      {page.custom_css && <style>{page.custom_css}</style>}
      {mode === 'code'
        ? <div className="bx-page"><CodePage html={page.code_html} /></div>
        : <VisualPage data={page.puck_data} />}
    </>
  );
}

function VisualPage({ data }) {
  const json = normalize(data);

  // Tell the layout the content is in the DOM, so an imported design's script
  // gets re-run against it. Without this, anything the script has to
  // initialise — scroll reveals, tabs — never wakes up on the first page load.
  useEffect(() => {
    if (json) notifyContentRendered();
  }, [json]);

  if (!json) {
    return (
      <div className="bx-editor-note" style={{ margin: '64px auto', maxWidth: 480 }}>
        This page has no content yet.
      </div>
    );
  }
  return (
    <Editor enabled={false} resolver={NODES}>
      <Frame data={json} />
    </Editor>
  );
}

function CodePage({ html }) {
  const host = useRef(null);
  useEffect(() => {
    injectHtml(host.current, html || '');
    notifyContentRendered();
  }, [html]);
  return <div ref={host} className="bx-html" />;
}

/**
 * Accept either a JSON string or an object, and reject anything that isn't a
 * Craft tree — a page saved by an older builder must render as empty rather
 * than throwing and taking the whole site down.
 */
function normalize(stored) {
  if (!stored) return null;
  try {
    const json = typeof stored === 'string' ? stored : JSON.stringify(stored);
    const parsed = typeof stored === 'string' ? JSON.parse(stored) : stored;
    if (!parsed || typeof parsed !== 'object' || !parsed.ROOT) return null;
    return json;
  } catch {
    return null;
  }
}
