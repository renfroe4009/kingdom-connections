import { useState, useEffect, useRef } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import CartBadge from './CartBadge.jsx';
import CartDrawer from './CartDrawer.jsx';
import { useSiteCustomCss, useSiteCustomJs, useSiteStylesheet, useSiteTheme } from '../frontend/theme/useSiteTheme.js';
import { useContentVersion } from '../frontend/theme/contentSignal.js';

const API_BASE = import.meta.env.VITE_API_URL
  ? `${import.meta.env.VITE_API_URL.replace(/\/$/, '')}/api`
  : '/api';

// Every colour here is a CSS variable, never a literal. The variables are
// written from admin settings (see frontend/theme/siteTheme.js), so changing
// the primary colour in the dashboard repaints the header and footer too.
const WHITE     = '#ffffff';
const PRIMARY   = 'var(--brand-primary)';
const SECONDARY = 'var(--brand-secondary)';
const ON_DARK   = 'var(--brand-text-on-dark, #ffffff)';

/* ─── SVG Icons ──────────────────────────────────────────────────────────── */
function IconFacebook({ size = 20, color = WHITE }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill={color}><path d="M22 12c0-5.523-4.477-10-10-10S2 6.477 2 12c0 4.991 3.657 9.128 8.438 9.878V14.89h-2.54V12h2.54V9.797c0-2.506 1.492-3.89 3.777-3.89 1.094 0 2.238.195 2.238.195v2.46h-1.26c-1.243 0-1.63.771-1.63 1.562V12h2.773l-.443 2.89h-2.33v6.988C18.343 21.128 22 16.991 22 12z"/></svg>;
}
function IconTwitterX({ size = 20, color = WHITE }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill={color}><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>;
}
function IconInstagram({ size = 20, color = WHITE }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill={color}><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z"/></svg>;
}
function IconLinkedIn({ size = 20, color = WHITE }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill={color}><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>;
}
const SOCIAL_ICONS = { facebook: IconFacebook, twitter: IconTwitterX, instagram: IconInstagram, linkedin: IconLinkedIn };

/* ─── Site settings ──────────────────────────────────────────────────────────
   The header and footer are driven entirely by admin settings — logo, nav,
   CTAs, contact details, colours and copy. Nothing about a specific client is
   hardcoded here, so this same layout serves every site built on the CMS.
   Resolution and caching live in frontend/theme/siteTheme.js, shared with the
   builder canvas so the preview can't drift from the live site. */

/* ─── Exclusive click ─────────────────────────────────────────────────────────
   Lets React own a click on an element whose class an imported design's script
   also binds to (`.theme-toggle`, `.nav__toggle`).

   Why it's needed: site JS is re-executed on every navigation so a design's
   scroll reveals and widgets initialise on each page, and `addEventListener`
   accumulates — by the third page a single click would fire the design's
   handler three times and toggle three times, i.e. appear dead.

   Registering in the capture phase and calling stopImmediatePropagation means
   exactly one handler runs, however many times the design's script has bound. */
function useExclusiveClick(handler) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const onClick = (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      handler();
    };
    el.addEventListener('click', onClick, true);
    return () => el.removeEventListener('click', onClick, true);
  }, [handler]);
  return ref;
}

/* ─── Light / dark toggle ─────────────────────────────────────────────────────
   Flips `data-theme` on <html>, which is the hook imported designs use for
   their dark palette (`[data-theme="dark"] { --accent: … }`).

   Deliberately NOT given the class `theme-toggle`: a design's own script binds
   a click handler to that selector, and since site JS re-runs on navigation the
   handlers would stack and fire several times per click. Ours owns the
   behaviour; the design's CSS can be pointed at `.bx-theme-toggle` if the exact
   look matters.

   `resyncKey` re-applies the stored choice after site JS re-runs, because a
   design's script sets `data-theme` from its own storage on every execution and
   would otherwise undo the visitor's selection on each page change. */
