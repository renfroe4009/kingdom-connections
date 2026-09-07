// =============================================================================
// Customer-facing portal layout
// Shown for users with role 'portal' (or admin, which bypasses).
// =============================================================================
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext.jsx';
import BrandMark from './BrandMark.jsx';
import { useConfirm } from '../../hooks/useConfirm.jsx';
import { useAdminTheme } from '../../hooks/useAdminTheme.js';

// Adding a future module (e.g. Membership, Golf) is just another entry here
// plus a route in App.jsx and a scoped endpoint in portal.js following the
// same getScope() pattern as /donations and /invoices below.
const navItems = [
  { to: '/portal/dashboard',        label: 'Dashboard',        icon: 'solar:screencast-2-line-duotone' },
  { to: '/portal/giving',           label: 'My Giving',        icon: 'solar:hand-heart-line-duotone' },
  { to: '/portal/membership',       label: 'My Membership',    icon: 'solar:medal-ribbons-star-line-duotone' },
  { to: '/portal/events',           label: 'My Events',        icon: 'solar:calendar-line-duotone' },
  { to: '/portal/orders',           label: 'My Orders',        icon: 'solar:bag-check-line-duotone' },
  { to: '/portal/invoices',         label: 'Invoices',         icon: 'solar:bill-list-line-duotone' },
  { to: '/portal/subscriptions',    label: 'Recurring',        icon: 'solar:refresh-circle-line-duotone' },
  { to: '/portal/payment-methods',  label: 'Payment Methods',  icon: 'solar:card-line-duotone' },
  { to: '/portal/profile',          label: 'My Profile',       icon: 'solar:user-line-duotone' },
];

export default function PortalLayout() {
  useAdminTheme();
  const { user, logout } = useAuth();
  const nav = useNavigate();
  const { confirm, dialog: confirmDialog } = useConfirm();

  async function doLogout() {
    if (!(await confirm('Sign out of the portal?', { danger: false, confirmLabel: 'Sign Out' }))) return;
    await logout();
    nav('/portal/login', { replace: true });
  }

  const initials = `${user?.first_name?.[0] || ''}${user?.last_name?.[0] || ''}` || user?.email?.[0]?.toUpperCase() || '?';

  return (
    <div style={{ minHeight: '100vh', background: '#F8F5EF' }}>
      {/* Top bar */}
      <header className="bg-white shadow-sm" style={{ borderBottom: '1px solid #F0C8B0' }}>
        <div className="container py-2 py-sm-3 portal-header-row d-flex align-items-center justify-content-between" style={{ maxWidth: 1200 }}>
          <div className="d-flex align-items-center gap-2 gap-sm-3">
            <BrandMark size="md" />
            <span className="badge bg-light text-muted border">Customer Portal</span>
          </div>
          <div className="d-flex align-items-center gap-2 gap-sm-3 portal-header-actions">
            <div className="text-end d-none d-sm-block">
              <div className="fw-semibold">{user?.first_name} {user?.last_name}</div>
              <small className="text-muted">{user?.email}</small>
            </div>
            <div className="avatar-initials" style={{ background: 'var(--secondary, #C9A227)', color: 'var(--brand, #0A1F3D)' }}>{initials}</div>
            <button className="btn btn-sm btn-light" onClick={doLogout} title="Sign out">
              <iconify-icon icon="solar:logout-3-line-duotone" class="fs-5"></iconify-icon>
            </button>
          </div>
        </div>

        {/* Tabs — scrollable on mobile */}
        <div className="container px-0 px-sm-3" style={{ maxWidth: 1200 }}>
          <ul className="nav gap-1 portal-nav-scroll" style={{ borderBottom: 'none', overflowX: 'auto', flexWrap: 'nowrap', WebkitOverflowScrolling: 'touch' }}>
            {navItems.map((n) => (
              <li className="nav-item" key={n.to}>
                <NavLink
                  to={n.to}
                  className={({ isActive }) =>
                    'nav-link d-flex align-items-center gap-1 gap-sm-2 px-2 px-sm-3 py-2' +
                    (isActive ? ' fw-bold' : ' text-dark')
                  }
                  style={({ isActive }) => ({
                    borderBottom: isActive ? '3px solid var(--secondary, #C9A227)' : '3px solid transparent',
                    color: isActive ? 'var(--brand, #0A1F3D)' : undefined,
                    whiteSpace: 'nowrap',
                  })}
                >
                  <iconify-icon icon={n.icon}></iconify-icon>
                  <span>{n.label}</span>
                </NavLink>
              </li>
            ))}
          </ul>
        </div>
      </header>

      <main className="container py-3 py-md-4 px-3 px-md-4" style={{ maxWidth: 1200 }}>
        <Outlet />
      </main>
      {confirmDialog}
    </div>
  );
}
