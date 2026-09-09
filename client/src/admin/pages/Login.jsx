import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext.jsx';
import BrandMark from '../components/BrandMark.jsx';
import api from '../../api/client.js';
import { useAdminTheme } from '../../hooks/useAdminTheme.js';

// view: 'login' | 'mfa' | 'forgot' | 'forgot_sent'
export default function Login() {
  useAdminTheme();
  const { login, verifyMfa, user } = useAuth();
  const nav = useNavigate();

  const [view, setView]         = useState('login');
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [resetEmail, setResetEmail] = useState('');
  const [err, setErr]           = useState('');
  const [busy, setBusy]         = useState(false);

  // MFA step-up state
  const [mfaToken, setMfaToken]   = useState('');
  const [mfaCode, setMfaCode]     = useState('');
  const [useRecovery, setUseRecovery] = useState(false);

  if (user) { nav('/admin/dashboard'); return null; }

  async function submitLogin(e) {
    e.preventDefault();
    setErr(''); setBusy(true);
    try {
      const result = await login(email, password);
      if (result?.mfaRequired) {
        setMfaToken(result.mfaToken);
        setMfaCode('');
        setUseRecovery(false);
        setView('mfa');
      } else {
        nav('/admin/dashboard');
      }
    } catch (e) {
      setErr(e?.response?.data?.error || e.message || 'Login failed');
    } finally { setBusy(false); }
  }

  async function submitMfa(e) {
    e.preventDefault();
    setErr(''); setBusy(true);
    try {
      await verifyMfa(mfaToken, useRecovery ? { recoveryCode: mfaCode } : { code: mfaCode });
      nav('/admin/dashboard');
    } catch (e) {
      const msg = e?.response?.data?.error || e.message || 'Verification failed';
      if (e?.response?.status === 401) {
        // The mfa_token itself expired/invalid — start over rather than
        // let the caller retry with a dead token.
        setErr('Your session expired. Please sign in again.');
        setView('login'); setPassword('');
      } else {
        setErr(msg);
      }
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

          {/* Brand */}
          <div className="d-flex flex-column align-items-center mb-4">
            <BrandMark size="lg" />
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

          {/* ── MFA STEP-UP ── */}
          {view === 'mfa' && (
            <form onSubmit={submitMfa}>
              <div className="text-center mb-3">
                <iconify-icon
                  icon="solar:shield-keyhole-bold-duotone"
                  style={{ fontSize: 40, color: 'var(--secondary)' }}
                ></iconify-icon>
                <h6 className="mt-2 mb-1">Two-factor verification</h6>
                <p className="text-muted small mb-0">
                  {useRecovery
                    ? 'Enter one of your recovery codes.'
                    : 'Enter the 6-digit code from your authenticator app.'}
                </p>
              </div>
              <div className="mb-3">
                <label className="form-label fw-semibold">
                  {useRecovery ? 'Recovery code' : 'Authentication code'}
                </label>
                <input
                  type="text"
                  className="form-control text-center"
                  style={{ letterSpacing: useRecovery ? 'normal' : '0.3em', fontSize: useRecovery ? undefined : '1.25rem' }}
                  value={mfaCode}
                  onChange={(e) => setMfaCode(e.target.value)}
                  inputMode={useRecovery ? 'text' : 'numeric'}
                  placeholder={useRecovery ? 'XXXX-XXXX-XX' : '123456'}
                  autoComplete="one-time-code"
                  autoFocus
                  required
                />
              </div>
              {err && <div className="alert alert-danger py-2 mb-3">{err}</div>}
              <button type="submit" className="btn btn-primary w-100 mb-2" disabled={busy || !mfaCode}>
                {busy ? 'Verifying…' : 'Verify'}
              </button>
              <button
                type="button"
                className="btn btn-link w-100 text-decoration-none"
                onClick={() => { setUseRecovery((v) => !v); setMfaCode(''); setErr(''); }}
              >
                {useRecovery ? 'Use an authenticator code instead' : "Can't access your authenticator? Use a recovery code"}
              </button>
              <button
                type="button"
                className="btn btn-link btn-sm w-100 text-decoration-none text-muted"
                onClick={() => { setView('login'); setPassword(''); setErr(''); }}
              >
                Back to sign in
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
