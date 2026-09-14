import { useEffect, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import BrandMark from '../../components/BrandMark.jsx';
import api from '../../../api/client.js';
import { useAdminTheme } from '../../../hooks/useAdminTheme.js';

// view: 'verifying' | 'success' | 'invalid'
export default function PortalVerifyEmail() {
  useAdminTheme();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') || '';
  const [view, setView] = useState(token ? 'verifying' : 'invalid');

  useEffect(() => {
    if (!token) return;
    api.post('/portal/verify-email', { token })
      .then(() => setView('success'))
      .catch(() => setView('invalid'));
  }, [token]);

  return (
    <div className="d-flex align-items-center justify-content-center" style={{ minHeight: '100vh', background: 'linear-gradient(135deg, var(--brand-dark, #111827) 0%, var(--brand, #1f2937) 55%, var(--secondary, #4b5563) 100%)' }}>
      <div className="card shadow-lg" style={{ width: 420, maxWidth: '94vw' }}>
        <div className="card-body p-4">
          <div className="d-flex flex-column align-items-center mb-4">
            <BrandMark size="lg" />
            <p className="text-muted mb-0 mt-2 fs-3">Customer Portal</p>
          </div>

          {view === 'verifying' && (
            <div className="text-center py-2">
              <div className="spinner-border text-primary mb-3"></div>
              <p className="text-muted small mb-0">Verifying your email…</p>
            </div>
          )}

          {view === 'success' && (
            <div className="text-center py-2">
              <iconify-icon icon="solar:check-circle-line-duotone" style={{ fontSize: 48, color: 'var(--bs-success)' }}></iconify-icon>
              <h6 className="mt-3 mb-1">Email verified</h6>
              <p className="text-muted small mb-3">Your account is active. You can sign in now.</p>
              <Link to="/portal/login" className="btn btn-primary btn-sm">Sign in to Portal</Link>
            </div>
          )}

          {view === 'invalid' && (
            <div className="text-center py-2">
              <iconify-icon icon="solar:close-circle-line-duotone" style={{ fontSize: 48, color: 'var(--bs-danger)' }}></iconify-icon>
              <h6 className="mt-3 mb-1">Link invalid or expired</h6>
              <p className="text-muted small mb-3">
                This verification link is no longer valid. Verification links expire after 24 hours.
              </p>
              <Link to="/portal/register" className="btn btn-outline-secondary btn-sm">Sign up again</Link>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
