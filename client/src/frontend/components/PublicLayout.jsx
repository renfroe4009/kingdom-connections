import { useState, useEffect, useRef } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import CartBadge from './CartBadge.jsx';
import CartDrawer from './CartDrawer.jsx';

const API_BASE = import.meta.env.VITE_API_URL
  ? `${import.meta.env.VITE_API_URL.replace(/\/$/, '')}/api`
  : '/api';

const NAVY    = '#0A1F3D'; // VCSF deep navy
const GOLD    = '#C9A227'; // VCSF badge gold
const WHITE   = '#ffffff';
const PRIMARY   = 'var(--brand-primary)';
const SECONDARY = 'var(--brand-secondary)';

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

/* ─── Brand + layout CSS vars ────────────────────────────────────────────── */
const FONT_STACKS = {
  inter:    "'Inter'",
  playfair: "'Playfair Display', Georgia, serif",
  system:   'system-ui, -apple-system, sans-serif',
};

function applyBrandVars(s) {
  const root = document.documentElement;
  root.style.setProperty('--brand-primary',   s.primary_color   || NAVY);
  root.style.setProperty('--brand-secondary', s.secondary_color || GOLD);

  // Desktop max-width (>=1400px tier) — only set when an admin picked a
  // non-default value; otherwise let the CSS fallback (1320px) stand.
  if (s.layout_desktop_max_width) root.style.setProperty('--site-max-width', s.layout_desktop_max_width);
  else root.style.removeProperty('--site-max-width');

  // Mobile max-width — 'fluid' forces full width, 'fixed' applies the chosen
  // (or default 540px) width, 'match-header' (default) removes the override
  // entirely so Bootstrap's real base-tier behavior stands.
  const mode = s.layout_mobile_mode || 'match-header';
  if (mode === 'fluid') root.style.setProperty('--site-max-width-mobile', '100%');
  else if (mode === 'fixed') root.style.setProperty('--site-max-width-mobile', s.layout_mobile_max_width || '540px');
  else if (s.layout_mobile_max_width) root.style.setProperty('--site-max-width-mobile', s.layout_mobile_max_width);
  else root.style.removeProperty('--site-max-width-mobile');

  root.style.setProperty('--site-font-family', FONT_STACKS[s.layout_font_family] || FONT_STACKS.inter);
}

/* ─── Default fallback settings ──────────────────────────────────────────── */
// VCSF branding — used for first paint before /website/public-settings
// resolves, and as the ultimate fallback if that fetch ever fails.
const DEFAULTS = {
  primary_color:     NAVY,
  secondary_color:   GOLD,
  header_logo_url:   '/vcsf/logo-header.png',
  footer_logo_url:   '/vcsf/logo-footer.png',
  site_name:         "Ventura County Sheriff's Foundation",
  header_address:    'P.O. Box 3007\nCamarillo, CA 93011',
  header_phone:      '(805) 492-4398',
  header_phone_tollfree: '',
  header_email:      'admin@vcsheriffsfoundation.org',
  header_website:    'https://vcsf.org',
  header_topbar_text:        '501(c)(3) Nonprofit • Tax ID #20-3780163',
  header_topbar_text_mobile: 'Tax ID #20-3780163',
  header_contact_label:      'Contact Us',
  header_contact_url:        '/contact',
  social_facebook:   'https://facebook.com/vcsheriffsfoundation',
  social_instagram:  'https://instagram.com/vcsfoundation',
  social_linkedin:   '',
  footer_copyright:  "Ventura County Sheriff's Foundation. All rights reserved.",
  footer_col2_title: 'Quick Links',
  footer_col2_links: [
    { label: 'Our Programs', url: '/programs' },
    { label: 'Donate & Membership', url: '/support' },
    { label: 'News & Events', url: '/news' },
    { label: 'Grant & Scholarship Applications', url: '/applications' },
  ],
  footer_col3_title: 'Get Involved',
  footer_col3_links: [
    { label: 'Donate', url: '/support' },
    { label: 'Become a Member', url: '/support' },
    { label: 'Contact Us', url: '/contact' },
  ],
  footer_cta_buttons: [{ label: 'Donate Now', url: '/support' }],
  header_cta_member_label: 'Become a Member',
  header_cta_member_url:   '/support',
  header_cta_donate_label: 'Donate Now',
  header_cta_donate_url:   '/support',
  layout_desktop_max_width: '',
  layout_mobile_max_width:  '',
  layout_mobile_mode:       'match-header',
  layout_font_family:       'inter',
  header_nav_links: [
    { label: 'Home', url: '/' },
    { label: 'About', url: '/about' },
    { label: 'Programs', url: '/programs' },
    { label: 'Support Us', url: '/support' },
    { label: 'News', url: '/news' },
    { label: 'Contact', url: '/contact' },
  ],
};

