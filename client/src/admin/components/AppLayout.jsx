import { useState, useEffect, useRef } from 'react';
import { NavLink, Outlet, useNavigate, Link, useLocation } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext.jsx';
import { useTheme } from '../../theme/ThemeContext.jsx';
import BrandMark from './BrandMark.jsx';
import AiAssistant from './AiAssistant.jsx';
import { ToastHost } from '../../components/Toast.jsx';
import { useConfirm } from '../../hooks/useConfirm.jsx';
import { useAdminTheme } from '../../hooks/useAdminTheme.js';
import { IntegrationsProvider } from '../context/IntegrationsContext.jsx';

// `children` turns an item into a collapsible group with sub-links beneath it.
// Permissions on children are evaluated independently from the parent.
//
// SECTIONS drives the top-level tab bar. Each section owns its own sidebar
// item list — clicking a tab swaps which list is shown, and the active tab
// is derived from the current URL (via matchPrefixes) rather than tracked
// as separate state, so browser back/forward and direct links stay in sync.
const SECTIONS = [
  {
    key: 'crm', label: 'CRM', icon: 'solar:users-group-two-rounded-bold-duotone',
    matchPrefixes: ['/admin/dashboard', '/admin/contacts', '/admin/organizations', '/admin/duplicates', '/admin/deals', '/admin/pipeline',
      '/admin/invoices', '/admin/transactions', '/admin/billing', '/admin/subscriptions', '/admin/maps', '/admin/tasks',
      '/admin/activities', '/admin/import'],
    items: [
      { to: '/admin/dashboard',     label: 'Dashboard',     icon: 'solar:screencast-2-line-duotone' },
      { to: '/admin/contacts',      label: 'Contacts',      icon: 'solar:user-rounded-line-duotone',          perm: 'contacts.read' },
      { to: '/admin/organizations', label: 'Organizations', icon: 'solar:buildings-2-line-duotone',           perm: 'organizations.read' },
      { to: '/admin/duplicates',    label: 'Duplicates',    icon: 'solar:layers-minimalistic-line-duotone',   perm: 'contacts.write' },
      { to: '/admin/deals',         label: 'Deals',         icon: 'solar:dollar-minimalistic-bold-duotone',   perm: 'deals.read' },
      { to: '/admin/pipeline',      label: 'Pipeline',      icon: 'solar:chart-2-line-duotone',               perm: 'deals.read' },
      {
        to: '/admin/invoices', label: 'Billing', icon: 'solar:bill-list-line-duotone', perm: 'invoices.read',
        children: [
          { to: '/admin/invoices',                   label: 'Invoices',        icon: 'solar:document-text-line-duotone' },
          { to: '/admin/transactions',               label: 'Transactions',    icon: 'solar:card-line-duotone',             perm: 'payments.read' },
          { to: '/admin/billing/tax-report',         label: 'Sales Tax',       icon: 'solar:bill-list-line-duotone',        perm: 'reports.view' },
          { to: '/admin/billing/reconciliation',     label: 'Reconciliation',  icon: 'solar:shield-check-line-duotone',     perm: 'reports.view' },
        ],
      },
      { to: '/admin/subscriptions', label: 'Subscriptions', icon: 'solar:refresh-circle-line-duotone', perm: 'subscriptions.read' },
      { to: '/admin/maps',          label: 'Maps',          icon: 'solar:map-point-line-duotone',   perm: 'maps.view' },
      { to: '/admin/tasks',         label: 'Tasks',         icon: 'solar:checklist-minimalistic-line-duotone', perm: 'tasks.read' },
      { to: '/admin/activities',    label: 'Activity',      icon: 'solar:clock-circle-line-duotone' },
      { to: '/admin/import',        label: 'CSV Import',    icon: 'solar:upload-minimalistic-line-duotone',   perm: 'import.csv' },
    ],
  },
  {
    key: 'website', label: 'Website', icon: 'solar:global-line-duotone',
    matchPrefixes: ['/admin/website', '/admin/blog-posts', '/admin/media', '/admin/reports/seo-settings', '/admin/forms', '/admin/settings/dns'],
    items: [
      { to: '/admin/website/pages',        label: 'Pages',           icon: 'solar:document-line-duotone' },
      { to: '/admin/website/settings',     label: 'Header & Footer', icon: 'solar:widget-line-duotone' },
      { to: '/admin/blog-posts',           label: 'Blog Posts',      icon: 'solar:document-text-line-duotone' },
      { to: '/admin/media',                label: 'Media Library',   icon: 'solar:gallery-wide-line-duotone' },
      { to: '/admin/forms',                label: 'Forms',           icon: 'solar:checklist-minimalistic-line-duotone' },
      { to: '/admin/reports/seo-settings', label: 'SEO',             icon: 'solar:magnifer-line-duotone' },
      { to: '/admin/settings/dns',         label: 'DNS Manager',     icon: 'solar:server-path-line-duotone', perm: 'settings.manage' },
      { to: '/admin/website/global-settings', label: 'Global Website Settings', icon: 'solar:settings-line-duotone', perm: 'settings.manage' },
    ],
  },
  {
    key: 'marketing', label: 'Marketing', icon: 'solar:rocket-2-bold-duotone',
    matchPrefixes: ['/admin/comms', '/admin/marketing'],
    items: [
      {
        to: '/admin/comms', label: 'Communications', icon: 'solar:chat-round-line-duotone', perm: 'comms.read',
        children: [
          { to: '/admin/comms',           label: 'Inbox',     icon: 'solar:inbox-line-duotone' },
          { to: '/admin/comms/lists',     label: 'Lists',     icon: 'solar:users-group-rounded-line-duotone', perm: 'lists.read' },
          { to: '/admin/comms/campaigns', label: 'Campaigns', icon: 'solar:rocket-2-line-duotone',           perm: 'campaigns.read' },
          { to: '/admin/comms/templates',   label: 'Templates',   icon: 'solar:document-add-line-duotone',  perm: 'comms.templates.manage' },
          { to: '/admin/comms/automations', label: 'Automations', icon: 'solar:bolt-circle-line-duotone',    perm: 'automations.read' },
        ],
      },
      {
        to: '/admin/marketing/social-composer', label: 'Social', icon: 'solar:share-circle-line-duotone',
        children: [
          { to: '/admin/marketing/social-composer', label: 'Compose',  icon: 'solar:pen-new-square-line-duotone', perm: 'campaigns.write' },
          { to: '/admin/marketing/post-queue',      label: 'Queue',    icon: 'solar:calendar-line-duotone', perm: 'campaigns.read' },
          { to: '/admin/marketing/accounts',        label: 'Accounts', icon: 'solar:link-circle-line-duotone', perm: 'settings.manage' },
        ],
      },
    ],
  },
  {
    key: 'commerce', label: 'Commerce', icon: 'solar:cart-large-2-bold-duotone',
    matchPrefixes: ['/admin/products', '/admin/categories', '/admin/orders', '/admin/shipping', '/admin/tax', '/admin/processing-fees'],
    items: [
      { to: '/admin/products',        label: 'Products',        icon: 'solar:box-line-duotone',          perm: 'products.read' },
      { to: '/admin/categories',      label: 'Categories',      icon: 'solar:folder-line-duotone',       perm: 'products.read' },
      { to: '/admin/orders',          label: 'Orders',          icon: 'solar:bag-check-line-duotone',    perm: 'orders.read' },
      { to: '/admin/shipping',        label: 'Shipping',        icon: 'solar:delivery-line-duotone',     perm: 'shipping.manage' },
      { to: '/admin/tax',             label: 'Tax Rates',       icon: 'solar:bill-list-line-duotone',    perm: 'tax.manage' },
      { to: '/admin/processing-fees', label: 'Processing Fees', icon: 'solar:card-transfer-line-duotone', perm: 'commerce.settings' },
    ],
  },
  {
    key: 'fundraising', label: 'Fundraising', icon: 'solar:heart-line-duotone',
    matchPrefixes: ['/admin/donations', '/admin/pledges', '/admin/membership', '/admin/events', '/admin/volunteers'],
    items: [
      { to: '/admin/donations',       label: 'Donations',        icon: 'solar:hand-heart-line-duotone', perm: 'donations.read' },
      { to: '/admin/pledges',         label: 'Pledges',          icon: 'solar:calendar-mark-line-duotone', perm: 'donations.read' },
      { to: '/admin/donations/funds', label: 'Funds & Campaigns', icon: 'solar:wallet-line-duotone',     perm: 'donations.read' },
      { to: '/admin/donations/retention', label: 'Donor Retention', icon: 'solar:refresh-circle-line-duotone', perm: 'reports.view' },
      { to: '/admin/donations/text-to-give', label: 'Text to Give', icon: 'solar:chat-round-money-line-duotone', perm: 'settings.manage' },
      { to: '/admin/membership',       label: 'Members',          icon: 'solar:users-group-two-rounded-line-duotone', perm: 'membership.read' },
      { to: '/admin/membership/tiers', label: 'Membership Tiers',  icon: 'solar:medal-ribbons-star-line-duotone',     perm: 'membership.read' },
      { to: '/admin/events',           label: 'Events',           icon: 'solar:calendar-line-duotone',        perm: 'events.read' },
      { to: '/admin/events/calendar',  label: 'Events Calendar',  icon: 'solar:calendar-line-duotone',        perm: 'events.read' },
      { to: '/admin/volunteers',       label: 'Volunteers',       icon: 'solar:user-heart-line-duotone',     perm: 'volunteers.read' },
    ],
  },
  {
    key: 'reports', label: 'Reports', icon: 'solar:chart-line-duotone',
    matchPrefixes: ['/admin/reports'],
    items: [
      { to: '/admin/reports', label: 'Reports', icon: 'solar:chart-2-line-duotone', perm: 'reports.view' },
      { to: '/admin/reports/builder', label: 'Report Builder', icon: 'solar:widget-2-line-duotone', perm: 'reports.view' },
    ],
  },
];

