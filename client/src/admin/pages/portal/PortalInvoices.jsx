import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../../../api/client.js';

const STATUS_TONE = {
  draft: 'secondary', sent: 'primary', partial: 'warning',
  paid: 'success', overdue: 'danger', void: 'dark', refunded: 'info',
};

export default function PortalInvoices() {
  const [rows, setRows] = useState([]);

  useEffect(() => {
    api.get('/portal/invoices').then((r) => setRows(r.data.rows || [])).catch(() => {});
  }, []);

  const fmt = (n) => `$${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  return (
    <div>
      <h3 className="fw-bolder mb-1">Invoices</h3>
      <p className="text-muted">All invoices on your account.</p>

      <div className="card">
        <div className="card-body">
          <div className="table-responsive">
            <table className="table align-middle mb-0">
              <thead>
                <tr>
                  <th>Number</th><th>Issued</th><th>Due</th>
                  <th className="text-end">Total</th><th className="text-end">Balance</th><th>Status</th><th></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((i) => (
                  <tr key={i.id}>
                    <td><Link to={`/portal/invoices/${i.id}`} className="fw-semibold">{i.invoice_number}</Link></td>
                    <td>{i.issue_date}</td>
                    <td>{i.due_date}</td>
                    <td className="text-end">{fmt(i.total)}</td>
                    <td className="text-end">{fmt(i.balance_due)}</td>
                    <td><span className={`badge bg-${STATUS_TONE[i.status]}-subtle text-${STATUS_TONE[i.status]}`}>{i.status}</span></td>
                    <td>
                      {Number(i.balance_due) > 0
                        ? <Link to={`/portal/invoices/${i.id}`} className="btn btn-sm btn-primary">Pay</Link>
                        : <Link to={`/portal/invoices/${i.id}`} className="btn btn-sm btn-light">View</Link>}
                    </td>
                  </tr>
                ))}
                {rows.length === 0 && <tr><td colSpan="7"><div className="empty-state">No invoices yet.</div></td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
