// A tiny signal for "the page's content just rendered".
//
// An imported design's script queries the DOM once at load — IntersectionObservers
// for scroll reveals, tab wiring, counters. In a single-page app the layout
// mounts first and the page body arrives later from the API, so that script runs
// against an empty page and never sees the real content. Scroll-reveal elements
// then stay at opacity:0 forever, which looks exactly like a broken site.
//
// The public page renderer calls notifyContentRendered() once its content is in
// the DOM; the layout re-runs the site script in response.

import { useEffect, useState } from 'react';

let version = 0;
const listeners = new Set();

/**
 * Called by the renderer once a page's content is committed to the DOM.
 *
 * Deferred by two animation frames on purpose: Craft's <Frame> paints its
 * nodes after the effect that calls this, so firing synchronously would re-run
 * the design's script against a page that is still empty — the exact failure
 * this module exists to prevent.
 */
export function notifyContentRendered() {
  if (typeof requestAnimationFrame !== 'function') {
    version += 1;
    for (const listener of listeners) listener(version);
    return;
  }
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      version += 1;
      for (const listener of listeners) listener(version);
    });
  });
}

/** Re-renders the caller whenever page content changes. */
export function useContentVersion() {
  const [current, setCurrent] = useState(version);
  useEffect(() => {
    listeners.add(setCurrent);
    // A render may have landed between the initial state read and subscribing.
    setCurrent(version);
    return () => listeners.delete(setCurrent);
  }, []);
  return current;
}
