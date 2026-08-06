import { useEffect, useRef, useState } from 'react';
import api from '../../api/client.js';
import PageHeader from '../../components/PageHeader.jsx';
import Modal from '../../components/Modal.jsx';
import TemplateEditor from '../components/TemplateEditor.jsx';
import { useConfirm } from '../../hooks/useConfirm.jsx';
import { toast } from '../../components/Toast.jsx';
import { parseApiError } from '../../utils/apiError.js';
import FormErrorBanner from '../../components/FormErrorBanner.jsx';

const NS_COLORS = {
  contact: '#0d6efd', organization: '#6f42c1', deal: '#198754',
  user: '#fd7e14', business: '#dc3545', invoice: '#20c997', payment: '#0dcaf0',
};

const empty = {
  channel: 'email', name: '', category: '',
  subject: '', body: '', merge_fields: '', is_active: true,
  slug: '', is_system: false,
};

const CHANNELS = ['email', 'sms'];

// Descriptions shown under each system template slug so admins understand
// when the template fires without needing to read the code.
const SYSTEM_SLUG_LABELS = {
  user_account_created: 'Sent when a new user invitation is created or resent.',
  invoice_sent:         'Sent when an invoice is emailed to a contact.',
  payment_receipt:      'Sent when a payment is recorded and the receipt is emailed.',
  void_receipt:         'Sent when an invoice is voided.',
  refund_receipt:       'Sent when a payment refund is processed.',
};

