import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../../api/client.js';
import PageHeader from '../../components/PageHeader.jsx';
import Modal from '../../components/Modal.jsx';
import RecordDonationModal from '../components/RecordDonationModal.jsx';
import { useAuth } from '../../auth/AuthContext.jsx';

const STATUS_TONE = {
  pending: 'warning', authorized: 'info', captured: 'success',
  failed: 'danger', refunded: 'secondary', voided: 'secondary',
};

const MATCH_TONE = { eligible: 'info', submitted: 'warning', matched: 'success', denied: 'secondary' };
const MATCH_LABEL = { eligible: 'Eligible', submitted: 'Submitted', matched: 'Matched', denied: 'Denied' };

function fmtMoney(n) {
  return `$${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function DonationsList() {
  const { can } = useAuth();
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [summary, setSummary] = useState(null);
  const [funds, setFunds] = useState([]);
  const [fundId, setFundId] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [page, setPage] = useState(1);
  const pageSize = 50;

  const [showRecord, setShowRecord] = useState(false);

  const [matchDonation, setMatchDonation] = useState(null); // the row being edited
  const [matchForm, setMatchForm] = useState({ matching_gift_employer: '', matching_gift_amount: '', matching_gift_state: 'none' });
  const [matchSaving, setMatchSaving] = useState(false);

  async function load() {
    const params = { page, pageSize };
    if (fundId) params.fund_id = fundId;
    if (startDate) params.start_date = startDate;
    if (endDate) params.end_date = endDate;
    const { data } = await api.get('/donations/admin', { params });
    setRows(data.rows);
    setTotal(data.total);
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [fundId, startDate, endDate, page]);
  useEffect(() => {
    api.get('/donations/admin/summary').then((r) => setSummary(r.data)).catch(() => {});
    api.get('/donations/admin/funds').then((r) => setFunds(r.data)).catch(() => {});
  }, []);

  function openMatch(d) {
    setMatchDonation(d);
    setMatchForm({
      matching_gift_employer: d.matching_gift_employer || '',
      matching_gift_amount: d.matching_gift_amount || '',
      matching_gift_state: d.matching_gift_state || 'eligible',
    });
  }
  async function saveMatch() {
    setMatchSaving(true);
    try {
      await api.put(`/donations/admin/${matchDonation.id}/matching-gift`, {
        matching_gift_employer: matchForm.matching_gift_employer || null,
        matching_gift_amount: matchForm.matching_gift_amount ? Number(matchForm.matching_gift_amount) : null,
        matching_gift_state: matchForm.matching_gift_state,
      });
      setMatchDonation(null);
      load();
    } finally { setMatchSaving(false); }
  }

  function exportCsv() {
    const token = localStorage.getItem('lc_impersonate_token') || localStorage.getItem('lc_token');
    const apiBase = api.defaults.baseURL;
    const url = `${apiBase}/donations/admin/export.csv`;
    fetch(url, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.blob())
      .then((blob) => {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'donations.csv';
        a.click();
      });
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div>
      <PageHeader title="Donations" subtitle="Gifts received online and recorded by staff"
        actions={<>
          <button className="btn btn-light" onClick={exportCsv}>
            <iconify-icon icon="solar:download-line-duotone" class="me-1"></iconify-icon> Export CSV
          </button>
          <Link to="/admin/donations/funds" className="btn btn-light ms-2">
            <iconify-icon icon="solar:wallet-line-duotone" class="me-1"></iconify-icon> Manage Funds
          </Link>
          {can('donations.write') && (
            <button className="btn btn-primary ms-2" onClick={() => setShowRecord(true)}>
              <iconify-icon icon="solar:add-circle-line-duotone" class="me-1"></iconify-icon> Record Donation
            </button>
          )}
        </>} />

      {summary && (
        <div className="row g-3 mb-3">
          <div className="col-md-3">
            <div className="card"><div className="card-body">
              <div className="text-muted small">Total Raised (all time)</div>
              <div className="fs-4 fw-bold">{fmtMoney(summary.totals.total_raised)}</div>
              <div className="text-muted small">{summary.totals.gift_count} gifts</div>
              {Number(summary.totals.total_fees) > 0 && (
                <div className="text-muted small">{fmtMoney(summary.totals.total_fees)} in processing fees collected</div>
              )}
            </div></div>
          </div>
          <div className="col-md-3">
            <div className="card"><div className="card-body">
              <div className="text-muted small">This Month</div>
              <div className="fs-4 fw-bold">{fmtMoney(summary.thisMonth.total_raised)}</div>
              <div className="text-muted small">{summary.thisMonth.gift_count} gifts</div>
              {Number(summary.thisMonth.total_fees) > 0 && (
                <div className="text-muted small">{fmtMoney(summary.thisMonth.total_fees)} in fees</div>
              )}
            </div></div>
          </div>
          <div className="col-md-3">
            <div className="card"><div className="card-body">
              <div className="text-muted small mb-1">Top Funds</div>
              {summary.byFund.length ? summary.byFund.slice(0, 3).map((f) => (
                <div key={f.fund_name} className="d-flex justify-content-between small">
                  <span>{f.fund_name}</span><strong>{fmtMoney(f.total_raised)}</strong>
                </div>
              )) : <div className="text-muted small">No gifts yet.</div>}
            </div></div>
          </div>
          <div className="col-md-3">
            <div className="card"><div className="card-body">
              <div className="text-muted small">Matching Gifts Pending</div>
              <div className="fs-4 fw-bold">{fmtMoney(summary.matching?.pending_amount)}</div>
              <div className="text-muted small">{summary.matching?.pending_count || 0} gifts · {fmtMoney(summary.matching?.matched_amount)} matched</div>
            </div></div>
          </div>
        </div>
      )}

      <div className="card">
        <div className="card-body">
          <div className="row g-2 mb-3">
            <div className="col-md-3">
              <select className="form-select" value={fundId} onChange={(e) => { setFundId(e.target.value); setPage(1); }}>
                <option value="">All funds</option>
                {funds.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
              </select>
            </div>
            <div className="col-md-3">
              <input type="date" className="form-control" value={startDate}
                onChange={(e) => { setStartDate(e.target.value); setPage(1); }} placeholder="Start date" />
            </div>
            <div className="col-md-3">
              <input type="date" className="form-control" value={endDate}
                onChange={(e) => { setEndDate(e.target.value); setPage(1); }} placeholder="End date" />
            </div>
          </div>

          <div className="table-responsive">
            <table className="table table-hover align-middle mb-0">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Donor</th>
                  <th>Fund</th>
                  <th className="text-end">Amount</th>
                  <th className="text-end">Fee</th>
                  <th>Status</th>
                  <th>Match</th>
                  <th>Invoice</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((d) => (
                  <tr key={d.id}>
                    <td>{new Date(d.created_at).toLocaleDateString()}</td>
                    <td>
                      {d.is_anonymous ? <span className="text-muted">Anonymous</span> : (
                        d.contact_id ? <Link to={`/admin/contacts/${d.contact_id}`}>{d.contact_name || d.contact_email}</Link> : (d.organization_name || '—')
                      )}
                      {d.dedication_note && <div className="text-muted small">{d.dedication_note}</div>}
                    </td>
                    <td>{d.fund_name || 'Undesignated'}</td>
                    <td className="text-end fw-semibold">{fmtMoney(d.net_amount)}</td>
                    <td className="text-end text-muted small">
                      {Number(d.fee_amount) > 0 ? fmtMoney(d.fee_amount) : '—'}
                    </td>
                    <td><span className={`badge bg-${STATUS_TONE[d.payment_status] || 'secondary'}-subtle text-${STATUS_TONE[d.payment_status] || 'secondary'}`}>{d.payment_status}</span></td>
                    <td>
                      <button className="btn btn-sm btn-link p-0 text-decoration-none" onClick={() => openMatch(d)}>
                        {d.matching_gift_state && d.matching_gift_state !== 'none' ? (
                          <span className={`badge bg-${MATCH_TONE[d.matching_gift_state]}-subtle text-${MATCH_TONE[d.matching_gift_state]}`}>
                            {MATCH_LABEL[d.matching_gift_state]}{d.matching_gift_amount ? ` · ${fmtMoney(d.matching_gift_amount)}` : ''}
                          </span>
                        ) : <span className="text-muted small">+ Add</span>}
                      </button>
                    </td>
                    <td>{d.invoice_id ? <Link to={`/admin/invoices/${d.invoice_id}`}>{d.invoice_number}</Link> : '—'}</td>
                  </tr>
                ))}
                {rows.length === 0 && <tr><td colSpan="8"><div className="empty-state">No donations yet.</div></td></tr>}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div className="d-flex justify-content-between align-items-center mt-3">
              <span className="text-muted small">Page {page} of {totalPages} ({total} total)</span>
              <div>
                <button className="btn btn-sm btn-light me-1" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</button>
                <button className="btn btn-sm btn-light" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>Next</button>
              </div>
            </div>
          )}
        </div>
      </div>

      <RecordDonationModal
        show={showRecord}
        onClose={() => setShowRecord(false)}
        onSaved={() => { setShowRecord(false); load(); }}
      />

      <Modal show={!!matchDonation} onClose={() => setMatchDonation(null)} title="Matching Gift" size="sm"
        footer={<><button className="btn btn-light" onClick={() => setMatchDonation(null)}>Cancel</button>
                  <button className="btn btn-primary" onClick={saveMatch} disabled={matchSaving}>{matchSaving ? 'Saving…' : 'Save'}</button></>}>
        <div className="row g-2">
          <div className="col-12"><label className="form-label">Employer</label>
            <input className="form-control" value={matchForm.matching_gift_employer}
              onChange={(e) => setMatchForm({ ...matchForm, matching_gift_employer: e.target.value })} placeholder="Acme Corp" /></div>
          <div className="col-12"><label className="form-label">Status</label>
            <select className="form-select" value={matchForm.matching_gift_state}
              onChange={(e) => setMatchForm({ ...matchForm, matching_gift_state: e.target.value })}>
              <option value="none">Not applicable</option>
              <option value="eligible">Eligible (donor says employer matches)</option>
              <option value="submitted">Submitted to employer</option>
              <option value="matched">Matched — received</option>
              <option value="denied">Denied</option>
            </select></div>
          <div className="col-12"><label className="form-label">Matched amount ($)</label>
            <input type="number" step="0.01" className="form-control" value={matchForm.matching_gift_amount}
              onChange={(e) => setMatchForm({ ...matchForm, matching_gift_amount: e.target.value })} /></div>
        </div>
      </Modal>
    </div>
  );
}
