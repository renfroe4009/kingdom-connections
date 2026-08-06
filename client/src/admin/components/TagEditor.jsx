import { useEffect, useMemo, useState } from 'react';
import api from '../../api/client.js';
import SearchableSelect from '../../components/SearchableSelect.jsx';
import { toast } from '../../components/Toast.jsx';
import { parseApiError } from '../../utils/apiError.js';

const ENDPOINT_BASE = { contact: '/contacts', organization: '/organizations' };

/**
 * Chip-list tag editor shared by ContactDetail and OrganizationDetail.
 * Fetches the full tag catalog once, lets the user add any tag not already
 * applied (via a searchable dropdown) or remove one (× on the chip), and
 * persists each change immediately through the dedicated tags-only endpoint
 * (PATCH /contacts/:id/tags or /organizations/:id/tags) rather than the
 * full record PUT, so an org's required `name` field never has to be resent.
 *
 * Props:
 *   entityType  'contact' | 'organization'
 *   entityId    number
 *   tags        current tags: Array<{ id, name, color }>
 *   onChange    (newTags) => void — parent updates its own state
 *   canEdit     whether add/remove controls render (default true)
 */
export default function TagEditor({ entityType, entityId, tags = [], onChange, canEdit = true }) {
  const [allTags, setAllTags] = useState([]);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    api.get('/tags').then(({ data }) => setAllTags(data)).catch(() => {});
  }, []);

  const base = ENDPOINT_BASE[entityType];
  const currentIds = useMemo(() => new Set(tags.map((t) => t.id)), [tags]);
  const options = useMemo(
    () => allTags.filter((t) => !currentIds.has(t.id)).map((t) => ({ value: t.id, label: t.name })),
    [allTags, currentIds]
  );

  async function persist(newIds) {
    setBusy(true);
    try {
      const { data } = await api.patch(`${base}/${entityId}/tags`, { tag_ids: newIds });
      onChange?.(data.tags);
    } catch (e) {
      toast(parseApiError(e, 'Failed to update tags'), 'error');
    } finally {
      setBusy(false);
    }
  }

  function addTag(tagId) {
    if (!tagId) return;
    setAdding(false);
    persist([...tags.map((t) => t.id), Number(tagId)]);
  }

  function removeTag(tagId) {
    persist(tags.filter((t) => t.id !== tagId).map((t) => t.id));
  }

  return (
    <div className="card mt-3">
      <div className="card-body">
        <h6 className="fw-bold text-uppercase small text-muted">Tags</h6>
        <div className="d-flex flex-wrap gap-2 align-items-center">
          {tags.map((t) => (
            <span key={t.id} className="tag-chip d-inline-flex align-items-center gap-1" style={{ background: t.color }}>
              {t.name}
              {canEdit && (
                <button type="button" className="btn-close btn-close-white" style={{ fontSize: '0.55rem' }}
                  disabled={busy} onClick={() => removeTag(t.id)} title={`Remove ${t.name}`} />
              )}
            </span>
          ))}
          {tags.length === 0 && <span className="text-muted small">No tags yet.</span>}
        </div>
        {canEdit && (
          <div className="mt-2">
            {adding ? (
              <div style={{ maxWidth: 220 }}>
                <SearchableSelect
                  options={options}
                  value=""
                  onChange={addTag}
                  placeholder="Search tags…"
                  emptyText="No more tags to add."
                  allowClear={false}
                />
              </div>
            ) : (
              <button type="button" className="btn btn-sm btn-light" disabled={busy} onClick={() => setAdding(true)}>
                <iconify-icon icon="solar:add-circle-line-duotone" class="me-1"></iconify-icon> Add tag
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
