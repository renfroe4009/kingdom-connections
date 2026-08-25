// Per-surface loading of the site stylesheet + theme variables.
//
// THE RULE (this caused the most pain on the previous build): site CSS must
// never be `import`ed into the bundle. Its selectors are global, so a single
// static import puts them on every admin screen too. Instead each public
// surface mounts a <link> on mount and removes it on unmount.
//
// `?url` asks Vite for the emitted asset URL without adding the file to the
// bundle's CSS — that's what makes this possible.

import { useEffect, useState } from 'react';
import siteCssUrl from './site.css?url';
import { applyBrandVars, fetchSiteSettings, getCachedSettings, THEME_DEFAULTS } from './siteTheme.js';

// Ref-counted so two surfaces mounted at once (e.g. layout + renderer) don't
// remove each other's stylesheet on unmount.
const LINK_ID = 'site-stylesheet';
let refCount = 0;

/**
 * Attach the site stylesheet to a document for as long as the caller is
 * mounted. Pass a different document to style an iframe.
 */
export function useSiteStylesheet(targetDocument, enabled = true) {
  // Reload FOUC: this link is mounted from an effect, well after first paint,
  // so on a hard reload the page briefly shows raw HTML with none of the
  // design's styling. Callers that care (PublicLayout) use this to keep
  // content hidden until the stylesheet has actually applied.
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    // Preview surfaces opt out: the builder canvas already gets its own <link>
    // from CanvasFrame, and the admin shell must never receive site CSS at all
    // — global selectors in it would restyle the dashboard.
    if (!enabled) return undefined;
    const doc = targetDocument || document;
    const isMain = doc === document;

    // Only the main document is shared with the admin shell, so only it needs
    // ref counting; each iframe document gets its own link outright.
    if (isMain) refCount += 1;

    let link = doc.getElementById(LINK_ID);
    if (!link) {
      link = doc.createElement('link');
      link.id = LINK_ID;
      link.rel = 'stylesheet';
      link.href = siteCssUrl;
      doc.head.appendChild(link);
    }

    // Already applied — true on every SPA navigation after the first, since
    // the link persists across route changes and never gets re-created.
    let cleanupListeners;
    if (link.sheet) {
      setLoaded(true);
    } else {
      const onLoad = () => setLoaded(true);
      // A blocked/404 stylesheet must not hang the loading gate forever.
      const onError = () => setLoaded(true);
      link.addEventListener('load', onLoad);
      link.addEventListener('error', onError);
      cleanupListeners = () => {
        link.removeEventListener('load', onLoad);
        link.removeEventListener('error', onError);
      };
    }

    return () => {
      cleanupListeners?.();
      if (isMain) {
        refCount -= 1;
        if (refCount > 0) return;
      }
      doc.getElementById(LINK_ID)?.remove();
    };
  }, [targetDocument, enabled]);

  return enabled ? loaded : true;
}

/**
 * Load the resolved site settings and write them onto a root element as
 * `--brand-*` variables. Returns the settings so callers can also use the
 * non-visual parts (nav links, logo, footer content).
 */
export function useSiteTheme(targetDocument) {
  const [settings, setSettings] = useState(() => getCachedSettings() || THEME_DEFAULTS);

  useEffect(() => {
    let alive = true;
    const root = (targetDocument || document).documentElement;
    // Paint whatever is already cached before the request resolves, so the
    // first frame isn't unstyled.
    applyBrandVars(getCachedSettings() || THEME_DEFAULTS, root);
    fetchSiteSettings().then((resolved) => {
      if (!alive) return;
      applyBrandVars(resolved, root);
      setSettings(resolved);
    });
    return () => { alive = false; };
  }, [targetDocument]);

  return settings;
}

/**
 * Site-wide custom CSS from admin (this is where an imported design's
 * stylesheet lives). Injected as a <style> after the site stylesheet so it
 * can override it.
 *
 * Ref-counted against a single element, like the stylesheet above. Two mounted
 * callers used to mean two copies of the whole stylesheet in <head> — tens of
 * kilobytes parsed twice, and duplicate rules in every DevTools inspection.
 */
const CUSTOM_CSS_ID = 'site-custom-css';
let customCssRefs = 0;

export function useSiteCustomCss(css, targetDocument) {
  useEffect(() => {
    if (!css) return undefined;
    const doc = targetDocument || document;
    const isMain = doc === document;
    if (isMain) customCssRefs += 1;

    let style = doc.getElementById(CUSTOM_CSS_ID);
    if (!style) {
      style = doc.createElement('style');
      style.id = CUSTOM_CSS_ID;
      style.dataset.siteCustomCss = 'true';
      doc.head.appendChild(style);
    }
    // Always write the latest value — the admin may have just changed it.
    if (style.textContent !== css) style.textContent = css;

    return () => {
      if (isMain) {
        customCssRefs -= 1;
        if (customCssRefs > 0) return;
      }
      doc.getElementById(CUSTOM_CSS_ID)?.remove();
    };
  }, [css, targetDocument]);
}

/**
 * Site-wide custom JS from admin — an imported design's `main.js` (menu
 * toggles, sliders, scroll effects) lives here.
 *
 * It must be a real <script> element: JS assigned via innerHTML never runs,
 * because the parser flags those tags as already-executed. Runs on the public
 * site only; the builder canvas never executes it, so a stray script can't
 * hijack the editor.
 */
export function useSiteCustomJs(js, { runKey, targetDocument } = {}) {
  useEffect(() => {
    if (!js) return undefined;
    const doc = targetDocument || document;
    const script = doc.createElement('script');
    script.dataset.siteCustomJs = 'true';
    script.textContent = js;
    doc.body.appendChild(script);
    return () => script.remove();
    // `runKey` (the current path) re-runs the script on navigation. A design's
    // script queries the DOM once at load — in a single-page app the layout
    // never unmounts, so without this the second page a visitor opens would
    // get no scroll reveals, tabs or counters.
  }, [js, runKey, targetDocument]);
}

export { siteCssUrl };
