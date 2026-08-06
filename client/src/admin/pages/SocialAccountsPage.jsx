import { useState, useEffect, useCallback } from 'react';
import api from '../../api/client.js';
import PageHeader from '../../components/PageHeader.jsx';

const PLATFORMS = [
  { value: 'facebook',  label: 'Facebook',  icon: 'logos:facebook',        color: '#1877F2', desc: 'Pages & Profiles' },
  { value: 'instagram', label: 'Instagram', icon: 'skill-icons:instagram',  color: '#E1306C', desc: 'Business Accounts' },
  { value: 'linkedin',  label: 'LinkedIn',  icon: 'logos:linkedin-icon',    color: '#0A66C2', desc: 'Company Pages' },
];

const emptyForm = {
  platform:     'facebook',
  account_name: '',
  account_id:   '',
  access_token: '',
  page_id:      '',
  page_name:    '',
  token_expiry: '',
};

export default function SocialAccountsPage() {
  const [accounts, setAccounts]     = useState([]);
  const [loading, setLoading]       = useState(false);
  const [showModal, setShowModal]   = useState(false);
  const [form, setForm]             = useState(emptyForm);
  const [saving, setSaving]         = useState(false);
  const [err, setErr]               = useState('');
  const [toast, setToast]           = useState('');
  const [disconnecting, setDisconnecting] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/social/accounts');
      setAccounts(data || []);
    } catch (e) {
      console.error(e);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  function showToast(msg) {
    setToast(msg);
    setTimeout(() => setToast(''), 3500);
  }

  function openModal() {
    setForm(emptyForm);
    setErr('');
    setShowModal(true);
  }

  function closeModal() {
    setShowModal(false);
    setErr('');
  }

  function setField(key, value) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function validate() {
    if (!form.platform) return 'Select a platform.';
    if (!form.account_name.trim()) return 'Account name is required.';
    if (!form.account_id.trim()) return 'Account / App ID is required.';
    return null;
  }

  async function handleSave(e) {
    e.preventDefault();
    setErr('');
    const v = validate();
    if (v) { setErr(v); return; }
    setSaving(true);
    try {
      const payload = {
        platform:     form.platform,
        account_name: form.account_name.trim(),
        account_id:   form.account_id.trim(),
        access_token: form.access_token.trim() || null,
        page_id:      form.page_id.trim() || null,
        page_name:    form.page_name.trim() || null,
        token_expiry: form.token_expiry || null,
      };
      await api.post('/social/accounts', payload);
      showToast('Account connected successfully.');
      closeModal();
      load();
    } catch (ex) {
      setErr(ex.response?.data?.error || ex.message || 'Save failed');
    } finally { setSaving(false); }
  }

  async function disconnect(id, name) {
    if (!window.confirm(`Disconnect "${name}"? This will not delete any posts.`)) return;
    setDisconnecting(id);
    try {
      await api.delete(`/social/accounts/${id}`);
      showToast('Account disconnected.');
      load();
    } catch (e) {
      showToast(e.response?.data?.error || 'Disconnect failed');
    } finally { setDisconnecting(null); }
  }

  // Group by platform for the status cards
  const byPlatform = PLATFORMS.map((p) => ({
    ...p,
    connected: accounts.filter((a) => a.platform === p.value),
  }));

  return (
    <div>
      <PageHeader
        title="Connected Accounts"
        subtitle="Manage your social media account connections"
        actions={(
          <button className="btn btn-primary" onClick={openModal}>
            <iconify-icon icon="solar:add-circle-line-duotone" class="me-1"></iconify-icon>
            Connect Account
          </button>
        )}
      />

      {toast && (
        <div className="alert alert-info alert-dismissible py-2">
          {toast}
          <button type="button" className="btn-close py-2" onClick={() => setToast('')} />
        </div>
      )}

      {/* OAuth note */}
      <div className="alert alert-info d-flex align-items-start gap-2 mb-3">
        <iconify-icon icon="solar:info-circle-line-duotone" style={{ fontSize: '1.25rem', flexShrink: 0, marginTop: 2 }}></iconify-icon>
        <div>
          <strong>OAuth flow coming soon</strong> — enter credentials manually for now. Your access token is stored encrypted and is never exposed in the UI after saving.
        </div>
      </div>

      {/* Platform status cards */}
      <div className="row g-3 mb-4">
        {byPlatform.map((p) => (
          <div key={p.value} className="col-md-4">
            <div className="card h-100">
              <div className="card-body">
                <div className="d-flex align-items-center gap-2 mb-2">
                  <iconify-icon icon={p.icon} style={{ fontSize: '1.75rem' }}></iconify-icon>
                  <div>
                    <div className="fw-semibold">{p.label}</div>
                    <div className="text-muted small">{p.desc}</div>
                  </div>
                  <div className="ms-auto">
                    {p.connected.length > 0
                      ? <span className="badge bg-success">{p.connected.length} connected</span>
                      : <span className="badge bg-secondary">Not connected</span>}
                  </div>
                </div>
                {p.connected.length > 0 && (
                  <ul className="list-unstyled mb-0 small">
                    {p.connected.map((a) => (
                      <li key={a.id} className="text-muted">
                        <iconify-icon icon="solar:check-circle-line-duotone" class="text-success me-1"></iconify-icon>
                        {a.account_name}{a.page_name ? ` / ${a.page_name}` : ''}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div className="card-footer py-2">
                <button className="btn btn-sm btn-light w-100" onClick={openModal}>
                  <iconify-icon icon="solar:add-circle-line-duotone" class="me-1"></iconify-icon>
                  Add {p.label} account
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Connected accounts table */}
      <div className="card">
        <div className="card-header">
          <h6 className="mb-0">All Connected Accounts</h6>
        </div>
        <div className="table-responsive">
          <table className="table table-hover align-middle mb-0">
            <thead className="table-light">
              <tr>
                <th style={{ width: 40 }}>Platform</th>
                <th>Account Name</th>
                <th>Page / Profile</th>
                <th style={{ width: 180 }}>Connected</th>
                <th style={{ width: 100 }}>Status</th>
                <th style={{ width: 100 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={6} className="text-center text-muted py-4">Loading…</td></tr>
              )}
              {!loading && accounts.length === 0 && (
                <tr>
                  <td colSpan={6} className="text-center text-muted py-4">
                    No accounts connected yet.{' '}
                    <button className="btn btn-link p-0" onClick={openModal}>Connect one now</button>
                  </td>
                </tr>
              )}
              {!loading && accounts.map((a) => {
                const plat = PLATFORMS.find((p) => p.value === a.platform);
                return (
                  <tr key={a.id}>
                    <td className="text-center">
                      {plat && <iconify-icon icon={plat.icon} title={plat.label} style={{ fontSize: '1.2rem' }}></iconify-icon>}
                    </td>
                    <td className="fw-semibold small">{a.account_name}</td>
                    <td className="small text-muted">{a.page_name || '—'}</td>
                    <td className="small text-muted">
                      {a.connected_at ? new Date(a.connected_at).toLocaleDateString() : '—'}
                      {a.token_expiry && (
                        <div style={{ fontSize: '0.7rem' }} className="text-warning">
                          Expires {new Date(a.token_expiry).toLocaleDateString()}
                        </div>
                      )}
                    </td>
                    <td>
                      <span className={`badge bg-${a.is_active ? 'success' : 'secondary'}`}>
                        {a.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td>
                      <button
                        className="btn btn-sm btn-outline-danger"
                        disabled={disconnecting === a.id}
                        onClick={() => disconnect(a.id, a.account_name)}
                        title="Disconnect"
                      >
                        {disconnecting === a.id
                          ? <span className="spinner-border spinner-border-sm"></span>
                          : <iconify-icon icon="solar:link-broken-line-duotone"></iconify-icon>}
                        {' '}Disconnect
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* ---- Connect Account Modal ---- */}
      {showModal && (
        <div className="modal d-block" tabIndex="-1" style={{ background: 'rgba(0,0,0,0.5)' }}>
          <div className="modal-dialog modal-lg">
            <form className="modal-content" onSubmit={handleSave}>
              <div className="modal-header">
                <h5 className="modal-title">Connect Social Account</h5>
                <button type="button" className="btn-close" onClick={closeModal} />
              </div>
              <div className="modal-body">
                {err && <div className="alert alert-danger py-2">{err}</div>}

                <div className="row g-3">
                  <div className="col-md-6">
                    <label className="form-label">Platform <span className="text-danger">*</span></label>
                    <select className="form-select" value={form.platform}
                      onChange={(e) => setField('platform', e.target.value)}>
                      {PLATFORMS.map((p) => (
                        <option key={p.value} value={p.value}>{p.label}</option>
                      ))}
                    </select>
                  </div>
                  <div className="col-md-6">
                    <label className="form-label">Account Name <span className="text-danger">*</span></label>
                    <input className="form-control" value={form.account_name}
                      onChange={(e) => setField('account_name', e.target.value)}
                      placeholder="My Business Page" />
                  </div>
                  <div className="col-md-6">
                    <label className="form-label">Account / App ID <span className="text-danger">*</span></label>
                    <input className="form-control font-monospace" value={form.account_id}
                      onChange={(e) => setField('account_id', e.target.value)}
                      placeholder="1234567890" />
                    <div className="form-text">Your platform app or user ID.</div>
                  </div>
                  <div className="col-md-6">
                    <label className="form-label">Page / Profile Name</label>
                    <input className="form-control" value={form.page_name}
                      onChange={(e) => setField('page_name', e.target.value)}
                      placeholder="My Page Name" />
                  </div>
                  <div className="col-md-6">
                    <label className="form-label">Page ID</label>
                    <input className="form-control font-monospace" value={form.page_id}
                      onChange={(e) => setField('page_id', e.target.value)}
                      placeholder="page ID if different from account ID" />
                  </div>
                  <div className="col-md-6">
                    <label className="form-label">Token Expiry (optional)</label>
                    <input type="date" className="form-control" value={form.token_expiry}
                      onChange={(e) => setField('token_expiry', e.target.value)} />
                  </div>
                  <div className="col-12">
                    <label className="form-label">Access Token</label>
                    <input type="password" className="form-control font-monospace" value={form.access_token}
                      onChange={(e) => setField('access_token', e.target.value)}
                      placeholder="Paste your access token here" autoComplete="new-password" />
                    <div className="form-text">
                      Stored securely. Will not be shown again after saving.
                    </div>
                  </div>
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-light" onClick={closeModal}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={saving}>
                  {saving ? 'Connecting…' : 'Connect Account'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
