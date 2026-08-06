import { useState } from 'react';
import api from '../../api/client.js';
import PhoneInput from '../../components/PhoneInput.jsx';

/**
 * Inline "quick-create contact" panel.
 *
 * Props:
 *   onCreated(contact)  — called with the new contact after a successful save
 *   onCancel()          — called when the user dismisses the panel
 *   organizationId      — optional; pre-binds the new contact to this org
 */
export default function QuickCreateContact({ onCreated, onCancel, organizationId }) {
  const [form, setForm] = useState({ first_name: '', last_name: '', email: '', phone: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState('');

  function set(field) {
    return (e) => setForm((f) => ({ ...f, [field]: e.target.value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.first_name.trim()) { setError('First name is required.'); return; }

    setSaving(true);
    setError('');
    try {
      const payload = {
        first_name:      form.first_name.trim(),
        last_name:       form.last_name.trim()  || null,
        email:           form.email.trim()      || null,
        phone:           form.phone.trim()      || null,
        organization_id: organizationId         || null,
      };
      const { data } = await api.post('/contacts', payload);
      onCreated({
        id:              data.id,
        first_name:      payload.first_name,
        last_name:       payload.last_name,
        email:           payload.email,
        phone:           payload.phone,
        organization_id: payload.organization_id,
      });
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to create contact.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="border rounded p-3 mt-2 bg-body-tertiary">
      <div className="d-flex align-items-center gap-2 mb-2">
        <iconify-icon icon="solar:user-plus-rounded-line-duotone" class="fs-6" style={{ color: 'var(--secondary)' }}></iconify-icon>
        <strong className="small">New Contact</strong>
      </div>
      <form onSubmit={handleSubmit}>
        <div className="row g-2">
          <div className="col-md-6">
            <input
              className="form-control form-control-sm"
              placeholder="First name *"
              value={form.first_name}
              onChange={set('first_name')}
              autoFocus
            />
          </div>
          <div className="col-md-6">
            <input
              className="form-control form-control-sm"
              placeholder="Last name"
              value={form.last_name}
              onChange={set('last_name')}
            />
          </div>
          <div className="col-md-6">
            <input
              type="email"
              className="form-control form-control-sm"
              placeholder="Email"
              value={form.email}
              onChange={set('email')}
            />
          </div>
          <div className="col-md-6">
            <PhoneInput
              className="form-control form-control-sm"
              placeholder="Phone (optional)"
              value={form.phone}
              onChange={(v) => setForm((f) => ({ ...f, phone: v }))}
            />
          </div>
        </div>
        {error && <div className="text-danger small mt-1">{error}</div>}
        <div className="d-flex gap-2 mt-2">
          <button type="submit" className="btn btn-primary btn-sm" disabled={saving}>
            {saving
              ? <><span className="spinner-border spinner-border-sm me-1" />Creating…</>
              : <>Create &amp; Select</>}
          </button>
          <button type="button" className="btn btn-outline-secondary btn-sm" onClick={onCancel} disabled={saving}>
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
