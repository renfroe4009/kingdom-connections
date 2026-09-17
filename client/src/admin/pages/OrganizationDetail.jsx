import { useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import api from '../../api/client.js';
import PageHeader from '../../components/PageHeader.jsx';
import Modal from '../../components/Modal.jsx';
import AttachmentsPanel from '../components/AttachmentsPanel.jsx';
import DriveTab from '../components/DriveTab.jsx';
import AddressVerifier from '../components/AddressVerifier.jsx';
import IndustrySicSelect from '../components/IndustrySicSelect.jsx';
import { useAuth } from '../../auth/AuthContext.jsx';
import PhoneInput from '../../components/PhoneInput.jsx';
import { useConfirm } from '../../hooks/useConfirm.jsx';
import { toast } from '../../components/Toast.jsx';
import { parseApiError } from '../../utils/apiError.js';
import { isBlank } from '../../utils/validation.js';
import { formatGateway } from '../../utils/gateway.js';
import FormErrorBanner from '../../components/FormErrorBanner.jsx';
import TagEditor from '../components/TagEditor.jsx';
import SearchableSelect from '../../components/SearchableSelect.jsx';
import MergeModal from '../components/MergeModal.jsx';
import RecordDonationModal from '../components/RecordDonationModal.jsx';

const emptyContact = { first_name: '', last_name: '', email: '', phone: '', title: '' };
const emptyDeal = { name: '', amount: '', expected_close_date: '', pipeline_id: null, stage_id: null };

function Req() {
  return <span className="text-danger ms-1">*</span>;
}

export default function OrganizationDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { can } = useAuth();
  const [data, setData] = useState(null);
  const [appEnabledBusy, setAppEnabledBusy] = useState(false);
  const [editShow, setEditShow] = useState(false);
  const [form, setForm] = useState({});
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const [orgCfg, setOrgCfg] = useState({});
  const [notes, setNotes] = useState([]);
  const [noteBody, setNoteBody] = useState('');
  const [timeline, setTimeline] = useState([]);
  const [pledges, setPledges] = useState([]);
  const [donations, setDonations] = useState({ rows: [], total: 0 });
  const [memberships, setMemberships] = useState([]);
  const [showDonate, setShowDonate] = useState(false);

  // Add Contact modal state
  const [contactShow, setContactShow] = useState(false);
  const [contactMode, setContactMode] = useState('attach'); // 'attach' | 'create'
  const [contactSearch, setContactSearch] = useState('');
  const [contactResults, setContactResults] = useState([]);
  const [newContact, setNewContact] = useState(emptyContact);
  const [contactFormError, setContactFormError] = useState('');
  const { confirm, dialog: confirmDialog } = useConfirm();

  // Add Deal modal state
  const [dealShow, setDealShow] = useState(false);
  const [pipelines, setPipelines] = useState([]);
  const [stages, setStages] = useState([]);
  const [newDeal, setNewDeal] = useState(emptyDeal);
  const [dealFormError, setDealFormError] = useState('');
  const [dealSaving, setDealSaving] = useState(false);

  // Merge state
  const [allOrgs, setAllOrgs] = useState([]);
  const [showMergePicker, setShowMergePicker] = useState(false);
  const [mergeTargetId, setMergeTargetId] = useState('');
  const [mergePair, setMergePair] = useState(null);

  function openMergePicker() {
    if (!allOrgs.length) api.get('/organizations', { params: { pageSize: 500 } }).then((r) => setAllOrgs(r.data.rows)).catch(() => {});
    setMergeTargetId('');
    setShowMergePicker(true);
  }
  function startMerge() {
    const target = allOrgs.find((o) => o.id === Number(mergeTargetId));
    if (!target) return;
    setShowMergePicker(false);
    setMergePair({ a: data.organization, b: target });
  }

  async function load() {
    const { data } = await api.get(`/organizations/${id}`);
    setData(data);
    api.get('/pledges', { params: { organization_id: id } }).then((r) => setPledges(r.data.rows || [])).catch(() => {});
    api.get('/donations/admin', { params: { organization_id: id, pageSize: 10 } }).then((r) => setDonations(r.data)).catch(() => {});
    api.get('/subscriptions', { params: { organization_id: id } }).then((r) => setMemberships((r.data.rows || []).filter((s) => s.membership_tier_id))).catch(() => {});
    const { data: notesData } = await api.get('/notes', { params: { entity_type: 'organization', entity_id: id } });
    setNotes(notesData);
    api.get(`/organizations/${id}/timeline`).then((r) => setTimeline(r.data.events || [])).catch(() => {});
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [id]);

  // Standalone toggle — kept independent of the big edit-modal save flow
  // (same pattern as Settings → Security's MFA switch) so flipping mobile
  // API visibility never requires resubmitting the rest of the org record.
  async function setAppEnabled(next) {
    setAppEnabledBusy(true);
    try {
      await api.patch(`/organizations/${id}/app-enabled`, { app_enabled: next });
      setData((d) => ({ ...d, organization: { ...d.organization, app_enabled: next } }));
    } catch (e) {
      alert(e.response?.data?.error || 'Failed to update mobile app visibility');
    } finally {
      setAppEnabledBusy(false);
    }
  }
  const [cwUrls, setCwUrls] = useState(null);
  useEffect(() => {
    api.get('/settings/module/organizations').then((r) => setOrgCfg(r.data)).catch(() => {});
    api.get('/connectwise/active').then((r) => { if (r.data?.active) setCwUrls(r.data); }).catch(() => {});
  }, []);

  async function addNote() {
    if (!noteBody.trim()) return;
    try {
      await api.post('/notes', { entity_type: 'organization', entity_id: Number(id), body: noteBody });
      setNoteBody(''); load();
    } catch (err) {
      toast(parseApiError(err), 'error');
    }
  }

  function openEdit() {
    const o = data.organization;
    setForm({
      name: o.name || '', website: o.website || '', industry: o.industry || '',
      sic_code: o.sic_code || '',
      phone: o.phone || '', employee_count: o.employee_count || '',
      annual_revenue: o.annual_revenue || '',
      address_line1: o.address_line1 || '', address_line2: o.address_line2 || '',
      city: o.city || '', state: o.state || '', postal_code: o.postal_code || '',
      country: o.country || '',
      tax_exempt: o.tax_exempt ? 1 : 0,
    });
    setFormError('');
    setEditShow(true);
  }

  function clientValidate() {
    if (orgCfg.require_website  && !form.website?.trim())      return 'Website is required.';
    if (orgCfg.require_phone    && !form.phone?.trim())         return 'Phone number is required.';
    if (orgCfg.require_industry && !form.industry?.trim())      return 'Industry is required.';
    if (orgCfg.require_address  && !form.address_line1?.trim()) return 'Street address is required.';
    return null;
  }

  async function saveEdit() {
    const clientErr = clientValidate();
    if (clientErr) { setFormError(clientErr); return; }

    const payload = {};
    for (const [k, v] of Object.entries(form)) {
      if (v === '' || v === null || v === undefined) continue;
      payload[k] = v;
    }
    if (!payload.name) payload.name = form.name;
    if (payload.employee_count != null) payload.employee_count = Number(payload.employee_count);
    if (payload.annual_revenue != null) payload.annual_revenue = Number(payload.annual_revenue);
    setSaving(true);
    setFormError('');
    try {
      await api.put(`/organizations/${id}`, payload);
      setEditShow(false); load();
    } catch (err) {
      const msg = err?.response?.data?.error || err?.response?.data?.message || err.message || 'Save failed';
      setFormError(msg);
    } finally {
      setSaving(false);
    }
  }
  async function remove() {
    if (!(await confirm(`Delete organization? Linked contacts and deals will lose their org reference.`))) return;
    try {
      await api.delete(`/organizations/${id}`);
      navigate('/admin/organizations');
    } catch (err) {
      toast(parseApiError(err), 'error');
    }
  }

  async function capturePayment(pid) {
    if (!(await confirm('Mark this pending payment as captured? Use this when the gateway confirmed payment but the webhook never reached us (e.g. localhost dev).', { danger: false, confirmLabel: 'Mark captured' }))) return;
    try {
      await api.post(`/payments/${pid}/capture`);
      load();
    } catch (err) {
      toast(parseApiError(err, 'Could not capture payment'), 'error');
    }
  }

  async function detachContact(c) {
    if (!(await confirm(`Remove ${c.first_name} ${c.last_name} from ${data.organization.name}? The contact itself is not deleted.`))) return;
    try {
      await api.put(`/contacts/${c.id}`, {
        first_name: c.first_name,
        last_name: c.last_name,
        email: c.email || null,
        phone: c.phone || null,
        title: c.title || null,
        organization_id: null,
        lifecycle_stage: c.lifecycle_stage || 'lead',
        lead_source: c.lead_source || null,
        owner_id: c.owner_id ?? null,
      });
      load();
    } catch (err) {
      toast(parseApiError(err), 'error');
    }
  }

  function openAddContactFromEdit() {
    setEditShow(false);
    openAddContact();
  }

  function openAddContact() {
    setContactMode('attach');
    setContactSearch('');
    setContactResults([]);
    setNewContact(emptyContact);
    setContactFormError('');
    setContactShow(true);
  }

  async function searchContacts(q) {
    setContactSearch(q);
    if (!q.trim()) { setContactResults([]); return; }
    const { data: res } = await api.get('/contacts', { params: { q, pageSize: 10 } });
    setContactResults(res?.rows || []);
  }

  async function attachContact(contact) {
    if (contact.organization_id && contact.organization_id !== Number(id)) {
      if (!(await confirm(`${contact.first_name} ${contact.last_name} is currently linked to another organization. Move them to ${data.organization.name}?`, { danger: false, confirmLabel: 'Move' }))) return;
    }
    try {
      await api.put(`/contacts/${contact.id}`, {
        first_name: contact.first_name,
        last_name: contact.last_name,
        email: contact.email || null,
        phone: contact.phone || null,
        title: contact.title || null,
        organization_id: Number(id),
        lifecycle_stage: contact.lifecycle_stage || 'lead',
        lead_source: contact.lead_source || null,
        owner_id: contact.owner_id ?? null,
      });
      setContactShow(false);
      load();
    } catch (err) {
      setContactFormError(parseApiError(err));
    }
  }

  async function createContact() {
    if (isBlank(newContact.first_name) && isBlank(newContact.last_name)) {
      setContactFormError('Enter at least a first or last name.');
      return;
    }
    setContactFormError('');
    try {
      await api.post('/contacts', {
        ...newContact,
        email: newContact.email || null,
        phone: newContact.phone || null,
        title: newContact.title || null,
        organization_id: Number(id),
        lifecycle_stage: 'lead',
      });
      setContactShow(false);
      load();
    } catch (err) {
      setContactFormError(parseApiError(err));
    }
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
        organization_id: Number(id),
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
  const { organization, contacts, deals, invoices = [], payments = [], totals } = data;
  const fmtMoney = (n, cur = 'USD') => {
    const v = Number(n || 0);
    try { return new Intl.NumberFormat('en-US', { style: 'currency', currency: cur }).format(v); }
    catch (_e) { return `$${v.toFixed(2)}`; }
  };
  const INVOICE_TONE = {
    draft: 'secondary', sent: 'primary', partial: 'warning',
    paid: 'success', overdue: 'danger', void: 'dark', refunded: 'info',
  };
  const PAYMENT_TONE = (s) =>
    (s === 'captured' || s === 'authorized') ? 'success'
    : (s === 'refunded' || s === 'voided' || s === 'failed') ? 'danger'
    : 'secondary';
  // Receipts are available for any payment that represents a real transaction,
  // even if still settling. Pending = authorized, waiting for overnight batch —
  // the receipt itself reflects that state via its badge/subline copy. We only
  // hide receipts for true dead-ends.
  const HAS_RECEIPT = (s) =>
    !!s && !['failed','voided','refunded','cancelled'].includes(String(s).toLowerCase());

  return (
    <div>
      <PageHeader title={organization.name}
        subtitle={[organization.industry, organization.sic_code && `SIC ${organization.sic_code}`].filter(Boolean).join(' · ')}
        actions={
          <>
            <Link to="/admin/organizations" className="btn btn-light">← Back</Link>
            {can('donations.write') && (
              <button className="btn btn-primary ms-2" onClick={() => setShowDonate(true)}>
                <iconify-icon icon="solar:hand-heart-line-duotone" class="me-1"></iconify-icon> Donate
              </button>
            )}
            {can('organizations.write') && (
              <button className="btn btn-primary ms-2" onClick={openEdit}>
                <iconify-icon icon="solar:pen-new-square-line-duotone" class="me-1"></iconify-icon> Edit
              </button>
            )}
            {can('organizations.write') && can('organizations.delete') && !organization.merged_into_id && (
              <button className="btn btn-outline-secondary ms-2" onClick={openMergePicker}>
                <iconify-icon icon="solar:layers-minimalistic-line-duotone" class="me-1"></iconify-icon> Merge with…
              </button>
            )}
            {can('organizations.delete') && (
              <button className="btn btn-light text-danger ms-2" onClick={remove}>
                <iconify-icon icon="solar:trash-bin-trash-line-duotone" class="me-1"></iconify-icon> Delete
              </button>
            )}
            {cwUrls && organization.cw_company_id && (
              <a
                className="btn btn-outline-secondary ms-2"
                href={`${cwUrls.company_url}${organization.cw_company_id}`}
                target="_blank" rel="noreferrer"
                title="Open in ConnectWise"
              >
                <iconify-icon icon="solar:square-top-down-line-duotone" class="me-1"></iconify-icon> Open in CW
              </a>
            )}
          </>
        }
      />

      {organization.merged_into_id && (
        <div className="alert alert-info d-flex align-items-center gap-2 mb-3">
          <iconify-icon icon="solar:layers-minimalistic-line-duotone" class="fs-5"></iconify-icon>
          This organization was merged into another record.{' '}
          <Link to={`/admin/organizations/${organization.merged_into_id}`}>View merged record →</Link>
        </div>
      )}

      <div className="row">
        <div className="col-lg-4 mb-3">
          <div className="card">
            <div className="card-body">
              <h6 className="fw-bold text-uppercase small text-muted">Details</h6>
              <dl className="row mb-0">
                <dt className="col-5">Website</dt><dd className="col-7">{organization.website ? <a href={organization.website} target="_blank" rel="noreferrer">{organization.website}</a> : '—'}</dd>
                <dt className="col-5">Phone</dt><dd className="col-7">{organization.phone || '—'}</dd>
                <dt className="col-5">Employees</dt><dd className="col-7">{organization.employee_count || '—'}</dd>
                <dt className="col-5">Revenue</dt><dd className="col-7">{organization.annual_revenue ? `$${Number(organization.annual_revenue).toLocaleString()}` : '—'}</dd>
                <dt className="col-5">Location</dt><dd className="col-7">{[organization.city, organization.state, organization.country].filter(Boolean).join(', ')}</dd>
                <dt className="col-5">CW Company</dt><dd className="col-7">{organization.cw_company_id || '—'}</dd>
              </dl>
            </div>
          </div>
          <div className="card mt-3">
            <div className="card-body">
              <div className="form-check form-switch mb-0">
                <input
                  type="checkbox"
                  className="form-check-input"
                  role="switch"
                  id="orgAppEnabledSwitch"
                  checked={!!organization.app_enabled}
                  disabled={appEnabledBusy || !can('organizations.write')}
                  onChange={(e) => setAppEnabled(e.target.checked)}
                />
                <label className="form-check-label fw-semibold" htmlFor="orgAppEnabledSwitch">
                  Visible to Praying Planet mobile app
                </label>
              </div>
              <div className="text-muted small mt-1">
                When on, this organization's members are visible to the Mobile API
                (Settings → Integrations → Mobile API).
              </div>
            </div>
          </div>
          <TagEditor
            entityType="organization"
            entityId={id}
            tags={data.tags || []}
            canEdit={can('organizations.write')}
            onChange={(newTags) => setData((d) => ({ ...d, tags: newTags }))}
          />
          {donations.rows.length > 0 && (
            <div className="card mt-3">
              <div className="card-body">
                <h6 className="fw-bold text-uppercase small text-muted mb-2">Giving History</h6>
                <ul className="list-unstyled small mb-0">
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

          {memberships.length > 0 && (
            <div className="card mt-3">
              <div className="card-body">
                <h6 className="fw-bold text-uppercase small text-muted mb-2">Membership</h6>
                <ul className="list-unstyled small mb-0">
                  {memberships.map((s) => (
                    <li key={s.id} className="py-1 border-bottom">
                      <div className="d-flex justify-content-between">
                        <Link to={`/admin/subscriptions/${s.id}`}>{s.name}</Link>
                        <span className={`badge bg-${s.status === 'active' ? 'success' : s.status === 'paused' ? 'warning' : 'secondary'}-subtle text-${s.status === 'active' ? 'success' : s.status === 'paused' ? 'warning' : 'secondary'}`}>{s.status}</span>
                      </div>
                      <div className="text-muted">
                        Next renewal {s.next_run_date || '—'} · {Number(s.payment_count) || 0} charge{Number(s.payment_count) === 1 ? '' : 's'} · ${Number(s.captured_total || 0).toFixed(2)} total
                      </div>
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

        <div className="col-lg-8">
          <div className="card">
            <div className="card-body">
              <div className="d-flex align-items-center justify-content-between mb-2">
                <h6 className="fw-bold text-uppercase small text-muted mb-0">
                  Contacts {contacts?.length ? <span className="text-muted fw-normal">({contacts.length})</span> : null}
                </h6>
                {can('contacts.write') && (
                  <button className="btn btn-sm btn-primary" onClick={openAddContact}>
                    <iconify-icon icon="solar:add-circle-line-duotone" class="me-1"></iconify-icon>
                    Add Contact
                  </button>
                )}
              </div>
              {contacts?.length ? (
                <div className="table-responsive">
                <table className="table table-sm align-middle mb-0">
                  <thead><tr><th>Name</th><th>Title</th><th>Email</th><th>Phone</th></tr></thead>
                  <tbody>
                    {contacts.map((c) => (
                      <tr key={c.id}>
                        <td><Link to={`/admin/contacts/${c.id}`}>{c.first_name} {c.last_name}</Link></td>
                        <td>{c.title}</td>
                        <td>{c.email}</td>
                        <td>{c.phone}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                </div>
              ) : <div className="text-muted small">No contacts.</div>}
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

          {/* ---------------- Invoices ---------------- */}
          <div className="card mt-3">
            <div className="card-body">
              <div className="d-flex justify-content-between align-items-center mb-2">
                <h6 className="fw-bold text-uppercase small text-muted mb-0">
                  Invoices {invoices.length ? <span className="fw-normal">({invoices.length})</span> : null}
                </h6>
                {can('invoices.write') && (
                  // Invoice creation lives in a modal on /invoices — pass
                  // ?new=1 to auto-open it and organization_id to preselect
                  // this org as the bill-to. (See InvoicesList for the matching read.)
                  <Link to={`/admin/invoices?new=1&organization_id=${id}`} className="btn btn-sm btn-primary">
                    <iconify-icon icon="solar:add-circle-line-duotone" class="me-1"></iconify-icon>
                    New Invoice
                  </Link>
                )}
              </div>

              {totals && invoices.length > 0 && (
                <div className="row g-2 mb-3">
                  <div className="col-md-4">
                    <div className="border rounded p-2">
                      <div className="small text-muted">Invoiced</div>
                      <div className="fw-bolder fs-5">{fmtMoney(totals.invoiced)}</div>
                    </div>
                  </div>
                  <div className="col-md-4">
                    <div className="border rounded p-2">
                      <div className="small text-muted">Paid</div>
                      <div className="fw-bolder fs-5 text-success">{fmtMoney(totals.paid)}</div>
                    </div>
                  </div>
                  <div className="col-md-4">
                    <div className="border rounded p-2">
                      <div className="small text-muted">Balance Due</div>
                      <div className={`fw-bolder fs-5 ${Number(totals.balance) > 0 ? 'text-danger' : ''}`}>
                        {fmtMoney(totals.balance)}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {invoices.length ? (
                <div className="table-responsive">
                  <table className="table table-sm align-middle mb-0">
                    <thead>
                      <tr>
                        <th>Number</th>
                        <th>Issued</th>
                        <th>Due</th>
                        <th>Contact</th>
                        <th>Status</th>
                        <th className="text-end">Total</th>
                        <th className="text-end">Balance</th>
                      </tr>
                    </thead>
                    <tbody>
                      {invoices.map((i) => (
                        <tr key={i.id}>
                          <td><Link to={`/admin/invoices/${i.id}`}>{i.invoice_number}</Link></td>
                          <td className="text-muted small">{i.issue_date}</td>
                          <td className="text-muted small">{i.due_date}</td>
                          <td className="small">{i.contact_name || '—'}</td>
                          <td>
                            <span className={`badge bg-${INVOICE_TONE[i.status] || 'secondary'}-subtle text-${INVOICE_TONE[i.status] || 'secondary'}`}>
                              {i.status}
                            </span>
                          </td>
                          <td className="text-end fw-semibold">{fmtMoney(i.total, i.currency)}</td>
                          <td className={`text-end fw-semibold ${Number(i.balance_due) > 0 ? 'text-danger' : 'text-muted'}`}>
                            {fmtMoney(i.balance_due, i.currency)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : <div className="text-muted small">No invoices yet.</div>}
            </div>
          </div>

          {/* ---------------- Payments ---------------- */}
          <div className="card mt-3">
            <div className="card-body">
              <h6 className="fw-bold text-uppercase small text-muted">
                Payments {payments.length ? <span className="fw-normal">({payments.length})</span> : null}
              </h6>
              {payments.length ? (
                <div className="table-responsive">
                  <table className="table table-sm align-middle mb-0">
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Invoice</th>
                        <th>Gateway</th>
                        <th>Method</th>
                        <th className="text-end">Amount</th>
                        <th>Status</th>
                        <th className="small">Txn</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {payments.map((p) => (
                        <tr key={p.id}>
                          <td className="small">{new Date(p.received_at || p.created_at).toLocaleDateString()}</td>
                          <td><Link to={`/admin/invoices/${p.invoice_id}`}>{p.invoice_number}</Link></td>
                          <td className="small">{formatGateway(p.gateway)}</td>
                          <td className="small">
                            {p.method || 'card'}
                            {p.card_last4 ? <span className="text-muted"> ****{p.card_last4}</span> : null}
                          </td>
                          <td className="text-end fw-semibold">{fmtMoney(p.amount, p.currency)}</td>
                          <td>
                            <span className={`badge bg-${PAYMENT_TONE(p.status)}-subtle text-${PAYMENT_TONE(p.status)}`}>
                              {p.status}
                            </span>
                          </td>
                          <td className="small text-muted">{p.external_txn_id || '—'}</td>
                          <td className="text-nowrap">
                            {/* Pending payments get a 'Mark captured' escape hatch for
                                localhost dev where the gateway IPN can't reach us. */}
                            {String(p.status).toLowerCase() === 'pending' && can('payments.write') && (
                              <button
                                className="btn btn-sm btn-success me-1"
                                title="Flip this pending payment to captured"
                                onClick={() => capturePayment(p.id)}
                              >
                                <iconify-icon icon="solar:check-circle-line-duotone" class="me-1"></iconify-icon>
                                Mark captured
                              </button>
                            )}
                            {HAS_RECEIPT(p.status) && p.receipt_token ? (
                              <>
                                <a
                                  href={`/api/payments/public/receipt/by-token/${p.receipt_token}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="btn btn-sm btn-outline-primary"
                                  title="View receipt"
                                >
                                  <iconify-icon icon="solar:document-text-line-duotone" class="me-1"></iconify-icon>
                                  Receipt
                                </a>
                                <a
                                  href={`/api/payments/public/receipt/by-token/${p.receipt_token}.pdf`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="btn btn-sm btn-light ms-1"
                                  title="Download PDF"
                                >
                                  <iconify-icon icon="solar:file-download-line-duotone"></iconify-icon>
                                </a>
                              </>
                            ) : <span className="text-muted small">—</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : <div className="text-muted small">No payments yet.</div>}
            </div>
          </div>

          <div className="card mt-3">
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

          <AttachmentsPanel entityType="organization" entityId={Number(id)} />
          <DriveTab entityType="organization" entityId={Number(id)} />

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

      <Modal show={editShow} onClose={() => setEditShow(false)} title="Edit Organization" size="lg"
        footer={
          <>
            <button className="btn btn-light" onClick={() => setEditShow(false)}>Cancel</button>
            <button className="btn btn-primary" onClick={saveEdit} disabled={saving}>
              {saving ? <><span className="spinner-border spinner-border-sm me-2" />Saving…</> : 'Save'}
            </button>
          </>
        }>

        {formError && (
          <div className="alert alert-danger d-flex align-items-center gap-2 py-2 mb-3">
            <iconify-icon icon="solar:close-circle-line-duotone" class="fs-5"></iconify-icon>
            {formError}
          </div>
        )}

        <div className="row g-2">
          <div className="col-12 col-md-8"><label className="form-label">Name</label>
            <input className="form-control" value={form.name || ''} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
          <div className="col-12 col-md-4">
            <label className="form-label">Industry / SIC{orgCfg.require_industry && <Req />}</label>
            <IndustrySicSelect industry={form.industry || ''} sicCode={form.sic_code || ''}
              onChange={({ industry, sic_code }) => setForm({ ...form, industry, sic_code })} /></div>
          <div className="col-12 col-md-6">
            <label className="form-label">Website{orgCfg.require_website && <Req />}</label>
            <input className="form-control" value={form.website || ''} onChange={(e) => setForm({ ...form, website: e.target.value })} /></div>
          <div className="col-12 col-md-3">
            <label className="form-label">Phone{orgCfg.require_phone && <Req />}</label>
            <PhoneInput value={form.phone} onChange={(v) => setForm({ ...form, phone: v })} /></div>
          <div className="col-6 col-md-3"><label className="form-label">Employees</label>
            <input type="number" className="form-control" value={form.employee_count || ''} onChange={(e) => setForm({ ...form, employee_count: e.target.value })} /></div>
          <div className="col-6 col-md-3"><label className="form-label">Annual revenue</label>
            <input type="number" className="form-control" value={form.annual_revenue || ''} onChange={(e) => setForm({ ...form, annual_revenue: e.target.value })} /></div>
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
          requiredAddress={orgCfg.require_address}
        />
        <div className="form-check mt-3">
          <input
            id="org_tax_exempt"
            type="checkbox"
            className="form-check-input"
            checked={!!form.tax_exempt}
            onChange={(e) => setForm({ ...form, tax_exempt: e.target.checked ? 1 : 0 })}
          />
          <label htmlFor="org_tax_exempt" className="form-check-label">Tax Exempt</label>
        </div>

        <hr />
        <div className="d-flex align-items-center justify-content-between mb-2">
          <h6 className="fw-bold text-uppercase small text-muted mb-0">
            Associated Contacts {contacts?.length ? <span className="text-muted fw-normal">({contacts.length})</span> : null}
          </h6>
          {can('contacts.write') && (
            <button type="button" className="btn btn-sm btn-primary" onClick={openAddContactFromEdit}>
              <iconify-icon icon="solar:add-circle-line-duotone" class="me-1"></iconify-icon>
              Add Contact
            </button>
          )}
        </div>
        {contacts?.length ? (
          <ul className="list-group">
            {contacts.map((c) => (
              <li key={c.id} className="list-group-item d-flex align-items-center justify-content-between">
                <div>
                  <Link to={`/admin/contacts/${c.id}`} className="fw-semibold text-decoration-none">
                    {c.first_name} {c.last_name}
                  </Link>
                  <div className="small text-muted">
                    {c.title || 'No title'} · {c.email || '—'} · {c.phone || '—'}
                  </div>
                </div>
                {can('contacts.write') && (
                  <button
                    type="button"
                    className="btn btn-sm btn-light text-danger"
                    onClick={() => detachContact(c)}
                    title="Remove from this organization"
                  >
                    <iconify-icon icon="solar:link-broken-line-duotone" class="me-1"></iconify-icon>
                    Remove
                  </button>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <div className="text-muted small py-2">No contacts linked. Use <strong>Add Contact</strong> above to attach one.</div>
        )}
      </Modal>

      <Modal show={contactShow} onClose={() => setContactShow(false)} title={`Add Contact to ${data.organization.name}`} size="lg"
        footer={
          <>
            <button className="btn btn-light" onClick={() => setContactShow(false)}>Cancel</button>
            {contactMode === 'create' && (
              <button className="btn btn-primary" onClick={createContact}>Create &amp; Attach</button>
            )}
          </>
        }
      >
        <FormErrorBanner error={contactFormError} />
        <ul className="nav nav-pills mb-3">
          <li className="nav-item">
            <button
              className={'nav-link ' + (contactMode === 'attach' ? 'active' : '')}
              onClick={() => { setContactMode('attach'); setContactFormError(''); }}
            >
              Attach Existing
            </button>
          </li>
          <li className="nav-item">
            <button
              className={'nav-link ' + (contactMode === 'create' ? 'active' : '')}
              onClick={() => { setContactMode('create'); setContactFormError(''); }}
            >
              Create New
            </button>
          </li>
        </ul>

        {contactMode === 'attach' && (
          <div>
            <input
              type="text"
              className="form-control mb-2"
              placeholder="Search by name, email, or phone…"
              value={contactSearch}
              onChange={(e) => searchContacts(e.target.value)}
              autoFocus
            />
            {contactSearch && !contactResults.length && (
              <div className="text-muted small py-2">No matches.</div>
            )}
            {contactResults.length > 0 && (
              <ul className="list-group">
                {contactResults.map((c) => {
                  const alreadyHere = c.organization_id === Number(id);
                  return (
                    <li key={c.id} className="list-group-item d-flex align-items-center justify-content-between">
                      <div>
                        <div className="fw-semibold">{c.first_name} {c.last_name}</div>
                        <small className="text-muted">
                          {c.email || '—'} · {c.title || 'No title'}
                          {c.organization_id && c.organization_name ? ` · ${c.organization_name}` : ''}
                        </small>
                      </div>
                      {alreadyHere ? (
                        <span className="badge bg-success-subtle text-success">Already attached</span>
                      ) : (
                        <button className="btn btn-sm btn-primary" onClick={() => attachContact(c)}>
                          Attach
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}

        {contactMode === 'create' && (
          <div className="row g-2">
            <div className="col-md-6">
              <label className="form-label">First name</label>
              <input
                className="form-control"
                value={newContact.first_name}
                onChange={(e) => setNewContact({ ...newContact, first_name: e.target.value })}
                autoFocus
              />
            </div>
            <div className="col-md-6">
              <label className="form-label">Last name</label>
              <input
                className="form-control"
                value={newContact.last_name}
                onChange={(e) => setNewContact({ ...newContact, last_name: e.target.value })}
              />
            </div>
            <div className="col-md-6">
              <label className="form-label">Email</label>
              <input
                type="email"
                className="form-control"
                value={newContact.email}
                onChange={(e) => setNewContact({ ...newContact, email: e.target.value })}
              />
            </div>
            <div className="col-md-6">
              <label className="form-label">Phone</label>
              <PhoneInput value={newContact.phone} onChange={(v) => setNewContact({ ...newContact, phone: v })} />
            </div>
            <div className="col-12">
              <label className="form-label">Title</label>
              <input
                className="form-control"
                value={newContact.title}
                onChange={(e) => setNewContact({ ...newContact, title: e.target.value })}
              />
            </div>
            <div className="col-12">
              <small className="text-muted">
                Contact will be created and linked to <strong>{data.organization.name}</strong>.
              </small>
            </div>
          </div>
        )}
      </Modal>

      <Modal show={dealShow} onClose={() => setDealShow(false)} title={`Add Deal to ${data.organization.name}`} size="md"
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
            <small className="text-muted">Deal will be created and linked to <strong>{data.organization.name}</strong>.</small>
          </div>
        </div>
      </Modal>

      <Modal show={showMergePicker} onClose={() => setShowMergePicker(false)} title="Merge with…"
        footer={<>
          <button className="btn btn-light" onClick={() => setShowMergePicker(false)}>Cancel</button>
          <button className="btn btn-primary" onClick={startMerge} disabled={!mergeTargetId}>Continue</button>
        </>}>
        <label className="form-label">Pick the other organization to merge with</label>
        <SearchableSelect
          options={allOrgs.filter((o) => o.id !== Number(id) && !o.merged_into_id)
            .map((o) => ({ value: o.id, label: o.name, sublabel: o.website }))}
          value={mergeTargetId}
          onChange={setMergeTargetId}
          placeholder="Search organizations…"
        />
      </Modal>

      {mergePair && (
        <MergeModal
          entityType="organization"
          recordA={mergePair.a}
          recordB={mergePair.b}
          onClose={() => setMergePair(null)}
          onMerged={() => { setMergePair(null); navigate('/admin/organizations'); }}
        />
      )}

      <RecordDonationModal
        show={showDonate}
        onClose={() => setShowDonate(false)}
        lockedOrganizationId={Number(id)}
        lockedDonorLabel={organization.name}
        onSaved={() => { setShowDonate(false); load(); }}
      />

      {confirmDialog}
    </div>
  );
}
