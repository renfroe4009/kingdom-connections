import { useEffect, useState } from 'react';
import api from '../../api/client.js';
import PageHeader from '../../components/PageHeader.jsx';
import Modal from '../../components/Modal.jsx';
import { useConfirm } from '../../hooks/useConfirm.jsx';
import { toast } from '../../components/Toast.jsx';
import { parseApiError } from '../../utils/apiError.js';
import FormErrorBanner from '../../components/FormErrorBanner.jsx';

const empty = {
  entity_type: 'contact', field_key: '', label: '',
  field_type: 'text', options_json: '', is_required: false, display_order: 0,
};

// These must match the DB enum + zod schema exactly. Adding a new option here
// without updating the server will result in "save" failing silently with 400.
const TYPES = ['text', 'number', 'date', 'boolean', 'select', 'multi_select', 'url', 'email', 'phone'];
const ENTITIES = ['contact', 'organization', 'deal'];

export default function CustomFieldsPage() {
  const [entity, setEntity] = useState('contact');
  const [rows, setRows] = useState([]);
  const [show, setShow] = useState(false);
  const [form, setForm] = useState(empty);
  const [editId, setEditId] = useState(null);
  const [formError, setFormError] = useState('');
  const { confirm, dialog: confirmDialog } = useConfirm();

  async function load() {
    const { data } = await api.get('/custom-fields', { params: { entity_type: entity } });
    setRows(data);
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [entity]);

  function openNew() { setEditId(null); setForm({ ...empty, entity_type: entity }); setFormError(''); setShow(true); }
  function openEdit(f) {
    setEditId(f.id);
    setForm({
      entity_type: f.entity_type,
      field_key: f.field_key,
      label: f.label,
      field_type: f.field_type,
      options_json: f.options_json ? (typeof f.options_json === 'string' ? f.options_json : JSON.stringify(f.options_json)) : '',
      is_required: !!f.is_required,
      display_order: f.display_order || 0,
    });
    setFormError('');
    setShow(true);
  }

  async function save() {
    setFormError('');
    const payload = { ...form, display_order: Number(form.display_order || 0) };
    // Auto-derive a key from the label if the user didn't pick one. Keys are
    // machine names — lowercase, alnum + underscore — and can't be edited
    // after creation.
    if (!payload.field_key && payload.label) {
      payload.field_key = String(payload.label)
        .trim().toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');
    }
    if (payload.options_json && typeof payload.options_json === 'string') {
      try { payload.options_json = JSON.parse(payload.options_json); }
      catch {
        setFormError('Options must be a valid JSON array, e.g. ["Option 1","Option 2"]');
        return;
      }
    }
    // Don't ship empty strings the server's zod schema doesn't accept.
    if (payload.options_json === '') payload.options_json = null;
    try {
      if (editId) await api.put(`/custom-fields/${editId}`, payload);
      else        await api.post('/custom-fields',           payload);
      setShow(false); setEditId(null); setForm(empty); load();
    } catch (err) {
      const issues = err.response?.data?.issues;
      const detail = Array.isArray(issues) && issues.length
        ? issues.map((i) => `${i.path?.join('.')}: ${i.message}`).join('\n')
        : parseApiError(err, 'Save failed.');
      setFormError(detail);
    }
  }

  async function remove(f) {
    if (!(await confirm(`Delete custom field "${f.label}"? Existing values will be removed.`))) return;
    try {
      await api.delete(`/custom-fields/${f.id}`);
      load();
    } catch (err) {
      toast(parseApiError(err, 'Delete failed'), 'error');
    }
  }

  const needsOptions = ['select', 'multi_select'].includes(form.field_type);

  return (
    <div>
      <PageHeader title="Custom Fields" subtitle={`${rows.length} fields for ${entity}s`}
        actions={<button className="btn btn-primary" onClick={openNew}>
          <iconify-icon icon="solar:add-circle-line-duotone" class="me-1"></iconify-icon> New Field
        </button>} />

      <div className="card mb-3">
        <div className="card-body">
          <div className="d-flex gap-2">
            {ENTITIES.map((e) => (
              <button key={e} className={`btn btn-sm ${entity === e ? 'btn-primary' : 'btn-light'} text-capitalize`} onClick={() => setEntity(e)}>
                {e}s
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-body">
          <div className="table-responsive">
            <table className="table table-hover align-middle mb-0">
              <thead><tr><th>Label</th><th>Key</th><th>Type</th><th>Required</th><th>Order</th><th className="text-end">Actions</th></tr></thead>
              <tbody>
                {rows.map((f) => (
                  <tr key={f.id}>
                    <td className="fw-semibold">{f.label}</td>
                    <td><code>{f.field_key}</code></td>
                    <td><span className="badge bg-primary-subtle text-primary">{f.field_type}</span></td>
                    <td>{f.is_required ? 'Yes' : 'No'}</td>
                    <td>{f.display_order}</td>
                    <td className="text-end text-nowrap">
                      <button className="btn btn-sm btn-light me-1" onClick={() => openEdit(f)} title="Edit">
                        <iconify-icon icon="solar:pen-new-square-line-duotone"></iconify-icon>
                      </button>
                      <button className="btn btn-sm btn-light text-danger" onClick={() => remove(f)} title="Delete">
                        <iconify-icon icon="solar:trash-bin-trash-line-duotone"></iconify-icon>
                      </button>
                    </td>
                  </tr>
                ))}
                {rows.length === 0 && <tr><td colSpan="6"><div className="empty-state">No custom fields for this entity.</div></td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <Modal show={show} onClose={() => { setShow(false); setEditId(null); }} title={editId ? 'Edit Custom Field' : 'New Custom Field'} size="lg"
        footer={<><button className="btn btn-light" onClick={() => { setShow(false); setEditId(null); }}>Cancel</button>
                  <button className="btn btn-primary" onClick={save}>Save</button></>}>
        <FormErrorBanner error={formError} />
        <div className="row g-2">
          <div className="col-md-4"><label className="form-label">Entity</label>
            <select className="form-select" value={form.entity_type} onChange={(e) => setForm({ ...form, entity_type: e.target.value })} disabled={!!editId}>
              {ENTITIES.map((e) => <option key={e} value={e}>{e}</option>)}
            </select></div>
          <div className="col-md-4"><label className="form-label">Label</label>
            <input className="form-control" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder="Account Owner" /></div>
          <div className="col-md-4"><label className="form-label">Field key</label>
            <input className="form-control" value={form.field_key} onChange={(e) => setForm({ ...form, field_key: e.target.value })} placeholder="account_owner" disabled={!!editId} /></div>
          <div className="col-md-4"><label className="form-label">Type</label>
            <select className="form-select" value={form.field_type} onChange={(e) => setForm({ ...form, field_type: e.target.value })}>
              {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select></div>
          <div className="col-md-4"><label className="form-label">Required</label>
            <select className="form-select" value={form.is_required ? '1' : '0'} onChange={(e) => setForm({ ...form, is_required: e.target.value === '1' })}>
              <option value="0">No</option><option value="1">Yes</option>
            </select></div>
          <div className="col-md-4"><label className="form-label">Display order</label>
            <input type="number" className="form-control" value={form.display_order} onChange={(e) => setForm({ ...form, display_order: e.target.value })} /></div>
          {needsOptions && (
            <div className="col-12"><label className="form-label">Options (JSON array)</label>
              <textarea className="form-control font-monospace" rows={3} value={form.options_json} onChange={(e) => setForm({ ...form, options_json: e.target.value })}
                placeholder='["Option 1", "Option 2", "Option 3"]' />
              <small className="text-muted">Required for select/multiselect. Use a JSON array of strings.</small>
            </div>
          )}
        </div>
      </Modal>

      {confirmDialog}
    </div>
  );
}
