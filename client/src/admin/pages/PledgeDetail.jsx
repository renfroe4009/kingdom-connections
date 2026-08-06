import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import api from '../../api/client.js';
import PageHeader from '../../components/PageHeader.jsx';
import { toast } from '../../components/Toast.jsx';
import { parseApiError } from '../../utils/apiError.js';
import { useConfirm } from '../../hooks/useConfirm.jsx';
import { useAuth } from '../../auth/AuthContext.jsx';

const STATUS_TONE = { active: 'success', paused: 'warning', completed: 'secondary', canceled: 'danger' };

function fmtMoney(n) {
  return `$${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function intervalLabel(count, unit) {
  return `Every ${count} ${unit}${Number(count) > 1 ? 's' : ''}`;
}

export default function PledgeDetail() {
  const { id } = useParams();
  const { can } = useAuth();
  const { confirm, dialog: confirmDialog } = useConfirm();
  const [data, setData] = useState(null);

  async function load() {
    const { data: d } = await api.get(`/pledges/${id}`);
    setData(d);
  }
  useEffect(() => { load().catch(() => {}); /* eslint-disable-next-line */ }, [id]);

  if (!data) return <div className="empty-state">Loading…</div>;
  const { pledge: p, donations } = data;

  async function setStatus(action) {
    if (action === 'cancel' && !(await confirm('Cancel this pledge? No further installments will be generated.'))) return;
    try {
      await api.post(`/pledges/${id}/${action}`);
      load();
    } catch (e) {
      toast(parseApiError(e), 'error');
    }
  }

  return (
    <div>
      <PageHeader
        title={p.contact_name || p.organization_name || 'Pledge'}
        subtitle={`${p.fund_name} · ${intervalLabel(p.interval_count, p.interval_unit)}`}
        actions={
          <>
            <Link to="/admin/pledges" className="btn btn-light">← Back</Link>
            {can('donations.write') && p.status === 'active' && (
              <button className="btn btn-outline-secondary ms-2" onClick={() => setStatus('pause')}>Pause</button>
            )}
            {can('donations.write') && p.status === 'paused' && (
              <button className="btn btn-outline-secondary ms-2" onClick={() => setStatus('resume')}>Resume</button>
            )}
            {can('donations.write') && ['active', 'paused'].includes(p.status) && (
              <button className="btn btn-outline-danger ms-2" onClick={() => setStatus('cancel')}>Cancel</button>
            )}
          </>
        }
      />

      <div className="row">
        <div className="col-lg-4 mb-3">
          <div className="card">
            <div className="card-body">
              <h6 className="fw-bold text-uppercase small text-muted">Pledge summary</h6>
              <dl className="row mb-0">
                <dt className="col-6">Status</dt>
                <dd className="col-6"><span className={`badge bg-${STATUS_TONE[p.status]}-subtle text-${STATUS_TONE[p.status]}`}>{p.status}</span></dd>
                <dt className="col-6">Installment</dt>
                <dd className="col-6">{fmtMoney(p.amount_per_installment)}</dd>
                <dt className="col-6">Schedule</dt>
                <dd className="col-6">{intervalLabel(p.interval_count, p.interval_unit)}</dd>
                <dt className="col-6">Progress</dt>
                <dd className="col-6">{p.occurrences_run || 0}{p.max_occurrences ? ` / ${p.max_occurrences}` : ''}</dd>
                <dt className="col-6">Next installment</dt>
                <dd className="col-6">{p.next_run_date || '—'}</dd>
                <dt className="col-6">Total pledged</dt>
                <dd className="col-6 fw-semibold">{p.total_pledged != null ? fmtMoney(p.total_pledged) : 'Open-ended'}</dd>
                <dt className="col-6">Collected</dt>
                <dd className="col-6 text-success fw-semibold">{fmtMoney(p.collected)}</dd>
                <dt className="col-6">Balance remaining</dt>
                <dd className="col-6 fw-semibold">{p.balance_remaining != null ? fmtMoney(p.balance_remaining) : '—'}</dd>
                <dt className="col-6">Auto-pay</dt>
                <dd className="col-6">{p.auto_pay ? `${p.gateway || 'on'}` : 'Invoice only'}</dd>
              </dl>
            </div>
          </div>
        </div>

        <div className="col-lg-8">
          <div className="card">
            <div className="card-body">
              <h6 className="fw-bold text-uppercase small text-muted mb-2">Donations collected</h6>
              {donations.length ? (
                <div className="table-responsive">
                  <table className="table table-sm align-middle mb-0">
                    <thead><tr><th>Date</th><th>Invoice</th><th className="text-end">Amount</th><th>Status</th></tr></thead>
                    <tbody>
                      {donations.map((d) => (
                        <tr key={d.id}>
                          <td className="small">{d.created_at}</td>
                          <td className="small">{d.invoice_number}</td>
                          <td className="text-end fw-semibold">{fmtMoney(d.amount)}</td>
                          <td><span className="badge bg-light text-dark">{d.payment_status}</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="empty-state">No installments collected yet.</div>
              )}
            </div>
          </div>
        </div>
      </div>
      {confirmDialog}
    </div>
  );
}
