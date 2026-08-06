import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import api from '../../api/client.js';
import PageHeader from '../../components/PageHeader.jsx';
import Modal from '../../components/Modal.jsx';
import PhoneInput from '../../components/PhoneInput.jsx';
import AddressVerifier from '../components/AddressVerifier.jsx';
import QuickCreateOrg from '../components/QuickCreateOrg.jsx';
import FormErrorBanner from '../../components/FormErrorBanner.jsx';
import BulkActionBar from '../components/BulkActionBar.jsx';
import { toast } from '../../components/Toast.jsx';
import { useAuth } from '../../auth/AuthContext.jsx';
import { useConfirm } from '../../hooks/useConfirm.jsx';
import { useIntegrations } from '../context/IntegrationsContext.jsx';
import { parseApiError } from '../../utils/apiError.js';
import { isValidEmail, isValidPhone, isBlank, PHONE_HINT } from '../../utils/validation.js';

const empty = {
  first_name: '', last_name: '', email: '', phone: '', title: '',
  organization_id: null, lifecycle_stage: 'lead', lead_source: '', owner_id: null,
  address_line1: '', address_line2: '', city: '', state: '', postal_code: '', country: '',
};

// Red asterisk for required labels — mirrors OrganizationsList.jsx's <Req/>.
function Req() {
  return <span className="text-danger ms-1">*</span>;
}

