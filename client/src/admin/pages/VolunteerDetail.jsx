import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import api from '../../api/client.js';
import PageHeader from '../../components/PageHeader.jsx';
import Modal from '../../components/Modal.jsx';
import AttachmentsPanel from '../components/AttachmentsPanel.jsx';
import { toast } from '../../components/Toast.jsx';
import { parseApiError } from '../../utils/apiError.js';
import { useConfirm } from '../../hooks/useConfirm.jsx';
import { useAuth } from '../../auth/AuthContext.jsx';

const COMPLIANCE_TYPES = ['background_check', 'waiver', 'training', 'other'];
const COMPLIANCE_STATUS_TONE = { pending: 'secondary', submitted: 'primary', approved: 'success', expired: 'danger' };

function typeLabel(t) {
  return t.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

const emptyItem = { id: null, type: 'background_check', status: 'pending', expiry_date: '', notes: '' };

export default function VolunteerDetail() {
  const { contactId } = useParams();
  const { can } = useAuth();
  const { confirm, dialog: confirmDialog } = useConfirm();
  const [contact, setContact] = useState(null);
  const [assignments, setAssignments] = useState([]);
  const [compliance, setCompliance] = useState([]);
  const [showItem, setShowItem] = useState(false);
  const [itemForm, setItemForm] = useState(emptyItem);
  const [docsFor, setDocsFor] = useState(null); // compliance item to manage documents for

  async function load() {
    const [c, a, comp] = await Promise.all([
      api.get(`/contacts/${contactId}`),
      api.get('/volunteers/admin', { params: { contact_id: contactId } }),
      api.get('/volunteers/admin/compliance', { params: { contact_id: contactId } }),
    ]);
    setContact(c.data.contact);
    setAssignments(a.data);
    setCompliance(comp.data);
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [contactId]);

  const totalApprovedHours = assignments
    .filter((a) => a.hours_approved_at)
    .reduce((sum, a) => sum + Number(a.actual_hours || 0), 0);

  function openNewItem() { setItemForm(emptyItem); setShowItem(true); }
  function openEditItem(item) {
    setItemForm({ id: item.id, type: item.type, status: item.status, expiry_date: item.expiry_date || '', notes: item.notes || '' });
    setShowItem(true);
  }

  async function saveItem() {
    try {
      const payload = { type: itemForm.type, status: itemForm.status, expiry_date: itemForm.expiry_date || null, notes: itemForm.notes || null };
      if (itemForm.id) await api.put(`/volunteers/admin/compliance/${itemForm.id}`, payload);
      else await api.post('/volunteers/admin/compliance', { ...payload, contact_id: Number(contactId) });
      setShowItem(false);
      load();
    } catch (e) {
      toast(parseApiError(e), 'error');
    }
  }

  async function removeItem(item) {
    if (!(await confirm(`Delete this ${typeLabel(item.type)} record?`))) return;
    try {
      await api.delete(`/volunteers/admin/compliance/${item.id}`);
      load();
    } catch (e) {
      toast(parseApiError(e), 'error');
    }
  }

  if (!contact) return <div className="empty-state">Loading…</div>;

  return (
    <div>
      <PageHeader
        title={`${contact.first_name} ${contact.last_name}`}
        subtitle="Volunteer record"
        actions={<>
          <Link to="/admin/volunteers" className="btn btn-light">← Back</Link>
          <Link to={`/admin/contacts/${contactId}`} className="btn btn-light ms-2">View Contact</Link>
        </>}
      />

      <div className="row">
        <div className="col-lg-4 mb-3">
          <div className="card">
            <div className="card-body">
              <h6 className="fw-bold text-uppercase small text-muted">Summary</h6>
              <dl className="row mb-0">
                <dt className="col-6">Email</dt><dd className="col-6">{contact.email || '—'}</dd>
                <dt className="col-6">Phone</dt><dd className="col-6">{contact.phone || '—'}</dd>
                <dt className="col-6">Assignments</dt><dd className="col-6">{assignments.length}</dd>
                <dt className="col-6">Approved Hours</dt><dd className="col-6 fw-semibold">{totalApprovedHours.toFixed(2)}</dd>
              </dl>
            </div>
          </div>
        </div>

        <div className="col-lg-8">
          <div className="card mb-3">
            <div className="card-body">
              <h6 className="fw-bold text-uppercase small text-muted mb-2">Assignments</h6>
              <div className="table-responsive">
                <table className="table table-sm align-middle mb-0">
                  <thead><tr><th>Event</th><th>Role</th><th>Hours</th><th>Status</th></tr></thead>
                  <tbody>
                    {assignments.map((a) => (
                      <tr key={a.id}>
                        <td><Link to={`/admin/events/${a.event_id}`}>{a.event_name}</Link></td>
                        <td>{a.role || '—'}</td>
                        <td>
                          {a.actual_hours != null ? `${a.actual_hours}h` : '—'}
                          {a.hours_approved_at && <span className="badge bg-success-subtle text-success ms-1">Approved</span>}
                        </td>
                        <td><span className="badge bg-primary-subtle text-primary">{a.status}</span></td>
                      </tr>
                    ))}
                    {assignments.length === 0 && <tr><td colSpan="4"><div className="empty-state">No assignments yet.</div></td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-body">
              <div className="d-flex justify-content-between align-items-center mb-2">
                <h6 className="fw-bold text-uppercase small text-muted mb-0">Compliance Items</h6>
                {can('volunteers.write') && (
                  <button className="btn btn-sm btn-primary" onClick={openNewItem}>
                    <iconify-icon icon="solar:add-circle-line-duotone" class="me-1"></iconify-icon> Add Item
                  </button>
                )}
              </div>
              <div className="table-responsive">
                <table className="table table-sm align-middle mb-0">
                  <thead><tr><th>Type</th><th>Status</th><th>Expires</th><th></th></tr></thead>
                  <tbody>
                    {compliance.map((item) => (
                      <tr key={item.id}>
                        <td>{typeLabel(item.type)}</td>
                        <td><span className={`badge bg-${COMPLIANCE_STATUS_TONE[item.status]}-subtle text-${COMPLIANCE_STATUS_TONE[item.status]}`}>{item.status}</span></td>
                        <td>{item.expiry_date || '—'}</td>
                        <td className="text-end text-nowrap">
                          <button className="btn btn-sm btn-light" onClick={() => setDocsFor(item)} title="Documents">
                            <iconify-icon icon="solar:paperclip-line-duotone"></iconify-icon>
                          </button>
                          {can('volunteers.write') && (
                            <>
                              <button className="btn btn-sm btn-light ms-1" onClick={() => openEditItem(item)}><iconify-icon icon="solar:pen-line-duotone"></iconify-icon></button>
                              <button className="btn btn-sm btn-light text-danger ms-1" onClick={() => removeItem(item)}><iconify-icon icon="solar:trash-bin-trash-line-duotone"></iconify-icon></button>
                            </>
                          )}
                        </td>
                      </tr>
                    ))}
                    {compliance.length === 0 && <tr><td colSpan="4"><div className="empty-state">No compliance items yet.</div></td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      </div>

      <Modal show={showItem} onClose={() => setShowItem(false)} title={itemForm.id ? 'Edit Compliance Item' : 'Add Compliance Item'} size="sm"
        footer={<><button className="btn btn-light" onClick={() => setShowItem(false)}>Cancel</button>
                  <button className="btn btn-primary" onClick={saveItem}>Save</button></>}>
        <div className="row g-2">
          <div className="col-12">
            <label className="form-label">Type</label>
            <select className="form-select" value={itemForm.type} onChange={(e) => setItemForm({ ...itemForm, type: e.target.value })}>
              {COMPLIANCE_TYPES.map((t) => <option key={t} value={t}>{typeLabel(t)}</option>)}
            </select>
          </div>
          <div className="col-12">
            <label className="form-label">Status</label>
            <select className="form-select" value={itemForm.status} onChange={(e) => setItemForm({ ...itemForm, status: e.target.value })}>
              {Object.keys(COMPLIANCE_STATUS_TONE).map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div className="col-12">
            <label className="form-label">Expiry date</label>
            <input type="date" className="form-control" value={itemForm.expiry_date} onChange={(e) => setItemForm({ ...itemForm, expiry_date: e.target.value })} />
          </div>
          <div className="col-12">
            <label className="form-label">Notes</label>
            <textarea className="form-control" rows={2} value={itemForm.notes} onChange={(e) => setItemForm({ ...itemForm, notes: e.target.value })} />
          </div>
        </div>
      </Modal>

      <Modal show={!!docsFor} onClose={() => setDocsFor(null)} title={docsFor ? `${typeLabel(docsFor.type)} — Documents` : ''} size="md"
        footer={<button className="btn btn-light" onClick={() => setDocsFor(null)}>Close</button>}>
        {docsFor && <AttachmentsPanel entityType="volunteer_compliance_item" entityId={docsFor.id} />}
      </Modal>

      {confirmDialog}
    </div>
  );
}
