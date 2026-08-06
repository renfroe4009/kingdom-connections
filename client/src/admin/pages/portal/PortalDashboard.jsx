import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../../../api/client.js';

export default function PortalDashboard() {
  const [me, setMe] = useState(null);
  const [invoices, setInvoices] = useState([]);
  const [subs, setSubs] = useState([]);

  useEffect(() => {
    api.get('/portal/me').then((r) => setMe(r.data)).catch(() => {});
    api.get('/portal/invoices').then((r) => setInvoices(r.data.rows || [])).catch(() => {});
    api.get('/portal/subscriptions').then((r) => setSubs(r.data.rows || [])).catch(() => {});
  }, []);

  const fmt = (n) => `$${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const outstanding = invoices.reduce((a, i) => a + Number(i.balance_due || 0), 0);
  const open = invoices.filter((i) => Number(i.balance_due || 0) > 0);

  return (
    <div>
      <h3 className="fw-bolder mb-1">Welcome back{me?.contact?.first_name ? `, ${me.contact.first_name}` : ''}.</h3>
      <p className="text-muted">Here's a snapshot of your account.</p>

      <div className="row g-3 mt-1">
        <div className="col-md-4">
          <div className="card">
            <div className="card-body">
              <small className="text-muted text-uppercase fw-bold">Amount due</small>
              <div className="fs-2 fw-bolder" style={{ color: 'var(--brand, #0A1F3D)' }}>{fmt(outstanding)}</div>
              {open.length > 0 && (
                <Link to="/portal/invoices" className="btn btn-sm btn-primary mt-2">Pay now</Link>
              )}
            </div>
          </div>
        </div>
        <div className="col-md-4">
          <div className="card">
            <div className="card-body">
              <small className="text-muted text-uppercase fw-bold">Open invoices</small>
              <div className="fs-2 fw-bolder">{open.length}</div>
              <Link to="/portal/invoices" className="small">View all →</Link>
            </div>
          </div>
        </div>
        <div className="col-md-4">
          <div className="card">
            <div className="card-body">
              <small className="text-muted text-uppercase fw-bold">Active subscriptions</small>
              <div className="fs-2 fw-bolder">{subs.filter((s) => s.status === 'active').length}</div>
              <Link to="/portal/subscriptions" className="small">Manage →</Link>
            </div>
          </div>
        </div>
      </div>

      <div className="card mt-4">
        <div className="card-body">
          <h6 className="fw-bold text-uppercase small text-muted">Recent invoices</h6>
          {invoices.length === 0 ? <div className="empty-state">No invoices yet.</div> : (
            <div className="table-responsive">
              <table className="table align-middle mb-0">
                <thead>
                  <tr>
                    <th>Number</th><th>Issued</th><th>Due</th>
                    <th className="text-end">Total</th><th className="text-end">Balance</th><th></th>
                  </tr>
                </thead>
                <tbody>
                  {invoices.slice(0, 10).map((i) => (
                    <tr key={i.id}>
                      <td><Link to={`/portal/invoices/${i.id}`} className="fw-semibold">{i.invoice_number}</Link></td>
                      <td>{i.issue_date}</td>
                      <td>{i.due_date}</td>
                      <td className="text-end">{fmt(i.total)}</td>
                      <td className="text-end">{fmt(i.balance_due)}</td>
                      <td>
                        {Number(i.balance_due) > 0
                          ? <Link to={`/portal/invoices/${i.id}`} className="btn btn-sm btn-primary">Pay</Link>
                          : <span className="badge bg-success-subtle text-success">Paid</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