// First navigable path within a section — used both as the tab's own link
// target and as the fallback when a section has no matching prefix.
function firstPath(section) {
  const first = section.items[0];
  return first.children ? first.children[0].to : first.to;
}

// Longest matching prefix wins, so e.g. /reports/seo-settings (Website)
// takes priority over the shorter, generic /reports (Reports).
function matchSection(pathname) {
  let best = null;
  for (const section of SECTIONS) {
    for (const prefix of section.matchPrefixes) {
      if (pathname === prefix || pathname.startsWith(prefix + '/')) {
        if (!best || prefix.length > best.len) best = { key: section.key, len: prefix.length };
      }
    }
  }
  return best?.key || 'crm';
}

const adminItems = [
  { to: '/admin/users',              label: 'Users',         icon: 'solar:users-group-rounded-line-duotone', perm: 'users.manage' },
  { to: '/admin/roles',              label: 'Roles',         icon: 'solar:shield-user-line-duotone',         perm: 'roles.manage' },
  { to: '/admin/pipelines',    label: 'Pipelines',     icon: 'solar:chart-square-line-duotone',        perm: 'pipelines.access' },
  { to: '/admin/tags',         label: 'Tags',          icon: 'solar:tag-line-duotone',                 perm: 'settings.manage' },
  { to: '/admin/custom-fields',label: 'Custom Fields', icon: 'solar:widget-add-line-duotone',          perm: 'settings.manage' },
  { to: '/admin/portal',       label: 'Portal Users',  icon: 'solar:user-id-line-duotone',             perm: 'portal.manage' },
  { to: '/admin/settings',           label: 'Integrations',  icon: 'solar:settings-line-duotone',            perm: 'settings.manage' },
  { to: '/admin/settings/business',  label: 'Business',      icon: 'solar:buildings-2-line-duotone',         perm: 'settings.manage' },
  { to: '/admin/ai-kb',        label: 'AI Knowledge Base', icon: 'solar:stars-line-duotone',           perm: 'settings.manage' },
];