export default function TemplatesPage() {
  const [rows, setRows]         = useState([]);
  const [channel, setChannel]   = useState('email');
  const [show, setShow]         = useState(false);
  const [form, setForm]         = useState(empty);
  const [editId, setEditId]     = useState(null);
  const [mergeFields, setMergeFields] = useState({});
  const [preview, setPreview]   = useState(null);
  const [categories, setCategories] = useState([]);
  const [formError, setFormError] = useState('');
  const editorRef = useRef(null);
  const autoPreviewRef = useRef(false);
  const { confirm, dialog: confirmDialog } = useConfirm();

  async function load() {
    const { data } = await api.get('/templates', { params: { channel } });
    setRows(data);
  }
  async function loadMerge() {
    const { data } = await api.get('/templates/merge-fields');
    setMergeFields(data);
  }
  async function loadCategories() {
    try {
      const { data } = await api.get('/templates/categories');
      setCategories(Array.isArray(data) ? data : []);
    } catch { /* not fatal */ }
  }

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [channel]);
  useEffect(() => { loadMerge(); loadCategories(); }, []);

  function openNew() {
    setEditId(null);
    setForm({ ...empty, channel });
    setPreview(null);
    setFormError('');
    setShow(true);
  }

  function openEdit(t) {
    setEditId(t.id);
    setForm({
      channel:      t.channel,
      name:         t.name || '',
      category:     t.category || '',
      subject:      t.subject || '',
      body:         t.body || '',
      merge_fields: t.merge_fields || '',
      is_active:    !!t.is_active,
      slug:         t.slug || '',
      is_system:    !!t.is_system,
    });
    setPreview(null);
    setFormError('');
    autoPreviewRef.current = !!t.is_system;
    setShow(true);
  }

  useEffect(() => {
    if (show && autoPreviewRef.current) {
      autoPreviewRef.current = false;
      runPreview();
    }
  }, [show]); // eslint-disable-line

  async function save() {
    setFormError('');
    if (!form.is_system && !form.name?.trim()) { setFormError('Please enter a template name.'); return; }
    // Strip tags to detect truly empty body (TipTap empty state = '<p></p>')
    const bodyPlain = (form.body || '').replace(/<[^>]*>/g, '').trim();
    if (!bodyPlain) { setFormError('Please enter the message body.'); return; }
    try {
      if (editId) await api.put(`/templates/${editId}`, form);
      else        await api.post('/templates', form);
      setShow(false); setEditId(null); setForm(empty);
      load();
      loadCategories();
    } catch (err) {
      const issues = err.response?.data?.issues;
      const detail = (Array.isArray(issues) && issues.length)
        ? issues.map((i) => `${(i.path || []).join('.') || '(field)'}: ${i.message}`).join('\n')
        : parseApiError(err, 'Save failed.');
      setFormError(detail);
    }
  }

  async function remove(t) {
    if (t.is_system) return; // never delete system templates
    if (!(await confirm(`Delete template "${t.name}"?`))) return;
    try {
      await api.delete(`/templates/${t.id}`);
      load();
    } catch (err) {
      toast(parseApiError(err, 'Delete failed.'), 'error');
    }
  }

  async function runPreview() {
    try {
      const { data } = await api.post('/templates/preview', {
        subject: form.subject, body: form.body,
      });
      setPreview(data);
    } catch (err) {
      setFormError(parseApiError(err, 'Preview failed.'));
    }
  }

  const isSystem = form.is_system;

  const systemRows = rows.filter((r) => r.is_system);
  const userRows   = rows.filter((r) => !r.is_system);

  return (
    <div>
      <PageHeader title="Message Templates"
        subtitle={`${rows.length} ${channel} template${rows.length !== 1 ? 's' : ''}`}
        actions={<button className="btn btn-primary" onClick={openNew}>
          <iconify-icon icon="solar:add-circle-line-duotone" class="me-1"></iconify-icon> New Template
        </button>} />

      {/* Channel selector */}
      <div className="card mb-3">
        <div className="card-body py-2">
          <div className="d-flex gap-2">
            {CHANNELS.map((c) => (
              <button key={c} className={`btn btn-sm ${channel === c ? 'btn-primary' : 'btn-light'} text-capitalize`} onClick={() => setChannel(c)}>
                {c === 'email' ? '📧 Email' : '📱 SMS'}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── System Templates ── */}
      {systemRows.length > 0 && (
        <div className="card mb-3">
          <div className="card-header d-flex align-items-center gap-2">
            <iconify-icon icon="solar:lock-keyhole-bold-duotone" style={{ color: 'var(--bs-warning)' }}></iconify-icon>
            <span className="fw-semibold">System Templates</span>
            <span className="ms-1 badge bg-warning-subtle text-warning border border-warning-subtle">Auto-managed</span>
            <span className="ms-auto text-muted small">Name, slug, and channel are locked. Subject &amp; body are editable.</span>
          </div>
          <div className="card-body p-0">
            <div className="table-responsive">
              <table className="table table-hover align-middle mb-0">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Slug</th>
                    {channel === 'email' && <th>Subject</th>}
                    <th>Trigger</th>
                    <th>Active</th>
                    <th className="text-end">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {systemRows.map((t) => (
                    <tr key={t.id}>
                      <td>
                        <div className="d-flex align-items-center gap-2">
                          <iconify-icon icon="solar:lock-keyhole-minimalistic-line-duotone" class="text-muted"></iconify-icon>
                          <span className="fw-semibold">{t.name}</span>
                          <span className="badge bg-warning-subtle text-warning border border-warning-subtle" style={{ fontSize: '0.7rem' }}>System</span>
                        </div>
                      </td>
                      <td><code className="text-muted small">{t.slug}</code></td>
                      {channel === 'email' && <td className="text-muted small">{t.subject || '—'}</td>}
                      <td>
                        <small className="text-muted">
                          {SYSTEM_SLUG_LABELS[t.slug] || '—'}
                        </small>
                      </td>
                      <td>
                        {t.is_active
                          ? <span className="badge bg-success-subtle text-success">Active</span>
                          : <span className="badge bg-light text-muted">Inactive</span>}
                      </td>
                      <td className="text-end">
                        <button className="btn btn-sm btn-light" onClick={() => openEdit(t)} title="Edit subject &amp; body">
                          <iconify-icon icon="solar:pen-new-square-line-duotone"></iconify-icon>
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ── User Templates ── */}
      <div className="card">
        {systemRows.length > 0 && (
          <div className="card-header fw-semibold">
            <iconify-icon icon="solar:document-text-line-duotone" class="me-1"></iconify-icon>
            Custom Templates
          </div>
        )}
        <div className="card-body p-0">
          <div className="table-responsive">
            <table className="table table-hover align-middle mb-0">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Category</th>
                  {channel === 'email' && <th>Subject</th>}
                  <th>Active</th>
                  <th className="text-end">Actions</th>
                </tr>
              </thead>
              <tbody>
                {userRows.map((t) => (
                  <tr key={t.id}>
                    <td className="fw-semibold">{t.name}</td>
                    <td>
                      {t.category
                        ? <span className="badge bg-light text-dark">{t.category}</span>
                        : <span className="text-muted">—</span>}
                    </td>
                    {channel === 'email' && <td className="text-muted">{t.subject || '—'}</td>}
                    <td>
                      {t.is_active
                        ? <span className="badge bg-success-subtle text-success">Active</span>
                        : <span className="badge bg-light text-muted">Inactive</span>}
                    </td>
                    <td className="text-end text-nowrap">
                      <button className="btn btn-sm btn-light me-1" onClick={() => openEdit(t)} title="Edit">
                        <iconify-icon icon="solar:pen-new-square-line-duotone"></iconify-icon>
                      </button>
                      <button className="btn btn-sm btn-light text-danger" onClick={() => remove(t)} title="Delete">
                        <iconify-icon icon="solar:trash-bin-trash-line-duotone"></iconify-icon>
                      </button>
                    </td>
                  </tr>
                ))}
                {userRows.length === 0 && (
                  <tr>
                    <td colSpan={channel === 'email' ? 5 : 4}>
                      <div className="py-4 text-center text-muted">
                        No custom {channel} templates yet.
                        <br />
                        <button className="btn btn-sm btn-outline-primary mt-2" onClick={openNew}>
                          Create one
                        </button>
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* ── Edit / New Modal ── */}
      <Modal
        show={show}
        onClose={() => { setShow(false); setEditId(null); }}
        title={
          isSystem
            ? <span className="d-flex align-items-center gap-2">
                <iconify-icon icon="solar:lock-keyhole-bold-duotone" style={{ color: 'var(--bs-warning)' }}></iconify-icon>
                Edit System Template
                <span className="badge bg-warning-subtle text-warning border border-warning-subtle">System</span>
              </span>
            : editId ? 'Edit Template' : 'New Template'
        }
        size="xl"
        footer={<>
          <button className="btn btn-light" onClick={() => { setShow(false); setEditId(null); }}>Cancel</button>
          {form.channel === 'email' && (
            <button className="btn btn-outline-secondary" onClick={runPreview} title="Render merge fields against a sample context and show the final email">
              <iconify-icon icon="solar:eye-scan-line-duotone" class="me-1"></iconify-icon>
              Rendered preview
            </button>
          )}
          <button className="btn btn-primary" onClick={save}>
            <iconify-icon icon="solar:diskette-line-duotone" class="me-1"></iconify-icon>
            Save
          </button>
        </>}
      >
        <div className="row g-3">

          {/* Save / validation error */}
          {formError && (
            <div className="col-12">
              <FormErrorBanner error={formError} />
            </div>
          )}

          {/* System template info banner */}
          {isSystem && (
            <div className="col-12">
              <div className="alert alert-warning d-flex gap-2 mb-0 py-2" role="alert">
                <iconify-icon icon="solar:info-circle-line-duotone" style={{ fontSize: '1.2rem', flexShrink: 0, marginTop: 2 }}></iconify-icon>
                <div>
                  <strong>System template</strong> — Name, slug, channel, and category are locked.
                  You can edit the <strong>subject</strong> and <strong>body</strong> (HTML).
                  Business branding (logo, colors) is injected automatically via{' '}
                  <code>{'{{business.*}}'}</code> merge fields.
                  {SYSTEM_SLUG_LABELS[form.slug] && (
                    <div className="mt-1 text-muted small"><em>{SYSTEM_SLUG_LABELS[form.slug]}</em></div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Channel + Name + Category row — locked for system */}
          {!isSystem && (
            <>
              <div className="col-md-3">
                <label className="form-label">Channel</label>
                <select className="form-select" value={form.channel}
                  onChange={(e) => setForm({ ...form, channel: e.target.value })}
                  disabled={!!editId}>
                  {CHANNELS.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div className="col-md-5">
                <label className="form-label">Name</label>
                <input className="form-control" value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="Welcome email" />
              </div>
              <div className="col-md-4">
                <label className="form-label">Category</label>
                <input className="form-control" list="lc-template-categories"
                  value={form.category}
                  onChange={(e) => setForm({ ...form, category: e.target.value })}
                  placeholder="Onboarding" autoComplete="off" />
                <datalist id="lc-template-categories">
                  {categories.map((c) => <option key={c} value={c} />)}
                </datalist>
                <small className="text-muted">Group templates in lists and compose picker.</small>
              </div>
            </>
          )}

          {/* System template locked meta row */}
          {isSystem && (
            <div className="col-12">
              <div className="row g-2">
                <div className="col-md-4">
                  <label className="form-label text-muted small">Name (locked)</label>
                  <input className="form-control form-control-sm bg-light" readOnly value={form.name} />
                </div>
                <div className="col-md-4">
                  <label className="form-label text-muted small">Slug (locked)</label>
                  <input className="form-control form-control-sm bg-light font-monospace" readOnly value={form.slug} />
                </div>
                <div className="col-md-4">
                  <label className="form-label text-muted small">Channel (locked)</label>
                  <input className="form-control form-control-sm bg-light text-capitalize" readOnly value={form.channel} />
                </div>
              </div>
            </div>
          )}

          {/* Subject */}
          {form.channel === 'email' && (
            <div className="col-12">
              <label className="form-label">Subject</label>
              <input className="form-control" value={form.subject}
                onChange={(e) => setForm({ ...form, subject: e.target.value })}
                placeholder="Welcome to Acme, {{contact.first_name}}" />
            </div>
          )}

          {/* Body — TemplateEditor (visual ↔ HTML) for email; plain textarea for SMS */}
          <div className="col-12">
            <label className="form-label">
              {form.channel === 'email' ? 'Body' : <>Body <small className="text-muted fw-normal">{form.body.length} chars</small></>}
            </label>

            {form.channel === 'email' ? (
              <TemplateEditor
                key={editId ?? 'new'}
                ref={editorRef}
                value={form.body}
                onChange={(html) => { setForm((f) => ({ ...f, body: html })); setPreview(null); }}
                mergeFields={mergeFields}
                minHeight={isSystem ? 420 : 320}
                defaultMode={isSystem ? 'html' : 'visual'}
              />
            ) : (
              /* SMS stays as plain textarea — no visual editor for short messages */
              <textarea
                className="form-control"
                rows={5}
                value={form.body}
                onChange={(e) => setForm({ ...form, body: e.target.value })}
                placeholder="Hi {{contact.first_name}}, just checking in re: {{deal.name}}."
              />
            )}
          </div>

          {/* Merge field chips — available for all channels */}
          <div className="col-12">
            <div className="d-flex align-items-center justify-content-between mb-1">
              <label className="form-label mb-0">
                <iconify-icon icon="solar:code-square-line-duotone" class="me-1"></iconify-icon>
                Available merge fields
              </label>
              <small className="text-muted">
                {form.channel === 'email'
                  ? 'Click to insert at cursor position in the editor'
                  : 'Click to append to message'}
              </small>
            </div>
            <div className="border rounded p-2" style={{ background: '#f8f9fa' }}>
              {Object.entries(mergeFields).map(([ns, fields]) => (
                <div key={ns} className="mb-2">
                  <span className="badge me-1 mb-1" style={{
                    background: NS_COLORS[ns] || '#6c757d',
                    color: '#fff', fontSize: '0.65rem',
                    textTransform: 'uppercase', letterSpacing: '.04em',
                  }}>{ns}</span>
                  {fields.map((f) => (
                    <button key={`${ns}.${f}`} type="button"
                      className="btn btn-sm me-1 mb-1"
                      style={{
                        fontSize: '0.75rem', fontFamily: 'monospace',
                        background: '#fff3cd', color: '#664d03',
                        border: '1px solid #ffe69c', borderRadius: 4,
                        padding: '1px 6px',
                      }}
                      onClick={() => {
                        if (form.channel === 'email') {
                          editorRef.current?.insertToken(`${ns}.${f}`);
                        } else {
                          setForm((prev) => ({
                            ...prev,
                            body: `${prev.body}${prev.body && !prev.body.endsWith(' ') ? ' ' : ''}{{${ns}.${f}}}`,
                          }));
                        }
                      }}>
                      {`{{${ns}.${f}}}`}
                    </button>
                  ))}
                </div>
              ))}
            </div>
            <small className="text-muted d-block mt-1">Missing values render as blank at send time.</small>
          </div>

          {/* Status */}
          <div className="col-md-4">
            <label className="form-label">Status</label>
            <select className="form-select" value={form.is_active ? '1' : '0'}
              onChange={(e) => setForm({ ...form, is_active: e.target.value === '1' })}>
              <option value="1">Active</option>
              <option value="0">Inactive</option>
            </select>
          </div>

          {/* Rendered preview panel */}
          {preview && (
            <div className="col-12">
              <div className="border rounded overflow-hidden shadow-sm">
                {/* Preview header */}
                <div className="px-3 py-2 d-flex align-items-center justify-content-between"
                  style={{ background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)', color: '#fff' }}>
                  <div className="d-flex align-items-center gap-2">
                    <iconify-icon icon="solar:letter-opened-line-duotone" style={{ fontSize: '1.1rem', color: '#7dd3fc' }}></iconify-icon>
                    <span className="fw-semibold" style={{ fontSize: '0.9rem' }}>Email Preview</span>
                    {isSystem && (
                      <span className="badge" style={{ background: 'rgba(255,255,255,.15)', fontSize: '0.65rem' }}>
                        Business branding applied
                      </span>
                    )}
                  </div>
                  <div className="d-flex align-items-center gap-2">
                    <button type="button" className="btn btn-sm"
                      style={{ background: 'rgba(255,255,255,.1)', color: '#fff', border: '1px solid rgba(255,255,255,.2)', fontSize: '0.75rem' }}
                      onClick={runPreview} title="Refresh preview with latest changes">
                      <iconify-icon icon="solar:refresh-line-duotone" class="me-1"></iconify-icon>Refresh
                    </button>
                    <button type="button" className="btn btn-sm"
                      style={{ background: 'rgba(255,255,255,.1)', color: '#fff', border: '1px solid rgba(255,255,255,.2)' }}
                      onClick={() => setPreview(null)}>
                      <iconify-icon icon="solar:close-circle-line-duotone"></iconify-icon>
                    </button>
                  </div>
                </div>

                {/* Email chrome */}
                <div style={{ background: '#f0f2f5', padding: '8px 12px', borderBottom: '1px solid #dee2e6' }}>
                  <div className="d-flex align-items-center gap-2" style={{ fontSize: '0.8rem', color: '#495057' }}>
                    <span className="text-muted">Subject:</span>
                    <span className="fw-semibold">{preview.subject || '(no subject)'}</span>
                  </div>
                </div>

                {/* Email body in a realistic frame */}
                <div style={{ background: '#e9ecef', padding: '16px', minHeight: 400 }}>
                  {form.channel === 'email' ? (
                    <div style={{
                      maxWidth: 640, margin: '0 auto',
                      boxShadow: '0 4px 24px rgba(0,0,0,.12)',
                      borderRadius: 6, overflow: 'hidden',
                    }}>
                      <iframe
                        title="Rendered email preview"
                        style={{ width: '100%', height: 560, border: 'none', display: 'block' }}
                        srcDoc={preview.body}
                        sandbox="allow-same-origin"
                      />
                    </div>
                  ) : (
                    <pre className="p-3 mb-0" style={{
                      whiteSpace: 'pre-wrap', fontFamily: 'inherit',
                      color: '#212529', background: '#fff',
                      borderRadius: 6,
                    }}>{preview.body}</pre>
                  )}
                </div>

                {/* Footer */}
                <div className="px-3 py-1" style={{ background: '#f8f9fa', borderTop: '1px solid #dee2e6' }}>
                  <small className="text-muted">
                    <iconify-icon icon="solar:info-circle-line-duotone" class="me-1"></iconify-icon>
                    Preview uses your saved business settings for logo, colors, and contact info.
                    {' '}Context: {preview.context_keys?.filter(k => !['business'].includes(k)).join(', ') || 'none'}
                  </small>
                </div>
              </div>
            </div>
          )}
        </div>
      </Modal>

      {confirmDialog}
    </div>
  );
}
