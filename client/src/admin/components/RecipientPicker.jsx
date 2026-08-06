import { useEffect, useMemo, useRef, useState } from 'react';
import api from '../../api/client.js';
import { toast } from '../../components/Toast.jsx';
import { parseApiError } from '../../utils/apiError.js';

/**
 * Recipient picker for the compose modal.
 *
 * Props:
 *   channel       'email' | 'sms'
 *   value         { mode: 'single'|'multiple', to: string, contacts: [{id, ...}], listId: number|null }
 *   onChange      (next) => void
 *
 * The component is dumb about its own value — the parent owns the state so the
 * existing single-recipient flow keeps working. We never put a list_id into a
 * "to" string; lists are resolved on the server when a list send is fired.
 *
 * Modes:
 *   single   — one recipient, manual or pulled from contacts
 *   multiple — chip list of selected contacts + ad-hoc emails/numbers, with
 *              an org filter to scope the picker. Optional list_id replaces
 *              the manual selection at send time (server resolves it).
 */
export default function RecipientPicker({ channel, value, onChange }) {
  const v = value || { mode: 'single', to: '', contacts: [], listId: null };

  const [orgs, setOrgs] = useState([]);
  const [orgFilter, setOrgFilter] = useState('');
  const [contacts, setContacts] = useState([]);
  const [contactQuery, setContactQuery] = useState('');
  const [lists, setLists] = useState([]);
  const [showCreate, setShowCreate] = useState(false);
  const [newContact, setNewContact] = useState({ first_name: '', last_name: '', email: '', mobile: '', organization_id: '' });
  const debounceRef = useRef(null);

  useEffect(() => {
    api.get('/organizations', { params: { pageSize: 200 } })
      .then(({ data }) => setOrgs(data.rows || []))
      .catch(() => {});
    api.get('/lists').then(({ data }) => setLists(data || [])).catch(() => {});
  }, []);

  // Debounced contact search — only used in 'multiple' mode (and for picking
  // a single contact via search). Org filter pins the result set; query
  // narrows further. We keep results to 50 to avoid dropping a 5MB JSON blob
  // into the browser when an admin opens this with no filter.
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      const params = { pageSize: 50 };
      if (orgFilter)    params.organization_id = orgFilter;
      if (contactQuery) params.q = contactQuery;
      api.get('/contacts', { params })
        .then(({ data }) => setContacts(data.rows || []))
        .catch(() => setContacts([]));
    }, 200);
    return () => debounceRef.current && clearTimeout(debounceRef.current);
  }, [orgFilter, contactQuery]);

  const selectedIds = useMemo(() => new Set(v.contacts.map((c) => c.id)), [v.contacts]);

  function setMode(mode) {
    onChange({ ...v, mode, listId: mode === 'multiple' ? v.listId : null });
  }

  function pickList(listId) {
    onChange({ ...v, listId: listId ? Number(listId) : null });
  }

  function toggleContact(c) {
    const exists = selectedIds.has(c.id);
    const next = exists
      ? v.contacts.filter((x) => x.id !== c.id)
      : [...v.contacts, c];
    onChange({ ...v, contacts: next });
  }

  function removeContact(id) {
    onChange({ ...v, contacts: v.contacts.filter((x) => x.id !== id) });
  }

  async function createContact() {
    if (!newContact.first_name && !newContact.last_name && !newContact.email) {
      toast('Add at least a name or email.', 'error');
      return;
    }
    try {
      const payload = {
        first_name: newContact.first_name || null,
        last_name:  newContact.last_name  || null,
        email:      newContact.email      || null,
        mobile:     newContact.mobile     || null,
        organization_id: newContact.organization_id ? Number(newContact.organization_id) : null,
      };
      const { data } = await api.post('/contacts', payload);
      // Re-fetch the row so we have the joined fields the picker shows.
      const { data: full } = await api.get(`/contacts/${data.id}`);
      const c = full.contact;
      const enriched = {
        id: c.id,
        first_name: c.first_name,
        last_name:  c.last_name,
        email:      c.email,
        mobile:     c.mobile,
        phone:      c.phone,
        organization_name: full?.contact?.organization_name,
      };
      // Single-mode: set as the recipient. Multi-mode: append to chip list.
      if (v.mode === 'single') {
        onChange({ ...v, to: channel === 'email' ? (c.email || '') : (c.mobile || c.phone || ''), contacts: [enriched] });
      } else {
        onChange({ ...v, contacts: [...v.contacts, enriched] });
      }
      setShowCreate(false);
      setNewContact({ first_name: '', last_name: '', email: '', mobile: '', organization_id: '' });
    } catch (err) {
      toast(parseApiError(err, 'Create failed.'), 'error');
    }
  }

  // Helper: pick the right address field for the channel.
  const addrOf = (c) => channel === 'email' ? c.email : (c.mobile || c.phone);

  return (
    <div className="border rounded p-2" style={{ background: '#FAFAFA' }}>
      <div className="d-flex align-items-center gap-2 mb-2">
        <div className="btn-group btn-group-sm" role="group">
          <button type="button" className={`btn ${v.mode === 'single' ? 'btn-primary' : 'btn-light'}`}
            onClick={() => setMode('single')}>Single</button>
          <button type="button" className={`btn ${v.mode === 'multiple' ? 'btn-primary' : 'btn-light'}`}
            onClick={() => setMode('multiple')}>Multiple</button>
        </div>
        <small className="text-muted">{v.mode === 'single' ? 'Send to one recipient.' : 'Pick contacts, paste addresses, or choose a saved list.'}</small>
      </div>

      {v.mode === 'single' ? (
        <div className="row g-2">
          <div className="col-md-7">
            <label className="form-label small mb-1">{channel === 'email' ? 'Email address' : 'Phone number'}</label>
            <input className="form-control" value={v.to}
              placeholder={channel === 'email' ? 'name@example.com' : '+15551234567'}
              onChange={(e) => onChange({ ...v, to: e.target.value })} />
          </div>
          <div className="col-md-5">
            <label className="form-label small mb-1">…or pick from CRM</label>
            <ContactPickInput
              channel={channel} contacts={contacts} contactQuery={contactQuery}
              setContactQuery={setContactQuery}
              orgs={orgs} orgFilter={orgFilter} setOrgFilter={setOrgFilter}
              onPick={(c) => onChange({ ...v, to: addrOf(c) || '', contacts: [c] })}
              onCreate={() => setShowCreate(true)} />
          </div>
        </div>
      ) : (
        <div>
          <div className="row g-2 mb-2">
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
                value={contactQuery} onChange={(e) => setContactQuery(e.target.value)} />
            </div>
          </div>

          <div className="border rounded mb-2 bg-white" style={{ maxHeight: 180, overflowY: 'auto' }}>
            {contacts.length === 0
              ? <div className="text-muted small p-2">No contacts match.</div>
              : contacts.map((c) => {
                  const sel = selectedIds.has(c.id);
                  const addr = addrOf(c);
                  return (
                    <button type="button" key={c.id}
                      className="d-flex align-items-center justify-content-between w-100 px-2 py-1 border-0 text-start"
                      style={{ background: sel ? '#FFF1E6' : 'transparent', cursor: addr ? 'pointer' : 'not-allowed' }}
                      disabled={!addr}
                      onClick={() => addr && toggleContact(c)}>
                      <span>
                        <strong>{c.first_name} {c.last_name}</strong>{' '}
                        <span className="text-muted small">{addr || `(no ${channel === 'email' ? 'email' : 'phone'})`}</span>
                      </span>
                      {sel && <iconify-icon icon="solar:check-circle-bold-duotone" style={{ color: 'var(--secondary)' }}></iconify-icon>}
                    </button>
                  );
                })}
          </div>

          <div className="d-flex flex-wrap gap-1 mb-2">
            {v.contacts.map((c) => (
              <span key={c.id} className="badge bg-primary-subtle text-primary d-inline-flex align-items-center gap-1 py-2">
                {c.first_name} {c.last_name}
                <button type="button" className="btn btn-sm p-0 lh-1 text-primary"
                  style={{ border: 0, background: 'transparent' }}
                  onClick={() => removeContact(c.id)} aria-label="Remove">×</button>
              </span>
            ))}
            {v.contacts.length === 0 && <small className="text-muted">No recipients selected yet.</small>}
          </div>

          <div className="row g-2 mt-2">
            <div className="col-md-6">
              <label className="form-label small mb-1">…or send to a saved list</label>
              <select className="form-select form-select-sm" value={v.listId || ''} onChange={(e) => pickList(e.target.value)}>
                <option value="">— No list —</option>
                {lists.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name} ({l.member_count} members{l.kind && l.kind !== 'other' ? ` · ${l.kind}` : ''})
                  </option>
                ))}
              </select>
              {v.listId ? <small className="text-muted">List recipients are resolved at send time and override the picker selection above.</small> : null}
            </div>
            <div className="col-md-6 d-flex align-items-end justify-content-end">
              <button type="button" className="btn btn-sm btn-light" onClick={() => setShowCreate(true)}>
                <iconify-icon icon="solar:add-circle-line-duotone" class="me-1"></iconify-icon> New contact
              </button>
            </div>
          </div>
        </div>
      )}

      {showCreate && (
        <div className="border-top mt-3 pt-3">
          <div className="d-flex justify-content-between align-items-center mb-2">
            <strong>New contact</strong>
            <button type="button" className="btn btn-sm btn-light" onClick={() => setShowCreate(false)}>Cancel</button>
          </div>
          <div className="row g-2">
            <div className="col-md-3"><input className="form-control form-control-sm" placeholder="First name"
              value={newContact.first_name} onChange={(e) => setNewContact({ ...newContact, first_name: e.target.value })} /></div>
            <div className="col-md-3"><input className="form-control form-control-sm" placeholder="Last name"
              value={newContact.last_name} onChange={(e) => setNewContact({ ...newContact, last_name: e.target.value })} /></div>
            <div className="col-md-3"><input className="form-control form-control-sm" placeholder="Email"
              value={newContact.email} onChange={(e) => setNewContact({ ...newContact, email: e.target.value })} /></div>
            <div className="col-md-3"><input className="form-control form-control-sm" placeholder="Mobile"
              value={newContact.mobile} onChange={(e) => setNewContact({ ...newContact, mobile: e.target.value })} /></div>
            <div className="col-md-9"><select className="form-select form-select-sm" value={newContact.organization_id}
              onChange={(e) => setNewContact({ ...newContact, organization_id: e.target.value })}>
              <option value="">No organization</option>
              {orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select></div>
            <div className="col-md-3 d-grid">
              <button type="button" className="btn btn-primary btn-sm" onClick={createContact}>Save & add</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Smaller helper used by single-recipient mode. Keeps the multi-mode picker
// the only complex part; this one is just an org filter + a dropdown of hits.
function ContactPickInput({ channel, contacts, contactQuery, setContactQuery, orgs, orgFilter, setOrgFilter, onPick, onCreate }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="position-relative">
      <input className="form-control" placeholder="Search name or email…"
        value={contactQuery}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onChange={(e) => { setContactQuery(e.target.value); setOpen(true); }} />
      {open && (
        <div className="position-absolute bg-white border rounded shadow-sm w-100" style={{ zIndex: 5, maxHeight: 240, overflowY: 'auto' }}>
          <div className="p-2 border-bottom">
            <select className="form-select form-select-sm" value={orgFilter} onChange={(e) => setOrgFilter(e.target.value)}>
              <option value="">All organizations</option>
              {orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          </div>
          {contacts.slice(0, 25).map((c) => {
            const addr = channel === 'email' ? c.email : (c.mobile || c.phone);
            return (
              <button type="button" key={c.id} disabled={!addr}
                className="d-block w-100 text-start px-2 py-1 border-0"
                style={{ background: 'transparent', cursor: addr ? 'pointer' : 'not-allowed' }}
                onMouseDown={(e) => { e.preventDefault(); if (addr) onPick(c); }}>
                <strong>{c.first_name} {c.last_name}</strong>{' '}
                <span className="text-muted small">{addr || `(no ${channel === 'email' ? 'email' : 'phone'})`}</span>
              </button>
            );
          })}
          {contacts.length === 0 && <div className="text-muted small p-2">No matches.</div>}
          <button type="button" className="d-block w-100 text-start px-2 py-2 border-0 border-top text-primary"
            style={{ background: 'transparent' }}
            onMouseDown={(e) => { e.preventDefault(); onCreate?.(); }}>
            <iconify-icon icon="solar:add-circle-line-duotone" class="me-1"></iconify-icon> Create new contact
          </button>
        </div>
      )}
    </div>
  );
}
