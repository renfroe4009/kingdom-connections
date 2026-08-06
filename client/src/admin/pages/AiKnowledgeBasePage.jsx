import { useEffect, useState } from 'react';
import api from '../../api/client.js';
import PageHeader from '../../components/PageHeader.jsx';
import Modal from '../../components/Modal.jsx';
import { useConfirm } from '../../hooks/useConfirm.jsx';
import { toast } from '../../components/Toast.jsx';
import { parseApiError } from '../../utils/apiError.js';

const MODULES = [
  'dashboard', 'contacts', 'organizations', 'deals',
  'tasks', 'invoices', 'subscriptions', 'billing',
  'communications', 'email_templates', 'settings', 'portal', 'admin',
  'website_builder', 'cms_pages', 'blog', 'forms', 'social', 'seo', 'ai', 'other',
];

const empty = { module: 'contacts', title: '', content: '', sort_order: 0, active: true };

export default function AiKnowledgeBasePage() {
  const [articles, setArticles] = useState([]);
  const [filterMod, setFilterMod] = useState('');
  const [show, setShow]           = useState(false);
  const [form, setForm]           = useState(empty);
  const [editId, setEditId]       = useState(null);
  const [saving, setSaving]       = useState(false);
  const [msg, setMsg]             = useState('');
  const { confirm, dialog: confirmDialog } = useConfirm();

  async function load() {
    const { data } = await api.get('/ai/kb/all');
    setArticles(data);
  }
  useEffect(() => { load(); }, []);

  function openNew() {
    setEditId(null); setForm(empty); setMsg(''); setShow(true);
  }
  function openEdit(a) {
    setEditId(a.id);
    setForm({ module: a.module, title: a.title, content: a.content, sort_order: a.sort_order, active: !!a.active });
    setMsg('');
    setShow(true);
  }

  async function save() {
    if (!form.title.trim() || !form.content.trim()) { setMsg('Title and content are required.'); return; }
    setSaving(true); setMsg('');
    try {
      if (editId) await api.put(`/ai/kb/${editId}`, form);
      else        await api.post('/ai/kb', form);
      setShow(false); load();
    } catch (e) {
      setMsg(parseApiError(e, 'Save failed.'));
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(a) {
    try {
      await api.put(`/ai/kb/${a.id}`, { active: !a.active });
      load();
    } catch (e) {
      toast(parseApiError(e, 'Update failed'), 'error');
    }
  }

  async function remove(a) {
    if (!(await confirm(`Delete article "${a.title}"?`))) return;
    try {
      await api.delete(`/ai/kb/${a.id}`);
      load();
    } catch (e) {
      toast(parseApiError(e, 'Delete failed'), 'error');
    }
  }

  const visible = filterMod ? articles.filter((a) => a.module === filterMod) : articles;

  // Group by module for display
  const grouped = {};
  for (const a of visible) {
    (grouped[a.module] = grouped[a.module] || []).push(a);
  }

  return (
    <div>
      <PageHeader
        title="AI Knowledge Base"
        subtitle={`${articles.length} articles`}
        actions={
          <button className="btn btn-primary" onClick={openNew}>
            <iconify-icon icon="solar:add-circle-line-duotone" class="me-1"></iconify-icon>
            New Article
          </button>
        }
      />

      <div className="mb-3 d-flex gap-2 flex-wrap">
        <select
          className="form-select"
          style={{ maxWidth: 200 }}
          value={filterMod}
          onChange={(e) => setFilterMod(e.target.value)}
        >
          <option value="">All modules</option>
          {MODULES.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
        <span className="text-muted small align-self-center">
          {visible.length} of {articles.length} articles
        </span>
      </div>

      {Object.entries(grouped).map(([mod, arts]) => (
        <div className="card mb-3" key={mod}>
          <div className="card-header d-flex align-items-center justify-content-between py-2">
            <span className="fw-bold text-uppercase small text-muted">{mod}</span>
            <span className="badge bg-secondary-subtle text-secondary">{arts.length}</span>
          </div>
          <div className="card-body p-0">
            <table className="table table-hover align-middle mb-0">
              <tbody>
                {arts.map((a) => (
                  <tr key={a.id}>
                    <td className="ps-3">
                      <div className="fw-semibold">{a.title}</div>
                      <div className="text-muted small" style={{ overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 'min(400px, 100%)' }}>
                        {a.content.slice(0, 120)}…
                      </div>
                    </td>
                    <td className="text-center" style={{ width: 80 }}>
                      <div className="form-check form-switch d-flex justify-content-center mb-0">
                        <input
                          className="form-check-input"
                          type="checkbox"
                          checked={!!a.active}
                          onChange={() => toggleActive(a)}
                          title={a.active ? 'Active — click to disable' : 'Inactive — click to enable'}
                        />
                      </div>
                    </td>
                    <td className="text-end pe-3 text-nowrap">
                      <button className="btn btn-sm btn-light me-1" onClick={() => openEdit(a)} title="Edit">
                        <iconify-icon icon="solar:pen-new-square-line-duotone"></iconify-icon>
                      </button>
                      <button className="btn btn-sm btn-light text-danger" onClick={() => remove(a)} title="Delete">
                        <iconify-icon icon="solar:trash-bin-trash-line-duotone"></iconify-icon>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}

      {visible.length === 0 && (
        <div className="empty-state">No articles found.</div>
      )}

      <Modal
        show={show}
        onClose={() => setShow(false)}
        title={editId ? 'Edit Article' : 'New Article'}
        size="lg"
        footer={<>
          <button className="btn btn-light" onClick={() => setShow(false)}>Cancel</button>
          <button className="btn btn-primary" onClick={save} disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </>}
      >
        {msg && <div className="alert alert-danger py-2 small mb-3">{msg}</div>}
        <div className="row g-3">
          <div className="col-12 col-md-6">
            <label className="form-label">Module</label>
            <select className="form-select" value={form.module} onChange={(e) => setForm({ ...form, module: e.target.value })}>
              {MODULES.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          <div className="col-6 col-md-4">
            <label className="form-label">Sort order</label>
            <input type="number" className="form-control" value={form.sort_order} onChange={(e) => setForm({ ...form, sort_order: Number(e.target.value) })} />
          </div>
          <div className="col-6 col-md-2 d-flex align-items-end pb-1">
            <div className="form-check">
              <input className="form-check-input" type="checkbox" id="art-active" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} />
              <label className="form-check-label" htmlFor="art-active">Active</label>
            </div>
          </div>
          <div className="col-12">
            <label className="form-label">Title</label>
            <input className="form-control" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. Creating Invoices" />
          </div>
          <div className="col-12">
            <label className="form-label">Content</label>
            <textarea
              className="form-control font-monospace"
              rows={8}
              value={form.content}
              onChange={(e) => setForm({ ...form, content: e.target.value })}
              placeholder="Write how-to content here. Plain text or markdown is fine. Be specific about navigation paths, button names, and step-by-step instructions."
              style={{ fontSize: '0.82rem' }}
            />
            <div className="form-text">The AI reads this content verbatim when answering questions in the {form.module} module.</div>
          </div>
        </div>
      </Modal>

      {confirmDialog}
    </div>
  );
}
