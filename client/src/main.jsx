import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import 'bootstrap/dist/js/bootstrap.bundle.min.js';
// Plain Bootstrap CSS (grid + utilities: container, d-flex, row/col-*, etc.)
// loads everywhere — both the admin dashboard and the public site's own
// PublicLayout.jsx/Puck blocks are built on these utility classes for
// layout, not just theming. This is separate from the NetSimple/Tabler
// ADMIN SKIN (vendor/css/styles.css, which layers admin-specific component
// styling with `!important` on top of Bootstrap) — that one is gated to
// admin/portal surfaces only via useAdminTheme.js, since it's what caused
// the public site's own design to get overridden.
import 'bootstrap/dist/css/bootstrap.min.css';
import '@fortawesome/fontawesome-free/css/all.min.css';
import App from './App.jsx';
import { AuthProvider } from './auth/AuthContext.jsx';
import { ThemeProvider, applyColors, BRAND_CACHE_KEY } from './theme/ThemeContext.jsx';
import { CartProvider } from './frontend/context/CartContext.jsx';
import './styles.css';

// Admin skin (NetSimple/Tabler, vendor/css/styles.css) — gated to
// admin/portal/login/invite/pay surfaces only (see useAdminTheme.js and
// index.html's comment on this). Requested here, synchronously, as the
// first thing this module does: the bundle's own <link> above is already
// in the document by the time this runs (module scripts execute after
// HTML parsing completes), so this lands after it in DOM order and still
// wins same-specificity cascade ties — while still being added before
// React's first render/paint, so the browser still blocks first paint on
// it (no flash of unstyled/wrong-sized content).
if (/^\/(admin|portal|login|reset-password|invite|pay)(\/|$)/.test(window.location.pathname)) {
  const adminThemeLink = document.createElement('link');
  adminThemeLink.rel = 'stylesheet';
  adminThemeLink.id = 'admin-theme-css';
  adminThemeLink.href = '/vendor/css/styles.css';
  // A <link> inserted via JS is only render-blocking on a best-effort,
  // timing-dependent basis -- on a cold-cache hard refresh the browser can
  // still paint React's first frame (e.g. the bare <ul class="nav-tabs">
  // on Reports pages) before this stylesheet has actually applied. The
  // `blocking="render"` attribute makes that a real contract instead of a
  // heuristic (supported in Chromium; harmlessly ignored elsewhere, same
  // as the previous unblocked behavior).
  adminThemeLink.setAttribute('blocking', 'render');
  document.head.appendChild(adminThemeLink);
}

// The org's brand colors (--brand, --secondary, etc., used directly in e.g.
// Login.jsx's background gradient) only exist once ThemeProvider's mount
// effect fetches /settings/public/theme -- a network round trip that
// finishes well after first paint. Until then, every hardcoded fallback in
// the app (Login.jsx's gradient ends in a gold/orange placeholder) is what
// actually renders, then visibly snaps to the real colors once the fetch
// resolves. Applying the last-fetched colors from cache here, before
// React's first render, means every load after the first one is already
// correct at first paint -- only a genuinely first-ever visit (nothing
// cached yet) still shows the placeholder-then-real transition.
try {
  const cached = JSON.parse(localStorage.getItem(BRAND_CACHE_KEY));
  if (cached?.primary) applyColors(cached.primary, cached.secondary);
} catch { /* no cache yet, or storage unavailable — fall back to defaults */ }

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <ThemeProvider>
        <AuthProvider>
          <CartProvider>
            <App />
          </CartProvider>
        </AuthProvider>
      </ThemeProvider>
    </BrowserRouter>
  </React.StrictMode>
);
