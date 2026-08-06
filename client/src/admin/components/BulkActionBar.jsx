import { useEffect, useState } from 'react';
import api from '../../api/client.js';
import Modal from '../../components/Modal.jsx';
import { toast } from '../../components/Toast.jsx';
import { parseApiError } from '../../utils/apiError.js';

const LIFECYCLE_STAGES = ['lead', 'mql', 'sql', 'customer', 'evangelist', 'other'];

/**
 * Bulk-action bar shown above a contacts/organizations table once rows are
 * selected. Only supports the currently-loaded page of rows — there is no
 * select-all-matching-filter across pages, so the count always reads
 * "N selected on this page" to avoid implying a broader scope than it has.
 *
 * Props:
 *   entityType     'contact' | 'organization' — drives the bulk endpoint path
 *   selectedIds    Set<number>
 *   onClear        () => void — clear selection after apply or cancel
 *   onApplied      () => void — refetch the list after a successful bulk edit
 *   showStage      whether to offer "Set lifecycle stage" (contacts only)
 */
export default function BulkActionBar({ entityType, selectedIds, onClear, onApplied, showStage = false }) {
  const [allTags, setAllTags] = useState([]);
  const [owners, setOwners] = useState([]);
  const [mode, setMode] = useState(null); // 'add_tag' | 'remove_tag' | 'owner' | 'stage'
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get('/tags').then((r) => setAllTags(r.data || [])).catch(() => {});
    api.get('/users/assignable').then((r) => setOwners(Array.isArray(r.data) ? r.data : [])).catch(() => {});
  }, []);

  if (selectedIds.size === 0) return null;

  const base = entityType === 'contact' ? '/contacts' : '/organizations';

  function openMode(m) { setMode(m); setValue(''); }
  function close() { setMode(null); setValue(''); }

  async function apply() {
    if (!value) return;
    const payload = { ids: [...selectedIds] };
    if (mode === 'add_tag') payload.add_tag_ids = [Number(value)];
    else if (mode === 'remove_tag') payload.remove_tag_ids = [Number(value)];
    else if (mode === 'owner') payload.set = { owner_id: Number(value) };
    else if (mode === 'stage') payload.set = { lifecycle_stage: value };

    setBusy(true);
    try {
      const { data } = await api.patch(`${base}/bulk`, payload);
      toast(
        data.skipped
          ? `Updated ${data.updated}, skipped ${data.skipped} outside your scope.`
          : `Updated ${data.updated} record${data.updated === 1 ? '' : 's'}.`,
        'success'
      );
      close();
      onClear();
      onApplied?.();
    } catch (e) {
      toast(parseApiError(e, 'Bulk update failed'), 'error');
    } finally {
      setBusy(false);
    }
  }

  const modeConfig = {
    add_tag:    { title: 'Add tag', options: allTags.map((t) => ({ value: t.id, label: t.name })) },
    remove_tag: { title: 'Remove tag', options: allTags.map((t) => ({ value: t.id, label: t.name })) },
    owner:      { title: 'Reassign owner', options: owners.map((u) => ({ value: u.id, label: `${u.first_name || ''} ${u.last_name || ''}`.trim() })) },
    stage:      { title: 'Set lifecycle stage', options: LIFECYCLE_STAGES.map((s) => ({ value: s, label: s })) },
  };

  return (
    <div className="d-flex align-items-center gap-2 p-2 mb-3 rounded" style={{ background: '#FAF5F0' }}>
      <span className="fw-semibold small">{selectedIds.size} selected on this page</span>
      <button className="btn btn-sm btn-light" onClick={() => openMode('add_tag')}>Add tag</button>
      <button className="btn btn-sm btn-light" onClick={() => openMode('remove_tag')}>Remove tag</button>
      <button className="btn btn-sm btn-light" onClick={() => openMode('owner')}>Reassign owner</button>
      {showStage && <button className="btn btn-sm btn-light" onClick={() => openMode('stage')}>Set stage</button>}
      <button className="btn btn-sm btn-link text-muted ms-auto" onClick={onClear}>Clear selection</button>

      <Modal show={!!mode} onClose={close} title={mode ? modeConfig[mode].title : ''}
        footer={<>
          <button className="btn btn-light" onClick={close}>Cancel</button>
          <button className="btn btn-primary" onClick={apply} disabled={busy || !value}>
            {busy ? <><span className="spinner-border spinner-border-sm me-2" />Applying…</> : 'Apply'}
          </button>
        </>}>
        {mode && (
          <select className="form-select" value={value} onChange={(e) => setValue(e.target.value)}>
            <option value="">Select…</option>
            {modeConfig[mode].options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        )}
      </Modal>
    </div>
  );
}
