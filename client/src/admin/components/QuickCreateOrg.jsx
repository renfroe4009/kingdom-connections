import { useState, useEffect } from 'react';
import api from '../../api/client.js';
import PhoneInput from '../../components/PhoneInput.jsx';

/**
 * Inline "quick-create organization" panel.
 *
 * Props:
 *   onCreated(org) — called with the new org object after a successful save;
 *                    the parent should add it to its orgs list and select it.
 *   onCancel()     — called when the user dismisses the panel.
 */
export default function QuickCreateOrg({ onCreated, onCancel }) {
  const [form, setForm]   = useState({ name: '', website: '', phone: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState('');
  const [orgCfg, setOrgCfg] = useState({});

  useEffect(() => {
    api.get('/settings/module/organizations').then((r) => setOrgCfg(r.data)).catch(() => {});
  }, []);

  function set(field) {
    return (e) => setForm((f) => ({ ...f, [field]: e.target.value }));
  }

  function clientValidate() {
    if (orgCfg.require_phone   && !form.phone.trim())   return 'Phone number is required.';
    return null;
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.name.trim()) { setError('Organization name is required.'); return; }
    const clientErr = clientValidate();
    if (clientErr) { setError(clientErr); return; }

    setSaving(true);
    setError('');
    try {
      const { data } = await api.post('/organizations', {
        name:    form.name.trim(),
        website: form.website.trim() || null,
        phone:   form.phone.trim()   || null,
      });
      onCreated({ id: data.id, name: form.name.trim(), website: form.website.trim() || null, phone: form.phone.trim() || null });
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to create organization.');
    } finally {
      setSaving(false);
    }
  }

  const req = (field) => orgCfg[`require_${field}`];

  return (
    <div className="border rounded p-3 mt-2 bg-body-tertiary">
      <div className="d-flex align-items-center gap-2 mb-2">
        <iconify-icon icon="solar:buildings-2-line-duotone" class="fs-6" style={{ color: 'var(--secondary)' }}></iconify-icon>
        <strong className="small">New Organization</strong>
      </div>
      <form onSubmit={handleSubmit}>
        <div className="row g-2">
          <div className="col-12">
            <input
              className="form-control form-control-sm"
              placeholder="Organization name *"
              value={form.name}
              onChange={set('name')}
              autoFocus
            />
          </div>
          <div className="col-md-6">
            <input
              className="form-control form-control-sm"
              placeholder="Website (optional)"
              value={form.website}
              onChange={set('website')}
            />
          </div>
          <div className="col-md-6">
            <PhoneInput
              className="form-control form-control-sm"
              placeholder={`Phone${req('phone') ? ' * (999-999-9999)' : ' (optional)'}`}
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
