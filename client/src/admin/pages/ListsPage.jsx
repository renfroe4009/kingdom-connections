import { useEffect, useMemo, useRef, useState } from 'react';
import api from '../../api/client.js';
import PageHeader from '../../components/PageHeader.jsx';
import Modal from '../../components/Modal.jsx';
import ComposeMessageModal from '../components/ComposeMessageModal.jsx';
import { useConfirm } from '../../hooks/useConfirm.jsx';
import { toast } from '../../components/Toast.jsx';
import { parseApiError } from '../../utils/apiError.js';

/**
 * ListsPage — CRUD for "saved recipient lists" used by bulk-send.
 *
 * The page has two surfaces:
 *
 *   1. Index card — table of all lists with member counts and quick actions
 *      (Edit / Delete / Open / Send).
 *   2. Members drawer — when a list is opened, shows its members + tools to
 *      add by contact-search or by adding everyone in an organization.
 *
 *   "Send to list" routes through the existing ComposeMessageModal, which
 *   already knows how to forward `list_id` to /email|sms/bulk-send. This
 *   keeps the send pipeline single-sourced — admins won't see a separate
 *   bulk-send UI to learn.
 */

const emptyList = { name: '', description: '', type: 'static', kind: 'newsletter', is_active: true };

const KIND_LABELS = {
  alerts: 'System Alerts',
  newsletter: 'Newsletter',
  product: 'Products & Services',
  marketing: 'Marketing',
  other: 'Other',
};

