import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../../api/client.js';
import BrandMark from '../components/BrandMark.jsx';
import PhoneInput from '../../components/PhoneInput.jsx';
import { useAdminTheme } from '../../hooks/useAdminTheme.js';

export default function AcceptInvite() {
  useAdminTheme();
  const { token } = useParams();
  const nav = useNavigate();
  const [loading, setLoading] = useState(true);
  const [invite, setInvite] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ first_name: '', last_name: '', phone: '', password: '', confirm: '' });

  useEffect(() => {
    api.get(`/invites/${token}`)
      .then((r) => {
        setInvite(r.data);
        setForm((f) => ({ ...f, first_name: r.data.first_name || '', last_name: r.data.last_name || '' }));
      })
      .catch((e) => setErr(e.response?.data?.error || 'Could not load invite'))
      .finally(() => setLoading(false));
  }, [token]);

  async function submit(e) {
    e.preventDefault();
    setErr('');
    if (form.password.length < 6) return setErr('Password must be at least 6 characters');
    if (form.password !== form.confirm) return setErr('Passwords do not match');
    setBusy(true);
    try {
      const { data } = await api.post(`/invites/${token}/accept`, {
        password: form.password,
        first_name: form.first_name || undefined,
        last_name: form.last_name || undefined,
        phone: form.phone || undefined,
      });
      localStorage.setItem('lc_token', data.token);
      localStorage.setItem('lc_user', JSON.stringify(data.user));
      // Full reload so AuthContext picks up the new user state
      location.href = '/dashboard';
    } catch (e) {
      setErr(e.response?.data?.error || e.message);
    } finally { setBusy(false); }
  }

  return (
    <div className="d-flex align-items-center justify-content-center" style={{ minHeight: '100vh', background: 'linear-gradient(135deg, var(--brand-dark, #071527) 0%, var(--brand, #0A1F3D) 55%, var(--secondary, #C9A227) 100%)' }}>
      <div className="card shadow-lg" style={{ width: 480, maxWidth: '94vw' }}>
        <div className="card-body p-4">
          <div className="d-flex flex-column align-items-center mb-4">
            <BrandMark size="lg" />
            <p className="text-muted mb-0 mt-2 fs-3">Accept your invitation</p>
          </div>

          {loading && <div className="text-center py-4 text-muted">Loading invite…</div>}

          {!loading && !invite && (
            <>
              <div className="alert alert-danger">{err || 'This invite is invalid or expired.'}</div>
              <button className="btn btn-light w-100" onClick={() => nav('/login')}>Go to sign in</button>
            </>
          )}

          {!loading && invite && (
            <form onSubmit={submit}>
              <div className="mb-3">
                <label className="form-label fw-semibold">Email</label>
                <input className="form-control" value={invite.email} disabled />
              </div>
              <div className="row g-2 mb-3">
                <div className="col-6">
                  <label className="form-label fw-semibold">First name</label>
                  <input className="form-control" value={form.first_name} onChange={(e) => setForm({ ...form, first_name: e.target.value })} />
                </div>
                <div className="col-6">
                  <label className="form-label fw-semibold">Last name</label>
                  <input className="form-control" value={form.last_name} onChange={(e) => setForm({ ...form, last_name: e.target.value })} />
                </div>
              </div>
              <div className="mb-3">
                <label className="form-label fw-semibold">Phone <span className="text-muted">(optional)</span></label>
                <PhoneInput value={form.phone} onChange={(v) => setForm({ ...form, phone: v })} />
              </div>
              <div className="mb-3">
                <label className="form-label fw-semibold">Password</label>
                <input type="password" className="form-control" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required minLength={6} />
              </div>
              <div className="mb-3">
                <label className="form-label fw-semibold">Confirm password</label>
                <input type="password" className="form-control" value={form.confirm} onChange={(e) => setForm({ ...form, confirm: e.target.value })} required minLength={6} />
              </div>
              {err && <div className="alert alert-danger py-2 mb-3">{err}</div>}
              <button type="submit" className="btn btn-primary w-100" disabled={busy}>
                {busy ? 'Creating account…' : 'Create account & sign in'}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
