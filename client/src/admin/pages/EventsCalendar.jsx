import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../../api/client.js';
import PageHeader from '../../components/PageHeader.jsx';
import Modal from '../../components/Modal.jsx';
import EventsCalendarGrid from '../components/EventsCalendarGrid.jsx';
import { useAuth } from '../../auth/AuthContext.jsx';

function gridRange(year, month) {
  const firstOfMonth = new Date(year, month, 1);
  const start = new Date(firstOfMonth);
  start.setDate(start.getDate() - start.getDay());
  const end = new Date(start);
  end.setDate(start.getDate() + 41);
  const fmt = (d) => d.toISOString().slice(0, 10);
  return { start: fmt(start), end: fmt(end) };
}

export default function EventsCalendar() {
  const { can } = useAuth();
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth()); // 0-indexed
  const [events, setEvents] = useState([]);
  const [selected, setSelected] = useState(null);
  const [summary, setSummary] = useState(null);

  const load = useCallback(() => {
    const { start, end } = gridRange(year, month);
    api.get('/events/admin/calendar', { params: { start, end } })
      .then((r) => setEvents(r.data))
      .catch(() => setEvents([]));
  }, [year, month]);
  useEffect(() => { load(); }, [load]);

  function openEvent(e) {
    setSelected(e);
    setSummary(null);
    api.get(`/events/admin/${e.id}/checkin/summary`).then((r) => setSummary(r.data)).catch(() => {});
  }

  function shiftMonth(delta) {
    const d = new Date(year, month + delta, 1);
    setYear(d.getFullYear());
    setMonth(d.getMonth());
  }

  function goToday() {
    setYear(today.getFullYear());
    setMonth(today.getMonth());
  }

  return (
    <div>
      <PageHeader
        title="Events Calendar"
        subtitle={new Date(year, month, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
        actions={<>
          <button className="btn btn-light me-1" onClick={() => shiftMonth(-1)}>&larr;</button>
          <button className="btn btn-light me-1" onClick={goToday}>Today</button>
          <button className="btn btn-light me-2" onClick={() => shiftMonth(1)}>&rarr;</button>
          <Link to="/admin/events" className="btn btn-light">List View</Link>
        </>}
      />

      <div className="card"><div className="card-body">
        <EventsCalendarGrid year={year} month={month} events={events} onEventClick={openEvent} />
      </div></div>

      {selected && (
        <Modal show={!!selected} onClose={() => setSelected(null)} title={selected.name} size="sm">
          <dl className="row mb-0">
            <dt className="col-5">Starts</dt><dd className="col-7">{new Date(selected.start_at).toLocaleString()}</dd>
            <dt className="col-5">Ends</dt><dd className="col-7">{selected.end_at ? new Date(selected.end_at).toLocaleString() : '—'}</dd>
            <dt className="col-5">Location</dt><dd className="col-7">{selected.location || '—'}</dd>
            <dt className="col-5">Capacity</dt><dd className="col-7">{selected.capacity ?? 'Unlimited'}</dd>
            <dt className="col-5">Registered</dt><dd className="col-7">{selected.registered_count}</dd>
            {summary && (
              <>
                <dt className="col-5">Tickets Issued</dt><dd className="col-7">{summary.total_tickets}</dd>
                <dt className="col-5">Checked In</dt><dd className="col-7">{summary.checked_in} / {summary.total_tickets}</dd>
              </>
            )}
          </dl>
          <div className="d-flex flex-wrap gap-2 mt-3">
            <Link to={`/admin/events/${selected.id}`} className="btn btn-sm btn-primary">View Details</Link>
            {can('events.checkin') && <Link to={`/admin/events/${selected.id}/checkin`} className="btn btn-sm btn-light">Gate Check-In</Link>}
          </div>
        </Modal>
      )}
    </div>
  );
}
