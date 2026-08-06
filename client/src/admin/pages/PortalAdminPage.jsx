// =============================================================================
// Admin-side portal user management — /admin/portal
// Creates/revokes "portal" role users tied to a Contact.
// =============================================================================
import { useEffect, useState } from 'react';
import api from '../../api/client.js';
import PageHeader from '../../components/PageHeader.jsx';
import Modal from '../../components/Modal.jsx';
import FormErrorBanner from '../../components/FormErrorBanner.jsx';
import { useConfirm } from '../../hooks/useConfirm.jsx';
import { toast } from '../../components/Toast.jsx';
import { parseApiError } from '../../utils/apiError.js';

export default function PortalAdminPage() {
  const { confirm, dialog: confirmDialog } = useConfirm();
  const [rows, setRows] = useState([]);
  const [contacts, setContacts] = useState([]);
  const [show, setShow] = useState(false);
  const [form, setForm] = useState({ contact_id: '', send_invite: true });
  const [created, setCreated] = useState(null);
  const [formError, setFormError] = useState('');

  async function load() {
    const { data } = await api.get('/portal/admin/users');
    setRows(data.rows);
  }
  useEffect(() => { load().catch(() => {}); }, []);
  useEffect(() => {
    api.get('/contacts', { params: { pageSize: 500 } }).then((r) => setContacts(r.data.rows)).catch(() => {});
  }, []);

  async function create() {
    setFormError('');
    if (!form.contact_id) { setFormError('Pick a contact first.'); return; }
    try {
      const { data } = await api.post('/portal/admin/users', {
        contact_id: Number(form.contact_id),
        send_invite: !!form.send_invite,
      });
      setCreated(data);
      setShow(false);
      setForm({ contact_id: '', send_invite: true });
      load();
    } catch (e) {
      setFormError(parseApiError(e, 'Failed to create portal user.'));
    }
  }

  async function revoke(id) {
    if (!(await confirm('Revoke portal access for this user? They will no longer be able to sign in.', {
      danger: true, confirmLabel: 'Revoke access',
    }))) return;
    try {
      await api.delete(`/portal/admin/users/${id}`);
      load();
    } catch (e) {
      toast(parseApiError(e), 'error');
    }
  }

  return (
    <div>
      <PageHeader title="Portal Users"
        subtitle="Customer-facing accounts that can log in to view their invoices and pay online"
        actions={<button className="btn btn-primary" onClick={() => { setFormError(''); setShow(true); }}>
          <iconify-icon icon="solar:add-circle-line-duotone" class="me-1"></iconify-icon> Invite Customer
        </button>} />

      {created && (
        <div className="alert alert-success">
          <strong>Portal user created.</strong> Temporary password: <code>{created.temp_password}</code>
          {' '}— share this securely if the invite email didn't send.
          <button className="btn-close float-end" onClick={() => setCreated(null)}></button>
        </div>
      )}

      <div className="card">
        <div className="card-body">
          <div className="table-responsive">
            <table className="table table-hover align-middle mb-0">
              <thead>
                <tr>
                  <th>Email</th><th>Contact</th><th>Organization</th>
                  <th>Last login</th><th>Status</th><th></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((u) => (
                  <tr key={u.id}>
                    <td className="fw-semibold">{u.email}</td>
                    <td>{u.linked_contact_name || '—'}</td>
                    <td>{u.organization_name || '—'}</td>
                    <td>{u.last_login_at ? new Date(u.last_login_at).toLocaleString() : <span className="text-muted">never</span>}</td>
                    <td>
                      <span className={`badge bg-${u.is_active ? 'success' : 'secondary'}-subtle text-${u.is_active ? 'success' : 'secondary'}`}>
                        {u.is_active ? 'active' : 'revoked'}
                      </span>
                    </td>
                    <td>
                      {u.is_active && (
                        <button className="btn btn-sm btn-light text-danger" onClick={() => revoke(u.id)}>
                          Revoke
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                {rows.length === 0 && <tr><td colSpan="6"><div className="empty-state">No portal users yet.</div></td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <Modal show={show} onClose={() => setShow(false)} title="Invite Customer to Portal"
        footer={<><button className="btn btn-light" onClick={() => setShow(false)}>Cancel</button>
                  <button className="btn btn-primary" onClick={create}>Create & Invite</button></>}>
        <FormErrorBanner error={formError} />
        <p className="text-muted small">
          The customer will be able to sign in at <code>/portal/login</code> to view their invoices,
          pay balances, and update their profile. They'll only see records tied to their contact.
        </p>
        <label className="form-label">Contact</label>
        <select className="form-select" value={form.contact_id} onChange={(e) => setForm({ ...form, contact_id: e.target.value })}>
          <option value="">— pick a contact —</option>
          {contacts.filter((c) => c.email).map((c) => (
            <option key={c.id} value={c.id}>
              {c.first_name} {c.last_name} · {c.email}
            </option>
          ))}
        </select>
        <div className="form-check mt-3">
          <input type="checkbox" className="form-check-input" id="sendInvite"
            checked={!!form.send_invite}
            onChange={(e) => setForm({ ...form, send_invite: e.target.checked })} />
          <label className="form-check-label" htmlFor="sendInvite">
            Email the customer their sign-in credentials
          </label>
        </div>
      </Modal>
      {confirmDialog}
    </div>
  );
}
