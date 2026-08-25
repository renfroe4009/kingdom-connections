// Resolved site theme — the single source of truth for what the public site
// and the builder canvas look like.
//
// The server merges Web Settings over the Business Profile and returns the
// result from /api/website/public-settings. Here we turn that payload into
// `--brand-*` CSS variables. site.css derives every `--bx-*` component token
// from those variables, so writing them is all it takes to repaint the site.
//
// applyBrandVars() takes a root element rather than assuming
// document.documentElement, because the builder canvas lives in an iframe and
// needs the same variables written onto *its* :root.

import api from '../../api/client.js';

// Neutral fallbacks. Deliberately unbranded — if theming fails to load the
// site should look plain, not like some other client's site.
export const THEME_DEFAULTS = {
  site_name: '',
  header_logo_url: '',
  header_logo_dark_url: '',
  footer_logo_url: '',
  footer_logo_dark_url: '',
  header_address: '',
  header_phone: '',
  header_phone_tollfree: '',
  header_email: '',
  header_website: '',
  primary_color: '#1f2937',
  secondary_color: '#4b5563',
  button_color: '',
  icon_color: '',
  text_on_dark: '#ffffff',
  text_on_light: '#1f2937',
  footer_background: '',
  footer_text: '',
  font_heading: '',
  font_body: '',
  layout_width: '1200px',
  site_custom_css: '',
  site_custom_js: '',
  social_facebook: '',
  social_instagram: '',
  social_linkedin: '',
  social_twitter: '',
  footer_copyright: '',
  footer_col2_title: '',
  footer_col2_links: [],
  footer_col3_title: '',
  footer_col3_links: [],
  footer_col4_title: '',
  footer_col4_links: [],
  footer_cta_buttons: [],
  header_nav_links: [],
  header_cta_buttons: [],
  header_show_cart: 'true',
  header_show_theme_toggle: 'false',
  topbar_text: '',
  footer_blurb: '',
};

// Maps a settings payload onto CSS custom properties. Empty values are
// *removed* rather than written as '', so the stylesheet's own defaults win
// instead of a blank string blowing away the cascade.
const VAR_MAP = {
  '--brand-primary': 'primary_color',
  '--brand-secondary': 'secondary_color',
  '--brand-button': 'button_color',
  '--brand-icon': 'icon_color',
  '--brand-text-on-dark': 'text_on_dark',
  '--brand-text-on-light': 'text_on_light',
  '--brand-font-heading': 'font_heading',
  '--brand-font-body': 'font_body',
  '--brand-layout-width': 'layout_width',
};

/**
 * The body class a page carries, from its slug.
 *
 * Imported designs commonly scope whole blocks of their stylesheet to the page
 * they belong to (`body.home .some-header { … }`) so a mockup's home
 * rules don't fight its inner pages. Miss the class and those rules never
 * match: the page renders as structurally correct but unstyled markup, which
 * reads like a failed import when the data is perfectly fine.
 *
 * Shared by PublicLayout (live site) and CanvasFrame (builder iframe) so the
 * preview cannot drift from the published page.
 *
 * ⚠️ PER-PROJECT — the `legal` grouping below is this design's convention.
 * Check the mockups' <body> tags and adjust; the home/`page-<slug>` shape
 * itself is the common case.
 */
const BODY_CLASS_GROUPS = { privacy: 'page-legal', terms: 'page-legal' };

export function pageBodyClass(slug) {
  const clean = String(slug || '').replace(/^\/+|\/+$/g, '').split('/')[0];
  if (!clean || clean === 'home') return 'home';
  return BODY_CLASS_GROUPS[clean] || `page-${clean}`;
}

export function applyBrandVars(settings, root) {
  const el = root || (typeof document !== 'undefined' ? document.documentElement : null);
  if (!el || !settings) return;
  for (const [cssVar, key] of Object.entries(VAR_MAP)) {
    const value = settings[key];
    if (value) el.style.setProperty(cssVar, value);
    else el.style.removeProperty(cssVar);
  }
}

export function clearBrandVars(root) {
  const el = root || (typeof document !== 'undefined' ? document.documentElement : null);
  if (!el) return;
  for (const cssVar of Object.keys(VAR_MAP)) el.style.removeProperty(cssVar);
}

// Module-level cache + in-flight promise so a page with several themed
// surfaces (layout, canvas, renderer) makes exactly one request.
let cached = null;
let inFlight = null;

export function getCachedSettings() {
  return cached;
}

export function fetchSiteSettings({ force = false } = {}) {
  if (cached && !force) return Promise.resolve(cached);
  if (inFlight && !force) return inFlight;
  inFlight = api
    .get('/website/public-settings')
    .then(({ data }) => {
      cached = { ...THEME_DEFAULTS, ...data };
      // Uploaded logos are served by the API, which lives on a different
      // origin in a split deploy. Bundled static paths must stay relative.
      const serverBase = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');
      if (serverBase) {
        for (const key of ['header_logo_url', 'header_logo_dark_url', 'footer_logo_url', 'footer_logo_dark_url']) {
          const value = cached[key];
          if (value && (value.startsWith('/api/') || value.startsWith('/uploads/'))) {
            cached[key] = `${serverBase}${value}`;
          }
        }
      }
      return cached;
    })
    .catch(() => {
      cached = cached || { ...THEME_DEFAULTS };
      return cached;
    })
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

// Called after saving Web Settings so the next read reflects the change.
export function invalidateSiteSettings() {
  cached = null;
  inFlight = null;
}
