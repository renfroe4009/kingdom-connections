import { useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../../api/client.js';
import { toast } from '../../components/Toast.jsx';
import { parseApiError } from '../../utils/apiError.js';

// =============================================================================
// ImportDesignModal — upload a design ZIP (one page's HTML + css/ + js/ +
// assets/, same shape as website-files/) and turn it into a page, the way
// scripts/import-design.js already does for a whole folder from the CLI.
//
// Server side: POST /api/website/import/design-zip (routes/pageImport.js).
// Never auto-publishes and never overwrites a live page directly —
// "Create new page" lands as a draft; "Update an existing page" writes a
// reviewable snapshot to that page's Version History instead of touching its
// live content. See that route's header comment for the full safety model.
// =============================================================================

function toSlug(s) {
  return s.toLowerCase().trim().replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-');
}

function CssConflictRow({ c }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border rounded p-2 mb-2" style={{ background: '#fff8f0' }}>
      <button type="button" className="btn btn-sm btn-link p-0 text-start fw-semibold" onClick={() => setOpen((o) => !o)}>
        <code>{c.selector}</code> already exists on the site with different styling {open ? '▲' : '▼'}
      </button>
      {open && (
        <div className="row g-2 mt-1">
          <div className="col-md-6">
            <div className="text-muted small mb-1">Currently on the site</div>
            <pre className="small bg-light p-2 rounded mb-0" style={{ whiteSpace: 'pre-wrap' }}>{c.existing}</pre>
          </div>
          <div className="col-md-6">
            <div className="text-muted small mb-1">In the imported design</div>
            <pre className="small bg-light p-2 rounded mb-0" style={{ whiteSpace: 'pre-wrap' }}>{c.incoming}</pre>
          </div>
        </div>
      )}
      <p className="small text-muted mb-0 mt-1">
        Not applied automatically. Keep the site-wide style as-is, or copy the imported version into{' '}
        <strong>this page's own Custom CSS</strong> (Edit → Page Settings) if the new page needs it specifically.
      </p>
    </div>
  );
}

function ResultSummary({ result, onDone }) {
  const { mode, page_id, version_id, slug, conversion, assets, css } = result;
  const [applying, setApplying] = useState(false);
  const [applied, setApplied] = useState(false);

  // Same endpoint as Version History's Restore, which saves the page's current
  // content as a snapshot first — so applying here can still be undone.
  async function applyNow() {
    setApplying(true);
    try {
      await api.post(`/website/versions/${version_id}/restore`);
      setApplied(true);
      toast('Imported design applied to the page.', 'success');
    } catch (e) {
      toast(parseApiError(e, 'Could not apply the import.'), 'error');
    } finally {
      setApplying(false);
    }
  }

  return (
    <div>
      <div className="alert alert-success d-flex align-items-center gap-2">
        <iconify-icon icon="solar:check-circle-bold" style={{ fontSize: '1.3rem' }} />
        <div>
          {mode === 'new'
            ? <>Imported as a new <strong>draft</strong> page at <code>/{slug}</code>.</>
            : applied
              ? <>Applied to <code>/{slug}</code>. Its previous content was saved to Version History, so you can restore it back from the page's History button.</>
              : <>Imported — saved as a new snapshot on <code>/{slug}</code>'s Version History. The page hasn't changed yet: click <strong>Apply now</strong> to use it, or review it later from History.</>}
        </div>
      </div>

      <div className="row g-3 mb-3">
        <div className="col-4">
          <div className="border rounded p-2 text-center h-100">
            <div className="fs-4 fw-bold">{conversion.converted}/{conversion.total}</div>
            <div className="text-muted small">blocks converted to editable components ({conversion.sections} section{conversion.sections === 1 ? '' : 's'})</div>
          </div>
        </div>
        <div className="col-4">
          <div className="border rounded p-2 text-center h-100">
            <div className="fs-4 fw-bold">{assets.added}</div>
            <div className="text-muted small">new image{assets.added === 1 ? '' : 's'} added to Media Library{assets.reused ? ` (${assets.reused} reused)` : ''}</div>
          </div>
        </div>
        <div className="col-4">
          <div className="border rounded p-2 text-center h-100">
            <div className="fs-4 fw-bold">{css.added.length}</div>
            <div className="text-muted small">new CSS rule{css.added.length === 1 ? '' : 's'} added{css.reused.length ? ` (${css.reused.length} already on the site, reused)` : ''}</div>
          </div>
        </div>
      </div>

      {assets.rejected?.length > 0 && (
        <div className="alert alert-warning small">
          {assets.rejected.length} file{assets.rejected.length === 1 ? '' : 's'} skipped — content didn't match an allowed image type:
          <ul className="mb-0 mt-1">
            {assets.rejected.map((r, i) => <li key={i}>{r.file} — {r.reason}</li>)}
          </ul>
        </div>
      )}

      {css.conflicts?.length > 0 && (
        <div className="mb-3">
          <h6 className="fw-semibold">CSS needing a decision ({css.conflicts.length})</h6>
          {css.conflicts.map((c, i) => <CssConflictRow key={i} c={c} />)}
        </div>
      )}

      {conversion.converted < conversion.total && (
        <p className="small text-muted">
          {conversion.total - conversion.converted} section{conversion.total - conversion.converted === 1 ? '' : 's'} didn't match a known component pattern and came in as raw HTML — still renders exactly as designed, just not drag-and-editable yet.
        </p>
      )}

      <div className="d-flex gap-2 justify-content-end flex-wrap mt-4">
        <button className="btn btn-outline-secondary" onClick={onDone} disabled={applying}>
          {mode === 'update' && !applied ? 'Apply later' : 'Close'}
        </button>
        {mode === 'new' || applied ? (
          <Link to={`/admin/website/pages/${page_id}/edit`} className="btn btn-primary" onClick={onDone}>
            Open in Builder →
          </Link>
        ) : (
          <button className="btn btn-primary" onClick={applyNow} disabled={applying}>
            {applying ? <><span className="spinner-border spinner-border-sm me-1" />Applying…</> : 'Apply now'}
          </button>
        )}
      </div>
    </div>
  );
}

