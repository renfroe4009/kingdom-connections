import { useState, useEffect, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import api from '../../api/client.js';
import PageHeader from '../../components/PageHeader.jsx';
import { PAGE_TEMPLATES, buildTemplate } from '../../builder/templates/pageTemplates.js';
import { useConfirm } from '../../hooks/useConfirm.jsx';
import { toast } from '../../components/Toast.jsx';
import { parseApiError } from '../../utils/apiError.js';

const IMPACT_COLOR = { critical: '#dc3545', serious: '#fd7e14', moderate: '#ffc107', minor: '#6c757d' };
const IMPACT_LABEL = { critical: 'Critical', serious: 'Serious', moderate: 'Moderate', minor: 'Minor' };

function issueKey(iss) {
  return iss.blockId ? `${iss.fixType}-${iss.blockId}` : (iss.fixType || iss.id);
}

function IssueRow({ iss, bgColor, borderColor, pageId, onFixed }) {
  const [open, setOpen]     = useState(false);
  const [value, setValue]   = useState(iss.currentValue || '');
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!value.trim()) return;
    setSaving(true);
    try {
      await api.patch(`/ada/fix/${pageId}`, { fixType: iss.fixType, value, blockId: iss.blockId });
      setOpen(false);
      onFixed();
    } catch (e) {
      toast(parseApiError(e, 'Fix failed'), 'error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ padding: '0.65rem 0.85rem', background: bgColor, border: `1px solid ${borderColor}`, borderRadius: 6, marginBottom: '0.5rem', fontSize: '0.85rem' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '0.5rem', flexWrap: 'wrap' }}>
        <div style={{ flex: 1 }}>
          <span style={{ display: 'inline-block', background: IMPACT_COLOR[iss.impact], color: '#fff', fontSize: '0.65rem', fontWeight: 700, padding: '1px 6px', borderRadius: 3, marginRight: '0.5rem', textTransform: 'uppercase' }}>{IMPACT_LABEL[iss.impact]}</span>
          <span style={{ fontWeight: 600 }}>WCAG {iss.wcag}</span>
          <span style={{ color: '#6c757d', marginLeft: '0.5rem' }}>— {iss.msg}</span>
        </div>
        {iss.fixable && !open && (
          <button onClick={() => { setValue(iss.currentValue || ''); setOpen(true); }}
            style={{ flexShrink: 0, fontSize: '0.75rem', padding: '2px 10px', borderRadius: 4, border: '1px solid #0d6efd', background: '#fff', color: '#0d6efd', cursor: 'pointer', whiteSpace: 'nowrap' }}>
            Fix ✎
          </button>
        )}
      </div>

      {open && (
        <div style={{ marginTop: '0.6rem', display: 'flex', gap: '0.4rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            autoFocus
            value={value}
            onChange={e => setValue(e.target.value)}
            placeholder={iss.fixType === 'meta_title' ? 'Enter page title…' : iss.fixType === 'meta_desc' ? 'Enter meta description…' : 'Enter alt text…'}
            style={{ flex: 1, minWidth: 180, fontSize: '0.82rem', padding: '4px 8px', border: '1px solid #ced4da', borderRadius: 4 }}
            onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setOpen(false); }}
          />
          <button onClick={save} disabled={saving || !value.trim()}
            style={{ fontSize: '0.78rem', padding: '3px 12px', borderRadius: 4, border: 'none', background: '#198754', color: '#fff', cursor: 'pointer', opacity: saving || !value.trim() ? 0.6 : 1 }}>
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button onClick={() => setOpen(false)}
            style={{ fontSize: '0.78rem', padding: '3px 10px', borderRadius: 4, border: '1px solid #ced4da', background: '#fff', cursor: 'pointer' }}>
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}

function AdaModal({ page, onClose }) {
  const [result, setResult]   = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);

  const runAudit = useCallback(() => {
    setLoading(true);
    setError(null);
    api.get(`/ada/check-page/${page.id}`)
      .then(r => setResult(r.data))
      .catch(e => setError(e.response?.data?.error || 'Audit failed'))
      .finally(() => setLoading(false));
  }, [page.id]);

  useEffect(() => { runAudit(); }, [runAudit]);

  const scoreColor = result
    ? result.score >= 80 ? '#198754' : result.score >= 50 ? '#ffc107' : '#dc3545'
    : '#6c757d';

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }} onClick={onClose}>
      <div style={{ background: '#fff', borderRadius: 12, width: '100%', maxWidth: 700, maxHeight: '85vh', overflow: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }} onClick={e => e.stopPropagation()}>
        <div style={{ padding: '1.25rem 1.5rem', borderBottom: '1px solid #dee2e6', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <h5 style={{ margin: 0, fontWeight: 700 }}>ADA / WCAG Audit</h5>
            <p style={{ margin: 0, fontSize: '0.82rem', color: '#6c757d' }}>/{page.slug}</p>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <Link to={`/admin/website/pages/${page.id}/edit`} onClick={onClose}
              style={{ fontSize: '0.78rem', padding: '4px 12px', borderRadius: 4, border: '1px solid #6c757d', color: '#6c757d', textDecoration: 'none', whiteSpace: 'nowrap' }}>
              Open Editor ↗
            </Link>
            <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: '1.4rem', cursor: 'pointer', color: '#6c757d', lineHeight: 1 }}>×</button>
          </div>
        </div>

        <div style={{ padding: '1.5rem' }}>
          {loading && <div className="text-center py-4"><span className="spinner-border text-primary" /><p className="mt-2 text-muted small">Auditing page data…</p></div>}
          {error   && <div className="alert alert-danger">{error}</div>}

          {result && (
            <>
              {/* Score */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem', marginBottom: '1.5rem', padding: '1rem 1.25rem', background: '#f8f9fa', borderRadius: 8 }}>
                <div style={{ textAlign: 'center', flexShrink: 0 }}>
                  <div style={{ fontSize: '2.5rem', fontWeight: 900, color: scoreColor, lineHeight: 1 }}>{result.score}</div>
                  <div style={{ fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.08em', color: '#6c757d' }}>Score</div>
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap' }}>
                    <span><strong style={{ color: '#dc3545' }}>{result.issues.length}</strong> <span className="text-muted small">issues</span></span>
                    <span><strong style={{ color: '#fd7e14' }}>{result.warnings.length}</strong> <span className="text-muted small">warnings</span></span>
                    <span><strong style={{ color: '#198754' }}>{result.passes.length}</strong> <span className="text-muted small">passing</span></span>
                  </div>
                  {result.pageTitle && <p style={{ margin: '0.5rem 0 0', fontSize: '0.82rem', color: '#6c757d' }}>Meta title: <em>{result.pageTitle}</em></p>}
                </div>
              </div>

              {/* Issues */}
              {result.issues.length > 0 && (
                <div className="mb-3">
                  <h6 style={{ fontWeight: 700, color: '#dc3545', marginBottom: '0.75rem' }}>Issues ({result.issues.length})</h6>
                  {result.issues.map((iss, i) => (
                    <IssueRow key={issueKey(iss) + i} iss={iss} pageId={page.id}
                      bgColor="#fff5f5" borderColor="#f5c2c7" onFixed={runAudit} />
                  ))}
                </div>
              )}

              {/* Warnings */}
              {result.warnings.length > 0 && (
                <div className="mb-3">
                  <h6 style={{ fontWeight: 700, color: '#856404', marginBottom: '0.75rem' }}>Warnings ({result.warnings.length})</h6>
                  {result.warnings.map((w, i) => (
                    <IssueRow key={issueKey(w) + i} iss={w} pageId={page.id}
                      bgColor="#fffbea" borderColor="#ffc107" onFixed={runAudit} />
                  ))}
                </div>
              )}

              {/* Passing */}
              {result.passes.length > 0 && (
                <details>
                  <summary style={{ cursor: 'pointer', color: '#198754', fontWeight: 700, fontSize: '0.9rem', marginBottom: '0.5rem' }}>Passing checks ({result.passes.length})</summary>
                  {result.passes.map((p, i) => (
                    <div key={i} style={{ padding: '0.4rem 0.85rem', fontSize: '0.82rem', color: '#198754', borderLeft: '3px solid #198754', marginBottom: '0.35rem' }}>✓ {p.msg}</div>
                  ))}
                </details>
              )}

              <p style={{ marginTop: '1rem', fontSize: '0.75rem', color: '#aaa' }}>
                Audits meta title, meta description, and image alt text directly from the database. Heading structure, link text, and button names require the page editor.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Template picker modal
// ---------------------------------------------------------------------------
function TemplatePickerModal({ onClose, onPick }) {
  const [selected, setSelected] = useState(null);
  const [title, setTitle]       = useState('');
  const [slug, setSlug]         = useState('');
  const [creating, setCreating] = useState(false);

  function toSlug(s) {
    return s.toLowerCase().trim().replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-');
  }

  function handlePick(t) {
    setSelected(t);
    if (!title) {
      setTitle(t.label);
      setSlug(toSlug(t.label));
    }
  }

  async function create() {
    if (!selected || !title.trim()) return;
    setCreating(true);
    try {
      // Craft templates build their tree on demand; the old Puck templates
      // carried a static `puck_data` blob. Same destination column, new shape.
      await onPick(title, slug || toSlug(title), buildTemplate(selected.id));
    } finally {
      setCreating(false);
    }
  }

  return (
    <div
      className="modal d-block"
      style={{ background: 'rgba(0,0,0,0.55)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="modal-dialog modal-xl modal-dialog-centered modal-dialog-scrollable">
        <div className="modal-content">
          <div className="modal-header">
            <h5 className="modal-title">Choose a Page Template</h5>
            <button type="button" className="btn-close" onClick={onClose} />
          </div>
          <div className="modal-body">
            <div className="row g-3 mb-4">
              {PAGE_TEMPLATES.map((t) => (
                <div key={t.id} className="col-md-4 col-lg-3">
                  <div
                    className={`card h-100 ${selected?.id === t.id ? 'border-primary border-2' : 'border'}`}
                    style={{ cursor: 'pointer', transition: 'box-shadow 0.15s' }}
                    onClick={() => handlePick(t)}
                  >
                    <div className="card-body d-flex flex-column align-items-center text-center py-4">
                      <iconify-icon icon={t.icon} style={{ fontSize: '2.5rem', color: selected?.id === t.id ? '#0d6efd' : '#6c757d', marginBottom: '0.75rem' }} />
                      <h6 className="fw-bold mb-1">{t.label}</h6>
                      <p className="text-muted small mb-0">{t.description}</p>
                    </div>
                    {selected?.id === t.id && (
                      <div className="card-footer text-center py-1 bg-primary text-white small fw-semibold">Selected</div>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {selected && (
              <div className="border rounded p-3 bg-light">
                <h6 className="fw-semibold mb-3">Page Details</h6>
                <div className="row g-2">
                  <div className="col-md-6">
                    <label className="form-label small">Page Title</label>
                    <input
                      type="text"
                      className="form-control"
                      value={title}
                      onChange={(e) => { setTitle(e.target.value); setSlug(toSlug(e.target.value)); }}
                      placeholder="Page title"
                    />
                  </div>
                  <div className="col-md-6">
                    <label className="form-label small">Slug</label>
                    <div className="input-group">
                      <span className="input-group-text">/</span>
                      <input
                        type="text"
                        className="form-control font-monospace"
                        value={slug}
                        onChange={(e) => setSlug(e.target.value)}
                        placeholder="page-slug"
                      />
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={!selected || !title.trim() || creating}
              onClick={create}
            >
              {creating
                ? <><span className="spinner-border spinner-border-sm me-1" />Creating…</>
                : 'Create from Template →'
              }
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function WebsitePagesPage() {
  const [pages, setPages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showTemplates, setShowTemplates] = useState(false);
  const [creating, setCreating] = useState(false);
  const [adaPage, setAdaPage] = useState(null);
  const navigate = useNavigate();
  const { confirm, dialog: confirmDialog } = useConfirm();

  useEffect(() => {
    api.get('/website/pages').then(r => setPages(r.data)).catch(() => {}).finally(() => setLoading(false));
  }, []);

  async function createFromTemplate(title, slug, puck_data) {
    setCreating(true);
    try {
      const { data } = await api.post('/website/pages', { title, slug, puck_data, status: 'published' });
      navigate(`/admin/website/pages/${data.id}/edit`);
    } catch (e) {
      toast(parseApiError(e, 'Failed to create page'), 'error');
    } finally {
      setCreating(false);
    }
  }

  async function clonePage(id) {
    try {
      const { data } = await api.post(`/website/pages/${id}/clone`);
      navigate(`/admin/website/pages/${data.id}/edit`);
    } catch (e) {
      toast(parseApiError(e, 'Clone failed'), 'error');
    }
  }

  async function deletePage(id, title) {
    if (!(await confirm(`Delete "${title}"? This cannot be undone.`))) return;
    try {
      await api.delete(`/website/pages/${id}`);
      setPages(prev => prev.filter(p => p.id !== id));
    } catch (e) {
      toast(parseApiError(e, 'Delete failed'), 'error');
    }
  }

  const statusBadge = s => (
    <span className={`badge ${s === 'published' ? 'bg-success' : 'bg-secondary'}`}>{s}</span>
  );

  return (
    <div className="p-4">
      <PageHeader
        title="Website Pages"
        subtitle="Manage your public website pages"
        actions={
          <button className="btn btn-primary btn-sm" onClick={() => setShowTemplates(true)}>
            <iconify-icon icon="solar:add-circle-line-duotone" className="me-1" />
            + New Page
          </button>
        }
      />

      {loading ? (
        <div className="text-center py-5"><span className="spinner-border text-primary" /></div>
      ) : (
        <div className="card">
          <div className="table-responsive">
            <table className="table table-hover mb-0">
              <thead className="table-light">
                <tr>
                  <th>Title</th>
                  <th>Slug</th>
                  <th>Status</th>
                  <th>Last Updated By</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {pages.map(p => (
                  <tr key={p.id}>
                    <td><strong>{p.title}</strong></td>
                    <td><code>/{p.slug}</code></td>
                    <td>{statusBadge(p.status)}</td>
                    <td className="text-muted small">
                      {p.first_name ? <span className="fw-semibold text-dark">{p.first_name} {p.last_name}</span> : <span className="text-muted">—</span>}
                      <br /><span style={{ fontSize: '0.75rem' }}>{new Date(p.updated_at).toLocaleDateString()}</span>
                    </td>
                    <td className="text-end">
                      <a href={`/${p.slug}`} target="_blank" rel="noopener noreferrer" className="btn btn-sm btn-outline-secondary me-1">Preview ↗</a>
                      <button className="btn btn-sm btn-outline-info me-1" onClick={() => setAdaPage(p)} title="Run ADA / WCAG accessibility audit">ADA ♿</button>
                      <Link to={`/admin/website/pages/${p.id}/edit`} className="btn btn-sm btn-outline-primary me-1">Edit</Link>
                      <button className="btn btn-sm btn-outline-secondary me-1" onClick={() => clonePage(p.id)} title="Clone this page as a draft">Clone</button>
                      <button className="btn btn-sm btn-outline-danger" onClick={() => deletePage(p.id, p.title)}>Delete</button>
                    </td>
                  </tr>
                ))}
                {!pages.length && (
                  <tr><td colSpan={5} className="text-center text-muted py-5">No pages yet. Click "New Page" to get started.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {adaPage && <AdaModal page={adaPage} onClose={() => setAdaPage(null)} />}

      {showTemplates && (
        <TemplatePickerModal
          onClose={() => setShowTemplates(false)}
          onPick={createFromTemplate}
        />
      )}

      {confirmDialog}
    </div>
  );
}
