import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import api from '../../api/client.js';
import PageHeader from '../../components/PageHeader.jsx';
import Modal from '../../components/Modal.jsx';
import FormErrorBanner from '../../components/FormErrorBanner.jsx';
import { toast } from '../../components/Toast.jsx';
import { parseApiError } from '../../utils/apiError.js';
import { useConfirm } from '../../hooks/useConfirm.jsx';
import { useAuth } from '../../auth/AuthContext.jsx';

const US_STATES = ['AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY'];

function fmtMoney(n) {
  return `$${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// MySQL DATETIME ("2026-09-20 19:00:00") -> value a <input type="datetime-local"> accepts.
function toDatetimeLocal(s) {
  if (!s) return '';
  return s.replace(' ', 'T').slice(0, 16);
}

function blankTicket() {
  return { id: null, name: '', price: '', capacity: '', is_active: true, sort_order: 0 };
}

export default function EventDetail() {
  const { id } = useParams();
  const { can } = useAuth();
  const { confirm, dialog: confirmDialog } = useConfirm();
  const [event, setEvent] = useState(null);
  const [tickets, setTickets] = useState([]);
  const [registrations, setRegistrations] = useState([]);
  const [showTicket, setShowTicket] = useState(false);
  const [ticketForm, setTicketForm] = useState(blankTicket());
  const [regeneratingPin, setRegeneratingPin] = useState(false);
  const [showEditEvent, setShowEditEvent] = useState(false);
  const [eventForm, setEventForm] = useState(null);
  const [eventFormError, setEventFormError] = useState('');
  const [volunteers, setVolunteers] = useState([]);
  const [showAssign, setShowAssign] = useState(false);
  const [assignQuery, setAssignQuery] = useState('');
  const [assignResults, setAssignResults] = useState([]);
  const [assignForm, setAssignForm] = useState(null); // { contact, role, status, shift_start, shift_end }

  async function load() {
    const calls = [
      api.get('/events/admin'),
      api.get(`/events/admin/${id}/tickets`),
      api.get(`/events/admin/${id}/registrations`),
    ];
    if (can('volunteers.read')) calls.push(api.get('/volunteers/admin', { params: { event_id: id } }));
    const results = await Promise.all(calls);
    setEvent(results[0].data.find((e) => String(e.id) === String(id)) || null);
    setTickets(results[1].data);
    setRegistrations(results[2].data);
    if (results[3]) setVolunteers(results[3].data);
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [id]);

  function downloadManifest() {
    const token = localStorage.getItem('lc_impersonate_token') || localStorage.getItem('lc_token');
    const apiBase = api.defaults.baseURL;
    const url = `${apiBase}/events/admin/${id}/manifest.csv`;
    fetch(url, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.blob())
      .then((blob) => {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `${event?.slug || 'event'}-manifest.csv`;
        a.click();
      });
  }

  useEffect(() => {
    if (!showAssign) return;
    const t = setTimeout(() => {
      api.get('/contacts', { params: { q: assignQuery, pageSize: 25 } })
        .then(({ data }) => setAssignResults(data.rows || []))
        .catch(() => setAssignResults([]));
    }, 200);
    return () => clearTimeout(t);
  }, [assignQuery, showAssign]);

  function openAssign() {
    setAssignQuery(''); setAssignResults([]);
    setAssignForm({ contact: null, role: '', status: 'invited', shift_start: '', shift_end: '' });
    setShowAssign(true);
  }

  async function saveAssignment() {
    if (!assignForm.contact) { toast('Pick a contact first.', 'error'); return; }
    try {
      await api.post('/volunteers/admin', {
        event_id: Number(id), contact_id: assignForm.contact.id, role: assignForm.role || null,
        status: assignForm.status, shift_start: assignForm.shift_start ? assignForm.shift_start.replace('T', ' ') : null,
        shift_end: assignForm.shift_end ? assignForm.shift_end.replace('T', ' ') : null,
      });
      setShowAssign(false);
      load();
    } catch (e) {
      toast(parseApiError(e), 'error');
    }
  }

  async function removeVolunteer(v) {
    if (!(await confirm(`Remove ${v.first_name} ${v.last_name} from this event?`))) return;
    try {
      await api.delete(`/volunteers/admin/${v.id}`);
      load();
    } catch (e) {
      toast(parseApiError(e), 'error');
    }
  }

  async function setVolunteerStatus(v, status) {
    try {
      await api.put(`/volunteers/admin/${v.id}`, { role: v.role, status, shift_start: v.shift_start, shift_end: v.shift_end, notes: v.notes });
      load();
    } catch (e) {
      toast(parseApiError(e), 'error');
    }
  }

  function openNewTicket() { setTicketForm(blankTicket()); setShowTicket(true); }
  function openEditTicket(t) { setTicketForm({ ...t }); setShowTicket(true); }

  async function saveTicket() {
    try {
      const payload = {
        name: ticketForm.name, price: Number(ticketForm.price || 0),
        capacity: ticketForm.capacity ? Number(ticketForm.capacity) : null,
        is_active: !!ticketForm.is_active, sort_order: Number(ticketForm.sort_order || 0),
      };
      if (ticketForm.id) await api.put(`/events/admin/tickets/${ticketForm.id}`, payload);
      else await api.post(`/events/admin/${id}/tickets`, payload);
      setShowTicket(false);
      load();
    } catch (e) {
      toast(parseApiError(e), 'error');
    }
  }

  async function removeTicket(t) {
    if (!(await confirm(`Delete ticket type "${t.name}"?`, { danger: true }))) return;
    try {
      await api.delete(`/events/admin/tickets/${t.id}`);
      load();
    } catch (e) {
      toast(parseApiError(e), 'error');
    }
  }

  async function regeneratePin() {
    setRegeneratingPin(true);
    try {
      const { data } = await api.post(`/events/admin/${id}/checkin/regenerate-pin`);
      setEvent(ev => ({ ...ev, checkin_pin: data.checkin_pin }));
      toast('New check-in PIN generated', 'success');
    } catch (e) {
      toast(parseApiError(e), 'error');
    } finally {
      setRegeneratingPin(false);
    }
  }

  function openEditEvent() {
    setEventForm({
      name: event.name, slug: event.slug, description: event.description || '',
      start_at: toDatetimeLocal(event.start_at), end_at: toDatetimeLocal(event.end_at),
      location: event.location || '',
      address_line1: event.address_line1 || '', address_line2: event.address_line2 || '',
      city: event.city || '', state: event.state || '', postal_code: event.postal_code || '',
      capacity: event.capacity ?? '', is_active: !!event.is_active,
    });
    setEventFormError('');
    setShowEditEvent(true);
  }

  async function saveEvent() {
    if (!eventForm.name || !eventForm.start_at) { setEventFormError('Name and start date/time are required.'); return; }
    try {
      await api.put(`/events/admin/${id}`, {
        name: eventForm.name, slug: eventForm.slug || undefined, description: eventForm.description || null,
        start_at: eventForm.start_at.replace('T', ' '), end_at: eventForm.end_at ? eventForm.end_at.replace('T', ' ') : null,
        location: eventForm.location || null,
        address_line1: eventForm.address_line1 || null, address_line2: eventForm.address_line2 || null,
        city: eventForm.city || null, state: eventForm.state || null, postal_code: eventForm.postal_code || null,
        capacity: eventForm.capacity ? Number(eventForm.capacity) : null,
        is_active: eventForm.is_active,
      });
      setShowEditEvent(false);
      load();
    } catch (e) {
      setEventFormError(parseApiError(e));
    }
  }

  const checkinScanUrl = event?.checkin_pin
    ? `${window.location.origin}/events-checkin/${id}?pin=${event.checkin_pin}`
    : null;
  const volunteerCheckinUrl = event?.checkin_pin
    ? `${window.location.origin}/volunteer-checkin/${id}?pin=${event.checkin_pin}`
    : null;

  async function approveHours(v) {
    try {
      await api.post(`/volunteers/admin/${v.id}/approve-hours`);
      load();
    } catch (e) {
      toast(parseApiError(e), 'error');
    }
  }

  if (!event) return <div className="empty-state">Loading…</div>;

  return (
    <div>
      <PageHeader
        title={event.name}
        subtitle={<span>{new Date(event.start_at).toLocaleString()}{event.location ? ` · ${event.location}` : ''}</span>}
        actions={<>
          {can('events.write') && <button className="btn btn-light me-2" onClick={openEditEvent}>Edit Event</button>}
          {can('events.checkin') && <Link to={`/admin/events/${id}/checkin`} className="btn btn-primary me-2">Gate Check-In</Link>}
          <Link to="/admin/events" className="btn btn-light">← Back</Link>
        </>}
      />

      <div className="row">
        <div className="col-lg-4 mb-3">
          <div className="card">
            <div className="card-body">
              <h6 className="fw-bold text-uppercase small text-muted">Details</h6>
              <dl className="row mb-0">
                <dt className="col-5">Starts</dt><dd className="col-7">{new Date(event.start_at).toLocaleString()}</dd>
                <dt className="col-5">Ends</dt><dd className="col-7">{event.end_at ? new Date(event.end_at).toLocaleString() : '—'}</dd>
                <dt className="col-5">Location</dt><dd className="col-7">{event.location || '—'}</dd>
                <dt className="col-5">Address</dt><dd className="col-7">
                  {event.address_line1
                    ? <>{event.address_line1}{event.address_line2 ? `, ${event.address_line2}` : ''}<br />{[event.city, event.state].filter(Boolean).join(', ')} {event.postal_code || ''}</>
                    : '—'}
                </dd>
                <dt className="col-5">Capacity</dt><dd className="col-7">{event.capacity ?? 'Unlimited'}</dd>
                <dt className="col-5">Registered</dt><dd className="col-7">{event.registered_count}</dd>
              </dl>
              {event.description && <p className="text-muted small mt-2 mb-0">{event.description}</p>}
            </div>
          </div>

          {can('events.write') && (
            <div className="card mt-3">
              <div className="card-body">
                <h6 className="fw-bold text-uppercase small text-muted">Gate Scan Link</h6>
                <p className="small text-muted mb-2">
                  Share this link + PIN with day-of volunteers who don't have a CRM login — they can scan
                  attendee tickets at the gate from their own phone, no sign-in required.
                </p>
                {event.checkin_pin ? (
                  <>
                    <div className="mb-2"><span className="text-muted small">PIN:</span> <strong style={{ letterSpacing: '0.1em' }}>{event.checkin_pin}</strong></div>
                    <input className="form-control form-control-sm mb-2" readOnly value={checkinScanUrl} onFocus={e => e.target.select()} />
                  </>
                ) : <p className="small text-muted">No PIN generated yet.</p>}
                <button className="btn btn-sm btn-outline-primary" onClick={regeneratePin} disabled={regeneratingPin}>
                  {event.checkin_pin ? 'Regenerate PIN' : 'Generate PIN'}
                </button>
              </div>
            </div>
          )}

          {can('volunteers.write') && (
            <div className="card mt-3">
              <div className="card-body">
                <h6 className="fw-bold text-uppercase small text-muted">Volunteer Shift Check-In Link</h6>
                <p className="small text-muted mb-2">
                  Same PIN — a different link. Volunteers scan their own badge here to check in and out of
                  their shift; hours are computed automatically.
                </p>
                {event.checkin_pin ? (
                  <input className="form-control form-control-sm mb-2" readOnly value={volunteerCheckinUrl} onFocus={e => e.target.select()} />
                ) : <p className="small text-muted">Generate a PIN above first.</p>}
              </div>
            </div>
          )}
        </div>

        <div className="col-lg-8">
          <div className="card mb-3">
            <div className="card-body">
              <div className="d-flex justify-content-between align-items-center mb-2">
                <h6 className="fw-bold text-uppercase small text-muted mb-0">Ticket Types</h6>
                {can('events.write') && (
                  <button className="btn btn-sm btn-primary" onClick={openNewTicket}>
                    <iconify-icon icon="solar:add-circle-line-duotone" class="me-1"></iconify-icon> Add Ticket
                  </button>
                )}
              </div>
              <table className="table table-sm align-middle mb-0">
                <thead><tr><th>Name</th><th className="text-end">Price</th><th className="text-end">Capacity</th><th>Active</th><th></th></tr></thead>
                <tbody>
                  {tickets.map((t) => (
                    <tr key={t.id}>
                      <td>{t.name}</td>
                      <td className="text-end">{fmtMoney(t.price)}</td>
                      <td className="text-end">{t.capacity ?? 'Unlimited'}</td>
                      <td>{t.is_active ? <span className="badge bg-success-subtle text-success">Active</span> : <span className="badge bg-secondary-subtle text-secondary">Inactive</span>}</td>
                      <td className="text-end">
                        {can('events.write') && (
                          <>
                            <button className="btn btn-sm btn-light" onClick={() => openEditTicket(t)}><iconify-icon icon="solar:pen-line-duotone"></iconify-icon></button>
                            <button className="btn btn-sm btn-light text-danger ms-1" onClick={() => removeTicket(t)}><iconify-icon icon="solar:trash-bin-trash-line-duotone"></iconify-icon></button>
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
                  {tickets.length === 0 && <tr><td colSpan="5"><div className="empty-state">No ticket types yet.</div></td></tr>}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card mb-3">
            <div className="card-body">
              <div className="d-flex justify-content-between align-items-center mb-2">
                <h6 className="fw-bold text-uppercase small text-muted mb-0">Registrations</h6>
                <button type="button" className="btn btn-sm btn-light" onClick={downloadManifest}>
                  <iconify-icon icon="solar:download-line-duotone" class="me-1"></iconify-icon>
                  Download Manifest
                </button>
              </div>
              <table className="table table-sm align-middle mb-0">
                <thead><tr><th>Attendee</th><th>Ticket</th><th className="text-end">Qty</th><th>Status</th><th>Registered</th></tr></thead>
                <tbody>
                  {registrations.map((r) => (
                    <tr key={r.id}>
                      <td>{r.contact_id ? <Link to={`/admin/contacts/${r.contact_id}`}>{r.contact_name || r.attendee_email}</Link> : (r.attendee_name || r.attendee_email)}</td>
                      <td>{r.ticket_name}</td>
                      <td className="text-end">{r.quantity}</td>
                      <td><span className="badge bg-primary-subtle text-primary">{r.status}</span></td>
                      <td>{new Date(r.created_at).toLocaleDateString()}</td>
                    </tr>
                  ))}
                  {registrations.length === 0 && <tr><td colSpan="5"><div className="empty-state">No registrations yet.</div></td></tr>}
                </tbody>
              </table>
            </div>
          </div>

          {can('volunteers.read') && (
            <div className="card">
              <div className="card-body">
                <div className="d-flex justify-content-between align-items-center mb-2">
                  <h6 className="fw-bold text-uppercase small text-muted mb-0">Volunteers</h6>
                  {can('volunteers.write') && (
                    <button className="btn btn-sm btn-primary" onClick={openAssign}>
                      <iconify-icon icon="solar:add-circle-line-duotone" class="me-1"></iconify-icon> Assign Volunteer
                    </button>
                  )}
                </div>
                <table className="table table-sm align-middle mb-0">
                  <thead><tr><th>Volunteer</th><th>Role</th><th>Shift</th><th>Checked In/Out</th><th>Hours</th><th>Status</th><th></th></tr></thead>
                  <tbody>
                    {volunteers.map((v) => (
                      <tr key={v.id}>
                        <td><Link to={`/admin/contacts/${v.contact_id}`}>{v.first_name} {v.last_name}</Link></td>
                        <td>{v.role || '—'}</td>
                        <td>{v.shift_start ? new Date(v.shift_start).toLocaleString() : '—'}</td>
                        <td className="small">
                          {v.checked_in_at ? new Date(v.checked_in_at).toLocaleTimeString() : '—'}
                          {' → '}
                          {v.checked_out_at ? new Date(v.checked_out_at).toLocaleTimeString() : '—'}
                        </td>
                        <td className="small">
                          {v.actual_hours != null ? `${v.actual_hours}h` : '—'}
                          {v.hours_approved_at
                            ? <span className="badge bg-success-subtle text-success ms-1">Approved</span>
                            : (can('volunteers.write') && v.actual_hours != null && (
                                <button className="btn btn-sm btn-link p-0 ms-1" onClick={() => approveHours(v)}>Approve</button>
                              ))}
                        </td>
                        <td>
                          {can('volunteers.write') ? (
                            <select className="form-select form-select-sm" style={{ width: 130 }} value={v.status}
                              onChange={(e) => setVolunteerStatus(v, e.target.value)}>
                              <option value="invited">Invited</option>
                              <option value="confirmed">Confirmed</option>
                              <option value="declined">Declined</option>
                              <option value="completed">Completed</option>
                            </select>
                          ) : (
                            <span className="badge bg-primary-subtle text-primary">{v.status}</span>
                          )}
                        </td>
                        <td className="text-end text-nowrap">
                          {v.qr_token && (
                            <Link className="btn btn-sm btn-light" to={`/volunteer-badge/${v.qr_token}`} target="_blank" title="View badge">
                              <iconify-icon icon="solar:qr-code-line-duotone"></iconify-icon>
                            </Link>
                          )}
                          {can('volunteers.write') && (
                            <button className="btn btn-sm btn-light text-danger ms-1" onClick={() => removeVolunteer(v)}>
                              <iconify-icon icon="solar:trash-bin-trash-line-duotone"></iconify-icon>
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                    {volunteers.length === 0 && <tr><td colSpan="7"><div className="empty-state">No volunteers assigned yet.</div></td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>

      <Modal show={showTicket} onClose={() => setShowTicket(false)} title={ticketForm.id ? 'Edit Ticket' : 'New Ticket'} size="sm"
        footer={<><button className="btn btn-light" onClick={() => setShowTicket(false)}>Cancel</button>
                  <button className="btn btn-primary" onClick={saveTicket}>Save</button></>}>
        <div className="row g-2">
          <div className="col-12"><label className="form-label">Name</label>
            <input className="form-control" value={ticketForm.name} onChange={(e) => setTicketForm({ ...ticketForm, name: e.target.value })} placeholder="General Admission" /></div>
          <div className="col-md-6"><label className="form-label">Price ($, 0 = free)</label>
            <input type="number" step="0.01" className="form-control" value={ticketForm.price} onChange={(e) => setTicketForm({ ...ticketForm, price: e.target.value })} /></div>
          <div className="col-md-6"><label className="form-label">Capacity (optional)</label>
            <input type="number" min="1" className="form-control" value={ticketForm.capacity || ''} onChange={(e) => setTicketForm({ ...ticketForm, capacity: e.target.value })} /></div>
          <div className="col-12">
            <div className="form-check form-switch">
              <input className="form-check-input" type="checkbox" id="ticket_active" checked={ticketForm.is_active}
                onChange={(e) => setTicketForm({ ...ticketForm, is_active: e.target.checked })} />
              <label className="form-check-label" htmlFor="ticket_active">Active (visible in public registration)</label>
            </div>
          </div>
        </div>
      </Modal>

      {eventForm && (
        <Modal show={showEditEvent} onClose={() => setShowEditEvent(false)} title="Edit Event" size="md"
          footer={<><button className="btn btn-light" onClick={() => setShowEditEvent(false)}>Cancel</button>
                    <button className="btn btn-primary" onClick={saveEvent}>Save</button></>}>
          <FormErrorBanner error={eventFormError} />
          <div className="row g-2">
            <div className="col-12"><label className="form-label">Name</label>
              <input className="form-control" value={eventForm.name} onChange={(e) => setEventForm({ ...eventForm, name: e.target.value })} /></div>
            <div className="col-12"><label className="form-label">Slug</label>
              <input className="form-control" value={eventForm.slug} onChange={(e) => setEventForm({ ...eventForm, slug: e.target.value })} /></div>
            <div className="col-12"><label className="form-label">Description</label>
              <textarea className="form-control" rows="2" value={eventForm.description} onChange={(e) => setEventForm({ ...eventForm, description: e.target.value })} /></div>
            <div className="col-md-6"><label className="form-label">Starts</label>
              <input type="datetime-local" className="form-control" value={eventForm.start_at} onChange={(e) => setEventForm({ ...eventForm, start_at: e.target.value })} /></div>
            <div className="col-md-6"><label className="form-label">Ends (optional)</label>
              <input type="datetime-local" className="form-control" value={eventForm.end_at} onChange={(e) => setEventForm({ ...eventForm, end_at: e.target.value })} /></div>
            <div className="col-md-6"><label className="form-label">Venue Name (optional)</label>
              <input className="form-control" value={eventForm.location} onChange={(e) => setEventForm({ ...eventForm, location: e.target.value })} /></div>
            <div className="col-md-6"><label className="form-label">Capacity (optional)</label>
              <input type="number" min="1" className="form-control" value={eventForm.capacity} onChange={(e) => setEventForm({ ...eventForm, capacity: e.target.value })} /></div>
            <div className="col-12"><label className="form-label">Address (optional)</label>
              <input className="form-control" value={eventForm.address_line1} onChange={(e) => setEventForm({ ...eventForm, address_line1: e.target.value })} placeholder="Street address" /></div>
            <div className="col-12">
              <input className="form-control" value={eventForm.address_line2} onChange={(e) => setEventForm({ ...eventForm, address_line2: e.target.value })} placeholder="Apt / Suite (optional)" /></div>
            <div className="col-md-5"><label className="form-label">City</label>
              <input className="form-control" value={eventForm.city} onChange={(e) => setEventForm({ ...eventForm, city: e.target.value })} /></div>
            <div className="col-md-4"><label className="form-label">State</label>
              <select className="form-select" value={eventForm.state} onChange={(e) => setEventForm({ ...eventForm, state: e.target.value })}>
                <option value="">—</option>
                {US_STATES.map(s => <option key={s} value={s}>{s}</option>)}
              </select></div>
            <div className="col-md-3"><label className="form-label">ZIP</label>
              <input className="form-control" value={eventForm.postal_code} onChange={(e) => setEventForm({ ...eventForm, postal_code: e.target.value })} /></div>
            <div className="col-12">
              <div className="form-check form-switch">
                <input className="form-check-input" type="checkbox" id="event_active" checked={eventForm.is_active}
                  onChange={(e) => setEventForm({ ...eventForm, is_active: e.target.checked })} />
                <label className="form-check-label" htmlFor="event_active">Active (visible on the public site)</label>
              </div>
            </div>
          </div>
        </Modal>
      )}

      {assignForm && (
        <Modal show={showAssign} onClose={() => setShowAssign(false)} title="Assign Volunteer" size="sm"
          footer={<><button className="btn btn-light" onClick={() => setShowAssign(false)}>Cancel</button>
                    <button className="btn btn-primary" onClick={saveAssignment}>Assign</button></>}>
          <div className="row g-2">
            <div className="col-12">
              <label className="form-label">Contact</label>
              {assignForm.contact ? (
                <div className="d-flex align-items-center justify-content-between border rounded p-2">
                  <span>{assignForm.contact.first_name} {assignForm.contact.last_name} <span className="text-muted small">{assignForm.contact.email}</span></span>
                  <button className="btn btn-sm btn-light" onClick={() => setAssignForm({ ...assignForm, contact: null })}>Change</button>
                </div>
              ) : (
                <>
                  <input className="form-control" placeholder="Search name or email…" value={assignQuery}
                    onChange={(e) => setAssignQuery(e.target.value)} />
                  <div className="border rounded mt-1" style={{ maxHeight: 180, overflowY: 'auto' }}>
                    {assignResults.map((c) => (
                      <button type="button" key={c.id} className="d-block w-100 text-start px-2 py-1 border-0"
                        style={{ background: 'transparent' }}
                        onClick={() => setAssignForm({ ...assignForm, contact: c })}>
                        {c.first_name} {c.last_name} <span className="text-muted small">{c.email}</span>
                      </button>
                    ))}
                    {assignQuery && assignResults.length === 0 && <div className="text-muted small p-2">No matches.</div>}
                  </div>
                </>
              )}
            </div>
            <div className="col-12"><label className="form-label">Role (optional)</label>
              <input className="form-control" value={assignForm.role} onChange={(e) => setAssignForm({ ...assignForm, role: e.target.value })} placeholder="Gate check-in, setup, parking…" /></div>
            <div className="col-md-6"><label className="form-label">Shift starts (optional)</label>
              <input type="datetime-local" className="form-control" value={assignForm.shift_start} onChange={(e) => setAssignForm({ ...assignForm, shift_start: e.target.value })} /></div>
            <div className="col-md-6"><label className="form-label">Shift ends (optional)</label>
              <input type="datetime-local" className="form-control" value={assignForm.shift_end} onChange={(e) => setAssignForm({ ...assignForm, shift_end: e.target.value })} /></div>
            <div className="col-12"><label className="form-label">Status</label>
              <select className="form-select" value={assignForm.status} onChange={(e) => setAssignForm({ ...assignForm, status: e.target.value })}>
                <option value="invited">Invited</option>
                <option value="confirmed">Confirmed</option>
                <option value="declined">Declined</option>
                <option value="completed">Completed</option>
              </select></div>
          </div>
        </Modal>
      )}

      {confirmDialog}
    </div>
  );
}