function NavGroup({ item, can }) {
  const location = useLocation();
  const visibleChildren = (item.children || []).filter((c) => !c.perm || can(c.perm));
  // Auto-expand the group when the user is on one of its sub-pages.
  const isWithinGroup = visibleChildren.some((c) =>
    location.pathname === c.to || location.pathname.startsWith(c.to + '/')
  );
  const [open, setOpen] = useState(isWithinGroup);

  if (visibleChildren.length === 0) return null;

  return (
    <li className={`sidebar-item ${open ? 'selected' : ''}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={'sidebar-link primary-hover-bg w-100 d-flex align-items-center' + (isWithinGroup ? ' active' : '')}
        style={{ background: 'transparent', border: 0, justifyContent: 'space-between' }}
      >
        <span className="d-flex align-items-center">
          <span className="aside-icon p-2 rounded-1" style={{ background: 'var(--secondary-subtle)', color: 'var(--secondary)' }}>
            <iconify-icon icon={item.icon} class="fs-6"></iconify-icon>
          </span>
          <span className="hide-menu ps-1">{item.label}</span>
        </span>
        <iconify-icon
          icon={open ? 'solar:alt-arrow-up-line-duotone' : 'solar:alt-arrow-down-line-duotone'}
          class="fs-6 text-muted"
        ></iconify-icon>
      </button>
      {open && (
        <ul className="list-unstyled mb-0 ps-4">
          {visibleChildren.map((c) => (
            <li className="sidebar-item" key={c.to}>
              <NavLink
                end
                to={c.to}
                className={({ isActive }) =>
                  'sidebar-link primary-hover-bg' + (isActive ? ' active' : '')
                }
              >
                <span className="aside-icon p-2 rounded-1" style={{ background: 'var(--secondary-subtle)', color: 'var(--secondary)' }}>
                  <iconify-icon icon={c.icon} class="fs-6"></iconify-icon>
                </span>
                <span className="hide-menu ps-1 small">{c.label}</span>
              </NavLink>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

export default function AppLayout() {
  useAdminTheme();
  const { user, logout, can, impersonating, stopImpersonating } = useAuth();
  const { theme, toggleTheme, secondaryColor } = useTheme();
  const navigate = useNavigate();
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const dropdownRef = useRef(null);
  const { confirm, dialog: confirmDialog } = useConfirm();

  const activeSectionKey = matchSection(location.pathname);
  const activeSection = SECTIONS.find((s) => s.key === activeSectionKey) || SECTIONS[0];

  useEffect(() => {
    function handleClickOutside(e) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  function closeSidebar() { setSidebarOpen(false); }

  async function doLogout() {
    if (!(await confirm('Sign out?', { danger: false, confirmLabel: 'Sign Out' }))) return;
    await logout();
    navigate('/login', { replace: true });
  }

  const initials = `${user?.first_name?.[0] || ''}${user?.last_name?.[0] || ''}` || user?.email?.[0]?.toUpperCase() || '?';

  return (
    <IntegrationsProvider>
    <div id="main-wrapper" className={sidebarOpen ? 'sidebar-open' : ''}>
      {/* Impersonation banner */}
      {impersonating && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, zIndex: 9999,
          background: '#e67e22', color: '#fff',
          padding: '8px 16px',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12,
          fontSize: 14, fontWeight: 600,
        }}>
          <iconify-icon icon="solar:eye-line-duotone" style={{ fontSize: 18 }}></iconify-icon>
          Viewing as {impersonating.first_name} {impersonating.last_name} ({impersonating.email})
          <button
            onClick={stopImpersonating}
            style={{ background: 'rgba(255,255,255,0.25)', border: 'none', color: '#fff', borderRadius: 6, padding: '6px 14px', cursor: 'pointer', fontWeight: 600 }}
          >
            Stop impersonating
          </button>
        </div>
      )}

      {/* Mobile backdrop */}
      <div className="sidebar-backdrop" onClick={closeSidebar} />

      <aside className="left-sidebar with-vertical">
        <div className="brand-logo d-flex align-items-center justify-content-center w-100" style={{ padding: 10 }}>
          <BrandMark size="sm" linkHome />
        </div>

        {/* Module / section switcher — mobile only. Desktop keeps its version in the
            topbar; on mobile everything lives in this one drawer instead. */}
        <div
          className="d-lg-none d-flex gap-2 px-3 pb-3 module-switcher-scroll"
          style={{ overflowX: 'auto', flexWrap: 'nowrap', WebkitOverflowScrolling: 'touch' }}
        >
          {SECTIONS.map((s) => {
            const active = s.key === activeSectionKey;
            return (
              <button
                key={s.key}
                type="button"
                onClick={() => navigate(firstPath(s))}
                className="btn btn-sm d-flex align-items-center gap-2 flex-shrink-0"
                style={{
                  borderRadius: 20,
                  padding: '6px 14px',
                  fontWeight: 600,
                  whiteSpace: 'nowrap',
                  border: active ? 'none' : '1px solid var(--border-warm)',
                  background: active ? 'var(--bs-dark, #111)' : 'transparent',
                  color: active ? '#fff' : 'inherit',
                }}
              >
                <iconify-icon icon={s.icon} class="fs-6"></iconify-icon>
                {s.label}
              </button>
            );
          })}
        </div>

        <div className="scroll-sidebar">
          <nav className="sidebar-nav">
            <ul id="sidebarnav" className="mb-0" onClick={closeSidebar}>
              <li className="nav-small-cap">
                <i className="ti ti-dots nav-small-cap-icon fs-4"></i>
                <span className="hide-menu">{activeSection.label}</span>
              </li>
              {activeSection.items.filter((n) => !n.perm || can(n.perm)).map((n) => (
                n.children
                  ? <NavGroup key={n.to} item={n} can={can} />
                  : (
                    <li className="sidebar-item" key={n.to}>
                      <NavLink
                        end
                        to={n.to}
                        className={({ isActive }) =>
                          'sidebar-link primary-hover-bg' + (isActive ? ' active' : '')
                        }
                      >
                        <span className="aside-icon p-2 rounded-1" style={{ background: 'var(--secondary-subtle)', color: 'var(--secondary)' }}>
                          <iconify-icon icon={n.icon} class="fs-6"></iconify-icon>
                        </span>
                        <span className="hide-menu ps-1">{n.label}</span>
                      </NavLink>
                    </li>
                  )
              ))}

            </ul>
          </nav>
        </div>

        <div className="fixed-profile mx-3 mt-3">
          <div className="card mb-0 shadow-none" style={{ background: secondaryColor }}>
            <div className="card-body p-2">
              <div className="d-flex align-items-center gap-2" style={{ minWidth: 0 }}>
                <div className="avatar-initials flex-shrink-0" style={{ background: 'var(--brand)', color: 'white' }}>{initials}</div>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div className="text-white fw-semibold text-truncate" style={{ fontSize: '0.85rem' }}>{user?.first_name} {user?.last_name}</div>
                  <div className="text-truncate" style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.65)' }}>{user?.email}</div>
                  <div className="hide-menu" style={{ fontSize: '0.72rem', color: 'rgba(255,255,255,0.35)' }}>v{__APP_VERSION__}</div>
                </div>
                <button onClick={doLogout} className="btn btn-sm btn-link text-white p-0 flex-shrink-0" title="Sign out" aria-label="Sign out">
                  <iconify-icon icon="solar:logout-3-line-duotone" class="fs-5"></iconify-icon>
                </button>
              </div>
            </div>
          </div>
        </div>
      </aside>

      <div className="page-wrapper" style={impersonating ? { paddingTop: 40 } : undefined}>
        <div className="body-wrapper">
          <div className="container-fluid mw-100">
            <header className="topbar sticky-top" style={{ borderBottom: '1px solid var(--border-warm)' }}>
              <nav className="navbar p-2 d-flex align-items-center gap-3">
                {/* Left: hamburger + brand. Visible throughout the whole "sidebar is a
                    slide-out drawer" range (<1300px, see .d-1300-none / the vendor
                    theme's own sidebar breakpoint in styles.css) — not just below
                    Bootstrap's lg (992px), so there's no dead zone on laptop widths
                    where the sidebar is hidden but nothing can open it. */}
                <ul className="navbar-nav d-flex flex-row align-items-center gap-2 mb-0">
                  <li className="nav-item d-1300-none">
                    <button
                      className="btn btn-light btn-sm border d-flex align-items-center justify-content-center"
                      style={{ width: 44, height: 44 }}
                      onClick={() => setSidebarOpen((v) => !v)}
                      aria-label="Toggle menu"
                    >
                      <iconify-icon icon="solar:hamburger-menu-line-duotone" class="fs-5"></iconify-icon>
                    </button>
                  </li>
                  <li className="nav-item d-1300-none">
                    <BrandMark size="sm" linkHome />
                  </li>
                </ul>

                {/* Center: module / section switcher — desktop only. On mobile this
                    wrapped across 2-3 rows and ate most of the visible screen before
                    any page content; it moves into the sidebar drawer instead (below).
                    Scrolls horizontally rather than wrapping so adding more modules
                    later (Membership, Volunteer, Golf, ...) never breaks the layout —
                    `minWidth: 0` is required on this flex child so it can actually
                    shrink below its content width and hand overflow to the scrollbar
                    instead of pushing the right-side controls off-screen. */}
                <div
                  className="d-none d-lg-flex align-items-center gap-2 flex-grow-1 module-switcher-scroll"
                  style={{ overflowX: 'auto', flexWrap: 'nowrap', minWidth: 0, WebkitOverflowScrolling: 'touch' }}
                >
                  {SECTIONS.map((s) => {
                    const active = s.key === activeSectionKey;
                    return (
                      <button
                        key={s.key}
                        type="button"
                        // Below 1300px the sidebar is a slide-out drawer, not pinned
                        // (see styles.css), so there's nowhere else to see this
                        // module's sub-items after navigating — open the drawer too.
                        // No-op above 1300px: the drawer CSS doesn't apply there.
                        onClick={() => { navigate(firstPath(s)); setSidebarOpen(true); }}
                        className="btn btn-sm d-flex align-items-center gap-2 flex-shrink-0"
                        style={{
                          borderRadius: 20,
                          padding: '6px 16px',
                          fontWeight: 600,
                          whiteSpace: 'nowrap',
                          border: active ? 'none' : '1px solid var(--border-warm)',
                          background: active ? 'var(--bs-dark, #111)' : 'transparent',
                          color: active ? '#fff' : 'inherit',
                        }}
                      >
                        <iconify-icon icon={s.icon} class="fs-6"></iconify-icon>
                        {s.label}
                      </button>
                    );
                  })}
                </div>

                {/* Right: always-visible controls */}
                <ul className="navbar-nav flex-row align-items-center gap-2 ms-auto mb-0">
                  <li className="nav-item">
                    <button
                      className="btn btn-primary btn-sm d-flex align-items-center gap-1 px-3"
                      style={{ height: 44, borderRadius: 22 }}
                      onClick={() => setAiOpen((v) => !v)}
                      title="AI Assistant"
                    >
                      <iconify-icon icon="solar:stars-line-duotone" class="fs-5"></iconify-icon>
                      <span className="d-none d-sm-inline fw-semibold" style={{ fontSize: '0.82rem' }}>AI Assistant</span>
                    </button>
                  </li>
                  <li className="nav-item">
                    <button
                      className="btn btn-light btn-sm border d-flex align-items-center justify-content-center"
                      style={{ width: 44, height: 44 }}
                      onClick={toggleTheme}
                      title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
                    >
                      <iconify-icon
                        icon={theme === 'dark'
                          ? 'solar:sun-line-duotone'
                          : 'solar:moon-sleep-line-duotone'}
                        class="fs-5"
                      ></iconify-icon>
                    </button>
                  </li>
                  <li className="nav-item" style={{ position: 'relative' }} ref={dropdownRef}>
                      <button
                        type="button"
                        className="btn btn-light d-flex align-items-center gap-2 border"
                        onClick={() => setDropdownOpen((v) => !v)}
                        aria-expanded={dropdownOpen}
                      >
                        <div className="avatar-initials" style={{ background: 'var(--brand)', color: 'white', width: 32, height: 32 }}>
                          {initials}
                        </div>
                        <span className="d-none d-md-inline fw-semibold text-dark">
                          {user?.first_name || user?.email}
                        </span>
                        <iconify-icon icon="solar:alt-arrow-down-line-duotone" class="fs-6 text-muted"></iconify-icon>
                      </button>
                      {dropdownOpen && (
                        <ul className="dropdown-menu dropdown-menu-end shadow show" style={{ minWidth: 240, position: 'absolute', right: 0, top: '100%', zIndex: 1050 }}>
                          <li className="px-3 py-2 border-bottom">
                            <div className="fw-bold text-dark">{user?.first_name} {user?.last_name}</div>
                            <small className="text-muted">{user?.email}</small>
                            {user?.roles?.length ? (
                              <div className="mt-1">
                                {user.roles.map((r) => (
                                  <span key={r} className="badge bg-primary-subtle text-primary me-1">{r}</span>
                                ))}
                              </div>
                            ) : null}
                          </li>
                          {adminItems.filter((a) => can(a.perm)).length > 0 && (
                            <>
                              <li>
                                <h6 className="dropdown-header text-uppercase small text-muted px-3 pt-2 pb-1 mb-0">
                                  Settings
                                </h6>
                              </li>
                              {adminItems.filter((a) => can(a.perm)).map((n) => (
                                <li key={n.to}>
                                  <Link
                                    className="dropdown-item d-flex align-items-center gap-2"
                                    to={n.to}
                                    onClick={() => setDropdownOpen(false)}
                                  >
                                    <iconify-icon icon={n.icon}></iconify-icon>
                                    <span>{n.label}</span>
                                  </Link>
                                </li>
                              ))}
                            </>
                          )}
                          <li><hr className="dropdown-divider" /></li>
                          <li>
                            <button
                              type="button"
                              className="dropdown-item d-flex align-items-center gap-2 text-danger"
                              onClick={doLogout}
                            >
                              <iconify-icon icon="solar:logout-3-line-duotone"></iconify-icon>
                              <span>Sign out</span>
                            </button>
                          </li>
                        </ul>
                      )}
                    </li>
                  </ul>
              </nav>
            </header>

            <main style={{ padding: '24px 8px' }}>
              <Outlet />
            </main>
          </div>
        </div>
      </div>

      <AiAssistant open={aiOpen} onClose={() => setAiOpen(false)} />
      <ToastHost />
      {confirmDialog}
    </div>
    </IntegrationsProvider>
  );
}
