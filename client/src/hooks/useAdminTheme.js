import { useEffect } from 'react';

// The NetSimple/Bootstrap admin theme (client/public/vendor/css/styles.css)
// used to load unconditionally via a <link> in index.html, which meant it
// was active on every route — including the public marketing site and the
// Puck builder canvas, where it fought (and often won, via !important) with
// the site's own vcsf-design.css. This hook loads it only while an
// admin/portal surface is actually mounted, ref-counted so nested/sibling
// consumers (e.g. AppLayout rendering a page that also calls this) don't
// remove it out from under each other.
const HREF = '/vendor/css/styles.css';
const LINK_ID = 'admin-theme-css';
let refCount = 0;

export function useAdminTheme() {
  useEffect(() => {
    refCount++;
    if (!document.getElementById(LINK_ID)) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.id = LINK_ID;
      link.href = HREF;
      document.head.appendChild(link);
    }
    return () => {
      refCount--;
      if (refCount <= 0) {
        refCount = 0;
        document.getElementById(LINK_ID)?.remove();
      }
    };
  }, []);
}
