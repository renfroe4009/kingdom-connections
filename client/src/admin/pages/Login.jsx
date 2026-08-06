import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext.jsx';
import BrandMark from '../components/BrandMark.jsx';
import api from '../../api/client.js';
import { useAdminTheme } from '../../hooks/useAdminTheme.js';

// view: 'login' | 'forgot' | 'forgot_sent'
export default function Login() {
  useAdminTheme();
  const { login, user } = useAuth();
  const nav = useNavigate();

  const [view, setView]         = useState('login');
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [resetEmail, setResetEmail] = useState('');
  const [err, setErr]           = useState('');
  const [busy, setBusy]         = useState(false);

  if (user) { nav('/admin/dashboard'); return null; }

  async function submitLogin(e) {
    e.preventDefault();
    setErr(''); setBusy(true);
    try {
      await login(email, password);
      nav('/admin/dashboard');
    } catch (e) {
      setErr(e?.response?.data?.error || e.message || 'Login failed');
    } finally { setBusy(false); }
  }

  async function submitForgot(e) {
    e.preventDefault();
    setErr(''); setBusy(true);
    try {
      await api.post('/auth/forgot-password', { email: resetEmail });
      setView('forgot_sent');
    } catch (e) {
      // Always show success to prevent email enumeration
      setView('forgot_sent');
    } finally { setBusy(false); }
  }

  return (
    <div
      className="d-flex align-items-center justify-content-center"
      style={{ minHeight: '100vh', background: 'linear-gradient(135deg, var(--brand-dark, #071527) 0%, var(--brand, #0A1F3D) 55%, var(--secondary, #C9A227) 100%)' }}
    >
      <div className="card shadow-lg" style={{ width: 420, maxWidth: '94vw' }}>
        <div className="card-body p-4">

          {/* Brand + phase */}
          <div className="d-flex flex-column align-items-center mb-4">
            <BrandMark size="lg" />
            <p className="text-muted mb-0 mt-2 small text-center">Phase 2 — Maps, Payments &amp; Portal</p>
          </div>

          {/* ── LOGIN FORM ── */}
          {view === 'login' && (
            <form onSubmit={submitLogin}>
              <div className="mb-3">
                <label className="form-label fw-semibold">Email</label>
                <input
                  type="email"
                  className="form-control"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                  required
                />
              </div>
              <div className="mb-1">
                <label className="form-label fw-semibold">Password</label>
                <input
                  type="password"
                  className="form-control"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  required
                />
              </div>
              <div className="text-end mb-3">
                <button
                  type="button"
                  className="btn btn-link btn-sm p-0 text-decoration-none"
                  onClick={() => { setView('forgot'); setErr(''); }}
                >
                  Forgot password?
                </button>
              </div>
              {err && <div className="alert alert-danger py-2 mb-3">{err}</div>}
              <button type="submit" className="btn btn-primary w-100" disabled={busy}>
                {busy ? 'Signing in…' : 'Sign in'}
              </button>
            </form>
          )}

          {/* ── FORGOT PASSWORD FORM ── */}
          {view === 'forgot' && (
            <form onSubmit={submitForgot}>
              <p className="text-muted small mb-3">
                Enter your email address and we'll send you a link to reset your password.
              </p>
              <div className="mb-3">
                <label className="form-label fw-semibold">Email</label>
                <input
                  type="email"
                  className="form-control"
                  value={resetEmail}
                  onChange={(e) => setResetEmail(e.target.value)}
                  autoComplete="email"
                  required
                />
              </div>
              {err && <div className="alert alert-danger py-2 mb-3">{err}</div>}
              <button type="submit" className="btn btn-primary w-100 mb-2" disabled={busy}>
                {busy ? 'Sending…' : 'Send reset link'}
              </button>
              <button
                type="button"
                className="btn btn-link w-100 text-decoration-none"
                onClick={() => { setView('login'); setErr(''); }}
              >
                Back to sign in
              </button>
            </form>
          )}

          {/* ── FORGOT SENT CONFIRMATION ── */}
          {view === 'forgot_sent' && (
            <div className="text-center py-2">
              <iconify-icon
                icon="solar:letter-line-duotone"
                style={{ fontSize: 48, color: 'var(--secondary)' }}
              ></iconify-icon>
              <h6 className="mt-3 mb-1">Check your inbox</h6>
              <p className="text-muted small mb-3">
                If an account exists for <strong>{resetEmail}</strong>, a password reset link
                has been sent. Check your spam folder if you don't see it.
              </p>
              <button
                type="button"
                className="btn btn-outline-secondary btn-sm"
                onClick={() => { setView('login'); setResetEmail(''); setErr(''); }}
              >
                Back to sign in
              </button>
            </div>
          )}

        </div>

        {/* Version footer */}
        <div className="card-footer text-center bg-transparent border-top-0 pb-3 pt-0">
          <small className="text-muted">v{__APP_VERSION__}</small>
        </div>
      </div>
    </div>
  );
}
