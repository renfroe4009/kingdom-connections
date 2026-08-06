import { useEffect, useState } from 'react';
import api from '../../../api/client.js';
import DonationCheckout from '../../../frontend/components/DonationCheckout.jsx';

const STATUS_TONE = { captured: 'success', authorized: 'info' };
const QUICK_AMOUNTS = [25, 50, 100, 250];

export default function PortalGiving() {
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [statementYear, setStatementYear] = useState(String(new Date().getFullYear()));
  const [statementError, setStatementError] = useState('');

  // ── Give Again ──────────────────────────────────────────────────────────
  const [funds, setFunds] = useState([]);
  const [fundSlug, setFundSlug] = useState('');
  const [selectedAmt, setSelectedAmt] = useState(null);
  const [customAmt, setCustomAmt] = useState('');
  const [giveError, setGiveError] = useState('');
  const [giveBusy, setGiveBusy] = useState(false);
  const [giveCheckout, setGiveCheckout] = useState(null); // { invoiceId, total, contactId }
  const [giveSuccess, setGiveSuccess] = useState(false);

  function load() {
    api.get('/portal/donations').then((r) => {
      setRows(r.data.rows || []);
      setTotal(r.data.total || 0);
    }).catch(() => {});
  }
  useEffect(() => { load(); }, []);
  useEffect(() => {
    api.get('/donations/public/funds').then((r) => setFunds(r.data || [])).catch(() => {});
  }, []);

  async function startGiveAgain() {
    const amount = Number(customAmt || selectedAmt);
    if (!amount || amount <= 0) { setGiveError('Choose or enter an amount.'); return; }
    setGiveError(''); setGiveBusy(true);
    try {
      const { data } = await api.post('/portal/donations/checkout', {
        amount, fund_slug: fundSlug || null,
      });
      setGiveCheckout(data);
    } catch (e) {
      setGiveError(e.response?.data?.error || 'Could not start checkout.');
    } finally {
      setGiveBusy(false);
    }
  }

  async function handleGiveSuccess() {
    try {
      await api.post(`/donations/public/finalize/${giveCheckout.invoiceId}`, { fund_slug: fundSlug || null });
    } catch { /* payment already captured — finalize is best-effort tagging */ }
    setGiveCheckout(null);
    setSelectedAmt(null);
    setCustomAmt('');
    setGiveSuccess(true);
    load();
  }

  const fmt = (n) => `$${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  async function downloadStatement() {
    setStatementError('');
    try {
      const res = await api.get(`/portal/donations/statement/${statementYear}`, { responseType: 'blob' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(res.data);
      a.download = `giving-statement-${statementYear}.pdf`;
      a.click();
    } catch (e) {
      setStatementError(e.response?.status === 404 ? `No gifts found for ${statementYear}.` : 'Could not download statement.');
    }
  }

  const years = Array.from(new Set(rows.map((r) => new Date(r.created_at).getFullYear())));
  if (!years.length) years.push(new Date().getFullYear());

  return (
    <div>
      <h3 className="fw-bolder mb-1">My Giving</h3>
      <p className="text-muted">Your donation history and receipts.</p>

      <div className="card mb-3">
        <div className="card-body">
          <h6 className="fw-bold mb-3">Give Again</h6>
          {giveSuccess && !giveCheckout && (
            <div className="alert alert-success py-2 small">Thank you for your gift!</div>
          )}
          {giveCheckout ? (
            <div style={{ maxWidth: 420 }}>
              <DonationCheckout
                invoiceId={giveCheckout.invoiceId}
                chargeAmount={giveCheckout.total}
                contactId={giveCheckout.contactId}
                allowSaveCard
                saveCardLabel="Save this card for future gifts"
                onSuccess={handleGiveSuccess}
                onCancel={() => setGiveCheckout(null)}
              />
              <button className="btn btn-light btn-sm mt-2" onClick={() => setGiveCheckout(null)}>Cancel</button>
            </div>
          ) : (
            <div style={{ maxWidth: 420 }}>
              <div className="d-flex flex-wrap gap-2 mb-2">
                {QUICK_AMOUNTS.map((amt) => (
                  <button key={amt} type="button"
                    className={`btn btn-sm ${selectedAmt === amt ? 'btn-primary' : 'btn-outline-secondary'}`}
                    onClick={() => { setSelectedAmt(amt); setCustomAmt(''); }}>
                    ${amt}
                  </button>
                ))}
              </div>
              <input type="number" className="form-control mb-2" placeholder="Custom amount"
                value={customAmt} onChange={(e) => { setCustomAmt(e.target.value); setSelectedAmt(null); }} />
              {funds.length > 0 && (
                <select className="form-select mb-2" value={fundSlug} onChange={(e) => setFundSlug(e.target.value)}>
                  <option value="">Where needed most</option>
                  {funds.map((f) => <option key={f.id} value={f.slug}>{f.name}</option>)}
                </select>
              )}
              {giveError && <div className="text-danger small mb-2">{giveError}</div>}
              <button className="btn btn-primary" disabled={giveBusy} onClick={startGiveAgain}>
                {giveBusy ? 'Starting…' : 'Give'}
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="card mb-3">
        <div className="card-body d-flex flex-wrap justify-content-between align-items-center gap-3">
          <div>
            <div className="text-muted small">Total given</div>
            <div className="fs-3 fw-bold">{fmt(total)}</div>
          </div>
          <div className="d-flex align-items-center gap-2">
            <select className="form-select form-select-sm" style={{ width: 100 }} value={statementYear} onChange={(e) => setStatementYear(e.target.value)}>
              {years.map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
            <button className="btn btn-sm btn-outline-primary" onClick={downloadStatement}>Year-End Statement</button>
          </div>
        </div>
        {statementError && <div className="card-footer text-danger small py-2">{statementError}</div>}
      </div>

      <div className="card">
        <div className="card-body">
          <div className="table-responsive">
            <table className="table align-middle mb-0">
              <thead>
                <tr>
                  <th>Date</th><th>Fund</th><th className="text-end">Amount</th><th>Status</th><th></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((d) => (
                  <tr key={d.id}>
                    <td>{new Date(d.created_at).toLocaleDateString()}</td>
                    <td>
                      {d.fund_name || 'Where needed most'}
                      {d.dedication_note && <div className="text-muted small">{d.dedication_note}</div>}
                    </td>
                    <td className="text-end fw-semibold">{fmt(d.amount)}</td>
                    <td><span className={`badge bg-${STATUS_TONE[d.payment_status] || 'secondary'}-subtle text-${STATUS_TONE[d.payment_status] || 'secondary'}`}>{d.payment_status}</span></td>
                    <td>
                      {d.receipt_token && (
                        <a className="btn btn-sm btn-light" href={`${api.defaults.baseURL}/payments/public/receipt/by-token/${d.receipt_token}.pdf`} target="_blank" rel="noreferrer">
                          Receipt
                        </a>
                      )}
                    </td>
                  </tr>
                ))}
                {rows.length === 0 && <tr><td colSpan="5"><div className="empty-state">No gifts yet.</div></td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
