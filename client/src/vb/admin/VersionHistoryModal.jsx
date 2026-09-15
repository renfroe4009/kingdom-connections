import { useState, useEffect, useCallback } from 'react';
import api from '../../api/client.js';
import { toast } from '../../components/Toast.jsx';
import { parseApiError } from '../../utils/apiError.js';
import { useConfirm } from '../../hooks/useConfirm.jsx';

// =============================================================================
// VersionHistoryModal — lists a page's saved snapshots (website_versions) and
// restores one over the live page content.
//
// The backend side of this (GET /pages/:id/versions, POST /versions/:vid/restore)
// already existed — every builder Save quietly snapshots the previous content
// before overwriting it. There was just no screen to see or use that history.
// Built alongside the design-ZIP importer because "import as an update"
// deliberately writes its proposed content here rather than touching the live
// page directly — a version an admin reviews and restores, not an
// auto-applied overwrite. Restoring works the same for any snapshot, import
// or otherwise.
// =============================================================================
export default function VersionHistoryModal({ page, onClose, onRestored }) {
  const [versions, setVersions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [restoringId, setRestoringId] = useState(null);
  const { confirm, dialog: confirmDialog } = useConfirm();

  const load = useCallback(() => {
    setLoading(true);
    api.get(`/website/pages/${page.id}/versions`)
      .then((r) => setVersions(r.data))
      .catch((e) => toast(parseApiError(e, 'Could not load version history.'), 'error'))
      .finally(() => setLoading(false));
  }, [page.id]);

  useEffect(() => { load(); }, [load]);

  async function restore(v) {
    const ok = await confirm(
      `Replace this page's content with "${v.snapshot_label || 'this version'}"? Nothing is deleted — the current content is saved to Version History first, so you can restore it back at any time.`,
      { title: 'Restore this version?', confirmLabel: 'Restore', danger: false }
    );
    if (!ok) return;
    setRestoringId(v.id);
    try {
      await api.post(`/website/versions/${v.id}/restore`);
      toast('Restored. Open the page in the builder to review it.', 'success');
      onRestored?.();
      load();
    } catch (e) {
      toast(parseApiError(e, 'Restore failed.'), 'error');
    } finally {
      setRestoringId(null);
    }
  }

  return (
    <div className="modal d-block" style={{ background: 'rgba(0,0,0,0.55)' }} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-dialog modal-lg modal-dialog-centered modal-dialog-scrollable">
        <div className="modal-content">
          <div className="modal-header">
            <div>
              <h5 className="modal-title mb-0">Version History</h5>
              <p className="text-muted small mb-0">/{page.slug}</p>
            </div>
            <button type="button" className="btn-close" onClick={onClose} />
          </div>
          <div className="modal-body">
            {loading ? (
              <div className="text-center py-4"><span className="spinner-border text-primary" /></div>
            ) : versions.length === 0 ? (
              <p className="text-muted text-center py-4 mb-0">No saved snapshots yet — one is created automatically the next time this page is saved or a design is imported over it.</p>
            ) : (
              <div className="list-group">
                {versions.map((v) => (
                  <div key={v.id} className="list-group-item d-flex align-items-center justify-content-between flex-wrap gap-2">
                    <div>
                      <div className="fw-semibold">{v.snapshot_label || 'Untitled snapshot'}</div>
                      <div className="text-muted small">
                        {new Date(v.created_at).toLocaleString()}
                        {v.user_name ? ` · ${v.user_name}` : ''}
                      </div>
                    </div>
                    <button
                      className="btn btn-sm btn-outline-primary"
                      disabled={restoringId === v.id}
                      onClick={() => restore(v)}
                    >
                      {restoringId === v.id ? <><span className="spinner-border spinner-border-sm me-1" />Restoring…</> : 'Restore'}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
      {confirmDialog}
    </div>
  );
}
