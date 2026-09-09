import { useEffect, useState } from 'react';
import api from '../../api/client.js';
import PageHeader from '../../components/PageHeader.jsx';

// Self-service two-factor authentication (TOTP) enrollment — every user
// manages their own, regardless of the org-wide toggle (Settings →
// Security, admin-only) that decides whether it's MANDATORY for privileged
// permissions. Anyone can enroll voluntarily any time.
export default function AccountSecurityPage() {
  const [status, setStatus] = useState(null); // { enrolled, pendingSetup }
  const [loading, setLoading] = useState(true);

  // Enrollment sub-flow: null | 'setup' | 'confirm' | 'recovery'
  const [step, setStep] = useState(null);
  const [setupData, setSetupData] = useState(null); // { secret, qr_data_url }
  const [code, setCode] = useState('');
  const [recoveryCodes, setRecoveryCodes] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  // Password-confirmation mini-forms for disable / regenerate
  const [pending, setPending] = useState(null); // null | 'disable' | 'regenerate'
  const [password, setPassword] = useState('');

  async function loadStatus() {
    const { data } = await api.get('/auth/mfa/status');
    setStatus(data);
  }
  useEffect(() => { loadStatus().finally(() => setLoading(false)); }, []);

  async function startSetup() {
    setErr(''); setBusy(true);
    try {
      const { data } = await api.post('/auth/mfa/totp/setup');
      setSetupData(data);
      setCode('');
      setStep('setup');
    } catch (e) {
      setErr(e.response?.data?.error || 'Could not start setup.');
    } finally { setBusy(false); }
  }

  async function confirmSetup(e) {
    e.preventDefault();
    setErr(''); setBusy(true);
    try {
      const { data } = await api.post('/auth/mfa/totp/confirm', { code });
      setRecoveryCodes(data.recovery_codes);
      setStep('recovery');
      await loadStatus();
    } catch (e) {
      setErr(e.response?.data?.error || 'Invalid code.');
    } finally { setBusy(false); }
  }

  function finishEnrollment() {
    setStep(null);
    setSetupData(null);
    setRecoveryCodes(null);
    setCode('');
  }

  async function submitPasswordAction(e) {
    e.preventDefault();
    setErr(''); setBusy(true);
    try {
      if (pending === 'disable') {
        await api.post('/auth/mfa/disable', { password });
        setPending(null); setPassword('');
        await loadStatus();
      } else if (pending === 'regenerate') {
        const { data } = await api.post('/auth/mfa/recovery-codes/regenerate', { password });
        setRecoveryCodes(data.recovery_codes);
        setStep('recovery');
        setPending(null); setPassword('');
      }
    } catch (e) {
      setErr(e.response?.data?.error || 'Action failed.');
    } finally { setBusy(false); }
  }

  if (loading) return <div className="empty-state">Loading…</div>;

  return (
    <div>
      <PageHeader title="My Account" subtitle="Manage your own sign-in security." />

      <div className="card">
        <div className="card-body">
          <h5 className="fw-semibold mb-1">Two-factor authentication</h5>
          <p className="text-muted small mb-3">
            Require a code from an authenticator app (Google Authenticator, Authy, 1Password, etc.)
            in addition to your password when signing in.
          </p>

          {err && <div className="alert alert-danger py-2 mb-3">{err}</div>}

          {/* ── Not enrolled, no flow started ── */}
          {!step && status?.enrolled === false && (
            <div className="d-flex align-items-center justify-content-between">
              <span className="badge bg-secondary-subtle text-secondary-emphasis">Not enabled</span>
              <button className="btn btn-primary" onClick={startSetup} disabled={busy}>
                {status.pendingSetup ? 'Resume setup' : 'Enable two-factor authentication'}
              </button>
            </div>
          )}

          {/* ── Enrolled, no flow started ── */}
          {!step && status?.enrolled === true && (
            <div>
              <div className="d-flex align-items-center justify-content-between mb-3">
                <span className="badge bg-success-subtle text-success-emphasis">Enabled</span>
                <div className="d-flex gap-2">
                  <button className="btn btn-outline-secondary btn-sm" onClick={() => { setPending('regenerate'); setErr(''); }}>
                    Regenerate recovery codes
                  </button>
                  <button className="btn btn-outline-danger btn-sm" onClick={() => { setPending('disable'); setErr(''); }}>
                    Disable
                  </button>
                </div>
              </div>

              {pending && (
                <form onSubmit={submitPasswordAction} className="border rounded p-3 bg-light">
                  <label className="form-label fw-semibold">
                    Confirm your password to {pending === 'disable' ? 'disable two-factor authentication' : 'regenerate your recovery codes'}
                  </label>
                  <div className="d-flex gap-2">
                    <input
                      type="password"
                      className="form-control"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      autoComplete="current-password"
                      autoFocus
                      required
                    />
                    <button type="submit" className={`btn btn-${pending === 'disable' ? 'danger' : 'primary'}`} disabled={busy}>
                      {busy ? 'Working…' : 'Confirm'}
                    </button>
                    <button type="button" className="btn btn-outline-secondary" onClick={() => { setPending(null); setPassword(''); setErr(''); }}>
                      Cancel
                    </button>
                  </div>
                  {pending === 'regenerate' && (
                    <p className="text-muted small mt-2 mb-0">Your existing recovery codes will stop working.</p>
                  )}
                </form>
              )}
            </div>
          )}

          {/* ── Setup: show QR code, ask for the first code ── */}
          {step === 'setup' && setupData && (
            <form onSubmit={confirmSetup}>
              <ol className="ps-3">
                <li className="mb-2">
                  Scan this QR code with your authenticator app:
                  <div className="my-3">
                    <img src={setupData.qr_data_url} alt="TOTP QR code" width={200} height={200} style={{ border: '1px solid var(--bs-border-color)', borderRadius: 8 }} />
                  </div>
                  <p className="text-muted small">
                    Can't scan? Enter this code manually: <code>{setupData.secret}</code>
                  </p>
                </li>
                <li>
                  <label className="form-label fw-semibold">Enter the 6-digit code from the app</label>
                  <input
                    type="text"
                    className="form-control"
                    style={{ maxWidth: 200, letterSpacing: '0.3em', fontSize: '1.25rem' }}
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    inputMode="numeric"
                    placeholder="123456"
                    autoFocus
                    required
                  />
                </li>
              </ol>
              <div className="d-flex gap-2">
                <button type="submit" className="btn btn-primary" disabled={busy || !code}>
                  {busy ? 'Verifying…' : 'Verify and enable'}
                </button>
                <button type="button" className="btn btn-outline-secondary" onClick={finishEnrollment}>Cancel</button>
              </div>
            </form>
          )}

          {/* ── Recovery codes (shown once, after confirm OR regenerate) ── */}
          {step === 'recovery' && recoveryCodes && (
            <div>
              <div className="alert alert-warning">
                Save these recovery codes somewhere safe — each one can be used once to sign in if you
                lose access to your authenticator app. <strong>They will not be shown again.</strong>
              </div>
              <div className="row row-cols-2 g-2 mb-3">
                {recoveryCodes.map((c) => (
                  <div key={c} className="col">
                    <code className="d-block p-2 bg-light rounded text-center">{c}</code>
                  </div>
                ))}
              </div>
              <button className="btn btn-primary" onClick={finishEnrollment}>Done</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
