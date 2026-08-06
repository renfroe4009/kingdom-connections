import { useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import BrandMark from '../components/BrandMark.jsx';
import api from '../../api/client.js';
import { useAdminTheme } from '../../hooks/useAdminTheme.js';

// view: 'form' | 'success' | 'invalid'
export default function ResetPassword() {
  useAdminTheme();
  const nav = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') || '';

  const [view, setView]         = useState(token ? 'form' : 'invalid');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm]   = useState('');
  const [err, setErr]           = useState('');
  const [busy, setBusy]         = useState(false);

  async function submit(e) {
    e.preventDefault();
    if (password !== confirm) { setErr('Passwords do not match.'); return; }
    if (password.length < 8)  { setErr('Password must be at least 8 characters.'); return; }
    setErr(''); setBusy(true);
    try {
      await api.post('/auth/reset-password', { token, password });
      setView('success');
    } catch (e) {
      const msg = e?.response?.data?.error || 'Reset link is invalid or has expired.';
      if (msg.toLowerCase().includes('invalid') || msg.toLowerCase().includes('expired')) {
        setView('invalid');
      } else {
        setErr(msg);
      }
    } finally { setBusy(false); }
  }

  return (
    <div
      className="d-flex align-items-center justify-content-center"
      style={{ minHeight: '100vh', background: 'linear-gradient(135deg, var(--brand-dark, #071527) 0%, var(--brand, #0A1F3D) 55%, var(--secondary, #C9A227) 100%)' }}
    >
      <div className="card shadow-lg" style={{ width: 420, maxWidth: '94vw' }}>
        <div className="card-body p-4">

          <div className="d-flex flex-column align-items-center mb-4">
            <BrandMark size="lg" />
          </div>

          {/* ── RESET FORM ── */}
          {view === 'form' && (
            <>
              <h5 className="mb-1">Set a new password</h5>
              <p className="text-muted small mb-3">Choose a strong password — at least 8 characters.</p>
              <form onSubmit={submit}>
                <div className="mb-3">
                  <label className="form-label fw-semibold">New password</label>
                  <input
                    type="password"
                    className="form-control"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="new-password"
                    required
                    minLength={8}
                  />
                </div>
                <div className="mb-3">
                  <label className="form-label fw-semibold">Confirm password</label>
                  <input
                    type="password"
                    className="form-control"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    autoComplete="new-password"
                    required
                  />
                </div>
                {err && <div className="alert alert-danger py-2 mb-3">{err}</div>}
                <button type="submit" className="btn btn-primary w-100" disabled={busy}>
                  {busy ? 'Saving…' : 'Set new password'}
                </button>
              </form>
            </>
          )}

          {/* ── SUCCESS ── */}
          {view === 'success' && (
            <div className="text-center py-2">
              <iconify-icon
                icon="solar:check-circle-line-duotone"
                style={{ fontSize: 48, color: 'var(--bs-success)' }}
              ></iconify-icon>
              <h6 className="mt-3 mb-1">Password updated</h6>
              <p className="text-muted small mb-3">You can now sign in with your new password.</p>
              <Link to="/login" className="btn btn-primary btn-sm">Sign in</Link>
            </div>
          )}

          {/* ── INVALID / EXPIRED TOKEN ── */}
          {view === 'invalid' && (
            <div className="text-center py-2">
              <iconify-icon
                icon="solar:close-circle-line-duotone"
                style={{ fontSize: 48, color: 'var(--bs-danger)' }}
              ></iconify-icon>
              <h6 className="mt-3 mb-1">Link invalid or expired</h6>
              <p className="text-muted small mb-3">
                This reset link is no longer valid. Reset links expire after 1 hour.
              </p>
              <Link to="/login" className="btn btn-outline-secondary btn-sm">Back to sign in</Link>
            </div>
          )}

        </div>
        <div className="card-footer text-center bg-transparent border-top-0 pb-3 pt-0">
          <small className="text-muted">v{__APP_VERSION__}</small>
        </div>
      </div>
    </div>
  );
}
