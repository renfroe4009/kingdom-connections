import { Fragment, useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import api from '../../api/client.js';
import PageHeader from '../../components/PageHeader.jsx';
import Modal from '../../components/Modal.jsx';
import AttachmentsPanel from '../components/AttachmentsPanel.jsx';
import DriveTab from '../components/DriveTab.jsx';
import AddressVerifier from '../components/AddressVerifier.jsx';
import ComposeMessageModal from '../components/ComposeMessageModal.jsx';
import PhoneInput from '../../components/PhoneInput.jsx';
import QuickCreateOrg from '../components/QuickCreateOrg.jsx';
import SearchableSelect from '../../components/SearchableSelect.jsx';
import TagEditor from '../components/TagEditor.jsx';
import MergeModal from '../components/MergeModal.jsx';
import { useAuth } from '../../auth/AuthContext.jsx';
import { useConfirm } from '../../hooks/useConfirm.jsx';
import { useIntegrations } from '../context/IntegrationsContext.jsx';
import { toast } from '../../components/Toast.jsx';
import { parseApiError } from '../../utils/apiError.js';
import { isBlank } from '../../utils/validation.js';
import FormErrorBanner from '../../components/FormErrorBanner.jsx';

function Req() {
  return <span className="text-danger ms-1">*</span>;
}

const emptyDeal = { name: '', amount: '', expected_close_date: '', pipeline_id: null, stage_id: null };

export default function ContactDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { can } = useAuth();
  const { smtp: smtpActive, sms: smsActive, google: googleConnected } = useIntegrations();
  const { confirm, dialog: confirmDialog } = useConfirm();
  const [data, setData] = useState(null);
  const [noteBody, setNoteBody] = useState('');
  const [orgs, setOrgs] = useState([]);
  const [editShow, setEditShow] = useState(false);
  const [form, setForm] = useState({});
  const [composeOpen, setComposeOpen] = useState(false);
  const [composeChannel, setComposeChannel] = useState('email');
  const [showNewOrg, setShowNewOrg] = useState(false);

  // Add Deal modal state
  const [dealShow, setDealShow] = useState(false);
  const [pipelines, setPipelines] = useState([]);
  const [stages, setStages] = useState([]);
  const [newDeal, setNewDeal] = useState(emptyDeal);
  const [dealFormError, setDealFormError] = useState('');
  const [dealSaving, setDealSaving] = useState(false);

  // Fundraising: household, soft credits, giving history
  const [household, setHousehold] = useState(null);
  const [softCredits, setSoftCredits] = useState([]);
  const [donations, setDonations] = useState({ rows: [], total: 0 });
  const [pledges, setPledges] = useState([]);
  const [timeline, setTimeline] = useState([]);
  const [showHousehold, setShowHousehold] = useState(false);
  const [householdName, setHouseholdName] = useState('');
  const [addMemberId, setAddMemberId] = useState('');
  const [allContacts, setAllContacts] = useState([]);
  const [showMergePicker, setShowMergePicker] = useState(false);
  const [mergeTargetId, setMergeTargetId] = useState('');
  const [mergePair, setMergePair] = useState(null);

  async function load() {
    const { data } = await api.get(`/contacts/${id}`);
    setData(data);
  }
  async function loadFundraising() {
    api.get(`/contacts/${id}/household`).then((r) => setHousehold(r.data)).catch(() => setHousehold(null));
    api.get(`/contacts/${id}/soft-credits`).then((r) => setSoftCredits(r.data.rows || [])).catch(() => {});
    api.get('/donations/admin', { params: { contact_id: id, pageSize: 10 } }).then((r) => setDonations(r.data)).catch(() => {});
    api.get('/pledges', { params: { contact_id: id } }).then((r) => setPledges(r.data.rows || [])).catch(() => {});
    api.get(`/contacts/${id}/timeline`).then((r) => setTimeline(r.data.events || [])).catch(() => {});
  }
  useEffect(() => { load(); loadFundraising(); /* eslint-disable-next-line */ }, [id]);
  useEffect(() => { api.get('/organizations', { params: { pageSize: 200 } }).then((r) => setOrgs(r.data.rows)).catch(() => {}); }, []);

  async function createHousehold() {
    if (!householdName.trim()) return;
    const { data: h } = await api.post('/households', { name: householdName, primary_contact_id: Number(id) });
    setHousehold(h);
    setShowHousehold(false);
    setHouseholdName('');
  }
  async function addHouseholdMember() {
    if (!addMemberId || !household) return;
    const { data: h } = await api.post(`/households/${household.id}/members`, { contact_id: Number(addMemberId) });
    setHousehold(h);
    setAddMemberId('');
  }
  async function removeHouseholdMember(contactId) {
    if (!household) return;
    if (!(await confirm('Remove this person from the household?'))) return;
    await api.delete(`/households/${household.id}/members/${contactId}`);
    const { data: h } = await api.get(`/households/${household.id}`);
    setHousehold(h);
  }
  function openHouseholdModal() {
    if (!allContacts.length) api.get('/contacts', { params: { pageSize: 500 } }).then((r) => setAllContacts(r.data.rows)).catch(() => {});
    setShowHousehold(true);
  }
  function openMergePicker() {
    if (!allContacts.length) api.get('/contacts', { params: { pageSize: 500 } }).then((r) => setAllContacts(r.data.rows)).catch(() => {});
    setMergeTargetId('');
    setShowMergePicker(true);
  }
  function startMerge() {
    const target = allContacts.find((c) => c.id === Number(mergeTargetId));
    if (!target) return;
    setShowMergePicker(false);
    setMergePair({ a: data.contact, b: target });
  }
  async function downloadStatement() {
    const year = new Date().getFullYear();
    try {
      const res = await api.get(`/donations/admin/statement/${id}/${year}`, { responseType: 'blob' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(res.data);
      a.download = `giving-statement-${year}-${id}.pdf`;
      a.click();
    } catch (e) {
      toast(e.response?.status === 404 ? `No gifts found for ${year}.` : 'Could not download statement.', 'error');
    }
  }

  async function addNote() {
    if (!noteBody.trim()) return;
    await api.post('/notes', { entity_type: 'contact', entity_id: Number(id), body: noteBody });
    setNoteBody(''); load();
  }

  function openEdit() {
    const c = data.contact;
    setForm({
      first_name: c.first_name || '', last_name: c.last_name || '',
      email: c.email || '', phone: c.phone || '', mobile: c.mobile || '',
      title: c.title || '', lifecycle_stage: c.lifecycle_stage || 'lead',
      lead_source: c.lead_source || '', organization_id: c.organization_id || null,
      address_line1: c.address_line1 || '', address_line2: c.address_line2 || '',
      city: c.city || '', state: c.state || '',
      postal_code: c.postal_code || '', country: c.country || '',
      tax_exempt: c.tax_exempt ? 1 : 0,
    });
    setShowNewOrg(false);
    setEditShow(true);
  }

  async function saveEdit() {
    const payload = { ...form, organization_id: form.organization_id ? Number(form.organization_id) : null };
    await api.put(`/contacts/${id}`, payload);
    setEditShow(false); load();
  }

  async function remove() {
    if (!(await confirm('Delete contact? This cannot be undone.'))) return;
    await api.delete(`/contacts/${id}`);
    navigate('/admin/contacts');
  }

  async function openAddDeal() {
    setDealFormError('');
    setNewDeal(emptyDeal);
    setDealShow(true);
    try {
      const { data: pl } = await api.get('/pipelines');
      setPipelines(pl);
      const def = pl[0];
      if (def) {
        const { data: stgs } = await api.get(`/pipelines/${def.id}/stages`);
        setStages(stgs);
        setNewDeal((f) => ({ ...f, pipeline_id: def.id, stage_id: stgs[0]?.id || null }));
      }
    } catch (err) {
      setDealFormError(parseApiError(err));
    }
  }

  async function changeDealPipeline(pid) {
    const { data: stgs } = await api.get(`/pipelines/${pid}/stages`);
    setStages(stgs);
    setNewDeal((f) => ({ ...f, pipeline_id: Number(pid), stage_id: stgs[0]?.id || null }));
  }

  function dealClientValidate() {
    if (isBlank(newDeal.name)) return 'Deal name is required.';
    if (!isBlank(newDeal.amount) && Number(newDeal.amount) < 0) return 'Amount cannot be negative.';
    if (newDeal.expected_close_date && Number.isNaN(Date.parse(newDeal.expected_close_date))) return 'Enter a valid close date.';
    return null;
  }

  async function createDeal() {
    const clientErr = dealClientValidate();
    if (clientErr) { setDealFormError(clientErr); return; }
    setDealFormError('');
    setDealSaving(true);
    try {
      await api.post('/deals', {
        name: newDeal.name,
        pipeline_id: Number(newDeal.pipeline_id),
        stage_id: Number(newDeal.stage_id),
        primary_contact_id: Number(id),
        organization_id: data.contact.organization_id || null,
        amount: newDeal.amount === '' ? undefined : Number(newDeal.amount),
        expected_close_date: newDeal.expected_close_date || null,
      });
      setDealShow(false);
      load();
    } catch (err) {
      setDealFormError(parseApiError(err));
    } finally {
      setDealSaving(false);
    }
  }

  if (!data) return <div className="empty-state">Loading…</div>;
  const { contact, notes, tags, tasks, custom_fields, deals } = data;

  return (
    <div>
      <PageHeader
        title={`${contact.first_name || ''} ${contact.last_name || ''}`.trim() || 'Contact'}
        subtitle={contact.title ? `${contact.title}${contact.organization_name ? ' · ' + contact.organization_name : ''}` : contact.organization_name}
        actions={
          <>
            <Link to="/admin/contacts" className="btn btn-light">← Back</Link>
            {can('comms.write') && smtpActive && contact.email && (
              <button className="btn btn-light ms-2" onClick={() => { setComposeChannel('email'); setComposeOpen(true); }}>
                <iconify-icon icon="solar:letter-line-duotone" class="me-1"></iconify-icon> Email
              </button>
            )}
            {can('comms.write') && smsActive && (contact.mobile || contact.phone) && (
              <button className="btn btn-light ms-2" onClick={() => { setComposeChannel('sms'); setComposeOpen(true); }}>
                <iconify-icon icon="solar:chat-line-line-duotone" class="me-1"></iconify-icon> SMS
              </button>
            )}
            {can('contacts.write') && (
              <button className="btn btn-primary ms-2" onClick={openEdit}>
                <iconify-icon icon="solar:pen-new-square-line-duotone" class="me-1"></iconify-icon> Edit
              </button>
            )}
            {can('contacts.write') && can('contacts.delete') && !contact.merged_into_id && (
              <button className="btn btn-outline-secondary ms-2" onClick={openMergePicker}>
                <iconify-icon icon="solar:layers-minimalistic-line-duotone" class="me-1"></iconify-icon> Merge with…
              </button>
            )}
            {can('contacts.delete') && (
              <button className="btn btn-outline-danger ms-2" onClick={remove}>
                <iconify-icon icon="solar:trash-bin-trash-line-duotone" class="me-1"></iconify-icon> Delete
              </button>
            )}
          </>
        }
      />

      {contact.merged_into_id && (
        <div className="alert alert-info d-flex align-items-center gap-2 mb-3">
          <iconify-icon icon="solar:layers-minimalistic-line-duotone" class="fs-5"></iconify-icon>
          This contact was merged into another record.{' '}
          <Link to={`/admin/contacts/${contact.merged_into_id}`}>View merged record →</Link>
        </div>
      )}

      <div className="row">
        <div className="col-lg-4 mb-3">
          <div className="card">
            <div className="card-body">
              <h6 className="fw-bold text-uppercase small text-muted">Details</h6>
              <dl className="row mb-0">
                <dt className="col-5">Email</dt><dd className="col-7">{contact.email || '—'}</dd>
                <dt className="col-5">Phone</dt><dd className="col-7">{contact.phone || '—'}</dd>
                <dt className="col-5">Mobile</dt><dd className="col-7">{contact.mobile || '—'}</dd>
                <dt className="col-5">Stage</dt><dd className="col-7"><span className="badge bg-primary-subtle text-primary">{contact.lifecycle_stage}</span></dd>
                <dt className="col-5">Source</dt><dd className="col-7">{contact.lead_source || '—'}</dd>
                <dt className="col-5">Org</dt><dd className="col-7">{contact.organization_name || '—'}</dd>
              </dl>
            </div>
          </div>
          <TagEditor
            entityType="contact"
            entityId={id}
            tags={tags || []}
            canEdit={can('contacts.write')}
            onChange={(newTags) => setData((d) => ({ ...d, tags: newTags }))}
          />
          {custom_fields?.length > 0 && (
            <div className="card mt-3">
              <div className="card-body">
                <h6 className="fw-bold text-uppercase small text-muted">Custom Fields</h6>
                <dl className="row mb-0">
                  {custom_fields.map((f) => (
                    // Short <>…</> can't carry a key prop, which is what React
                    // was warning about. Switch to keyed Fragment.
                    <Fragment key={f.field_key}>
                      <dt className="col-5">{f.label}</dt>
                      <dd className="col-7">{f.value_text || '—'}</dd>
                    </Fragment>
                  ))}
                </dl>
              </div>
            </div>
          )}

          <div className="card mt-3">
            <div className="card-body">
              <div className="d-flex justify-content-between align-items-center">
                <h6 className="fw-bold text-uppercase small text-muted mb-0">Household</h6>
                {can('contacts.write') && (
                  household
                    ? <button className="btn btn-sm btn-light" onClick={openHouseholdModal}><iconify-icon icon="solar:pen-line-duotone"></iconify-icon></button>
                    : <button className="btn btn-sm btn-light" onClick={openHouseholdModal}>+ Add</button>
                )}
              </div>
              {household ? (
                <>
                  <div className="fw-semibold mt-1">{household.name}</div>
                  <ul className="list-unstyled small mt-2 mb-0">
                    {household.members.map((m) => (
                      <li key={m.contact_id} className="d-flex justify-content-between align-items-center py-1">
                        <span>
                          {Number(m.contact_id) === Number(id) ? <strong>{m.contact_name}</strong> : <Link to={`/admin/contacts/${m.contact_id}`}>{m.contact_name}</Link>}
                          {m.relationship && <span className="text-muted"> · {m.relationship}</span>}
                        </span>
                        {can('contacts.write') && Number(m.contact_id) !== Number(id) && (
                          <button className="btn btn-sm btn-link text-danger p-0" onClick={() => removeHouseholdMember(m.contact_id)}>
                            <iconify-icon icon="solar:close-circle-line-duotone"></iconify-icon>
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                </>
              ) : (
                <div className="text-muted small mt-1">Not part of a household yet.</div>
              )}
            </div>
          </div>

          {softCredits.length > 0 && (
            <div className="card mt-3">
              <div className="card-body">
                <h6 className="fw-bold text-uppercase small text-muted">Soft-Credited Gifts</h6>
                <div className="text-muted small mb-2">Gifts given by someone else, credited to this contact.</div>
                <ul className="list-unstyled small mb-0">
                  {softCredits.map((s) => (
                    <li key={s.id} className="py-1 border-bottom">
                      <div className="d-flex justify-content-between">
                        <span>{s.donor_contact_id ? <Link to={`/admin/contacts/${s.donor_contact_id}`}>{s.donor_name}</Link> : (s.donor_name || 'Anonymous')}</span>
                        <strong>${Number(s.amount).toFixed(2)}</strong>
                      </div>
                      <div className="text-muted">{s.fund_name || 'Undesignated'} · {new Date(s.created_at).toLocaleDateString()}</div>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}

          {donations.rows.length > 0 && (
            <div className="card mt-3">
              <div className="card-body">
                <div className="d-flex justify-content-between align-items-center">
                  <h6 className="fw-bold text-uppercase small text-muted mb-0">Giving History</h6>
                  <button className="btn btn-sm btn-light" onClick={downloadStatement} title="Download year-end statement">
                    <iconify-icon icon="solar:document-add-line-duotone"></iconify-icon>
                  </button>
                </div>
                <ul className="list-unstyled small mb-0 mt-2">
                  {donations.rows.map((d) => (
                    <li key={d.id} className="py-1 border-bottom">
                      <div className="d-flex justify-content-between">
                        <span>{d.fund_name || 'Undesignated'}</span>
                        <strong>${Number(d.amount).toFixed(2)}</strong>
                      </div>
                      <div className="text-muted">{new Date(d.created_at).toLocaleDateString()} · {d.payment_status}</div>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}

          {pledges.length > 0 && (
            <div className="card mt-3">
              <div className="card-body">
                <h6 className="fw-bold text-uppercase small text-muted mb-2">Pledges</h6>
                <ul className="list-unstyled small mb-0">
                  {pledges.map((p) => (
                    <li key={p.id} className="py-1 border-bottom">
                      <div className="d-flex justify-content-between">
                        <Link to={`/admin/pledges/${p.id}`}>{p.fund_name}</Link>
                        <span className={`badge bg-${p.status === 'active' ? 'success' : p.status === 'paused' ? 'warning' : 'secondary'}-subtle text-${p.status === 'active' ? 'success' : p.status === 'paused' ? 'warning' : 'secondary'}`}>{p.status}</span>
                      </div>
                      <div className="text-muted">
                        {p.balance_remaining != null ? `$${Number(p.balance_remaining).toFixed(2)} remaining` : 'Open-ended'}
                        {' '}of {p.total_pledged != null ? `$${Number(p.total_pledged).toFixed(2)}` : '—'}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </div>

        <Modal show={showHousehold} onClose={() => setShowHousehold(false)} title={household ? 'Manage Household' : 'Add to Household'} size="sm"
          footer={household ? null : <><button className="btn btn-light" onClick={() => setShowHousehold(false)}>Cancel</button>
                    <button className="btn btn-primary" onClick={createHousehold}>Create</button></>}>
          {household ? (
            <>
              <label className="form-label">Add a member</label>
              <SearchableSelect
                options={allContacts.filter((c) => !household.members.some((m) => Number(m.contact_id) === c.id)).map((c) => ({ value: c.id, label: `${c.first_name} ${c.last_name}`, sublabel: c.email }))}
                value={addMemberId}
                onChange={setAddMemberId}
                placeholder="Search contacts…"
              />
              <button className="btn btn-primary btn-sm mt-2" disabled={!addMemberId} onClick={addHouseholdMember}>Add to household</button>
            </>
          ) : (
            <>
              <label className="form-label">Household name</label>
              <input className="form-control" value={householdName} onChange={(e) => setHouseholdName(e.target.value)} placeholder="The Smith Family" autoFocus />
              <div className="form-text">{data?.contact?.first_name} {data?.contact?.last_name} will be added as the first member.</div>
            </>
          )}
        </Modal>

        <div className="col-lg-8">
          <div className="card">
            <div className="card-body">
              <h6 className="fw-bold text-uppercase small text-muted">Notes</h6>
              <div className="d-flex gap-2 mb-3">
                <textarea rows={2} className="form-control" placeholder="Add a note…" value={noteBody} onChange={(e) => setNoteBody(e.target.value)} />
                <button className="btn btn-primary" onClick={addNote}>Post</button>
              </div>
              <ul className="list-unstyled mb-0">
                {notes?.map((n) => (
                  <li key={n.id} className="py-2 border-top">
                    <div className="d-flex justify-content-between">
                      <strong>{n.user_name || 'System'}</strong>
                      <small className="text-muted">{new Date(n.created_at).toLocaleString()}</small>
                    </div>
                    <div>{n.body}</div>
                  </li>
                ))}
                {(!notes || notes.length === 0) && <li className="text-muted small py-2">No notes yet.</li>}
              </ul>
            </div>
          </div>

          <div className="card mt-3">
            <div className="card-body">
              <h6 className="fw-bold text-uppercase small text-muted">Tasks</h6>
              {tasks?.length ? (
                <ul className="list-unstyled mb-0">
                  {tasks.map((t) => (
                    <li key={t.id} className="d-flex justify-content-between py-2 border-top">
                      <div>
                        <div className="fw-semibold">{t.title}</div>
                        <small className="text-muted">Due {t.due_date ? new Date(t.due_date).toLocaleString() : '—'} · {t.assignee_name || 'Unassigned'}</small>
                      </div>
                      <span className={`badge bg-${t.status === 'completed' ? 'success' : 'warning'}-subtle text-${t.status === 'completed' ? 'success' : 'warning'}`}>{t.status}</span>
                    </li>
                  ))}
                </ul>
              ) : <div className="text-muted small">No tasks.</div>}
            </div>
          </div>

          <div className="card mt-3">
            <div className="card-body">
              <div className="d-flex align-items-center justify-content-between mb-2">
                <h6 className="fw-bold text-uppercase small text-muted mb-0">
                  Deals {deals?.length ? <span className="text-muted fw-normal">({deals.length})</span> : null}
                </h6>
                {can('deals.write') && (
                  <button className="btn btn-sm btn-primary" onClick={openAddDeal}>
                    <iconify-icon icon="solar:add-circle-line-duotone" class="me-1"></iconify-icon>
                    Add Deal
                  </button>
                )}
              </div>
              {deals?.length ? (
                <div className="table-responsive">
                <table className="table table-sm align-middle mb-0">
                  <thead><tr><th>Name</th><th className="text-end">Amount</th><th>Status</th><th>Close Date</th></tr></thead>
                  <tbody>
                    {deals.map((d) => (
                      <tr key={d.id}>
                        <td><Link to={`/admin/deals/${d.id}`}>{d.name}</Link></td>
                        <td className="text-end fw-bold">${Number(d.amount).toLocaleString()}</td>
                        <td><span className={`badge bg-${d.status === 'won' ? 'success' : d.status === 'lost' ? 'danger' : 'warning'}-subtle text-${d.status === 'won' ? 'success' : d.status === 'lost' ? 'danger' : 'warning'}`}>{d.status}</span></td>
                        <td>{d.expected_close_date}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                </div>
              ) : <div className="text-muted small">No deals.</div>}
            </div>
          </div>

          <AttachmentsPanel entityType="contact" entityId={Number(id)} />
          {googleConnected && <DriveTab entityType="contact" entityId={Number(id)} />}

          <div className="card mt-3">
            <div className="card-body">
              <h6 className="fw-bold text-uppercase small text-muted">Timeline</h6>
              <ul className="list-unstyled mb-0">
                {timeline.map((e, i) => (
                  <li key={i} className="py-2 border-top d-flex align-items-start gap-2">
                    <iconify-icon icon={e.icon} class="fs-5 text-muted mt-1"></iconify-icon>
                    <div className="flex-grow-1">
                      <div className="d-flex justify-content-between">
                        <span className="text-capitalize fw-semibold">{e.title}</span>
                        <small className="text-muted">{new Date(e.date).toLocaleString()}</small>
                      </div>
                      {e.description && <div className="small text-muted">{e.description}{e.meta ? ` — ${e.meta}` : ''}</div>}
                    </div>
                  </li>
                ))}
                {timeline.length === 0 && <li className="text-muted small py-2">No activity yet.</li>}
              </ul>
            </div>
          </div>
        </div>
      </div>

      <Modal show={editShow} onClose={() => setEditShow(false)} title="Edit Contact" size="lg"
        footer={<><button className="btn btn-light" onClick={() => setEditShow(false)}>Cancel</button>
                  <button className="btn btn-primary" onClick={saveEdit}>Save</button></>}>
        <div className="row g-2">
          <div className="col-12 col-md-6"><label className="form-label">First name</label>
            <input className="form-control" value={form.first_name || ''} onChange={(e) => setForm({ ...form, first_name: e.target.value })} /></div>
          <div className="col-12 col-md-6"><label className="form-label">Last name</label>
            <input className="form-control" value={form.last_name || ''} onChange={(e) => setForm({ ...form, last_name: e.target.value })} /></div>
          <div className="col-12 col-md-6"><label className="form-label">Email</label>
            <input className="form-control" value={form.email || ''} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
          <div className="col-12 col-md-6"><label className="form-label">Title</label>
            <input className="form-control" value={form.title || ''} onChange={(e) => setForm({ ...form, title: e.target.value })} /></div>
          <div className="col-12 col-md-6"><label className="form-label">Phone</label>
            <PhoneInput value={form.phone} onChange={(v) => setForm({ ...form, phone: v })} /></div>
          <div className="col-12 col-md-6"><label className="form-label">Mobile</label>
            <PhoneInput value={form.mobile} onChange={(v) => setForm({ ...form, mobile: v })} /></div>
          <div className="col-12 col-md-6">
            <div className="d-flex align-items-center justify-content-between mb-1">
              <label className="form-label mb-0">Organization</label>
              {!showNewOrg && (
                <button type="button" className="btn btn-link btn-sm p-0 text-primary" onClick={() => setShowNewOrg(true)}>
                  <iconify-icon icon="solar:add-circle-line-duotone" class="me-1"></iconify-icon>New org
                </button>
              )}
            </div>
            <select className="form-select" value={form.organization_id || ''} onChange={(e) => setForm({ ...form, organization_id: e.target.value })}>
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
          <div className="col-6 col-md-3"><label className="form-label">Lifecycle</label>
            <select className="form-select" value={form.lifecycle_stage || 'lead'} onChange={(e) => setForm({ ...form, lifecycle_stage: e.target.value })}>
              {['lead', 'mql', 'sql', 'customer', 'evangelist'].map((s) => <option key={s} value={s}>{s}</option>)}
            </select></div>
          <div className="col-6 col-md-3"><label className="form-label">Source</label>
            <input className="form-control" value={form.lead_source || ''} onChange={(e) => setForm({ ...form, lead_source: e.target.value })} /></div>
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
        <hr />
        <div className="form-check">
          <input
            id="contact_tax_exempt"
            type="checkbox"
            className="form-check-input"
            checked={!!form.tax_exempt}
            onChange={(e) => setForm({ ...form, tax_exempt: e.target.checked ? 1 : 0 })}
          />
          <label htmlFor="contact_tax_exempt" className="form-check-label">Tax Exempt</label>
        </div>
      </Modal>

      <ComposeMessageModal
        show={composeOpen}
        onClose={() => setComposeOpen(false)}
        defaults={{
          channel: composeChannel,
          to: composeChannel === 'email' ? (contact.email || '') : (contact.mobile || contact.phone || ''),
          entity_type: 'contact',
          entity_id: Number(id),
          contact_id: Number(id),
          organization_id: contact.organization_id || undefined,
        }}
        onSent={() => { setComposeOpen(false); load(); }}
      />

      <Modal show={dealShow} onClose={() => setDealShow(false)} title={`Add Deal for ${contact.first_name || ''} ${contact.last_name || ''}`.trim()} size="md"
        footer={<>
          <button className="btn btn-light" onClick={() => setDealShow(false)}>Cancel</button>
          <button className="btn btn-primary" onClick={createDeal} disabled={dealSaving}>{dealSaving ? 'Saving…' : 'Create Deal'}</button>
        </>}>
        <FormErrorBanner error={dealFormError} />
        <div className="row g-2">
          <div className="col-12">
            <label className="form-label">Name<Req /></label>
            <input className="form-control" value={newDeal.name} onChange={(e) => setNewDeal({ ...newDeal, name: e.target.value })} />
          </div>
          <div className="col-6">
            <label className="form-label">Amount</label>
            <input type="number" min="0" className="form-control" value={newDeal.amount} onChange={(e) => setNewDeal({ ...newDeal, amount: e.target.value })} />
          </div>
          <div className="col-6">
            <label className="form-label">Expected Close Date</label>
            <input type="date" className="form-control" value={newDeal.expected_close_date} onChange={(e) => setNewDeal({ ...newDeal, expected_close_date: e.target.value })} />
          </div>
          <div className="col-6">
            <label className="form-label">Pipeline</label>
            <select className="form-select" value={newDeal.pipeline_id || ''} onChange={(e) => changeDealPipeline(e.target.value)}>
              {pipelines.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div className="col-6">
            <label className="form-label">Stage</label>
            <select className="form-select" value={newDeal.stage_id || ''} onChange={(e) => setNewDeal({ ...newDeal, stage_id: e.target.value })}>
              {stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div className="col-12">
            <small className="text-muted">
              Deal will be created and linked to <strong>{contact.first_name} {contact.last_name}</strong>{contact.organization_name ? <> and <strong>{contact.organization_name}</strong></> : ''}.
            </small>
          </div>
        </div>
      </Modal>

      <Modal show={showMergePicker} onClose={() => setShowMergePicker(false)} title="Merge with…"
        footer={<>
          <button className="btn btn-light" onClick={() => setShowMergePicker(false)}>Cancel</button>
          <button className="btn btn-primary" onClick={startMerge} disabled={!mergeTargetId}>Continue</button>
        </>}>
        <label className="form-label">Pick the other contact to merge with</label>
        <SearchableSelect
          options={allContacts.filter((c) => c.id !== Number(id) && !c.merged_into_id)
            .map((c) => ({ value: c.id, label: `${c.first_name || ''} ${c.last_name || ''}`.trim(), sublabel: c.email }))}
          value={mergeTargetId}
          onChange={setMergeTargetId}
          placeholder="Search contacts…"
        />
      </Modal>

      {mergePair && (
        <MergeModal
          entityType="contact"
          recordA={mergePair.a}
          recordB={mergePair.b}
          onClose={() => setMergePair(null)}
          onMerged={() => { setMergePair(null); navigate('/admin/contacts'); }}
        />
      )}

      {confirmDialog}
    </div>
  );
}
