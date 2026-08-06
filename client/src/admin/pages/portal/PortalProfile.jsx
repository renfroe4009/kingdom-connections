import { useEffect, useState } from 'react';
import api from '../../../api/client.js';
import PhoneInput from '../../../components/PhoneInput.jsx';

const pwdDefault = { current_password: '', new_password: '', confirm_password: '' };

export default function PortalProfile() {
  const [form, setForm] = useState(null);
  const [org, setOrg] = useState(null);
  const [msg, setMsg] = useState('');

  const [pwd, setPwd]       = useState(pwdDefault);
  const [pwdMsg, setPwdMsg] = useState('');
  const [pwdBusy, setPwdBusy] = useState(false);

  async function load() {
    const { data } = await api.get('/portal/me');
    if (data.contact) {
      setForm({
        first_name: data.contact.first_name || '',
        last_name:  data.contact.last_name  || '',
        phone:      data.contact.phone      || '',
        mobile:     data.contact.mobile     || '',
        address_line1: data.contact.address_line1 || '',
        address_line2: data.contact.address_line2 || '',
        city:       data.contact.city        || '',
        state:      data.contact.state       || '',
        postal_code: data.contact.postal_code || '',
        country:    data.contact.country     || '',
      });
    }
    setOrg(data.organization || null);
  }
  useEffect(() => { load().catch(() => {}); }, []);

  async function save() {
    setMsg('');
    try {
      await api.put('/portal/me/profile', form);
      setMsg('Profile saved.');
    } catch (e) {
      setMsg(e.response?.data?.error || 'Save failed.');
    }
  }

  async function changePassword(e) {
    e.preventDefault();
    setPwdMsg(''); setPwdBusy(true);
    try {
      await api.put('/portal/me/password', pwd);
      setPwd(pwdDefault);
      setPwdMsg('success:Password updated successfully.');
    } catch (e) {
      setPwdMsg('error:' + (e.response?.data?.error || 'Password change failed.'));
    } finally { setPwdBusy(false); }
  }

  if (!form) return <div className="empty-state">Loading…</div>;

  const [pwdMsgType, pwdMsgText] = pwdMsg.startsWith('success:')
    ? ['success', pwdMsg.slice(8)]
    : pwdMsg.startsWith('error:')
      ? ['danger', pwdMsg.slice(6)]
      : [null, ''];

  return (
    <div>
      <h3 className="fw-bolder mb-1">My Profile</h3>
      <p className="text-muted">Keep your contact information up to date.</p>

      {msg && <div className="alert alert-info">{msg}</div>}

      {org && (
        <div className="alert alert-light">
          <strong>Organization:</strong> {org.name}
        </div>
      )}

      <div className="card mb-4">
        <div className="card-body">
          <div className="row g-2">
            <div className="col-md-6"><label className="form-label">First name</label>
              <input className="form-control" value={form.first_name} onChange={(e) => setForm({ ...form, first_name: e.target.value })} /></div>
            <div className="col-md-6"><label className="form-label">Last name</label>
              <input className="form-control" value={form.last_name} onChange={(e) => setForm({ ...form, last_name: e.target.value })} /></div>
            <div className="col-md-6"><label className="form-label">Phone</label>
              <PhoneInput value={form.phone} onChange={(v) => setForm({ ...form, phone: v })} /></div>
            <div className="col-md-6"><label className="form-label">Mobile</label>
              <PhoneInput value={form.mobile} onChange={(v) => setForm({ ...form, mobile: v })} /></div>
            <div className="col-md-12"><label className="form-label">Address line 1</label>
              <input className="form-control" value={form.address_line1} onChange={(e) => setForm({ ...form, address_line1: e.target.value })} /></div>
            <div className="col-md-12"><label className="form-label">Address line 2</label>
              <input className="form-control" value={form.address_line2} onChange={(e) => setForm({ ...form, address_line2: e.target.value })} /></div>
            <div className="col-md-5"><label className="form-label">City</label>
              <input className="form-control" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} /></div>
            <div className="col-md-3"><label className="form-label">State</label>
              <input className="form-control" value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value })} /></div>
            <div className="col-md-2"><label className="form-label">ZIP</label>
              <input className="form-control" value={form.postal_code} onChange={(e) => setForm({ ...form, postal_code: e.target.value })} /></div>
            <div className="col-md-2"><label className="form-label">Country</label>
              <input className="form-control" value={form.country} onChange={(e) => setForm({ ...form, country: e.target.value })} /></div>
          </div>
          <div className="d-flex justify-content-end mt-3">
            <button className="btn btn-primary" onClick={save}>Save changes</button>
          </div>
        </div>
      </div>

      <h5 className="fw-semibold mb-1">Change Password</h5>
      <p className="text-muted small mb-3">Choose a strong password — at least 8 characters.</p>

      <div className="card">
        <div className="card-body">
          <form onSubmit={changePassword}>
            {pwdMsg && <div className={`alert alert-${pwdMsgType} py-2 mb-3`}>{pwdMsgText}</div>}
            <div className="mb-3">
              <label className="form-label fw-semibold">Current password</label>
              <input
                type="password"
                className="form-control"
                value={pwd.current_password}
                onChange={(e) => setPwd({ ...pwd, current_password: e.target.value })}
                autoComplete="current-password"
                required
              />
            </div>
            <div className="mb-3">
              <label className="form-label fw-semibold">New password</label>
              <input
                type="password"
                className="form-control"
                value={pwd.new_password}
                onChange={(e) => setPwd({ ...pwd, new_password: e.target.value })}
                autoComplete="new-password"
                required
                minLength={8}
              />
            </div>
            <div className="mb-3">
              <label className="form-label fw-semibold">Confirm new password</label>
              <input
                type="password"
                className="form-control"
                value={pwd.confirm_password}
                onChange={(e) => setPwd({ ...pwd, confirm_password: e.target.value })}
                autoComplete="new-password"
                required
              />
            </div>
            <div className="d-flex justify-content-end">
              <button type="submit" className="btn btn-primary" disabled={pwdBusy}>
                {pwdBusy ? 'Saving…' : 'Update password'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
