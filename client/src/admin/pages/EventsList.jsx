import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import api from '../../api/client.js';
import PageHeader from '../../components/PageHeader.jsx';
import Modal from '../../components/Modal.jsx';
import FormErrorBanner from '../../components/FormErrorBanner.jsx';
import { parseApiError } from '../../utils/apiError.js';
import { useAuth } from '../../auth/AuthContext.jsx';

const US_STATES = ['AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY'];

function blankEvent() {
  return {
    name: '', slug: '', description: '', start_at: '', end_at: '', location: '',
    address_line1: '', address_line2: '', city: '', state: '', postal_code: '',
    capacity: '', is_active: true,
  };
}

export default function EventsList() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const [rows, setRows] = useState([]);
  const [show, setShow] = useState(false);
  const [form, setForm] = useState(blankEvent());
  const [formError, setFormError] = useState('');

  async function load() {
    const { data } = await api.get('/events/admin');
    setRows(data);
  }
  useEffect(() => { load(); }, []);

  function openNew() { setForm(blankEvent()); setFormError(''); setShow(true); }

  async function save() {
    if (!form.name || !form.start_at) { setFormError('Name and start date/time are required.'); return; }
    try {
      const { data } = await api.post('/events/admin', {
        name: form.name, slug: form.slug || undefined, description: form.description || null,
        start_at: form.start_at.replace('T', ' '), end_at: form.end_at ? form.end_at.replace('T', ' ') : null,
        location: form.location || null,
        address_line1: form.address_line1 || null, address_line2: form.address_line2 || null,
        city: form.city || null, state: form.state || null, postal_code: form.postal_code || null,
        capacity: form.capacity ? Number(form.capacity) : null,
        is_active: form.is_active,
      });
      setShow(false);
      navigate(`/admin/events/${data.id}`);
    } catch (e) {
      setFormError(parseApiError(e));
    }
  }

  return (
    <div>
      <PageHeader title="Events" subtitle="Ticketed events and registrations"
        actions={<>
          <Link to="/admin/events/calendar" className="btn btn-light me-2">
            <iconify-icon icon="solar:calendar-line-duotone" class="me-1"></iconify-icon> Calendar View
          </Link>
          {can('events.write') && (
            <button className="btn btn-primary" onClick={openNew}>
              <iconify-icon icon="solar:add-circle-line-duotone" class="me-1"></iconify-icon> New Event
            </button>
          )}
        </>} />

      <div className="card">
        <div className="card-body">
          <div className="table-responsive">
            <table className="table table-hover align-middle mb-0">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Starts</th>
                  <th>Location</th>
                  <th className="text-end">Registered</th>
                  <th>Active</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((e) => (
                  <tr key={e.id} style={{ cursor: 'pointer' }} onClick={() => navigate(`/admin/events/${e.id}`)}>
                    <td className="fw-semibold">{e.name}</td>
                    <td>{new Date(e.start_at).toLocaleString()}</td>
                    <td>{e.location || '—'}</td>
                    <td className="text-end">{e.registered_count}{e.capacity ? ` / ${e.capacity}` : ''}</td>
                    <td>{e.is_active ? <span className="badge bg-success-subtle text-success">Active</span> : <span className="badge bg-secondary-subtle text-secondary">Inactive</span>}</td>
                  </tr>
                ))}
                {rows.length === 0 && <tr><td colSpan="5"><div className="empty-state">No events yet.</div></td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <Modal show={show} onClose={() => setShow(false)} title="New Event" size="md"
        footer={<><button className="btn btn-light" onClick={() => setShow(false)}>Cancel</button>
                  <button className="btn btn-primary" onClick={save}>Create</button></>}>
        <FormErrorBanner error={formError} />
        <div className="row g-2">
          <div className="col-12"><label className="form-label">Name</label>
            <input className="form-control" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Annual Gala" /></div>
          <div className="col-12"><label className="form-label">Slug (auto-generated if left blank)</label>
            <input className="form-control" value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} /></div>
          <div className="col-12"><label className="form-label">Description</label>
            <textarea className="form-control" rows="2" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
          <div className="col-md-6"><label className="form-label">Starts</label>
            <input type="datetime-local" className="form-control" value={form.start_at} onChange={(e) => setForm({ ...form, start_at: e.target.value })} /></div>
          <div className="col-md-6"><label className="form-label">Ends (optional)</label>
            <input type="datetime-local" className="form-control" value={form.end_at} onChange={(e) => setForm({ ...form, end_at: e.target.value })} /></div>
          <div className="col-md-6"><label className="form-label">Venue Name (optional)</label>
            <input className="form-control" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} placeholder="Test Golf Course" /></div>
          <div className="col-md-6"><label className="form-label">Capacity (optional)</label>
            <input type="number" min="1" className="form-control" value={form.capacity} onChange={(e) => setForm({ ...form, capacity: e.target.value })} /></div>
          <div className="col-12"><label className="form-label">Address (optional)</label>
            <input className="form-control" value={form.address_line1} onChange={(e) => setForm({ ...form, address_line1: e.target.value })} placeholder="Street address" /></div>
          <div className="col-12">
            <input className="form-control" value={form.address_line2} onChange={(e) => setForm({ ...form, address_line2: e.target.value })} placeholder="Apt / Suite (optional)" /></div>
          <div className="col-md-5"><label className="form-label">City</label>
            <input className="form-control" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} /></div>
          <div className="col-md-4"><label className="form-label">State</label>
            <select className="form-select" value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value })}>
              <option value="">—</option>
              {US_STATES.map(s => <option key={s} value={s}>{s}</option>)}
            </select></div>
          <div className="col-md-3"><label className="form-label">ZIP</label>
            <input className="form-control" value={form.postal_code} onChange={(e) => setForm({ ...form, postal_code: e.target.value })} /></div>
        </div>
      </Modal>
    </div>
  );
}
