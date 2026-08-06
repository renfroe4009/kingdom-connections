import { useEffect, useState } from 'react';
import api from '../../api/client.js';
import PageHeader from '../../components/PageHeader.jsx';

const fmtMoney = (n) =>
  `$${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const fmtPct = (n) => `${Number(n || 0).toFixed(3)}%`;

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}
function firstOfMonthStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

export default function BillingTaxReport() {
  const [from, setFrom]       = useState(firstOfMonthStr());
  const [to, setTo]           = useState(todayStr());
  const [ownerId, setOwnerId] = useState('');
  const [orgId, setOrgId]     = useState('');
  const [data, setData]       = useState(null);
  const [owners, setOwners]   = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');

  useEffect(() => {
    api.get('/users').then((r) => setOwners(r.data || [])).catch(() => {});
  }, []);

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ from, to });
      if (ownerId) params.set('owner_id', ownerId);
      if (orgId)   params.set('org_id', orgId);
      const r = await api.get(`/reports/billing/tax?${params}`);
      setData(r.data);
    } catch (e) {
      setError(e.response?.data?.error || 'Failed to load report.');
    } finally {
      setLoading(false);
    }
  }

  function csvHref() {
    const params = new URLSearchParams({ from, to, format: 'csv' });
    if (ownerId) params.set('owner_id', ownerId);
    if (orgId)   params.set('org_id', orgId);
    return `/api/reports/billing/tax?${params}`;
  }

  const rows    = data?.rows    || [];
  const totals  = data?.totals  || {};

  return (
    <div>
      <PageHeader
        title="Sales Tax Report"
        subtitle="Tax billed and collected per paid invoice"
        actions={
          <a href={csvHref()} className="btn btn-light" download>
            <iconify-icon icon="solar:download-line-duotone" class="me-1"></iconify-icon>
            Export CSV
          </a>
        }
      />

      {/* ── Filters ── */}
      <div className="card mb-4">
        <div className="card-body">
          <div className="row g-2 align-items-end">
            <div className="col-md-2">
              <label className="form-label small fw-semibold">From</label>
              <input type="date" className="form-control" value={from} onChange={(e) => setFrom(e.target.value)} />
            </div>
            <div className="col-md-2">
              <label className="form-label small fw-semibold">To</label>
              <input type="date" className="form-control" value={to} onChange={(e) => setTo(e.target.value)} />
            </div>
            <div className="col-md-3">
              <label className="form-label small fw-semibold">Owner</label>
              <select className="form-select" value={ownerId} onChange={(e) => setOwnerId(e.target.value)}>
                <option value="">All owners</option>
                {owners.map((u) => (
                  <option key={u.id} value={u.id}>
                    {[u.first_name, u.last_name].filter(Boolean).join(' ')}
                  </option>
                ))}
              </select>
            </div>
            <div className="col-md-auto">
              <button className="btn btn-primary" onClick={load} disabled={loading}>
                {loading
                  ? <><span className="spinner-border spinner-border-sm me-1" />Loading…</>
                  : 'Run Report'}
              </button>
            </div>
          </div>
        </div>
      </div>

      {error && <div className="alert alert-danger">{error}</div>}

      {/* ── Summary cards ── */}
      {data && (
        <div className="row g-3 mb-4">
          <div className="col-6 col-md-3">
            <div className="card border-0 bg-light">
              <div className="card-body py-3">
                <div className="text-muted small text-uppercase fw-bold">Invoices</div>
                <div className="fs-4 fw-bold">{rows.length}</div>
              </div>
            </div>
          </div>
          <div className="col-6 col-md-3">
            <div className="card border-0 bg-warning-subtle">
              <div className="card-body py-3">
                <div className="text-muted small text-uppercase fw-bold">Tax Billed</div>
                <div className="fs-4 fw-bold text-warning">{fmtMoney(totals.tax_billed)}</div>
              </div>
            </div>
          </div>
          <div className="col-6 col-md-3">
            <div className="card border-0 bg-success-subtle">
              <div className="card-body py-3">
                <div className="text-muted small text-uppercase fw-bold">Tax Collected</div>
                <div className="fs-4 fw-bold text-success">{fmtMoney(totals.tax_collected)}</div>
              </div>
            </div>
          </div>
          <div className="col-6 col-md-3">
            <div className="card border-0 bg-info-subtle">
              <div className="card-body py-3">
                <div className="text-muted small text-uppercase fw-bold">Revenue Collected</div>
                <div className="fs-4 fw-bold text-info">{fmtMoney(totals.amount_paid)}</div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Table ── */}
      <div className="card">
        <div className="card-body p-0">
          {rows.length === 0 && !loading ? (
            <div className="p-4 text-center text-muted">
              No taxable paid invoices found for the selected period.
            </div>
          ) : (
            <div className="table-responsive">
              <table className="table table-hover mb-0 align-middle small">
                <thead className="table-light">
                  <tr>
                    <th>Invoice #</th>
                    <th>Paid Date</th>
                    <th>Customer</th>
                    <th>Organization</th>
                    <th>Owner</th>
                    <th className="text-end">Subtotal</th>
                    <th className="text-end">Tax Rate</th>
                    <th className="text-end">Tax Billed</th>
                    <th className="text-end">Amt Paid</th>
                    <th className="text-end">Tax Collected</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id}>
                      <td>
                        <a href={`/invoices/${r.id}`} className="fw-semibold text-decoration-none">
                          {r.invoice_number}
                        </a>
                      </td>
                      <td className="text-nowrap">{r.paid_date || '—'}</td>
                      <td>{r.contact_name || '—'}</td>
                      <td>{r.org_name || '—'}</td>
                      <td>{r.owner_name || '—'}</td>
                      <td className="text-end">{fmtMoney(r.subtotal)}</td>
                      <td className="text-end">{fmtPct(r.tax_rate)}</td>
                      <td className="text-end">{fmtMoney(r.tax_amount)}</td>
                      <td className="text-end">{fmtMoney(r.amount_paid)}</td>
                      <td className="text-end fw-semibold text-success">{fmtMoney(r.tax_collected)}</td>
                    </tr>
                  ))}
                </tbody>
                {rows.length > 0 && (
                  <tfoot className="table-light fw-bold">
                    <tr>
                      <td colSpan={7} className="text-end">Totals</td>
                      <td className="text-end">{fmtMoney(totals.tax_billed)}</td>
                      <td className="text-end">{fmtMoney(totals.amount_paid)}</td>
                      <td className="text-end text-success">{fmtMoney(totals.tax_collected)}</td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
