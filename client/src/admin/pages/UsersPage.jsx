import { useEffect, useState } from 'react';
import api from '../../api/client.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import PageHeader from '../../components/PageHeader.jsx';
import Modal from '../../components/Modal.jsx';
import PhoneInput from '../../components/PhoneInput.jsx';
import { useConfirm } from '../../hooks/useConfirm.jsx';
import { toast } from '../../components/Toast.jsx';
import { parseApiError } from '../../utils/apiError.js';

const empty = { email: '', first_name: '', last_name: '', password: '', phone: '', role_ids: [], manager_id: '', cw_member_id: '' };
const emptyInvite = { email: '', first_name: '', last_name: '', phone: '', role_ids: [], expires_in_days: 14 };

export default function UsersPage() {
  const { can, impersonate } = useAuth();
  const { confirm, dialog: confirmDialog } = useConfirm();
  const [rows, setRows] = useState([]);
  const [roles, setRoles] = useState([]);
  const [invites, setInvites] = useState([]);
  const [scopeIds, setScopeIds] = useState(null); // IDs the current user can impersonate
  const [show, setShow] = useState(false);
  const [form, setForm] = useState(empty);
  const [editId, setEditId] = useState(null);
  const [cwActive, setCwActive] = useState(false);
  const [cwVerifying, setCwVerifying] = useState(false);
  const [cwVerifyMsg, setCwVerifyMsg] = useState('');
  const [inviteShow, setInviteShow] = useState(false);
  const [inviteForm, setInviteForm] = useState(emptyInvite);
  const [lastInvite, setLastInvite] = useState(null);
  const [inviteErr, setInviteErr] = useState('');
  const [copyMsg, setCopyMsg] = useState('');
  const [saveErr, setSaveErr] = useState('');
  const [saving, setSaving] = useState(false);

  async function load() {
    const [u, r] = await Promise.all([api.get('/users'), api.get('/roles')]);
    setRows(u.data); setRoles(r.data);
    try { const inv = await api.get('/invites'); setInvites(inv.data); } catch { setInvites([]); }
    try { const cw = await api.get('/connectwise/active'); setCwActive(!!cw.data?.active); } catch { /* no CW */ }
    // Load the manager's reportable scope (used to decide who can be impersonated)
    if (can('users.impersonate')) {
      try {
        const { data } = await api.get('/users/me/reports');
        setScopeIds(data.map((r) => r.id));
      } catch { setScopeIds([]); }
    }
  }
  useEffect(() => { load(); }, []);

  function openNew() { setEditId(null); setForm(empty); setSaveErr(''); setShow(true); }
  function openEdit(u) {
    setEditId(u.id);
    const roleNameToId = new Map(roles.map((r) => [r.name, r.id]));
    const currentRoleIds = (u.roles || []).map((r) => (typeof r === 'string' ? roleNameToId.get(r) : r?.id)).filter(Boolean);
    setForm({
      email: u.email, first_name: u.first_name, last_name: u.last_name, password: '', phone: u.phone || '',
      role_ids: currentRoleIds, manager_id: u.manager_id ?? '', cw_member_id: u.cw_member_id || '',
    });
    setCwVerifyMsg('');
    setSaveErr('');
    setShow(true);
  }

  async function doImpersonate(u) {
    try {
      await impersonate(u.id);
    } catch (e) {
      toast(parseApiError(e, 'Could not start impersonation'), 'error');
    }
  }

  async function verifyCwMember() {
    if (!form.cw_member_id.trim()) return;
    setCwVerifying(true); setCwVerifyMsg('');
    try {
      const { data } = await api.get(`/connectwise/members/${encodeURIComponent(form.cw_member_id.trim())}`);
      setCwVerifyMsg(`✓ Found: ${data.member?.name || form.cw_member_id}`);
    } catch (e) {
      setCwVerifyMsg(e.response?.data?.error || 'Member not found');
    } finally { setCwVerifying(false); }
  }

  async function save() {
    setSaveErr('');
    setSaving(true);
    try {
      const payload = {
        ...form,
        role_ids: form.role_ids.map(Number),
        manager_id: form.manager_id ? Number(form.manager_id) : null,
        cw_member_id: form.cw_member_id || null,
      };
      if (editId) {
        if (!payload.password) delete payload.password;
        await api.put(`/users/${editId}`, payload);
      } else {
        await api.post('/users', payload);
      }
      setShow(false); setForm(empty); setEditId(null); load();
    } catch (e) {
      const msg = e.response?.data?.issues?.[0]?.message || e.response?.data?.error || e.message || 'Save failed';
      setSaveErr(msg);
    } finally {
      setSaving(false);
    }
  }

  async function deactivate(u) {
    const willDeactivate = u.is_active;
    if (!(await confirm(`${willDeactivate ? 'Deactivate' : 'Activate'} ${u.first_name} ${u.last_name}?`, {
      danger: willDeactivate,
      confirmLabel: willDeactivate ? 'Deactivate' : 'Activate',
    }))) return;
    try {
      await api.put(`/users/${u.id}`, { is_active: !u.is_active });
      load();
    } catch (e) {
      toast(parseApiError(e), 'error');
    }
  }

  function toggleRole(rid, which = 'form') {
    const stateSetter = which === 'form' ? setForm : setInviteForm;
    stateSetter((f) => {
      const has = f.role_ids.includes(rid);
      return { ...f, role_ids: has ? f.role_ids.filter((x) => x !== rid) : [...f.role_ids, rid] };
    });
  }

  function openInvite() {
    setInviteForm(emptyInvite);
    setLastInvite(null);
    setInviteErr('');
    setInviteShow(true);
  }

  async function sendInvite() {
    setInviteErr('');
    try {
      const { data } = await api.post('/invites', {
        ...inviteForm,
        role_ids: inviteForm.role_ids.map(Number),
        expires_in_days: Number(inviteForm.expires_in_days) || 14,
      });
      setLastInvite(data);
      load();
    } catch (e) {
      setInviteErr(e.response?.data?.error || e.message);
    }
  }

  async function resendInvite(i) {
    try {
      const { data } = await api.post(`/invites/${i.id}/resend`);
      setLastInvite(data);
      setInviteShow(true);
      load();
    } catch (e) {
      toast(parseApiError(e, 'Resend failed'), 'error');
    }
  }

  async function revokeInvite(i) {
    if (!(await confirm(`Revoke invite for ${i.email}?`, { danger: true, confirmLabel: 'Revoke' }))) return;
    try {
      await api.delete(`/invites/${i.id}`);
      load();
    } catch (e) {
      toast(parseApiError(e), 'error');
    }
  }

  async function copyLink(url) {
    try {
      await navigator.clipboard.writeText(url);
      setCopyMsg('Link copied');
      setTimeout(() => setCopyMsg(''), 2000);
    } catch {
      setCopyMsg('Copy failed — select the link and copy manually');
    }
  }

  return (
    <div>
      <PageHeader title="Users" subtitle={`${rows.length} users · ${invites.length} pending invite${invites.length === 1 ? '' : 's'}`}
        actions={
          <>
            <button className="btn btn-light" onClick={openInvite}>
              <iconify-icon icon="solar:letter-line-duotone" class="me-1"></iconify-icon> Invite
            </button>
            <button className="btn btn-primary ms-2" onClick={openNew}>
              <iconify-icon icon="solar:user-plus-line-duotone" class="me-1"></iconify-icon> New User
            </button>
          </>
        } />

      {copyMsg && <div className="alert alert-success py-2">{copyMsg}</div>}

      <div className="card mb-3">
        <div className="card-body">
          <h6 className="fw-bold text-uppercase small text-muted mb-3">Users</h6>
          <div className="table-responsive">
            <table className="table table-hover align-middle mb-0">
              <thead><tr><th>Name</th><th>Email</th><th>Roles</th><th>Manager</th>{cwActive && <th>CW Member</th>}<th>Status</th><th className="text-end">Actions</th></tr></thead>
              <tbody>
                {rows.map((u) => (
                  <tr key={u.id}>
                    <td>
                      <div className="d-flex align-items-center gap-2">
                        <div className="avatar-initials">{(u.first_name?.[0] || '') + (u.last_name?.[0] || '')}</div>
                        <div>
                          <div className="fw-semibold">{u.first_name} {u.last_name}</div>
                          <small className="text-muted">{u.phone || ''}</small>
                        </div>
                      </div>
                    </td>
                    <td>{u.email}</td>
                    <td>
                      {(u.roles || []).map((r) => <span key={r.id || r} className="badge bg-primary-subtle text-primary me-1">{r.name || r}</span>)}
                    </td>
                    <td><span className="text-muted small">{u.manager_name || '—'}</span></td>
                    {cwActive && <td><span className="text-muted small font-monospace">{u.cw_member_id || '—'}</span></td>}
                    <td>{u.is_active ? <span className="badge bg-success-subtle text-success">Active</span> : <span className="badge bg-secondary-subtle text-secondary">Inactive</span>}</td>
                    <td className="text-end">
                      {scopeIds?.includes(u.id) && (
                        <button
                          className="btn btn-sm btn-warning me-1"
                          title="View as this user"
                          onClick={() => doImpersonate(u)}
                        >
                          <iconify-icon icon="solar:eye-line-duotone" class="me-1"></iconify-icon>
                          View as
                        </button>
                      )}
                      <button className="btn btn-sm btn-light me-1" onClick={() => openEdit(u)}>Edit</button>
                      <button className="btn btn-sm btn-light" onClick={() => deactivate(u)}>{u.is_active ? 'Deactivate' : 'Activate'}</button>
                    </td>
                  </tr>
                ))}
                {rows.length === 0 && <tr><td colSpan="6"><div className="empty-state">No users.</div></td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {invites.length > 0 && (
        <div className="card">
          <div className="card-body">
            <h6 className="fw-bold text-uppercase small text-muted mb-3">Pending invites</h6>
            <div className="table-responsive">
              <table className="table table-sm align-middle mb-0">
                <thead><tr><th>Email</th><th>Name</th><th>Sent</th><th>Expires</th><th className="text-end">Actions</th></tr></thead>
                <tbody>
                  {invites.map((i) => (
                    <tr key={i.id}>
                      <td className="fw-semibold">{i.email}</td>
                      <td>{[i.first_name, i.last_name].filter(Boolean).join(' ') || '—'}</td>
                      <td><small className="text-muted">{new Date(i.created_at).toLocaleString()}</small></td>
                      <td>
                        {new Date(i.expires_at) < new Date()
                          ? <span className="badge bg-danger-subtle text-danger">Expired</span>
                          : <small className="text-muted">{new Date(i.expires_at).toLocaleDateString()}</small>}
                      </td>
                      <td className="text-end">
                        <button className="btn btn-sm btn-light me-1" onClick={() => resendInvite(i)}>Resend</button>
                        <button className="btn btn-sm btn-light text-danger" onClick={() => revokeInvite(i)}>Revoke</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      <Modal show={show} onClose={() => setShow(false)} title={editId ? 'Edit User' : 'New User'}
        footer={<><button className="btn btn-light" onClick={() => setShow(false)}>Cancel</button>
                  <button className="btn btn-primary" onClick={save} disabled={saving}>
                    {saving ? <><span className="spinner-border spinner-border-sm me-1"></span>Saving…</> : 'Save'}
                  </button></>}>
        <div className="row g-2">
          <div className="col-12 col-md-6"><label className="form-label">First name</label>
            <input className="form-control" value={form.first_name} onChange={(e) => setForm({ ...form, first_name: e.target.value })} /></div>
          <div className="col-12 col-md-6"><label className="form-label">Last name</label>
            <input className="form-control" value={form.last_name} onChange={(e) => setForm({ ...form, last_name: e.target.value })} /></div>
          <div className="col-12 col-md-6"><label className="form-label">Email</label>
            <input className="form-control" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
          <div className="col-12 col-md-6"><label className="form-label">Phone</label>
            <PhoneInput value={form.phone} onChange={(v) => setForm({ ...form, phone: v })} /></div>
          <div className="col-md-12"><label className="form-label">{editId ? 'New password (leave blank to keep)' : 'Password'}</label>
            <input type="password" className="form-control" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
            {!editId && <div className="form-text">Min 12 characters, must include uppercase, lowercase, and a number.</div>}</div>
          {saveErr && <div className="col-12"><div className="alert alert-danger py-2 mb-0">{saveErr}</div></div>}
          <div className="col-md-12">
            <label className="form-label">Manager</label>
            <select className="form-select" value={form.manager_id ?? ''} onChange={(e) => setForm({ ...form, manager_id: e.target.value })}>
              <option value="">— No manager —</option>
              {rows.filter((u) => !editId || u.id !== editId).map((u) => (
                <option key={u.id} value={u.id}>{u.first_name} {u.last_name} ({u.email})</option>
              ))}
            </select>
          </div>
          {cwActive && (
            <div className="col-12">
              <label className="form-label">
                <iconify-icon icon="solar:link-circle-line-duotone" class="me-1"></iconify-icon>
                ConnectWise Member ID
              </label>
              <div className="input-group">
                <input
                  className="form-control"
                  placeholder="e.g. jsmith"
                  value={form.cw_member_id || ''}
                  onChange={(e) => { setForm({ ...form, cw_member_id: e.target.value }); setCwVerifyMsg(''); }}
                />
                <button className="btn btn-outline-secondary" type="button" disabled={cwVerifying || !form.cw_member_id} onClick={verifyCwMember}>
                  {cwVerifying ? <span className="spinner-border spinner-border-sm"></span> : 'Verify'}
                </button>
              </div>
              {cwVerifyMsg && (
                <div className={`form-text ${cwVerifyMsg.startsWith('✓') ? 'text-success' : 'text-danger'}`}>
                  {cwVerifyMsg}
                </div>
              )}
              <div className="form-text">Used as Sales Rep when pushing this user's won deals to ConnectWise. Falls back to the global setting if blank.</div>
            </div>
          )}
          <div className="col-12">
            <label className="form-label">Roles</label>
            <div className="d-flex flex-wrap gap-2">
              {roles.map((r) => (
                <label key={r.id} className={`btn btn-sm ${form.role_ids.includes(r.id) ? 'btn-primary' : 'btn-light'}`}>
                  <input type="checkbox" hidden checked={form.role_ids.includes(r.id)} onChange={() => toggleRole(r.id, 'form')} />
                  {r.name}
                </label>
              ))}
            </div>
          </div>
        </div>
      </Modal>

      <Modal show={inviteShow} onClose={() => setInviteShow(false)} title="Invite user"
        footer={
          lastInvite
            ? <><button className="btn btn-light" onClick={() => { setInviteShow(false); setLastInvite(null); }}>Close</button></>
            : <><button className="btn btn-light" onClick={() => setInviteShow(false)}>Cancel</button>
                <button className="btn btn-primary" onClick={sendInvite}>Send invite</button></>
        }>
        {!lastInvite ? (
          <div className="row g-2">
            <div className="col-12 col-md-8"><label className="form-label">Email</label>
              <input className="form-control" value={inviteForm.email} onChange={(e) => setInviteForm({ ...inviteForm, email: e.target.value })} placeholder="name@company.com" /></div>
            <div className="col-12 col-md-4"><label className="form-label">Expires (days)</label>
              <input type="number" min="1" max="90" className="form-control" value={inviteForm.expires_in_days} onChange={(e) => setInviteForm({ ...inviteForm, expires_in_days: e.target.value })} /></div>
            <div className="col-12 col-md-6"><label className="form-label">First name</label>
              <input className="form-control" value={inviteForm.first_name} onChange={(e) => setInviteForm({ ...inviteForm, first_name: e.target.value })} /></div>
            <div className="col-12 col-md-6"><label className="form-label">Last name</label>
              <input className="form-control" value={inviteForm.last_name} onChange={(e) => setInviteForm({ ...inviteForm, last_name: e.target.value })} /></div>
            <div className="col-12">
              <label className="form-label">Roles</label>
              <div className="d-flex flex-wrap gap-2">
                {roles.map((r) => (
                  <label key={r.id} className={`btn btn-sm ${inviteForm.role_ids.includes(r.id) ? 'btn-primary' : 'btn-light'}`}>
                    <input type="checkbox" hidden checked={inviteForm.role_ids.includes(r.id)} onChange={() => toggleRole(r.id, 'invite')} />
                    {r.name}
                  </label>
                ))}
              </div>
            </div>
            {inviteErr && <div className="col-12"><div className="alert alert-danger py-2 mb-0">{inviteErr}</div></div>}
            <div className="col-12">
              <small className="text-muted">
                If SMTP is configured (Settings → SMTP), the invite email is sent automatically. Otherwise you'll see a copyable link to share.
              </small>
            </div>
          </div>
        ) : (
          <div>
            <div className={`alert ${lastInvite.email_status === 'sent' ? 'alert-success' : 'alert-warning'} mb-3`}>
              {lastInvite.email_status === 'sent' && <>Invite email sent to <strong>{lastInvite.email}</strong>.</>}
              {lastInvite.email_status === 'failed' && <>Email send failed: <code>{lastInvite.email_error}</code>. Use the copyable link below.</>}
              {lastInvite.email_status === 'skipped' && <>Email was not sent. Use the copyable link below.</>}
            </div>
            <label className="form-label fw-semibold">Accept link</label>
            <div className="input-group">
              <input className="form-control font-monospace" value={lastInvite.accept_url} readOnly onFocus={(e) => e.target.select()} />
              <button className="btn btn-primary" onClick={() => copyLink(lastInvite.accept_url)}>
                <iconify-icon icon="solar:copy-line-duotone"></iconify-icon> Copy
              </button>
            </div>
            <small className="text-muted mt-2 d-block">
              Expires {new Date(lastInvite.expires_at).toLocaleString()}.
            </small>
          </div>
        )}
      </Modal>
      {confirmDialog}
    </div>
  );
}
