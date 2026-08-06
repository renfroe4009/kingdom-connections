import { useState, useEffect } from 'react';
import '../../frontend/vcsf-design.css';

const API_BASE = import.meta.env.VITE_API_URL
  ? `${import.meta.env.VITE_API_URL.replace(/\/$/, '')}/api`
  : '/api';

const NAVY  = '#0A1F3D';
const GOLD  = '#C9A227';
const WHITE = '#ffffff';

const DEFAULTS = {
  header_logo_url:   '/vcsf/logo-header.png',
  footer_logo_url:   '/vcsf/logo-footer.png',
  site_name:         "Ventura County Sheriff's Foundation",
  header_address:    'P.O. Box 3007, Camarillo, CA 93011',
  header_phone:      '(805) 492-4398',
  header_email:      'admin@vcsheriffsfoundation.org',
  header_topbar_text:        '501(c)(3) Nonprofit • Tax ID #20-3780163',
  header_topbar_text_mobile: 'Tax ID #20-3780163',
  header_contact_label:      'Contact Us',
  footer_copyright:  "Ventura County Sheriff's Foundation. All rights reserved.",
  footer_col2_title: 'Quick Links',
  footer_col2_links: [{ label: 'Our Programs' }, { label: 'Donate & Membership' }, { label: 'News & Events' }],
  footer_col3_title: 'Get Involved',
  footer_col3_links: [{ label: 'Donate' }, { label: 'Become a Member' }, { label: 'Contact Us' }],
  header_cta_member_label: 'Become a Member',
  header_cta_donate_label: 'Donate Now',
  header_nav_links:  [
    { label: 'Home' }, { label: 'About' }, { label: 'Programs' }, { label: 'Support Us' }, { label: 'News' }, { label: 'Contact' },
  ],
  layout_desktop_max_width: '',
  layout_mobile_max_width:  '',
  layout_mobile_mode:       'match-header',
  layout_font_family:       'inter',
};

// Mirrors PublicLayout.jsx's applyBrandVars() layout-var logic so the builder
// canvas reflects the same admin-configured container width/font the live
// site uses, not just the color vars.
const FONT_STACKS = {
  inter:    "'Inter'",
  playfair: "'Playfair Display', Georgia, serif",
  system:   'system-ui, -apple-system, sans-serif',
};
function applySiteLayoutVars(s) {
  const root = document.documentElement;
  if (s.layout_desktop_max_width) root.style.setProperty('--site-max-width', s.layout_desktop_max_width);
  else root.style.removeProperty('--site-max-width');

  const mode = s.layout_mobile_mode || 'match-header';
  if (mode === 'fluid') root.style.setProperty('--site-max-width-mobile', '100%');
  else if (mode === 'fixed') root.style.setProperty('--site-max-width-mobile', s.layout_mobile_max_width || '540px');
  else if (s.layout_mobile_max_width) root.style.setProperty('--site-max-width-mobile', s.layout_mobile_max_width);
  else root.style.removeProperty('--site-max-width-mobile');

  root.style.setProperty('--site-font-family', FONT_STACKS[s.layout_font_family] || FONT_STACKS.inter);
}

let _cached = null;

