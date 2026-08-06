import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import BrandMark from '../../components/BrandMark.jsx';
import api from '../../../api/client.js';
import { useAdminTheme } from '../../../hooks/useAdminTheme.js';

// view: 'form' | 'sent'
export default function PortalRegister() {
  useAdminTheme();
  const [searchParams] = useSearchParams();
  const [view, setView] = useState('form');
  // Post-transaction success screens link here with ?email=... prefilled —
  // registration matches this email against an existing contact record
  // (server/src/routes/portal.js /register), so most of the time this
  // exact address is the one that already has giving/order/event history.
  const [form, setForm] = useState({ first_name: '', last_name: '', email: searchParams.get('email') || '', phone: '', password: '', confirm: '' });
  const [err, setErr]   = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    if (form.password !== form.confirm) { setErr('Passwords do not match.'); return; }
    if (form.password.length < 8) { setErr('Password must be at least 8 characters.'); return; }
    setErr(''); setBusy(true);
    try {
      await api.post('/portal/register', {
        first_name: form.first_name, last_name: form.last_name,
        email: form.email, phone: form.phone || null, password: form.password,
      });
      setView('sent');
    } catch (e) {
      setErr(e?.response?.data?.error || 'Something went wrong. Please try again.');
    } finally { setBusy(false); }
  }

  return (
    <div className="d-flex align-items-center justify-content-center" style={{ minHeight: '100vh', background: 'linear-gradient(135deg, var(--brand-dark, #071527) 0%, var(--brand, #0A1F3D) 55%, var(--secondary, #C9A227) 100%)' }}>
      <div className="card shadow-lg" style={{ width: 460, maxWidth: '94vw' }}>
        <div className="card-body p-4">
          <div className="d-flex flex-column align-items-center mb-4">
            <BrandMark size="lg" />
            <p className="text-muted mb-0 mt-2 fs-3">Customer Portal</p>
          </div>

          {view === 'form' && (
            <form onSubmit={submit}>
              <h5 className="mb-1">Create your account</h5>
              <p className="text-muted small mb-3">See your giving history, manage payment methods, and more.</p>
              <div className="row g-2 mb-2">
                <div className="col-6">
                  <label className="form-label fw-semibold">First name</label>
                  <input className="form-control" value={form.first_name} onChange={(e) => setForm({ ...form, first_name: e.target.value })} autoComplete="given-name" required autoFocus />
                </div>
                <div className="col-6">
                  <label className="form-label fw-semibold">Last name</label>
                  <input className="form-control" value={form.last_name} onChange={(e) => setForm({ ...form, last_name: e.target.value })} autoComplete="family-name" required />
                </div>
              </div>
              <div className="mb-2">
                <label className="form-label fw-semibold">Email</label>
                <input type="email" className="form-control" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} autoComplete="email" required />
              </div>
              <div className="mb-2">
                <label className="form-label fw-semibold">Phone (optional)</label>
                <input type="tel" className="form-control" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} autoComplete="tel" />
              </div>
              <div className="mb-2">
                <label className="form-label fw-semibold">Password</label>
                <input type="password" className="form-control" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} autoComplete="new-password" required minLength={8} />
              </div>
              <div className="mb-3">
                <label className="form-label fw-semibold">Confirm password</label>
                <input type="password" className="form-control" value={form.confirm} onChange={(e) => setForm({ ...form, confirm: e.target.value })} autoComplete="new-password" required />
              </div>
              {err && <div className="alert alert-danger py-2 mb-3">{err}</div>}
              <button type="submit" className="btn btn-primary w-100" disabled={busy}>
                {busy ? 'Creating account…' : 'Create account'}
              </button>
              <p className="text-center text-muted small mt-3 mb-0">
                Already have an account? <Link to="/portal/login">Sign in</Link>
              </p>
            </form>
          )}

          {view === 'sent' && (
            <div className="text-center py-2">
              <iconify-icon icon="solar:letter-line-duotone" style={{ fontSize: 48, color: 'var(--secondary)' }}></iconify-icon>
              <h6 className="mt-3 mb-1">Check your inbox</h6>
              <p className="text-muted small mb-3">
                We sent a verification link to <strong>{form.email}</strong>. Click it to activate your account, then sign in.
              </p>
              <Link to="/portal/login" className="btn btn-outline-secondary btn-sm">Back to sign in</Link>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
