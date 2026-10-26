import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../../../api/client.js';
import { wontRenew } from '../../../utils/membershipTerms.js';
import { formatDateOnly } from '../../../utils/date.js';

export default function PortalDashboard() {
  const [me, setMe] = useState(null);
  const [invoices, setInvoices] = useState([]);
  const [donations, setDonations] = useState({ rows: [], total: 0 });
  const [membership, setMembership] = useState([]);
  const [eventRegs, setEventRegs] = useState([]);

  useEffect(() => {
    api.get('/portal/me').then((r) => setMe(r.data)).catch(() => {});
    api.get('/portal/invoices').then((r) => setInvoices(r.data.rows || [])).catch(() => {});
    api.get('/portal/donations').then((r) => setDonations(r.data)).catch(() => {});
    api.get('/portal/membership').then((r) => setMembership(r.data.rows || [])).catch(() => {});
    api.get('/portal/event-registrations').then((r) => setEventRegs(r.data.rows || [])).catch(() => {});
  }, []);

  const fmt = (n) => `$${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const outstanding = invoices.reduce((a, i) => a + Number(i.balance_due || 0), 0);
  const open = invoices.filter((i) => Number(i.balance_due || 0) > 0);

  const thisYear = new Date().getFullYear();
  const givenThisYear = donations.rows
    .filter((d) => new Date(d.created_at).getFullYear() === thisYear)
    .reduce((a, d) => a + Number(d.amount || 0), 0);

  const activeMembership = membership.find((m) => m.status === 'active');

  const upcoming = eventRegs
    .filter((r) => new Date(r.start_at) > new Date())
    .sort((a, b) => new Date(a.start_at) - new Date(b.start_at));
  const nextEvent = upcoming[0];

  return (
    <div>
      <h3 className="fw-bolder mb-1">Welcome back{me?.contact?.first_name ? `, ${me.contact.first_name}` : ''}.</h3>
      <p className="text-muted">Here's a snapshot of your giving and membership.</p>

      <div className="row g-3 mt-1">
        <div className="col-md-4">
          <div className="card h-100">
            <div className="card-body">
              <small className="text-muted text-uppercase fw-bold">Total Given</small>
              <div className="fs-2 fw-bolder" style={{ color: 'var(--brand, #1f2937)' }}>{fmt(donations.total)}</div>
              <div className="small text-muted">{fmt(givenThisYear)} this year</div>
              <Link to="/portal/giving" className="small">View giving history →</Link>
            </div>
          </div>
        </div>
        <div className="col-md-4">
          <div className="card h-100">
            <div className="card-body">
              <small className="text-muted text-uppercase fw-bold">Membership</small>
              {activeMembership ? (
                <>
                  <div className="fs-2 fw-bolder">{activeMembership.tier_name}</div>
                  <div className="small text-muted">
                    {wontRenew(activeMembership)
                      ? `Member until ${formatDateOnly(activeMembership.end_date)}`
                      : (activeMembership.next_run_date ? `Renews ${formatDateOnly(activeMembership.next_run_date)}` : 'Active')}
                  </div>
                </>
              ) : (
                <div className="fs-4 fw-bolder text-muted">No active membership</div>
              )}
              <Link to="/portal/membership" className="small">Manage →</Link>
            </div>
          </div>
        </div>
        <div className="col-md-4">
          <div className="card h-100">
            <div className="card-body">
              <small className="text-muted text-uppercase fw-bold">Upcoming Events</small>
              <div className="fs-2 fw-bolder">{upcoming.length}</div>
              <div className="small text-muted">{nextEvent ? nextEvent.event_name : 'Nothing scheduled'}</div>
              <Link to="/portal/events" className="small">View all →</Link>
            </div>
          </div>
        </div>
      </div>

      <div className="row g-3 mt-1">
        <div className="col-md-6">
          <div className="card">
            <div className="card-body">
              <small className="text-muted text-uppercase fw-bold">Amount due</small>
              <div className="fs-4 fw-bolder">{fmt(outstanding)}</div>
              {open.length > 0 && (
                <Link to="/portal/invoices" className="btn btn-sm btn-primary mt-2">Pay now</Link>
              )}
            </div>
          </div>
        </div>
        <div className="col-md-6">
          <div className="card">
            <div className="card-body">
              <small className="text-muted text-uppercase fw-bold">Open invoices</small>
              <div className="fs-4 fw-bolder">{open.length}</div>
              <Link to="/portal/invoices" className="small">View all →</Link>
            </div>
          </div>
        </div>
      </div>

      {upcoming.length > 0 && (
        <div className="card mt-4">
          <div className="card-body">
            <h6 className="fw-bold text-uppercase small text-muted">Upcoming Events</h6>
            <ul className="list-unstyled mb-0">
              {upcoming.slice(0, 5).map((r) => (
                <li key={r.id} className="d-flex justify-content-between align-items-center py-2 border-bottom">
                  <div>
                    <div className="fw-semibold">{r.event_name}</div>
                    <small className="text-muted">{r.ticket_name}{r.location ? ` · ${r.location}` : ''}</small>
                  </div>
                  <div className="text-end small text-muted">
                    {new Date(r.start_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                  </div>
                </li>
              ))}
            </ul>
            <Link to="/portal/events" className="small d-inline-block mt-2">View all →</Link>
          </div>
        </div>
      )}

      <div className="card mt-4">
        <div className="card-body">
          <h6 className="fw-bold text-uppercase small text-muted">Recent Giving</h6>
          {donations.rows.length === 0 ? <div className="empty-state">No gifts yet.</div> : (
            <div className="table-responsive">
              <table className="table align-middle mb-0">
                <thead>
                  <tr>
                    <th>Date</th><th>Fund</th><th className="text-end">Amount</th><th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {donations.rows.slice(0, 10).map((d) => (
                    <tr key={d.id}>
                      <td>{new Date(d.created_at).toLocaleDateString()}</td>
                      <td>{d.fund_name || 'Undesignated'}</td>
                      <td className="text-end fw-semibold">{fmt(d.amount)}</td>
                      <td><span className="badge bg-success-subtle text-success">{d.payment_status}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <Link to="/portal/giving" className="small d-inline-block mt-3">View all →</Link>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