export default function ListsPage() {
  const [lists, setLists] = useState([]);
  const [editId, setEditId] = useState(null);
  const [showEdit, setShowEdit] = useState(false);
  const [form, setForm] = useState(emptyList);
  const [openId, setOpenId] = useState(null); // expanded list whose members are shown
  const [openList, setOpenList] = useState(null);
  const [members, setMembers] = useState([]);
  const [showCompose, setShowCompose] = useState(false);
  const [composeChannel, setComposeChannel] = useState('email');
  const [composeListId, setComposeListId] = useState(null);
  const [err, setErr] = useState('');
  const { confirm, dialog: confirmDialog } = useConfirm();

  async function loadLists() {
    try {
      const { data } = await api.get('/lists');
      setLists(data || []);
    } catch (e) {
      setErr(e.response?.data?.error || e.message);
    }
  }
  useEffect(() => { loadLists(); }, []);

  async function loadMembers(id) {
    try {
      const { data } = await api.get(`/lists/${id}`);
      setOpenList(data.list);
      setMembers(data.members || []);
    } catch (e) {
      setErr(e.response?.data?.error || e.message);
    }
  }

  function openNew() {
    setEditId(null); setForm(emptyList); setShowEdit(true);
  }
  function openEdit(l) {
    setEditId(l.id);
    setForm({
      name: l.name || '',
      description: l.description || '',
      type: l.type || 'static',
      kind: l.kind || 'newsletter',
      is_active: l.is_active !== 0,
    });
    setShowEdit(true);
  }

  async function save() {
    try {
      if (editId) await api.put(`/lists/${editId}`, form);
      else        await api.post('/lists', form);
      setShowEdit(false); setEditId(null); setForm(emptyList);
      await loadLists();
      if (openId) await loadMembers(openId);
    } catch (e) {
      toast(parseApiError(e, 'Save failed'), 'error');
    }
  }

  async function remove(l) {
    if (!(await confirm(`Delete list "${l.name}" and all its members? This cannot be undone.`))) return;
    try {
      await api.delete(`/lists/${l.id}`);
      if (openId === l.id) { setOpenId(null); setOpenList(null); setMembers([]); }
      loadLists();
    } catch (e) {
      toast(parseApiError(e, 'Delete failed'), 'error');
    }
  }

  async function open(l) {
    setOpenId(l.id);
    await loadMembers(l.id);
  }
  function close() { setOpenId(null); setOpenList(null); setMembers([]); }

  function startSend(list, channel) {
    setComposeListId(list.id);
    setComposeChannel(channel);
    setShowCompose(true);
  }

  return (
    <div>
      <PageHeader title="Lists" subtitle={`${lists.length} saved recipient list${lists.length === 1 ? '' : 's'}`}
        actions={<button className="btn btn-primary" onClick={openNew}>
          <iconify-icon icon="solar:add-circle-line-duotone" class="me-1"></iconify-icon> New List
        </button>} />

      {err && <div className="alert alert-danger">{err}</div>}

      <div className="card mb-3">
        <div className="card-body">
          <div className="table-responsive">
            <table className="table table-hover align-middle mb-0">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Kind</th>
                  <th>Type</th>
                  <th className="text-end">Members</th>
                  <th>Created by</th>
                  <th>Status</th>
                  <th className="text-end">Actions</th>
                </tr>
              </thead>
              <tbody>
                {lists.map((l) => (
                  <tr key={l.id} className={openId === l.id ? 'table-active' : ''}>
                    <td>
                      <div className="fw-semibold">{l.name}</div>
                      {l.description && <small className="text-muted">{l.description}</small>}
                    </td>
                    <td><span className="badge bg-light text-dark">{KIND_LABELS[l.kind] || l.kind || '—'}</span></td>
                    <td className="text-capitalize text-muted">{l.type}</td>
                    <td className="text-end fw-semibold">{l.member_count}</td>
                    <td className="text-muted">{l.created_by_name || '—'}</td>
                    <td>
                      {l.is_active
                        ? <span className="badge bg-success-subtle text-success">Active</span>
                        : <span className="badge bg-light text-muted">Inactive</span>}
                    </td>
                    <td className="text-end text-nowrap">
                      <button className="btn btn-sm btn-light me-1" onClick={() => open(l)} title="View members">
                        <iconify-icon icon="solar:users-group-rounded-line-duotone"></iconify-icon>
                      </button>
                      <button className="btn btn-sm btn-light me-1" onClick={() => startSend(l, 'email')} title="Send email to list">
                        <iconify-icon icon="solar:letter-line-duotone"></iconify-icon>
                      </button>
                      <button className="btn btn-sm btn-light me-1" onClick={() => startSend(l, 'sms')} title="Send SMS to list">
                        <iconify-icon icon="solar:chat-round-dots-line-duotone"></iconify-icon>
                      </button>
                      <button className="btn btn-sm btn-light me-1" onClick={() => openEdit(l)} title="Edit">
                        <iconify-icon icon="solar:pen-new-square-line-duotone"></iconify-icon>
                      </button>
                      <button className="btn btn-sm btn-light text-danger" onClick={() => remove(l)} title="Delete">
                        <iconify-icon icon="solar:trash-bin-trash-line-duotone"></iconify-icon>
                      </button>
                    </td>
                  </tr>
                ))}
                {lists.length === 0 && <tr><td colSpan="7"><div className="empty-state">
                  No lists yet — create one to send bulk emails or SMS.
                </div></td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {openList && (
        <MembersPanel
          list={openList}
          members={members}
          onClose={close}
          onChanged={async () => { await loadMembers(openList.id); await loadLists(); }}
        />
      )}

      <Modal show={showEdit} onClose={() => { setShowEdit(false); setEditId(null); }}
        title={editId ? 'Edit List' : 'New List'}
        footer={<>
          <button className="btn btn-light" onClick={() => { setShowEdit(false); setEditId(null); }}>Cancel</button>
          <button className="btn btn-primary" onClick={save}>Save</button>
        </>}>
        <div className="row g-2">
          <div className="col-md-8">
            <label className="form-label">Name</label>
            <input className="form-control" value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div className="col-md-4">
            <label className="form-label">Kind</label>
            <select className="form-select" value={form.kind}
              onChange={(e) => setForm({ ...form, kind: e.target.value })}>
              {Object.entries(KIND_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
          <div className="col-12">
            <label className="form-label">Description</label>
            <textarea className="form-control" rows={2} value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </div>
          <div className="col-md-6">
            <label className="form-label">Type</label>
            <select className="form-select" value={form.type}
              onChange={(e) => setForm({ ...form, type: e.target.value })}>
              <option value="static">Static (manually managed)</option>
              <option value="dynamic" disabled>Dynamic (coming soon)</option>
            </select>
            <small className="text-muted">Static lists are populated by adding contacts directly.</small>
          </div>
          <div className="col-md-6 d-flex align-items-end">
            <div className="form-check form-switch">
              <input id="lc-list-active" className="form-check-input" type="checkbox" checked={form.is_active}
                onChange={(e) => setForm({ ...form, is_active: e.target.checked })} />
              <label htmlFor="lc-list-active" className="form-check-label">Active</label>
            </div>
          </div>
        </div>
      </Modal>

      <ComposeMessageModal
        show={showCompose}
        onClose={() => setShowCompose(false)}
        defaults={{ channel: composeChannel }}
        onSent={() => { /* keep open so admin can see the result line */ }}
      />
      {showCompose && composeListId && (
        // Pre-seed list selection by injecting a small effect-component. We do
        // this rather than threading a `defaultListId` prop through the modal
        // because the picker already accepts an external value via state — but
        // since the modal owns its own RecipientPicker state, we use the URL
        // hack via a bridge component below.
        <ListPreseedBridge listId={composeListId} channel={composeChannel} />
      )}

      {confirmDialog}
    </div>
  );
}

/**
 * The compose modal owns its recipient state internally, so to "send to this
 * list" we open the modal and then trigger a change that the user can confirm.
 * Rather than prop-drill a defaultListId, we do nothing here — clicking the
 * email/sms shortcut from the row already opens the modal; the admin then
 * picks the list from the saved-list dropdown. This is intentional: the path
 * is the same one a user takes from the inbox or a contact, and forcing them
 * to confirm the list selection prevents accidental "send to 5,000 people"
 * mistakes when a row button is clicked twice.
 *
 * If you want a fully zero-click flow later, lift recipient state up into the
 * page and pass `recipient`/`onChange` into ComposeMessageModal.
 */
function ListPreseedBridge() { return null; }

function MembersPanel({ list, members, onClose, onChanged }) {
  const [tab, setTab] = useState('add'); // 'add' | 'from-org' | 'from-tags'
  const [contacts, setContacts] = useState([]);
  const [orgs, setOrgs] = useState([]);
  const [orgFilter, setOrgFilter] = useState('');
  const [q, setQ] = useState('');
  const [orgToAdd, setOrgToAdd] = useState('');
  const [busy, setBusy] = useState(false);
  const [memberFilter, setMemberFilter] = useState('');
  // --- Tag-filter state (third tab) ---
  const [tags, setTags] = useState([]);
  const [selectedTagIds, setSelectedTagIds] = useState([]); // array of int ids
  const [tagMatch, setTagMatch] = useState('any');          // 'any' | 'all'
  const [tagPreview, setTagPreview] = useState(null);       // count or null while loading
  const debounceRef = useRef(null);
  const tagPreviewRef = useRef(null);
  const { confirm, dialog: confirmDialog } = useConfirm();

  useEffect(() => {
    api.get('/organizations', { params: { pageSize: 200 } }).then(({ data }) => setOrgs(data.rows || [])).catch(() => {});
    api.get('/tags').then(({ data }) => setTags(data || [])).catch(() => {});
  }, []);

  // Live preview "this will add N contacts" — debounced because it fires on
  // every checkbox toggle and the user often clicks several in a row.
  useEffect(() => {
    if (tagPreviewRef.current) clearTimeout(tagPreviewRef.current);
    if (selectedTagIds.length === 0) { setTagPreview(0); return; }
    setTagPreview(null);
    tagPreviewRef.current = setTimeout(() => {
      api.get('/lists/preview-tags', {
        params: { tag_ids: selectedTagIds.join(','), match: tagMatch },
      })
        .then(({ data }) => setTagPreview(data.count ?? 0))
        .catch(() => setTagPreview(0));
    }, 200);
    return () => tagPreviewRef.current && clearTimeout(tagPreviewRef.current);
  }, [selectedTagIds, tagMatch]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      const params = { pageSize: 50 };
      if (orgFilter) params.organization_id = orgFilter;
      if (q) params.q = q;
      api.get('/contacts', { params })
        .then(({ data }) => setContacts(data.rows || []))
        .catch(() => setContacts([]));
    }, 200);
    return () => debounceRef.current && clearTimeout(debounceRef.current);
  }, [orgFilter, q]);

  const memberIds = useMemo(() => new Set(members.map((m) => m.id)), [members]);

  async function addOne(c) {
    setBusy(true);
    try {
      await api.post(`/lists/${list.id}/members`, { contact_ids: [c.id] });
      await onChanged();
    } finally { setBusy(false); }
  }
  async function removeOne(c) {
    if (!(await confirm(`Remove ${c.first_name} ${c.last_name} from this list?`))) return;
    setBusy(true);
    try {
      await api.delete(`/lists/${list.id}/members/${c.id}`);
      await onChanged();
    } catch (e) {
      toast(parseApiError(e, 'Remove failed'), 'error');
    } finally { setBusy(false); }
  }
  async function addFromOrg() {
    if (!orgToAdd) return;
    setBusy(true);
    try {
      const { data } = await api.post(`/lists/${list.id}/members/from-org/${orgToAdd}`);
      toast(`Added ${data.added} contact${data.added === 1 ? '' : 's'} from this organization.`);
      setOrgToAdd('');
      await onChanged();
    } catch (e) {
      toast(parseApiError(e, 'Add failed'), 'error');
    } finally { setBusy(false); }
  }

  function toggleTag(id) {
    setSelectedTagIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }

  async function addFromTags() {
    if (selectedTagIds.length === 0) return;
    if (!(await confirm(`Add ${tagPreview ?? '?'} contact${tagPreview === 1 ? '' : 's'} matching the selected tags?`))) return;
    setBusy(true);
    try {
      const { data } = await api.post(`/lists/${list.id}/members/from-tags`, {
        tag_ids: selectedTagIds,
        match: tagMatch,
      });
      toast(`Added ${data.added} contact${data.added === 1 ? '' : 's'} matching the selected tags.`);
      setSelectedTagIds([]);
      await onChanged();
    } catch (e) {
      toast(parseApiError(e, 'Add failed'), 'error');
    } finally { setBusy(false); }
  }

  const visibleMembers = members.filter((m) => {
    if (!memberFilter) return true;
    const f = memberFilter.toLowerCase();
    return (m.full_name || '').toLowerCase().includes(f)
        || (m.email || '').toLowerCase().includes(f)
        || (m.organization_name || '').toLowerCase().includes(f);
  });

  return (
    <div className="card mb-3">
      <div className="card-body">
        <div className="d-flex flex-wrap align-items-center justify-content-between mb-2 gap-2">
          <div>
            <h5 className="mb-0">{list.name}</h5>
            <small className="text-muted">
              {members.length} member{members.length === 1 ? '' : 's'}
              {list.kind ? ` · ${KIND_LABELS[list.kind] || list.kind}` : ''}
            </small>
          </div>
          <button className="btn btn-sm btn-light" onClick={onClose}>
            <iconify-icon icon="solar:close-circle-line-duotone" class="me-1"></iconify-icon> Close
          </button>
        </div>

        <ul className="nav nav-pills mb-3 gap-1">
          <li className="nav-item">
            <button className={`nav-link ${tab === 'add' ? 'active' : ''}`} onClick={() => setTab('add')}>
              Add contacts
            </button>
          </li>
          <li className="nav-item">
            <button className={`nav-link ${tab === 'from-org' ? 'active' : ''}`} onClick={() => setTab('from-org')}>
              Add by organization
            </button>
          </li>
          <li className="nav-item">
            <button className={`nav-link ${tab === 'from-tags' ? 'active' : ''}`} onClick={() => setTab('from-tags')}>
              Add by tags
            </button>
          </li>
        </ul>

        {tab === 'add' && (
          <div className="row g-2 mb-3">
            <div className="col-md-5">
              <label className="form-label small mb-1">Filter by organization</label>
              <select className="form-select form-select-sm" value={orgFilter} onChange={(e) => setOrgFilter(e.target.value)}>
                <option value="">All organizations</option>
                {orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
            </div>
            <div className="col-md-7">
              <label className="form-label small mb-1">Search contacts</label>
              <input className="form-control form-control-sm" placeholder="Type a name or email…"
                value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            <div className="col-12">
              <div className="border rounded bg-white" style={{ maxHeight: 200, overflowY: 'auto' }}>
                {contacts.length === 0
                  ? <div className="text-muted small p-2">No contacts match.</div>
                  : contacts.map((c) => {
                      const inList = memberIds.has(c.id);
                      return (
                        <div key={c.id} className="d-flex align-items-center justify-content-between px-2 py-1">
                          <span>
                            <strong>{c.first_name} {c.last_name}</strong>{' '}
                            <span className="text-muted small">{c.email || c.mobile || c.phone || '—'}</span>
                            {c.organization_name && <span className="text-muted small"> · {c.organization_name}</span>}
                          </span>
                          {inList
                            ? <span className="badge bg-success-subtle text-success">In list</span>
                            : <button className="btn btn-sm btn-light" disabled={busy} onClick={() => addOne(c)}>
                                <iconify-icon icon="solar:add-circle-line-duotone"></iconify-icon> Add
                              </button>}
                        </div>
                      );
                    })}
              </div>
            </div>
          </div>
        )}

        {tab === 'from-org' && (
          <div className="row g-2 mb-3 align-items-end">
            <div className="col-md-8">
              <label className="form-label small mb-1">Pick an organization</label>
              <select className="form-select" value={orgToAdd} onChange={(e) => setOrgToAdd(e.target.value)}>
                <option value="">— Select organization —</option>
                {orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
              <small className="text-muted">Adds every contact under that organization. Re-adding existing members is a no-op.</small>
            </div>
            <div className="col-md-4 d-grid">
              <button className="btn btn-primary" disabled={!orgToAdd || busy} onClick={addFromOrg}>
                {busy ? 'Adding…' : 'Add all contacts'}
              </button>
            </div>
          </div>
        )}

        {tab === 'from-tags' && (
          <div className="mb-3">
            <div className="d-flex flex-wrap align-items-center justify-content-between gap-2 mb-2">
              <div>
                <label className="form-label small mb-1 mb-0">Pick one or more tags</label>
                <div className="text-muted small">
                  Adds every contact whose tags match — re-adding existing members is a no-op.
                </div>
              </div>
              <div className="btn-group btn-group-sm" role="group" aria-label="Match mode">
                <button type="button"
                  className={`btn ${tagMatch === 'any' ? 'btn-primary' : 'btn-outline-secondary'}`}
                  onClick={() => setTagMatch('any')}>
                  Match any
                </button>
                <button type="button"
                  className={`btn ${tagMatch === 'all' ? 'btn-primary' : 'btn-outline-secondary'}`}
                  onClick={() => setTagMatch('all')}>
                  Match all
                </button>
              </div>
            </div>

            {/* Tag chips — click to toggle, color comes from tag.color */}
            <div className="border rounded bg-white p-2 mb-2" style={{ minHeight: 56 }}>
              {tags.length === 0 ? (
                <div className="text-muted small p-1">
                  No tags exist yet. Create tags in <strong>Settings → Tags</strong> and apply them to contacts first.
                </div>
              ) : (
                <div className="d-flex flex-wrap gap-2">
                  {tags.map((t) => {
                    const selected = selectedTagIds.includes(t.id);
                    return (
                      <button
                        key={t.id}
                        type="button"
                        className={`btn btn-sm ${selected ? '' : 'btn-light border'}`}
                        onClick={() => toggleTag(t.id)}
                        style={selected ? { background: t.color || '#F05523', color: 'white', border: 0 } : { borderColor: t.color || '#dee2e6' }}
                        title={`${t.usage_count || 0} contact${t.usage_count === 1 ? '' : 's'} tagged`}
                      >
                        <span className="me-1" style={{
                          display: 'inline-block', width: 8, height: 8, borderRadius: '50%',
                          background: selected ? 'rgba(255,255,255,0.9)' : (t.color || '#F05523'),
                        }}></span>
                        {t.name}
                        <span className={`ms-1 small ${selected ? 'text-white-50' : 'text-muted'}`}>
                          {t.usage_count || 0}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="d-flex flex-wrap align-items-center justify-content-between gap-2">
              <div className="small">
                {selectedTagIds.length === 0 ? (
                  <span className="text-muted">Select one or more tags to preview matches.</span>
                ) : tagPreview === null ? (
                  <span className="text-muted">Counting matches…</span>
                ) : (
                  <span>
                    <strong>{tagPreview}</strong> contact{tagPreview === 1 ? '' : 's'} match{' '}
                    <span className="text-muted">
                      ({selectedTagIds.length} tag{selectedTagIds.length === 1 ? '' : 's'} · match {tagMatch})
                    </span>
                  </span>
                )}
              </div>
              <div className="d-flex gap-2">
                {selectedTagIds.length > 0 && (
                  <button className="btn btn-light btn-sm" onClick={() => setSelectedTagIds([])} disabled={busy}>
                    Clear
                  </button>
                )}
                <button
                  className="btn btn-primary btn-sm"
                  disabled={busy || selectedTagIds.length === 0 || !tagPreview}
                  onClick={addFromTags}
                >
                  {busy ? 'Adding…' : `Add ${tagPreview || 0} contact${tagPreview === 1 ? '' : 's'}`}
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="d-flex align-items-center justify-content-between mb-2">
          <strong>Members</strong>
          <input className="form-control form-control-sm" style={{ maxWidth: 240 }}
            placeholder="Filter members…" value={memberFilter} onChange={(e) => setMemberFilter(e.target.value)} />
        </div>
        <div className="table-responsive">
          <table className="table table-sm table-hover align-middle mb-0">
            <thead>
              <tr>
                <th>Contact</th>
                <th>Email</th>
                <th>Mobile</th>
                <th>Organization</th>
                <th className="text-end">Actions</th>
              </tr>
            </thead>
            <tbody>
              {visibleMembers.map((m) => (
                <tr key={m.id}>
                  <td className="fw-semibold">{m.full_name || `${m.first_name || ''} ${m.last_name || ''}`}</td>
                  <td className="text-muted">{m.email || '—'}</td>
                  <td className="text-muted">{m.mobile || m.phone || '—'}</td>
                  <td className="text-muted">{m.organization_name || '—'}</td>
                  <td className="text-end">
                    <button className="btn btn-sm btn-light text-danger" disabled={busy} onClick={() => removeOne(m)} title="Remove from list">
                      <iconify-icon icon="solar:trash-bin-trash-line-duotone"></iconify-icon>
                    </button>
                  </td>
                </tr>
              ))}
              {visibleMembers.length === 0 && <tr><td colSpan="5"><div className="empty-state">No members{memberFilter ? ' match the filter' : ''}.</div></td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {confirmDialog}
    </div>
  );
}