/* ─── Shared settings context ────────────────────────────────────────────── */
let _cached = null;
applyBrandVars(DEFAULTS); // set defaults immediately so first paint is correct
function useSiteSettings() {
  const [s, setS] = useState(_cached || DEFAULTS);
  useEffect(() => {
    if (_cached) return;
    fetch(`${API_BASE}/website/public-settings`)
      .then(r => r.json())
      .then(data => {
        // Only /api/... logo paths are backend-hosted (uploaded via business
        // settings or the media library) and need rewriting to the Railway
        // origin — bundled defaults like /assets/logos/... are Vercel-hosted
        // static files and must stay relative.
        const serverBase = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');
        for (const key of ['header_logo_url', 'footer_logo_url']) {
          if (serverBase && data[key]?.startsWith('/api/')) {
            data[key] = `${serverBase}${data[key]}`;
          }
        }
        _cached = { ...DEFAULTS, ...data };
        applyBrandVars(_cached);
        setS(_cached);
      })
      .catch(() => {});
  }, []);
  return s;
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
  const linkColor = isActive ? NAVY : slateColor;
  const baseLinkStyle = { textDecoration: 'none', fontSize: '0.9rem', fontWeight: isActive ? 600 : 500, padding: '8px 16px', display: 'block', borderRadius: 8, transition: 'color 0.2s, background 0.2s', color: linkColor, background: isActive ? 'rgba(201,162,39,0.10)' : 'transparent', whiteSpace: 'nowrap' };

  const hoverOn = e => { e.currentTarget.style.color = NAVY; e.currentTarget.style.background = 'rgba(201,162,39,0.10)'; };
  const hoverOff = e => { if (!isActive) { e.currentTarget.style.color = slateColor; e.currentTarget.style.background = 'transparent'; } };

  const linkProps = {
    title: item.title || undefined,
    ...(item.newTab ? { target: '_blank', rel: 'noopener noreferrer' } : {}),
  };

  if (!item.dropdown || item.dropdown.length === 0) {
    return item.newTab
      ? <a href={item.url} style={baseLinkStyle} onClick={onClick} onMouseEnter={hoverOn} onMouseLeave={hoverOff} {...linkProps}>{item.label}</a>
      : <NavLink to={item.url} style={({ isActive: a }) => ({ ...baseLinkStyle, color: a ? SECONDARY : slateColor, background: a ? 'rgba(255,107,0,0.08)' : 'transparent' })} onClick={onClick} onMouseEnter={hoverOn} onMouseLeave={hoverOff} {...linkProps}>{item.label}</NavLink>;
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
export default function PublicLayout({ children }) {
  const s = useSiteSettings();
  const [navOpen, setNavOpen] = useState(false);
  const location = useLocation();
  const year = new Date().getFullYear();
  const [seoPublic, setSeoPublic] = useState(null);

  useEffect(() => { setNavOpen(false); }, [location.pathname]);

  // Inject Organization + WebSite JSON-LD once site settings are loaded
  useEffect(() => {
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
        name: s.site_name || "Ventura County Sheriff's Foundation",
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
        name: s.site_name || "Ventura County Sheriff's Foundation",
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

  const footerLinkStyle = { color: '#aaaaaa', textDecoration: 'none', fontSize: '0.9rem', lineHeight: '1.8' };
  const navLinks = Array.isArray(s.header_nav_links) ? s.header_nav_links : DEFAULTS.header_nav_links;
  const col2Links = Array.isArray(s.footer_col2_links) ? s.footer_col2_links : DEFAULTS.footer_col2_links;
  const col3Links = Array.isArray(s.footer_col3_links) ? s.footer_col3_links : DEFAULTS.footer_col3_links;
  const ctaButtons = Array.isArray(s.footer_cta_buttons) ? s.footer_cta_buttons : DEFAULTS.footer_cta_buttons;

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

        {/* Top bar — navy trust banner: 501(c)(3) + Tax ID left, phone/contact right */}
        <div style={{ backgroundColor: PRIMARY, color: WHITE, fontSize: '0.8rem', padding: '8px 0' }}>
          <div className="container d-flex align-items-center justify-content-between flex-wrap" style={{ gap: 12 }}>
            <span className="d-none d-sm-inline">{s.header_topbar_text || DEFAULTS.header_topbar_text}</span>
            <span className="d-sm-none">{s.header_topbar_text_mobile || DEFAULTS.header_topbar_text_mobile}</span>
            <span className="d-flex align-items-center flex-wrap" style={{ gap: 20 }}>
              {s.header_phone && <a href={`tel:+1${s.header_phone.replace(/\D/g,'')}`} style={{ color: WHITE, textDecoration: 'none', fontWeight: 500 }}
                onMouseEnter={e => { e.currentTarget.style.color = GOLD; }} onMouseLeave={e => { e.currentTarget.style.color = WHITE; }}>{s.header_phone}</a>}
              <Link to={s.header_contact_url || '/contact'} className="d-none d-md-inline" style={{ color: WHITE, textDecoration: 'none' }}
                onMouseEnter={e => { e.currentTarget.style.color = GOLD; }} onMouseLeave={e => { e.currentTarget.style.color = WHITE; }}>{s.header_contact_label || 'Contact Us'}</Link>
            </span>
          </div>
        </div>

        {/* Site header — sticky white nav bar with logo, links, and member/donate CTAs */}
        <header style={{ position: 'sticky', top: 0, zIndex: 1000, background: WHITE, borderBottom: '1px solid #e5e7eb' }}>
          <div className="container d-flex align-items-center justify-content-between" style={{ height: 80, gap: 24 }}>
            <Link to="/" style={{ display: 'flex', alignItems: 'center', flexShrink: 0, lineHeight: 0 }}>
              {s.header_logo_url && (
                <img key={s.header_logo_url} src={s.header_logo_url}
                  style={{ height: 56, width: 'auto', objectFit: 'contain', display: 'block' }}
                  alt={s.site_name}
                  onError={e => { e.target.style.display = 'none'; }} />
              )}
            </Link>

            <nav aria-label="Main navigation" className="d-none d-lg-flex align-items-center" style={{ gap: 4 }}>
              {navLinks.map(item => <NavItem key={item.url + item.label} item={item} location={location} />)}
            </nav>

            <div className="d-flex align-items-center" style={{ gap: 12 }}>
              <Link to="/portal/login" className="d-none d-lg-inline-flex"
                style={{ color: NAVY, textDecoration: 'none', fontSize: '0.85rem', fontWeight: 600, whiteSpace: 'nowrap' }}>
                Donor Login
              </Link>
              <span style={{ color: NAVY }}><CartBadge /></span>
              <Link to={s.header_cta_member_url || '/support'} className="d-none d-lg-inline-flex"
                style={{ border: `1px solid ${PRIMARY}`, color: PRIMARY, background: 'transparent', textDecoration: 'none', alignItems: 'center', padding: '10px 20px', fontSize: '0.875rem', fontWeight: 600, borderRadius: 8, transition: 'background 0.2s', whiteSpace: 'nowrap' }}
                onMouseEnter={e => { e.currentTarget.style.background = '#f3f4f6'; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}>
                {s.header_cta_member_label || 'Become a Member'}
              </Link>
              <Link to={s.header_cta_donate_url || '/support'} className="d-none d-lg-inline-flex"
                style={{ background: SECONDARY, color: PRIMARY, textDecoration: 'none', alignItems: 'center', padding: '10px 24px', fontSize: '0.875rem', fontWeight: 600, borderRadius: 8, transition: 'transform 0.2s, box-shadow 0.2s', whiteSpace: 'nowrap' }}
                onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-1px)'; e.currentTarget.style.boxShadow = '0 10px 15px -3px rgba(0,0,0,0.1)'; }}
                onMouseLeave={e => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = 'none'; }}>
                {s.header_cta_donate_label || 'Donate Now'}
              </Link>
              <button className="d-lg-none border-0 bg-transparent d-flex flex-column justify-content-center" onClick={() => setNavOpen(o => !o)} aria-label="Toggle navigation menu" aria-expanded={navOpen} aria-controls="mobile-nav-drawer" style={{ gap: 5, padding: 8 }}>
                <span style={{ display: 'block', width: 24, height: 2, background: NAVY, borderRadius: 2, transition: 'transform 0.2s', transform: navOpen ? 'translateY(7px) rotate(45deg)' : 'none' }} />
                <span style={{ display: 'block', width: 24, height: 2, background: NAVY, borderRadius: 2, opacity: navOpen ? 0 : 1, transition: 'opacity 0.2s' }} />
                <span style={{ display: 'block', width: 24, height: 2, background: NAVY, borderRadius: 2, transition: 'transform 0.2s', transform: navOpen ? 'translateY(-7px) rotate(-45deg)' : 'none' }} />
              </button>
            </div>
          </div>
        </header>

        {/* Mobile nav drawer — white slide-down panel */}
        {navOpen && (
          <nav id="mobile-nav-drawer" aria-label="Mobile navigation" className="d-lg-none"
            style={{ backgroundColor: WHITE, borderBottom: '1px solid #e5e5e5', boxShadow: '0 20px 40px rgba(0,0,0,0.1)' }}>
            <div className="container py-2 d-flex flex-column">
              {navLinks.map(item => <NavItem key={item.url + item.label} item={item} location={location} onClick={() => setNavOpen(false)} mobile />)}
              <Link to={s.header_cta_member_url || '/support'} onClick={() => setNavOpen(false)} className="text-center mx-2 mt-2"
                style={{ border: `1px solid ${PRIMARY}`, color: PRIMARY, textDecoration: 'none', padding: '12px 22px', fontSize: '0.9rem', fontWeight: 600, borderRadius: 8 }}>
                {s.header_cta_member_label || 'Become a Member'}
              </Link>
              <Link to={s.header_cta_donate_url || '/support'} onClick={() => setNavOpen(false)} className="text-center mx-2 mt-2"
                style={{ background: SECONDARY, color: PRIMARY, textDecoration: 'none', padding: '12px 22px', fontSize: '0.9rem', fontWeight: 600, borderRadius: 8 }}>
                {s.header_cta_donate_label || 'Donate Now'}
              </Link>
              <Link to="/portal/login" onClick={() => setNavOpen(false)} className="text-center mt-3 mb-3"
                style={{ color: NAVY, textDecoration: 'none', fontSize: '0.85rem', fontWeight: 600 }}>
                Donor Login
              </Link>
            </div>
          </nav>
        )}

      </div>

      {/* ── Page content ── */}
      <main id="main-content" tabIndex={-1} style={{ margin: 0 }}>{children || <Outlet />}</main>

      {/* ── Footer ── */}
      <footer role="contentinfo" style={{ backgroundColor: PRIMARY, color: 'rgba(255,255,255,0.8)' }}>
        <div className="container py-5">
          <div className="row g-4">
            {/* Col 1 — Logo pill + blurb + contact */}
            <div className="col-lg-4">
              <div className="mb-3">
                {(s.footer_logo_url || s.header_logo_url) && (
                  <span style={{ display: 'inline-flex', background: 'rgba(255,255,255,0.1)', backdropFilter: 'blur(4px)', padding: '8px 16px', borderRadius: 16 }}>
                    <img key={s.footer_logo_url || s.header_logo_url} src={s.footer_logo_url || s.header_logo_url} style={{ height: 44, width: 'auto' }} alt={s.site_name} onError={e => { e.target.style.display = 'none'; }} />
                  </span>
                )}
              </div>
              <p style={{ color: 'rgba(255,255,255,0.8)', fontSize: '0.9rem', maxWidth: 380 }}>
                An independent 501(c)(3) dedicated exclusively to supporting the Ventura County Sheriff's Office and building stronger community partnerships.
              </p>
              {s.header_address && <p style={{ color: 'rgba(255,255,255,0.8)', fontSize: '0.9rem', marginBottom: '0.4rem', whiteSpace: 'pre-line' }}>{s.header_address}</p>}
              {s.header_email && <p style={{ marginBottom: '0.4rem' }}><a href={`mailto:${s.header_email}`} style={{ color: 'rgba(255,255,255,0.8)', textDecoration: 'none', fontSize: '0.9rem' }}>{s.header_email}</a></p>}
              {s.header_phone && <p style={{ color: WHITE, fontWeight: 700, fontSize: '1.15rem', marginBottom: '0.4rem' }}><a href={`tel:+1${s.header_phone.replace(/\D/g,'')}`} style={{ color: WHITE, textDecoration: 'none' }}>{s.header_phone}</a></p>}
            </div>

            {/* Col 2 */}
            <div className="col-lg-4">
              <h6 style={{ color: WHITE, textTransform: 'uppercase', letterSpacing: '0.1em', borderBottom: `2px solid ${SECONDARY}`, paddingBottom: '0.25rem', marginBottom: '1rem', fontWeight: 700 }}>
                {s.footer_col2_title || 'Quick Links'}
              </h6>
              <ul className="list-unstyled mb-0">
                {col2Links.map((lnk) => (
                  <li key={lnk.label}>
                    {lnk.newTab
                      ? <a href={lnk.url || lnk.to} title={lnk.title || undefined} target="_blank" rel="noopener noreferrer" style={footerLinkStyle} onMouseEnter={e => { e.currentTarget.style.color = WHITE; }} onMouseLeave={e => { e.currentTarget.style.color = '#aaaaaa'; }}>{lnk.label} <span style={{ fontSize: '0.65em', opacity: 0.6 }}>↗</span></a>
                      : <Link to={lnk.url || lnk.to} title={lnk.title || undefined} style={footerLinkStyle} onMouseEnter={e => { e.currentTarget.style.color = WHITE; }} onMouseLeave={e => { e.currentTarget.style.color = '#aaaaaa'; }}>{lnk.label}</Link>
                    }
                  </li>
                ))}
              </ul>
            </div>

            {/* Col 3 */}
            <div className="col-lg-4">
              <h6 style={{ color: WHITE, textTransform: 'uppercase', letterSpacing: '0.1em', borderBottom: `2px solid ${SECONDARY}`, paddingBottom: '0.25rem', marginBottom: '1rem', fontWeight: 700 }}>
                {s.footer_col3_title || 'Get Involved'}
              </h6>
              <ul className="list-unstyled mb-3">
                {col3Links.map((lnk) => (
                  <li key={lnk.label}>
                    {lnk.newTab
                      ? <a href={lnk.url || lnk.to} title={lnk.title || undefined} target="_blank" rel="noopener noreferrer" style={footerLinkStyle} onMouseEnter={e => { e.currentTarget.style.color = WHITE; }} onMouseLeave={e => { e.currentTarget.style.color = '#aaaaaa'; }}>{lnk.label} <span style={{ fontSize: '0.65em', opacity: 0.6 }}>↗</span></a>
                      : <Link to={lnk.url || lnk.to} title={lnk.title || undefined} style={footerLinkStyle} onMouseEnter={e => { e.currentTarget.style.color = WHITE; }} onMouseLeave={e => { e.currentTarget.style.color = '#aaaaaa'; }}>{lnk.label}</Link>
                    }
                  </li>
                ))}
              </ul>
              <div className="d-flex flex-column gap-2">
                {ctaButtons.map(({ label, url }) => (
                  <Link key={label} to={url}
                    style={{ display: 'inline-block', padding: '0.45rem 0.9rem', border: `1px solid ${WHITE}`, color: WHITE, textDecoration: 'none', fontSize: '0.82rem', textTransform: 'uppercase', letterSpacing: '0.05em', textAlign: 'center', transition: 'background 0.15s, color 0.15s' }}
                    onMouseEnter={e => { e.currentTarget.style.backgroundColor = WHITE; e.currentTarget.style.color = NAVY; }}
                    onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = WHITE; }}>
                    {label}
                  </Link>
                ))}
              </div>
              <Link to="/portal/login" style={{ ...footerLinkStyle, display: 'inline-block', marginTop: '0.75rem' }}
                onMouseEnter={e => { e.currentTarget.style.color = WHITE; }} onMouseLeave={e => { e.currentTarget.style.color = '#aaaaaa'; }}>
                Donor / Member Login
              </Link>
            </div>
          </div>
        </div>

        <div style={{ borderTop: '1px solid rgba(255,255,255,0.15)', padding: '0.75rem 0' }}>
          <div className="container d-flex flex-column flex-md-row justify-content-between align-items-center gap-2">
            <span style={{ color: 'rgba(255,255,255,0.7)', fontSize: '0.8rem' }}>&copy; {year} {s.footer_copyright}</span>
            <div className="d-flex gap-3 align-items-center">
              {socialEntries.map(({ key, url }) => {
                const Icon = SOCIAL_ICONS[key];
                return Icon ? <a key={key} href={url} target="_blank" rel="noopener noreferrer" aria-label={`Visit us on ${key.charAt(0).toUpperCase() + key.slice(1)}`} style={{ color: WHITE, lineHeight: 0 }}><Icon size={18} color={WHITE} /></a> : null;
              })}
            </div>
          </div>
        </div>
      </footer>
      <CartDrawer />
    </>
  );
}