export default function ContactsList() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const { confirm, dialog: confirmDialog } = useConfirm();
  const { connectwise: cwActive } = useIntegrations();
  const [q, setQ] = useState('');
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [show, setShow] = useState(false);
  const [modalTab, setModalTab] = useState('manual'); // 'manual' | 'cw'
  const [form, setForm] = useState(empty);
  const [editId, setEditId] = useState(null);
  const [orgs, setOrgs] = useState([]);
  const [showNewOrg, setShowNewOrg] = useState(false);
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const [selectedIds, setSelectedIds] = useState(new Set());

  // ConnectWise picker state
  const [cwSearch, setCwSearch] = useState('');
  const [cwResults, setCwResults] = useState([]);
  const [cwSearching, setCwSearching] = useState(false);
  const [cwImporting, setCwImporting] = useState(false);
  const [cwMsg, setCwMsg] = useState('');
  const [cwMsgIsError, setCwMsgIsError] = useState(false);
  const cwSearchTimer = useRef(null);

  async function load() {
    const { data } = await api.get('/contacts', { params: { q, page, pageSize: 25 } });
    setRows(data.rows); setTotal(data.total);
    setSelectedIds(new Set());
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [q, page]);

  function toggleRow(id) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  function toggleAllOnPage() {
    setSelectedIds((prev) =>
      prev.size === rows.length ? new Set() : new Set(rows.map((r) => r.id))
    );
  }
  useEffect(() => {
    api.get('/organizations', { params: { pageSize: 200 } }).then((r) => setOrgs(r.data.rows));
  }, []);

  function openNew() {
    setEditId(null); setForm(empty); setShowNewOrg(false);
    setModalTab(cwActive ? 'cw' : 'manual');
    setCwSearch(''); setCwResults([]); setCwMsg(''); setCwMsgIsError(false);
    setFormError('');
    setShow(true);
  }

  // Debounced CW contact search
  function handleCwSearch(val) {
    setCwSearch(val);
    setCwMsg(''); setCwMsgIsError(false);
    clearTimeout(cwSearchTimer.current);
    if (!val.trim()) { setCwResults([]); return; }
    cwSearchTimer.current = setTimeout(async () => {
      setCwSearching(true);
      try {
        const { data } = await api.get('/connectwise/contacts/search', { params: { q: val } });
        setCwResults(data);
        if (!data.length) setCwMsg('No contacts found in ConnectWise.');
      } catch (e) {
        setCwMsg(parseApiError(e, 'Search failed.'));
        setCwMsgIsError(true);
      } finally {
        setCwSearching(false);
      }
    }, 400);
  }

  async function importCwContact(ct) {
    setCwImporting(true); setCwMsg(''); setCwMsgIsError(false);
    try {
      const { data } = await api.post('/connectwise/contacts/import', { cwContactId: ct.id });
      setShow(false);
      navigate(`/admin/contacts/${data.contactId}`);
    } catch (e) {
      setCwMsg(parseApiError(e, 'Import failed.'));
      setCwMsgIsError(true);
      setCwImporting(false);
    }
  }
  function openEdit(c) {
    setEditId(c.id);
    setForm({
      first_name: c.first_name || '', last_name: c.last_name || '',
      email: c.email || '', phone: c.phone || '', title: c.title || '',
      organization_id: c.organization_id ?? null,
      lifecycle_stage: c.lifecycle_stage || 'lead',
      lead_source: c.lead_source || '', owner_id: c.owner_id ?? null,
      address_line1: c.address_line1 || '', address_line2: c.address_line2 || '',
      city: c.city || '', state: c.state || '',
      postal_code: c.postal_code || '', country: c.country || '',
    });
    setFormError('');
    setShow(true);
  }

  // Client-side check mirroring server/src/routes/contacts.js's saveSchema:
  // email is format-checked when present, but nothing is server-required —
  // these rules exist purely so a blank/garbled submission fails fast in the
  // UI instead of round-tripping to a silent 400.
  function clientValidate() {
    if (isBlank(form.first_name) && isBlank(form.last_name)) return 'Enter a first or last name.';
    if (isBlank(form.email) && isBlank(form.phone)) return 'Enter an email address or phone number.';
    if (!isValidEmail(form.email)) return 'Enter a valid email address.';
    if (!isValidPhone(form.phone)) return 'Enter a valid phone number.';
    return null;
  }

  async function save() {
    const clientErr = clientValidate();
    if (clientErr) { setFormError(clientErr); return; }

    const payload = { ...form };
    if (payload.organization_id === '' || payload.organization_id === undefined) payload.organization_id = null;
    if (payload.organization_id) payload.organization_id = Number(payload.organization_id);

    setSaving(true);
    setFormError('');
    try {
      if (editId) await api.put(`/contacts/${editId}`, payload);
      else await api.post('/contacts', payload);
      setShow(false); setEditId(null); setForm(empty); load();
    } catch (err) {
      setFormError(parseApiError(err));
    } finally {
      setSaving(false);
    }
  }

  async function remove(c) {
    if (!(await confirm(`Delete ${c.first_name} ${c.last_name}? This cannot be undone.`))) return;
    try {
      await api.delete(`/contacts/${c.id}`);
      load();
    } catch (err) {
      toast(parseApiError(err), 'error');
    }
  }

  return (
    <div>
      <PageHeader
        title="Contacts"
        subtitle={`${total.toLocaleString()} total`}
        actions={
          can('contacts.write') && (
            <button className="btn btn-primary" onClick={openNew}>
              <iconify-icon icon="solar:add-circle-line-duotone" class="me-1"></iconify-icon> New Contact
            </button>
          )
        }
      />

      <div className="card">
        <div className="card-body">
          <div className="d-flex gap-2 mb-3">
            <input className="form-control" placeholder="Search by name, email, phone…" value={q}
              onChange={(e) => { setPage(1); setQ(e.target.value); }} />
          </div>
          {can('contacts.write') && (
            <BulkActionBar
              entityType="contact"
              selectedIds={selectedIds}
              onClear={() => setSelectedIds(new Set())}
              onApplied={load}
              showStage
            />
          )}
          <div className="table-responsive">
            <table className="table table-hover align-middle mb-0">
              <thead>
                <tr>
                  {can('contacts.write') && (
                    <th style={{ width: 32 }}>
                      <input type="checkbox" className="form-check-input"
                        checked={rows.length > 0 && selectedIds.size === rows.length}
                        onChange={toggleAllOnPage} />
                    </th>
                  )}
                  <th>Name</th>
                  <th>Title</th>
                  <th>Organization</th>
                  <th>Email</th>
                  <th>Phone</th>
                  <th>Stage</th>
                  <th>Owner</th>
                  <th className="text-end">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => (
                  <tr key={c.id}>
                    {can('contacts.write') && (
                      <td>
                        <input type="checkbox" className="form-check-input"
                          checked={selectedIds.has(c.id)} onChange={() => toggleRow(c.id)} />
                      </td>
                    )}
                    <td>
                      <div className="d-flex align-items-center gap-2">
                        <div className="avatar-initials">{(c.first_name?.[0] || '') + (c.last_name?.[0] || '')}</div>
                        <Link to={`/admin/contacts/${c.id}`} className="text-decoration-none fw-semibold">
                          {c.first_name} {c.last_name}
                        </Link>
                      </div>
                    </td>
                    <td>{c.title}</td>
                    <td>{c.organization_name}</td>
                    <td>{c.email}</td>
                    <td>{c.phone}</td>
                    <td><span className="badge bg-primary-subtle text-primary">{c.lifecycle_stage}</span></td>
                    <td>{c.owner_name}</td>
                    <td className="text-end text-nowrap">
                      {can('contacts.write') && (
                        <button className="btn btn-sm btn-light me-1" onClick={() => openEdit(c)} title="Edit">
                          <iconify-icon icon="solar:pen-new-square-line-duotone"></iconify-icon>
                        </button>
                      )}
                      {can('contacts.delete') && (
                        <button className="btn btn-sm btn-light text-danger" onClick={() => remove(c)} title="Delete">
                          <iconify-icon icon="solar:trash-bin-trash-line-duotone"></iconify-icon>
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr><td colSpan={can('contacts.write') ? 9 : 8}><div className="empty-state">No contacts found.</div></td></tr>
                )}
              </tbody>
            </table>
          </div>
          {total > 25 && (
            <nav className="mt-3 d-flex justify-content-end">
              <ul className="pagination mb-0">
                <li className={`page-item ${page <= 1 ? 'disabled' : ''}`}><button className="page-link" onClick={() => setPage(page - 1)}>Prev</button></li>
                <li className="page-item disabled"><span className="page-link">{page} / {Math.ceil(total / 25)}</span></li>
                <li className={`page-item ${page >= Math.ceil(total / 25) ? 'disabled' : ''}`}><button className="page-link" onClick={() => setPage(page + 1)}>Next</button></li>
              </ul>
            </nav>
          )}
        </div>
      </div>

      <Modal
        show={show}
        onClose={() => { setShow(false); setEditId(null); }}
        title={editId ? 'Edit Contact' : 'New Contact'}
        size="lg"
        footer={modalTab === 'manual' ? <>
          <button className="btn btn-light" onClick={() => { setShow(false); setEditId(null); }}>Cancel</button>
          <button className="btn btn-primary" onClick={save} disabled={saving}>
            {saving ? <><span className="spinner-border spinner-border-sm me-2" />Saving…</> : 'Save'}
          </button>
        </> : <>
          <button className="btn btn-light" onClick={() => { setShow(false); }}>Cancel</button>
        </>}
      >
        {modalTab === 'manual' && <FormErrorBanner error={formError} />}

        {/* Tab bar — only shown for new contacts when CW is active */}
        {!editId && cwActive && (
          <ul className="nav nav-tabs mb-3">
            <li className="nav-item">
              <button className={`nav-link ${modalTab === 'cw' ? 'active' : ''}`} onClick={() => setModalTab('cw')}>
                <iconify-icon icon="simple-icons:connectwise" class="me-1"></iconify-icon>
                Import from ConnectWise
              </button>
            </li>
            <li className="nav-item">
              <button className={`nav-link ${modalTab === 'manual' ? 'active' : ''}`} onClick={() => setModalTab('manual')}>
                Add Manually
              </button>
            </li>
          </ul>
        )}

        {/* ── ConnectWise picker ── */}
        {modalTab === 'cw' && (
          <div>
            <div className="mb-3">
              <input
                className="form-control"
                placeholder="Search by first or last name…"
                title="ConnectWise contact search by first or last name only"
                value={cwSearch}
                onChange={(e) => handleCwSearch(e.target.value)}
                autoFocus
              />
              <div className="form-text text-muted" style={{ fontSize: '0.8rem' }}>
                Search by first or last name. Email search is not supported by ConnectWise.
              </div>
            </div>
            {cwSearching && <div className="text-muted small py-1">Searching ConnectWise…</div>}
            {cwMsg && (
              <div className={`alert ${cwMsgIsError ? 'alert-danger' : 'alert-secondary'} py-2 mb-2`}>{cwMsg}</div>
            )}
            {cwResults.length > 0 && (
              <div className="list-group">
                {cwResults.map((ct) => (
                  <button
                    key={ct.id}
                    className="list-group-item list-group-item-action"
                    onClick={() => importCwContact(ct)}
                    disabled={cwImporting}
                  >
                    <div className="d-flex justify-content-between align-items-start">
                      <div>
                        <div className="fw-semibold">{ct.firstName} {ct.lastName}</div>
                        {ct.title && <div className="small text-muted">{ct.title}</div>}
                        {ct.company && (
                          <div className="small text-muted">
                            <iconify-icon icon="solar:buildings-2-line-duotone" class="me-1"></iconify-icon>
                            {ct.company.name}
                          </div>
                        )}
                        {ct.email && <div className="small text-muted">{ct.email}</div>}
                        {ct.phone && <div className="small text-muted">{ct.phone}</div>}
                      </div>
                      <span className="badge bg-primary align-self-center ms-3">
                        {cwImporting ? '…' : 'Import'}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            )}
            {!cwSearch && !cwSearching && cwResults.length === 0 && (
              <p className="text-muted small mb-0">
                Start typing a name or email to search your ConnectWise contacts.
                The contact&apos;s company will be linked automatically — if the company isn&apos;t in the CRM yet it will be created.
              </p>
            )}
          </div>
        )}

        {/* ── Manual form ── */}
        {modalTab === 'manual' && <>
          <div className="row g-2">
            <div className="col-md-6"><label className="form-label">First name<Req /></label>
              <input className="form-control" value={form.first_name} onChange={(e) => setForm({ ...form, first_name: e.target.value })} /></div>
            <div className="col-md-6"><label className="form-label">Last name<Req /></label>
              <input className="form-control" value={form.last_name}  onChange={(e) => setForm({ ...form, last_name: e.target.value })} /></div>
            <div className="col-12">
              <div className="form-text mt-0 mb-1">First or last name is required.</div>
            </div>
            <div className="col-md-6"><label className="form-label">Email<Req /></label>
              <input className="form-control" value={form.email}      onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
            <div className="col-md-6"><label className="form-label">Phone<Req /></label>
              <PhoneInput value={form.phone} onChange={(v) => setForm({ ...form, phone: v })} />
              <div className="form-text">{PHONE_HINT}</div>
            </div>
            <div className="col-12">
              <div className="form-text mt-0 mb-1">Email address or phone number is required.</div>
            </div>
            <div className="col-md-6"><label className="form-label">Title</label>
              <input className="form-control" value={form.title}      onChange={(e) => setForm({ ...form, title: e.target.value })} /></div>
            <div className="col-md-6">
              <div className="d-flex align-items-center justify-content-between mb-1">
                <label className="form-label mb-0">Organization</label>
                {!showNewOrg && (
                  <button type="button" className="btn btn-link btn-sm p-0 text-primary" onClick={() => setShowNewOrg(true)}>
                    <iconify-icon icon="solar:add-circle-line-duotone" class="me-1"></iconify-icon>New org
                  </button>
                )}
              </div>
              <select className="form-select" value={form.organization_id ?? ''} onChange={(e) => setForm({ ...form, organization_id: e.target.value })}>
                <option value="">—</option>
                {orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
              {showNewOrg && (
                <QuickCreateOrg
                  onCreated={(org) => {
                    setOrgs((prev) => [...prev, org].sort((a, b) => a.name.localeCompare(b.name)));
                    setForm((f) => ({ ...f, organization_id: org.id }));
                    setShowNewOrg(false);
                  }}
                  onCancel={() => setShowNewOrg(false)}
                />
              )}
            </div>
            <div className="col-md-6"><label className="form-label">Lifecycle stage</label>
              <select className="form-select" value={form.lifecycle_stage} onChange={(e) => setForm({ ...form, lifecycle_stage: e.target.value })}>
                {['lead','mql','sql','customer','evangelist','other'].map((s) => <option key={s}>{s}</option>)}
              </select></div>
            <div className="col-md-6"><label className="form-label">Lead source</label>
              <input className="form-control" value={form.lead_source}  onChange={(e) => setForm({ ...form, lead_source: e.target.value })} /></div>
          </div>
          <hr />
          <AddressVerifier
            value={{
              address_line1: form.address_line1, address_line2: form.address_line2,
              city: form.city, state: form.state,
              postal_code: form.postal_code, country: form.country,
            }}
            onChange={(a) => setForm({ ...form, ...a })}
            compact
          />
        </>}
      </Modal>
      {confirmDialog}
    </div>
  );
}
