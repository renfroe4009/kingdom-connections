// The canvas iframe.
//
// This is the single most important structural decision in the builder. The
// page being edited and the builder's own UI are hostile to each other: site
// CSS contains global selectors that would restyle the editor chrome, and the
// admin's Bootstrap would leak into the page preview and make it lie about how
// the page really looks. An iframe is a real document boundary, so neither can
// reach the other.
//
// Craft.js supports this natively — its drop indicator portals itself into the
// canvas document when the canvas lives in another document.

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import faCssUrl from '@fortawesome/fontawesome-free/css/all.min.css?url';
import { siteCssUrl } from '../../frontend/theme/useSiteTheme.js';
import { applyBrandVars, pageBodyClass } from '../../frontend/theme/siteTheme.js';

// Editor-only chrome injected into the canvas: selection outlines, the
// placeholder look for empty containers, and the neutralising of anything that
// would fight the per-block toolbars.
const CANVAS_CHROME = `
  html, body { margin: 0; padding: 0; min-height: 100%; background: #fff; }
  body { overflow-x: hidden; }

  /* A sticky site header inside the canvas covers the top edge of the block
     beneath it — exactly where the per-block toolbar sits — which makes those
     blocks impossible to select or delete. Pin everything static in here.
     .nav is included because imported designs fix their nav, not a header. */
  header, nav, .nav, .bx-sticky, [role="banner"] { position: static !important; }

  /* The real header and footer render here for context (see PublicLayout's
     preview prop). They are not part of the page being edited: their links are
     React Router Links that would navigate the *admin* away, and Craft must
     never treat them as nodes. Inert them, and mark the boundary so it's
     obvious where the editable area starts and stops. */
  [role="banner"], [role="contentinfo"] {
    pointer-events: none !important;
    user-select: none;
  }
  [role="banner"] { border-bottom: 2px dashed rgba(74, 45, 130, 0.3); }
  [role="contentinfo"] { border-top: 2px dashed rgba(74, 45, 130, 0.3); }

  /* Scroll-reveal animations are the single biggest cause of "my section is
     blank in the builder". A design ships them as opacity:0 plus a script
     that adds a class once the element scrolls into view — and scripts never
     run in the canvas, deliberately, so the content would stay invisible and
     therefore uneditable. Force the finished state for the common patterns
     (hand-rolled reveal/fade-in, AOS, WOW.js). */
  [class*="reveal"], [class*="fade"], [class*="animate"],
  [data-aos], .wow, .sr-only-until-visible {
    opacity: 1 !important;
    visibility: visible !important;
    transform: none !important;
    animation: none !important;
    transition: none !important;
  }

  [data-bx-selected='true'] { outline: 2px solid #4a2d82 !important; outline-offset: -2px; }
  [data-bx-hovered='true']:not([data-bx-selected='true']) { outline: 1px dashed #9b8ac4 !important; outline-offset: -1px; }

  /* Children fill their Row and Column exactly, leaving no pixels to click on
     the container itself. A little padding while editing gives every layout
     node its own hit area — the breadcrumb in the settings panel is the
     reliable route, this just makes direct clicking possible too. */
  .bx-page--editing .bx-row { padding: 8px; }
  .bx-page--editing .bx-col { padding: 8px; }

  /* Empty containers are invisible and therefore undroppable — give them
     enough presence to aim at. */
  .bx-col:empty, .bx-row:empty, .bx-section__inner:empty {
    min-height: 72px;
    border: 1px dashed rgba(74, 45, 130, 0.35);
    border-radius: 6px;
  }

  /* Delete the last section and the page collapses to zero height, leaving no
     target to drop the next one onto — the canvas looks like it has stopped
     working. Keep the root fillable so it's always a drop target. */
  .bx-page--editing { min-height: 100vh; }
  .bx-page--empty {
    display: flex;
    align-items: center;
    justify-content: center;
    border: 2px dashed rgba(74, 45, 130, 0.35);
    border-radius: 8px;
  }
  .bx-spacer[data-editing='true'] {
    background-image: repeating-linear-gradient(45deg, rgba(74,45,130,.08) 0 6px, transparent 6px 12px);
    outline: 1px dashed rgba(74, 45, 130, 0.25);
  }

  /* Placeholder text for empty inline-editable fields. */
  [contenteditable][data-placeholder]:empty::before {
    content: attr(data-placeholder);
    opacity: 0.4;
  }
  [contenteditable]:focus { outline: 2px solid #4a2d82; outline-offset: 2px; }
`;