export default function ImportDesignModal({ pages, onClose, onImported }) {
  const [mode, setMode] = useState('new'); // 'new' | 'update'
  const [file, setFile] = useState(null);
  const [title, setTitle] = useState('');
  const [slug, setSlug] = useState('');
  const [targetPageId, setTargetPageId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);

  function onFileChange(e) {
    const f = e.target.files?.[0] || null;
    setFile(f);
    if (f && !title) {
      const base = f.name.replace(/\.zip$/i, '').replace(/[-_]+/g, ' ');
      setTitle(base);
      setSlug(toSlug(base));
    }
  }

  async function submit() {
    setError('');
    if (!file) return setError('Choose a .zip file first.');
    if (mode === 'new' && !slug.trim()) return setError('Enter a slug for the new page.');
    if (mode === 'update' && !targetPageId) return setError('Choose which page this design updates.');

    const fd = new FormData();
    fd.append('file', file);
    fd.append('mode', mode);
    if (mode === 'new') {
      fd.append('title', title.trim() || slug.trim());
      fd.append('slug', slug.trim());
    } else {
      fd.append('page_id', targetPageId);
    }

    setBusy(true);
    try {
      const { data } = await api.post('/website/import/design-zip', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      setResult(data);
    } catch (e) {
      setError(parseApiError(e, 'Import failed.'));
    } finally {
      setBusy(false);
    }
  }

  function done() {
    onImported?.();
    onClose();
  }

  return (
    <div className="modal d-block" style={{ background: 'rgba(0,0,0,0.55)' }} onClick={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div className="modal-dialog modal-lg modal-dialog-centered modal-dialog-scrollable">
        <div className="modal-content">
          <div className="modal-header">
            <h5 className="modal-title">Import Design (ZIP)</h5>
            <button type="button" className="btn-close" onClick={onClose} disabled={busy} />
          </div>
          <div className="modal-body">
            {result ? (
              <ResultSummary result={result} onDone={done} />
            ) : (
              <>
                <p className="text-muted small">
                  Upload a ZIP containing one page's design — an <code>.html</code> file plus its <code>css/</code>, <code>js/</code> and <code>assets/</code> folders (the same shape as a whole design export, just for one page). Sections matching a known pattern become real, editable components; anything else comes in as HTML that renders identically. New images are added to the Media Library; CSS already on the site is reused instead of duplicated.
                </p>

                <div className="mb-3">
                  <label className="form-label fw-medium">Design ZIP</label>
                  <input type="file" accept=".zip" className="form-control" onChange={onFileChange} disabled={busy} />
                </div>

                <div className="mb-3">
                  <div className="btn-group w-100" role="group">
                    <button type="button" className={`btn ${mode === 'new' ? 'btn-primary' : 'btn-outline-secondary'}`} onClick={() => setMode('new')} disabled={busy}>
                      Create new page
                    </button>
                    <button type="button" className={`btn ${mode === 'update' ? 'btn-primary' : 'btn-outline-secondary'}`} onClick={() => setMode('update')} disabled={busy}>
                      Update an existing page
                    </button>
                  </div>
                </div>

                {mode === 'new' ? (
                  <div className="row g-2 mb-3">
                    <div className="col-md-6">
                      <label className="form-label small">Page Title</label>
                      <input className="form-control" value={title} onChange={(e) => { setTitle(e.target.value); setSlug(toSlug(e.target.value)); }} disabled={busy} />
                    </div>
                    <div className="col-md-6">
                      <label className="form-label small">Slug</label>
                      <div className="input-group">
                        <span className="input-group-text">/</span>
                        <input className="form-control font-monospace" value={slug} onChange={(e) => setSlug(e.target.value)} disabled={busy} />
                      </div>
                    </div>
                    <div className="col-12 form-text">Creates a new page as a <strong>draft</strong> — nothing goes live until you publish it.</div>
                  </div>
                ) : (
                  <div className="mb-3">
                    <label className="form-label small">Which page is this design for?</label>
                    <select className="form-select" value={targetPageId} onChange={(e) => setTargetPageId(e.target.value)} disabled={busy}>
                      <option value="">Choose a page…</option>
                      {pages.map((p) => <option key={p.id} value={p.id}>{p.title} (/{p.slug})</option>)}
                    </select>
                    <div className="form-text">
                      The live page is <strong>not changed</strong>. This saves the imported content as a new entry in that page's Version History, for you to review and restore when ready.
                    </div>
                  </div>
                )}

                {error && <div className="alert alert-danger small mb-0">{error}</div>}
              </>
            )}
          </div>
          {!result && (
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={onClose} disabled={busy}>Cancel</button>
              <button className="btn btn-primary" onClick={submit} disabled={busy || !file}>
                {busy ? <><span className="spinner-border spinner-border-sm me-1" />Importing…</> : 'Import →'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