// deviceView comes straight from the builder's Desktop/Tablet/Mobile toggle
// (WebsitePageEditor.jsx) rather than a measured pixel width — the canvas
// area's actual rendered width also depends on the editor's own sidebar
// chrome, which has nothing to do with which device the user asked to
// preview, so measuring it directly would collapse to the mobile layout
// even in "Desktop" mode whenever the palette narrows the canvas below
// the real site's 992px breakpoint. Mirrors PublicLayout.jsx's real
// Bootstrap breakpoints (lg=992, md=768, sm=576) for tablet/mobile.
export default function SitePreviewShell({ children, deviceView = 'desktop' }) {
  const [s, setS] = useState(_cached || DEFAULTS);
  const [navOpen, setNavOpen] = useState(false);

  const isDesktopNav    = deviceView === 'desktop';
  const showContactLink = deviceView !== 'mobile';
  const showFullTopbar  = deviceView !== 'mobile';
  const stackedFooter   = deviceView !== 'desktop';

  useEffect(() => { setNavOpen(false); }, [isDesktopNav]);

  useEffect(() => {
    if (_cached) return;
    fetch(`${API_BASE}/website/public-settings`)
      .then(r => r.json())
      .then(data => {
        const serverBase = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');
        for (const key of ['header_logo_url', 'footer_logo_url']) {
          if (serverBase && data[key]?.startsWith('/api/')) {
            data[key] = `${serverBase}${data[key]}`;
          }
        }
        // Match the public site's --brand-primary/--brand-secondary vars so the
        // builder preview's .btn-gold/.btn-navy render with the same colors the
        // live site will use, instead of always falling back to the static navy/gold.
        document.documentElement.style.setProperty('--brand-primary',   data.primary_color   || NAVY);
        document.documentElement.style.setProperty('--brand-secondary', data.secondary_color || GOLD);
        _cached = { ...DEFAULTS, ...data };
        applySiteLayoutVars(_cached);
        setS(_cached);
      })
      .catch(() => {});
  }, []);

  const navLinks  = Array.isArray(s.header_nav_links)  ? s.header_nav_links  : DEFAULTS.header_nav_links;
  const col2Links = Array.isArray(s.footer_col2_links) ? s.footer_col2_links : DEFAULTS.footer_col2_links;
  const col3Links = Array.isArray(s.footer_col3_links) ? s.footer_col3_links : DEFAULTS.footer_col3_links;

  return (
    <div style={{ fontFamily: "'Inter', system-ui, sans-serif", background: '#F8F5EF', minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>

      {/* ── Top bar — navy trust banner ── */}
      <div style={{ backgroundColor: NAVY, color: WHITE, fontSize: '0.8rem', padding: '8px 0' }}>
        <div style={{ maxWidth: 1280, margin: '0 auto', padding: '0 1.5rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <span>{showFullTopbar ? (s.header_topbar_text || DEFAULTS.header_topbar_text) : (s.header_topbar_text_mobile || DEFAULTS.header_topbar_text_mobile)}</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
            <span>{s.header_phone}</span>
            {showContactLink && <span>{s.header_contact_label || 'Contact Us'}</span>}
          </span>
        </div>
      </div>

      {/* ── White sticky nav ── */}
      <header style={{ background: WHITE, borderBottom: '1px solid #e5e7eb' }}>
        <div style={{ maxWidth: 1280, margin: '0 auto', padding: '0 1.5rem', height: 80, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 24 }}>
          <img src={s.header_logo_url} style={{ height: 56, width: 'auto', objectFit: 'contain', display: 'block' }} alt={s.site_name}
            onError={e => { e.target.style.display = 'none'; }} />

          {isDesktopNav && (
            <nav style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
              {navLinks.map((item, i) => (
                <span key={i} style={{ color: '#4b5563', fontSize: '0.9rem', fontWeight: 500, padding: '8px 16px', borderRadius: 8, cursor: 'default', whiteSpace: 'nowrap' }}>
                  {item.label}{item.dropdown && <span style={{ fontSize: '0.65rem' }}> ▾</span>}
                </span>
              ))}
            </nav>
          )}

          {isDesktopNav ? (
            <span style={{ display: 'flex', gap: 12 }}>
              <span style={{ border: `1px solid ${NAVY}`, color: NAVY, padding: '10px 20px', fontSize: '0.875rem', fontWeight: 600, borderRadius: 8, whiteSpace: 'nowrap' }}>
                {s.header_cta_member_label || 'Become a Member'}
              </span>
              <span style={{ background: GOLD, color: NAVY, padding: '10px 24px', fontSize: '0.875rem', fontWeight: 600, borderRadius: 8, whiteSpace: 'nowrap' }}>
                {s.header_cta_donate_label || 'Donate Now'}
              </span>
            </span>
          ) : (
            <button type="button" aria-label="Toggle navigation menu" onClick={() => setNavOpen(o => !o)}
              style={{ border: 'none', background: 'transparent', display: 'flex', flexDirection: 'column', gap: 5, padding: 8, cursor: 'pointer', flexShrink: 0 }}>
              <span style={{ display: 'block', width: 24, height: 2, background: NAVY, borderRadius: 2, transition: 'transform 0.2s', transform: navOpen ? 'translateY(7px) rotate(45deg)' : 'none' }} />
              <span style={{ display: 'block', width: 24, height: 2, background: NAVY, borderRadius: 2, opacity: navOpen ? 0 : 1, transition: 'opacity 0.2s' }} />
              <span style={{ display: 'block', width: 24, height: 2, background: NAVY, borderRadius: 2, transition: 'transform 0.2s', transform: navOpen ? 'translateY(-7px) rotate(-45deg)' : 'none' }} />
            </button>
          )}
        </div>
      </header>

      {/* ── Mobile nav drawer ── */}
      {!isDesktopNav && navOpen && (
        <nav aria-label="Mobile navigation" style={{ background: WHITE, borderBottom: '1px solid #e5e5e5', boxShadow: '0 20px 40px rgba(0,0,0,0.1)' }}>
          <div style={{ padding: '0.5rem 1.5rem 1.25rem', display: 'flex', flexDirection: 'column' }}>
            {navLinks.map((item, i) => (
              <span key={i} style={{ color: '#4b5563', fontSize: '0.9rem', fontWeight: 500, padding: '10px 4px', borderBottom: i < navLinks.length - 1 ? '1px solid #f1f1f1' : 'none' }}>
                {item.label}{item.dropdown && <span style={{ fontSize: '0.65rem' }}> ▾</span>}
              </span>
            ))}
            <span style={{ textAlign: 'center', border: `1px solid ${NAVY}`, color: NAVY, padding: '12px 22px', fontSize: '0.9rem', fontWeight: 600, borderRadius: 8, marginTop: 12 }}>
              {s.header_cta_member_label || 'Become a Member'}
            </span>
            <span style={{ textAlign: 'center', background: GOLD, color: NAVY, padding: '12px 22px', fontSize: '0.9rem', fontWeight: 600, borderRadius: 8, marginTop: 8 }}>
              {s.header_cta_donate_label || 'Donate Now'}
            </span>
          </div>
        </nav>
      )}

      {/* ── Page content ── */}
      <main className="vcsf-page" style={{ flex: 1 }}>{children}</main>

      {/* ── Footer ── */}
      <footer style={{ backgroundColor: NAVY, color: 'rgba(255,255,255,0.8)' }}>
        <div style={{ maxWidth: 1280, margin: '0 auto', padding: '3rem 1.5rem' }}>
          <div style={{ display: 'grid', gridTemplateColumns: stackedFooter ? '1fr' : 'repeat(3, 1fr)', gap: '2rem' }}>
            <div>
              <span style={{ display: 'inline-flex', background: 'rgba(255,255,255,0.1)', padding: '8px 16px', borderRadius: 16, marginBottom: '1rem' }}>
                <img src={s.footer_logo_url || s.header_logo_url} style={{ height: 44, width: 'auto', display: 'block' }} alt={s.site_name}
                  onError={e => { e.target.style.display = 'none'; }} />
              </span>
              {s.header_address && <p style={{ color: 'rgba(255,255,255,0.8)', fontSize: '0.9rem', margin: '0 0 0.3rem' }}>{s.header_address}</p>}
              {s.header_email   && <p style={{ color: 'rgba(255,255,255,0.8)', fontSize: '0.9rem', margin: '0 0 0.3rem' }}>{s.header_email}</p>}
              {s.header_phone   && <p style={{ color: WHITE, fontWeight: 700, fontSize: '1.1rem', margin: 0 }}>{s.header_phone}</p>}
            </div>
            <div>
              <h6 style={{ color: WHITE, textTransform: 'uppercase', letterSpacing: '0.1em', borderBottom: `2px solid ${GOLD}`, paddingBottom: '0.25rem', marginBottom: '1rem', fontWeight: 700 }}>{s.footer_col2_title}</h6>
              <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                {col2Links.map((l, i) => <li key={i} style={{ color: 'rgba(255,255,255,0.75)', fontSize: '0.9rem', lineHeight: 1.8 }}>{l.label}</li>)}
              </ul>
            </div>
            <div>
              <h6 style={{ color: WHITE, textTransform: 'uppercase', letterSpacing: '0.1em', borderBottom: `2px solid ${GOLD}`, paddingBottom: '0.25rem', marginBottom: '1rem', fontWeight: 700 }}>{s.footer_col3_title}</h6>
              <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                {col3Links.map((l, i) => <li key={i} style={{ color: 'rgba(255,255,255,0.75)', fontSize: '0.9rem', lineHeight: 1.8 }}>{l.label}</li>)}
              </ul>
            </div>
          </div>
        </div>
        <div style={{ borderTop: '1px solid rgba(255,255,255,0.15)', padding: '0.75rem 0' }}>
          <div style={{ maxWidth: 1280, margin: '0 auto', padding: '0 1.5rem' }}>
            <span style={{ color: 'rgba(255,255,255,0.7)', fontSize: '0.8rem' }}>&copy; {new Date().getFullYear()} {s.footer_copyright}</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