export default function CanvasFrame({ children, width = '100%', customCss, siteCustomCss, settings, theme, slug, onDocument }) {
  const iframeRef = useRef(null);
  const [doc, setDoc] = useState(null);

  // Held in a ref so an inline callback from the parent doesn't re-fire this
  // on every render.
  const notify = useRef(onDocument);
  notify.current = onDocument;
  useEffect(() => { notify.current?.(doc); }, [doc]);

  // Build the canvas document once the iframe exists. about:blank is
  // same-origin, so we can write into it directly.
  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return undefined;

    let cancelled = false;
    const setup = () => {
      const target = iframe.contentDocument;
      if (!target || cancelled) return;
      if (!target.body) return;
      target.documentElement.lang = 'en';
      if (!target.getElementById('bx-canvas-chrome')) {
        const style = target.createElement('style');
        style.id = 'bx-canvas-chrome';
        style.textContent = CANVAS_CHROME;
        target.head.appendChild(style);
      }
      for (const [id, href] of [
        ['site-stylesheet', siteCssUrl],
        ['fa-stylesheet', faCssUrl],
      ]) {
        if (target.getElementById(id)) continue;
        const link = target.createElement('link');
        link.id = id;
        link.rel = 'stylesheet';
        link.href = href;
        target.head.appendChild(link);
      }
      target.body.classList.add('bx-canvas');
      setDoc(target);
    };

    setup();
    iframe.addEventListener('load', setup);
    return () => {
      cancelled = true;
      iframe.removeEventListener('load', setup);
    };
  }, []);

  // Brand variables must be written onto the canvas document's own :root, or
  // the preview shows theme defaults while the live site shows the real brand.
  useEffect(() => {
    if (!doc || !settings) return;
    applyBrandVars(settings, doc.documentElement);
  }, [doc, settings]);

  // Imported designs put their whole palette behind a theme attribute —
  // `:root` carries only fonts and metrics, while `[data-theme="light"]` and
  // `[data-theme="dark"]` define every colour. Without this the canvas renders
  // with every colour variable undefined: white text on white, buttons with no
  // background, images at raw opacity. The live site gets the attribute from
  // the design's own script, and scripts never run in here.
  useEffect(() => {
    if (!doc) return;
    const resolved = theme
      || (typeof localStorage !== 'undefined' && localStorage.getItem('site-theme'))
      || 'light';
    doc.documentElement.setAttribute('data-theme', resolved);
  }, [doc, theme]);

  // The page body class the design scopes its rules to. Without it every
  // `body.home …` / `body.page-about …` rule misses inside the iframe, and the
  // exact drift this iframe exists to prevent. Replaced rather than appended so
  // navigating between pages never leaves two page classes on one body.
  useEffect(() => {
    if (!doc?.body) return undefined;
    const cls = pageBodyClass(slug);
    doc.body.classList.add(cls);
    return () => doc.body.classList.remove(cls);
  }, [doc, slug]);

  useInjectedStyle(doc, siteCustomCss, 'bx-site-custom-css');
  useInjectedStyle(doc, customCss, 'bx-page-custom-css');

  return (
    <div className="bx-canvas-wrap">
      <iframe
        ref={iframeRef}
        title="Page canvas"
        className="bx-canvas-frame"
        style={{ width, maxWidth: '100%' }}
      />
      {doc && createPortal(children, doc.body)}
    </div>
  );
}

function useInjectedStyle(doc, css, id) {
  useEffect(() => {
    if (!doc) return undefined;
    const existing = doc.getElementById(id);
    if (existing) existing.remove();
    if (!css) return undefined;
    const style = doc.createElement('style');
    style.id = id;
    style.textContent = css;
    doc.head.appendChild(style);
    return () => style.remove();
  }, [doc, css, id]);
}