function ThemeToggle({ theme, onToggle }) {
  const ref = useExclusiveClick(onToggle);
  const dark = theme === 'dark';
  // Carries the design's own class and both icons, so an imported stylesheet
  // styles it and its `[data-theme="dark"] .icon-moon { display:none }` rules
  // work. `display` is also set inline for designs that don't ship those rules.
  return (
    <button
      ref={ref}
      type="button"
      className="theme-toggle bx-theme-toggle"
      aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
      title={dark ? 'Switch to light mode' : 'Switch to dark mode'}
    >
      <svg className="icon-moon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true" style={{ display: dark ? 'none' : 'block' }}>
        <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
      </svg>
      <svg className="icon-sun" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true" style={{ display: dark ? 'block' : 'none' }}>
        <circle cx="12" cy="12" r="5" />
        <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
      </svg>
    </button>
  );
}

/* ─── Nav item (link or dropdown) ────────────────────────────────────────── */
function NavItem({ item, location, onClick, mobile }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    function outside(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }
    document.addEventListener('mousedown', outside);
    return () => document.removeEventListener('mousedown', outside);
  }, [open]);

  const isActive = location.pathname === item.url || (item.url !== '/' && location.pathname.startsWith(item.url));
  const slateColor = '#4b5563'; // slate-600, matches the design's nav links
  const linkColor = isActive ? PRIMARY : slateColor;
  const baseLinkStyle = { textDecoration: 'none', fontSize: '0.9rem', fontWeight: isActive ? 600 : 500, padding: '8px 16px', display: 'block', borderRadius: 8, transition: 'color 0.2s, background 0.2s', color: linkColor, background: isActive ? 'color-mix(in srgb, var(--brand-secondary) 12%, transparent)' : 'transparent', whiteSpace: 'nowrap' };

  const hoverOn = e => { e.currentTarget.style.color = PRIMARY; e.currentTarget.style.background = 'color-mix(in srgb, var(--brand-secondary) 12%, transparent)'; };
  const hoverOff = e => { if (!isActive) { e.currentTarget.style.color = slateColor; e.currentTarget.style.background = 'transparent'; } };

  const linkProps = {
    title: item.title || undefined,
    ...(item.newTab ? { target: '_blank', rel: 'noopener noreferrer' } : {}),
  };

  if (!item.dropdown || item.dropdown.length === 0) {
    return item.newTab
      ? <a href={item.url} onClick={onClick} {...linkProps}>{item.label}</a>
      : <NavLink to={item.url} onClick={onClick} {...linkProps}>{item.label}</NavLink>;
  }

  return (
    <div ref={ref} className="position-relative"
      onMouseEnter={() => !mobile && setOpen(true)}
      onMouseLeave={() => !mobile && setOpen(false)}
      style={mobile ? undefined : { display: 'inline-block' }}
    >
      <button onClick={() => setOpen(o => !o)} title={item.title || undefined}
        onMouseEnter={hoverOn} onMouseLeave={hoverOff}
        style={{ background: 'transparent', border: 'none', color: linkColor, fontSize: '0.9rem', fontWeight: 500, padding: '8px 16px', borderRadius: 8, cursor: 'pointer', transition: 'color 0.2s, background 0.2s', display: 'flex', alignItems: 'center', gap: 4, width: mobile ? '100%' : undefined, textAlign: mobile ? 'left' : undefined }}>
        {item.label} <span style={{ fontSize: '0.65rem' }}>▾</span>
      </button>
      {open && (
        <ul style={{ position: mobile ? 'static' : 'absolute', top: '100%', left: 0, zIndex: 1000, backgroundColor: WHITE, border: '1px solid #e5e5e5', borderRadius: 12, listStyle: 'none', margin: 0, padding: 8, minWidth: 260, whiteSpace: 'nowrap', boxShadow: mobile ? 'none' : '0 20px 60px rgba(10,31,61,0.22)' }}>
          {item.dropdown.map(sub => (
            <li key={sub.url}>
              {sub.newTab
                ? <a href={sub.url} style={{ display: 'block', padding: '10px 14px', color: '#4b5563', textDecoration: 'none', fontSize: '0.875rem', borderRadius: 8 }}
                    title={sub.title || undefined} target="_blank" rel="noopener noreferrer"
                    onMouseEnter={e => { e.currentTarget.style.color = SECONDARY; e.currentTarget.style.backgroundColor = '#fafafa'; }}
                    onMouseLeave={e => { e.currentTarget.style.color = '#4b5563'; e.currentTarget.style.backgroundColor = 'transparent'; }}
                    onClick={() => { setOpen(false); onClick?.(); }}
                  >{sub.label} <span style={{ fontSize: '0.65em', opacity: 0.6 }}>↗</span></a>
                : <Link to={sub.url} style={{ display: 'block', padding: '10px 14px', color: '#4b5563', textDecoration: 'none', fontSize: '0.875rem', borderRadius: 8 }}
                    title={sub.title || undefined}
                    onMouseEnter={e => { e.currentTarget.style.color = SECONDARY; e.currentTarget.style.backgroundColor = '#fafafa'; }}
                    onMouseLeave={e => { e.currentTarget.style.color = '#4b5563'; e.currentTarget.style.backgroundColor = 'transparent'; }}
                    onClick={() => { setOpen(false); onClick?.(); }}
                  >{sub.label}</Link>
              }
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ─── Main layout ────────────────────────────────────────────────────────── */
/**
 * @param preview  Render the chrome only, with every document-level side effect
 *   suppressed. The builder canvas mounts this around the Craft `<Frame>` so an
 *   editor sees the real header and footer — but its React effects run in the
 *   *admin* document, so analytics, JSON-LD, canonical tags, `data-theme` and
 *   the site stylesheet must all stay switched off. Without this, opening the
 *   builder would load GA4 and Clarity into the dashboard.
 */
export default function PublicLayout({ children, preview = false }) {
  // Site CSS is attached here and removed on unmount, so it exists only while
  // a public route is on screen. Importing it statically would let its global
  // selectors restyle the admin dashboard.
  const location = useLocation();
  useSiteStylesheet(undefined, !preview);
  const s = useSiteTheme();
  useSiteCustomCss(preview ? '' : s.site_custom_css);
  // Re-runs on navigation so an imported design's script initialises the page
  // the visitor just moved to, not only the first one they landed on.
  // Keyed on the rendered content too, not just the path: the page body
  // arrives from the API after this layout mounts, and the design's script has
  // to run against it.
  const contentVersion = useContentVersion();
  useSiteCustomJs(preview ? '' : s.site_custom_js, { runKey: location.pathname + ':' + contentVersion });

  const [navOpen, setNavOpen] = useState(false);
  const year = new Date().getFullYear();

  // Theme lives here rather than inside the toggle, because the footer logo
  // swaps with it too (designs ship a colour logo and a white one).
  const [theme, setTheme] = useState(
    () => (typeof localStorage !== 'undefined' && localStorage.getItem('site-theme'))
      || document.documentElement.getAttribute('data-theme')
      || 'light',
  );
  const navToggleRef = useExclusiveClick(() => setNavOpen(o => !o));
  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    localStorage.setItem('site-theme', next);
    setTheme(next);
  };
  const [seoPublic, setSeoPublic] = useState(null);

  useEffect(() => { setNavOpen(false); }, [location.pathname]);

  // Re-applied when site JS re-runs: an imported design's script sets
  // `data-theme` from its own storage on every execution and would otherwise
  // undo the visitor's choice on each page change.
  useEffect(() => {
    if (preview) return;
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme, contentVersion, preview]);

  // Inject Organization + WebSite JSON-LD once site settings are loaded
  useEffect(() => {
    if (preview) return;
    if (!s.site_name && !s.header_phone) return;
    const siteUrl = window.location.origin;
    const existing = document.querySelector('script[data-site-jsonld]');
    if (existing) return;
    const sc = document.createElement('script');
    sc.type = 'application/ld+json';
    sc.setAttribute('data-site-jsonld', '1');
    sc.textContent = JSON.stringify([
      {
        '@context': 'https://schema.org',
        '@type': 'WebSite',
        name: s.site_name || document.title,
        url: siteUrl,
        potentialAction: {
          '@type': 'SearchAction',
          target: { '@type': 'EntryPoint', urlTemplate: `${siteUrl}/search?q={search_term_string}` },
          'query-input': 'required name=search_term_string',
        },
      },
      {
        '@context': 'https://schema.org',
        '@type': 'Organization',
        name: s.site_name || document.title,
        url: siteUrl,
        logo: s.header_logo_url ? (s.header_logo_url.startsWith('http') ? s.header_logo_url : `${siteUrl}${s.header_logo_url}`) : undefined,
        telephone: s.header_phone || undefined,
        email: s.header_email || undefined,
        address: s.header_address ? {
          '@type': 'PostalAddress',
          streetAddress: s.header_address.split('\n')[0],
          addressLocality: 'Camarillo',
          addressRegion: 'CA',
          addressCountry: 'US',
        } : undefined,
        sameAs: [s.social_facebook, s.social_instagram, s.social_twitter, s.social_linkedin].filter(Boolean),
      },
    ]);
    document.head.appendChild(sc);
  }, [s.site_name, s.header_phone]); // eslint-disable-line react-hooks/exhaustive-deps

  // Inject SEO tags + scripts from admin settings (runs once on mount)
  useEffect(() => {
    if (preview) return;
    fetch(`${API_BASE}/seo/public`)
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (!d) return;
        setSeoPublic(d);
        // Google Search Console verification meta tag
        if (d.google_search_console_verification) {
          const existing = document.querySelector('meta[name="google-site-verification"]');
          if (!existing) {
            const m = document.createElement('meta');
            m.name = 'google-site-verification';
            m.content = d.google_search_console_verification;
            document.head.appendChild(m);
          }
        }
        // GA4
        if (d.ga4_measurement_id) {
          if (!document.querySelector(`script[src*="${d.ga4_measurement_id}"]`)) {
            const s1 = document.createElement('script');
            s1.src = `https://www.googletagmanager.com/gtag/js?id=${d.ga4_measurement_id}`;
            s1.async = true;
            document.head.appendChild(s1);
            const s2 = document.createElement('script');
            s2.textContent = `window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','${d.ga4_measurement_id}');`;
            document.head.appendChild(s2);
          }
        }
        // Microsoft Clarity
        if (d.clarity_project_id) {
          if (!document.querySelector('script[data-clarity]')) {
            const sc = document.createElement('script');
            sc.setAttribute('data-clarity', '1');
            sc.textContent = `(function(c,l,a,r,i,t,y){c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);})(window,document,"clarity","script","${d.clarity_project_id}");`;
            document.head.appendChild(sc);
          }
        }
        // Custom head scripts (GTM snippet, etc.)
        if (d.head_scripts) {
          if (!document.querySelector('script[data-custom-head]')) {
            const tmp = document.createElement('div');
            tmp.innerHTML = d.head_scripts;
            Array.from(tmp.children).forEach(el => {
              if (el.tagName === 'SCRIPT') {
                const sc = document.createElement('script');
                if (el.src) sc.src = el.src;
                else sc.textContent = el.textContent;
                if (el.async) sc.async = true;
                sc.setAttribute('data-custom-head', '1');
                document.head.appendChild(sc);
              } else {
                el.setAttribute('data-custom-head', '1');
                document.head.appendChild(el);
              }
            });
          }
        }
        // Custom body scripts (GTM noscript, etc.)
        if (d.body_scripts) {
          if (!document.querySelector('[data-custom-body]')) {
            const tmp = document.createElement('div');
            tmp.innerHTML = d.body_scripts;
            tmp.setAttribute('data-custom-body', '1');
            document.body.insertAdjacentElement('afterbegin', tmp);
          }
        }
      })
      .catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Update canonical link tag on every route change
  useEffect(() => {
    if (preview) return;
    if (!seoPublic?.site_url) return;
    const prefix = seoPublic.preferred_domain === 'www' ? 'www.' : '';
    const href = `https://${prefix}${seoPublic.site_url}${location.pathname}`;
    let link = document.querySelector('link[rel="canonical"]');
    if (!link) {
      link = document.createElement('link');
      link.rel = 'canonical';
      document.head.appendChild(link);
    }
    link.href = href;
  }, [location.pathname, seoPublic]);

  const socialEntries = [
    { key: 'facebook', url: s.social_facebook },
    { key: 'twitter',  url: s.social_twitter  },
    { key: 'instagram',url: s.social_instagram },
    { key: 'linkedin', url: s.social_linkedin  },
  ].filter(e => e.url);

  // Footer palette. Defaults to the brand primary with light text, but a
  // design with a light footer just sets these two and everything inside —
  // headings, links, rules, buttons, social icons — follows.
  const footerBg = s.footer_background || PRIMARY;
  const footerFg = s.footer_text || ON_DARK;
  const footerMuted = `color-mix(in srgb, ${footerFg} 72%, transparent)`;
  const footerRule = `color-mix(in srgb, ${footerFg} 18%, transparent)`;

  // Columns are whatever the admin filled in — an empty one is simply absent
  // rather than rendering a heading over nothing.
  const footerColumns = [
    { title: s.footer_col2_title, links: Array.isArray(s.footer_col2_links) ? s.footer_col2_links : [] },
    { title: s.footer_col3_title, links: Array.isArray(s.footer_col3_links) ? s.footer_col3_links : [] },
    { title: s.footer_col4_title, links: Array.isArray(s.footer_col4_links) ? s.footer_col4_links : [] },
  ].filter((col) => col.title && col.links.length);

  const headerLogoLight = s.header_logo_url;
  const headerLogoDark = s.header_logo_dark_url;
  const footerLogoLight = s.footer_logo_url || s.header_logo_url;
  const footerLogoDark = s.footer_logo_dark_url;

  // Only paint over the design's own footer CSS when an admin actually chose
  // colours; otherwise the imported stylesheet stays in charge.
  const footerStyle = {};
  if (s.footer_background) footerStyle.backgroundColor = s.footer_background;
  if (s.footer_text) footerStyle.color = s.footer_text;

  const footerLinkStyle = { color: footerMuted, textDecoration: 'none', fontSize: '0.9rem', lineHeight: '1.8' };
  const navLinks = Array.isArray(s.header_nav_links) ? s.header_nav_links : [];
  // The layout already prints "©", so strip one from the setting rather than
  // rendering "© 2026 © Oscity Bioscience".
  const copyrightText = String(s.footer_copyright || '').replace(/^\s*(©|&copy;)\s*/i, '');
  const col2Links = Array.isArray(s.footer_col2_links) ? s.footer_col2_links : [];
  const col3Links = Array.isArray(s.footer_col3_links) ? s.footer_col3_links : [];
  const col4Links = Array.isArray(s.footer_col4_links) ? s.footer_col4_links : [];
  const ctaButtons = Array.isArray(s.footer_cta_buttons) ? s.footer_cta_buttons : [];
  // Settings arrive as strings; treat only an explicit 'false' as off so the
  // cart keeps showing on installs that never touch the setting.
  const showCart = String(s.header_show_cart ?? 'true') !== 'false';
  const showThemeToggle = String(s.header_show_theme_toggle ?? 'false') === 'true';
  const headerCtas = Array.isArray(s.header_cta_buttons) ? s.header_cta_buttons : [];

  return (
    <>
      {/* Skip navigation — ADA */}
      <a href="#main-content" style={{ position: 'absolute', left: '-9999px', top: 'auto', width: 1, height: 1, overflow: 'hidden' }}
        onFocus={e => { e.target.style.cssText = 'position:fixed;top:0;left:0;z-index:9999;background:#000;color:#fff;padding:0.5rem 1rem;font-size:1rem;'; }}
        onBlur={e => { e.target.style.cssText = 'position:absolute;left:-9999px;top:auto;width:1px;height:1px;overflow:hidden;'; }}>
        Skip to main content
      </a>

      {/* ── Header wrapper ── */}
      <div role="banner">

        {/* Announcement strip — content comes from Web Settings. With no
            message and no phone number there's nothing to say, so it's hidden
            rather than showing an empty bar. */}
        {(s.topbar_text || s.header_phone) && (
          <div style={{ backgroundColor: PRIMARY, color: ON_DARK, fontSize: '0.8rem', padding: '8px 0' }}>
            <div className="container d-flex align-items-center justify-content-between flex-wrap" style={{ gap: 12 }}>
              <span>{s.topbar_text}</span>
              <span className="d-flex align-items-center flex-wrap" style={{ gap: 20 }}>
                {s.header_phone && <a href={`tel:+1${s.header_phone.replace(/\D/g,'')}`} style={{ color: ON_DARK, textDecoration: 'none', fontWeight: 500 }}
                  onMouseEnter={e => { e.currentTarget.style.color = SECONDARY; }} onMouseLeave={e => { e.currentTarget.style.color = ON_DARK; }}>{s.header_phone}</a>}
                {s.header_email && <a href={`mailto:${s.header_email}`} className="d-none d-md-inline" style={{ color: ON_DARK, textDecoration: 'none' }}
                  onMouseEnter={e => { e.currentTarget.style.color = SECONDARY; }} onMouseLeave={e => { e.currentTarget.style.color = ON_DARK; }}>{s.header_email}</a>}
              </span>
            </div>
          </div>
        )}

        <nav className="nav" aria-label="Primary">
          <div className="container nav__inner">
            {/* The accessible name lives on the link, never on the images.
                Three separate things blank an alt-derived name: settings arrive
                after first paint (site_name is '' until then), the two logos
                swap by theme, and onError hides whichever one 404s. Any of them
                leaves a screen reader announcing "link" and nothing else — on
                the site's home link, on every page. With the label here the
                images are decorative, so alt="" is correct and avoids the name
                being read twice. */}
            <Link
              to="/"
              className="nav__logo"
              aria-label={s.site_name ? `${s.site_name} — home` : 'Home'}
              aria-current={location.pathname === '/' ? 'page' : undefined}
            >
              {headerLogoLight && (
                <img
                  className="logo-light"
                  src={headerLogoLight}
                  alt=""
                  style={{ display: theme === 'dark' ? 'none' : 'block' }}
                  onError={e => { e.target.style.display = 'none'; }}
                />
              )}
              {headerLogoDark && (
                <img
                  className="logo-dark"
                  src={headerLogoDark}
                  alt=""
                  style={{ display: theme === 'dark' ? 'block' : 'none' }}
                  onError={e => { e.target.style.display = 'none'; }}
                />
              )}
              {!headerLogoLight && !headerLogoDark && <span>{s.site_name}</span>}
            </Link>

            <div className="nav__links">
              {navLinks.map(item => <NavItem key={item.url + item.label} item={item} location={location} />)}
            </div>

            <div className="nav__actions">
              {showThemeToggle && <ThemeToggle theme={theme} onToggle={toggleTheme} />}
              {headerCtas.map(({ label, url }) => (
                <Link key={label + url} to={url} className="nav__cta">{label}</Link>
              ))}
              {showCart && <span className="nav__cart" style={{ color: 'inherit' }}><CartBadge /></span>}
              <button
                ref={navToggleRef}
                type="button"
                className="nav__toggle"
                aria-label={navOpen ? 'Close menu' : 'Open menu'}
                aria-expanded={navOpen}
                aria-controls="mobileMenu"
              >
                <span aria-hidden="true" /><span aria-hidden="true" /><span aria-hidden="true" />
              </button>
            </div>
          </div>
        </nav>

        <div
          // The design gates visibility on `.open`, not on [hidden] alone:
          // `.mobile-menu { display: none }` + `.mobile-menu.open { display: flex }`.
          // Both are needed — [hidden] keeps it out of the a11y tree, `.open`
          // is what actually shows it. (styles.css:2034-2045, 2515, 2651-2652)
          className={navOpen ? 'mobile-menu open' : 'mobile-menu'}
          id="mobileMenu"
          role="dialog"
          aria-modal="true"
          aria-label="Mobile navigation"
          hidden={!navOpen}
        >
          {navLinks.map(item => {
            const href = item.url || '';
            const external = item.newTab || /^https?:\/\//i.test(href);
            return external ? (
              <a key={href + item.label} href={href} target="_blank" rel="noopener noreferrer" onClick={() => setNavOpen(false)}>
                {item.label} <span className="sr-only">(opens in new tab)</span> →
              </a>
            ) : (
              <Link key={href + item.label} to={href} onClick={() => setNavOpen(false)}>{item.label}</Link>
            );
          })}
          {headerCtas.map(({ label, url }) => (
            <Link key={'m' + label + url} to={url} className="nav__cta" onClick={() => setNavOpen(false)}>{label}</Link>
          ))}
        </div>
      </div>

      {/* ── Page content ── */}
      <main id="main-content" tabIndex={-1} style={{ margin: 0 }}>{children || <Outlet />}</main>

      {/* ── Footer ── */}
      <footer role="contentinfo" className="footer" style={footerStyle}>
        <div className="container">
          <div className="footer__grid">
            <div className="footer__brand">
              {/* Two logos so a dark palette gets the light-on-dark version.
                  Which one shows is driven by React state, not the design's
                  own script, so our theme button and the design's stay in
                  agreement. */}
              {footerLogoLight && (
                <img
                  className="logo-light"
                  src={footerLogoLight}
                  alt={s.site_name}
                  style={{ display: theme === 'dark' ? 'none' : 'block' }}
                  onError={e => { e.target.style.display = 'none'; }}
                />
              )}
              {footerLogoDark && (
                <img
                  className="logo-dark"
                  src={footerLogoDark}
                  alt={s.site_name}
                  style={{ display: theme === 'dark' ? 'block' : 'none' }}
                  onError={e => { e.target.style.display = 'none'; }}
                />
              )}
              {!footerLogoLight && !footerLogoDark && (
                <strong style={{ fontSize: '1.25rem' }}>{s.site_name}</strong>
              )}
              {s.footer_blurb && <p>{s.footer_blurb}</p>}
              {ctaButtons.length > 0 && (
                <div className="footer__cta">
                  {ctaButtons.map(({ label, url }) => (
                    <Link key={label + url} to={url} className="btn btn--outline">{label}</Link>
                  ))}
                </div>
              )}
            </div>

            {footerColumns.map((col) => (
              <div key={col.title}>
                <h2 className="footer__heading">{col.title}</h2>
                <div className="footer__links">
                  {col.links.map((lnk) => {
                    const href = lnk.url || lnk.to || '';
                    const external = lnk.newTab || /^https?:\/\//i.test(href);
                    return external ? (
                      <a
                        key={lnk.label + href}
                        href={href}
                        target="_blank"
                        rel="noopener noreferrer"
                        title={lnk.title || undefined}
                      >
                        {lnk.label} <span className="sr-only">(opens in new tab)</span>
                      </a>
                    ) : (
                      <Link key={lnk.label + href} to={href} title={lnk.title || undefined}>{lnk.label}</Link>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          <div className="footer__bottom">
            <span>&copy; {year} {copyrightText}</span>
            {socialEntries.length > 0 && (
              <div className="footer__social">
                {socialEntries.map(({ key, url }) => {
                  const Icon = SOCIAL_ICONS[key];
                  const name = key.charAt(0).toUpperCase() + key.slice(1);
                  return Icon ? (
                    <a
                      key={key}
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={`${s.site_name || 'Us'} on ${name} (opens in new tab)`}
                      style={{ color: 'inherit', lineHeight: 0 }}
                    >
                      <Icon size={20} color="currentColor" />
                    </a>
                  ) : null;
                })}
              </div>
            )}
          </div>
        </div>
      </footer>
      <CartDrawer />
    </>
  );
}
