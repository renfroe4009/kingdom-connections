import { useEffect, useState } from 'react';
import { ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts';
import api from '../../api/client.js';
import PageHeader from '../../components/PageHeader.jsx';

const fmtMoney = (n) =>
  `$${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const fmtPct = (n) => `${Number(n || 0).toFixed(1)}%`;

const fmtAxisMoney = (n) => (Number(n) >= 1000 ? `$${(Number(n) / 1000).toFixed(0)}k` : `$${Number(n).toFixed(0)}`);

function donorHref(r) {
  return r.donor_type === 'organization' ? `/organizations/${r.donor_id}` : `/contacts/${r.donor_id}`;
}

function DonorTable({ title, rows, csvHref }) {
  return (
    <div className="card mb-4">
      <div className="card-body">
        <div className="d-flex justify-content-between align-items-center mb-2">
          <h6 className="fw-bold text-uppercase small text-muted mb-0">{title} ({rows.length})</h6>
          <a href={csvHref} className="btn btn-sm btn-light" download>
            <iconify-icon icon="solar:download-line-duotone" class="me-1"></iconify-icon>
            Export CSV
          </a>
        </div>
        <div className="table-responsive">
          <table className="table table-sm table-hover align-middle mb-0">
            <thead>
              <tr>
                <th>Donor</th>
                <th>Type</th>
                <th>Last Gift</th>
                <th className="text-end">Lifetime Total</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.donor_type}:${r.donor_id}`}>
                  <td><a href={donorHref(r)} className="fw-semibold text-decoration-none">{r.name}</a></td>
                  <td className="text-capitalize">{r.donor_type}</td>
                  <td>{r.last_gift_date ? new Date(r.last_gift_date).toLocaleDateString() : '—'}</td>
                  <td className="text-end">{fmtMoney(r.lifetime_total)}</td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr><td colSpan="4"><div className="empty-state">No donors in this list.</div></td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export default function DonorRetentionReport() {
  const [year, setYear] = useState(new Date().getFullYear());
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [year]);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const r = await api.get('/reports/donors/retention', { params: { year } });
      setData(r.data);
    } catch (e) {
      setError(e.response?.data?.error || 'Failed to load report.');
    } finally {
      setLoading(false);
    }
  }

  function csvHref(list) {
    const params = new URLSearchParams({ year, format: 'csv', list });
    return `/api/reports/donors/retention?${params}`;
  }

  const summary = data?.summary || {};
  const trend = data?.trend || [];
  const yearOptions = [];
  for (let y = new Date().getFullYear(); y >= new Date().getFullYear() - 6; y--) yearOptions.push(y);

  return (
    <div>
      <PageHeader
        title="Donor Retention"
        subtitle="Lapsed-donor lists, retention rate, and giving trends"
        actions={
          <select className="form-select" style={{ width: 120 }} value={year} onChange={(e) => setYear(Number(e.target.value))}>
            {yearOptions.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        }
      />

      {error && <div className="alert alert-danger">{error}</div>}
      {loading && !data && <div className="empty-state">Loading…</div>}

      {data && (
        <>
          <div className="row g-3 mb-4">
            <div className="col-6 col-md-3">
              <div className="card border-0 bg-success-subtle">
                <div className="card-body py-3">
                  <div className="text-muted small text-uppercase fw-bold">Retention Rate</div>
                  <div className="fs-4 fw-bold text-success">{fmtPct(summary.retention_rate)}</div>
                  <div className="small text-muted">{summary.prior_year_donor_count} donors in {year - 1}</div>
                </div>
              </div>
            </div>
            <div className="col-6 col-md-3">
              <div className="card border-0 bg-info-subtle">
                <div className="card-body py-3">
                  <div className="text-muted small text-uppercase fw-bold">New vs Returning</div>
                  <div className="fs-4 fw-bold text-info">{summary.new_donor_count} / {summary.returning_donor_count}</div>
                  <div className="small text-muted">new / returning in {year}</div>
                </div>
              </div>
            </div>
            <div className="col-6 col-md-3">
              <div className="card border-0 bg-warning-subtle">
                <div className="card-body py-3">
                  <div className="text-muted small text-uppercase fw-bold">LYBUNT</div>
                  <div className="fs-4 fw-bold text-warning">{summary.lybunt_count}</div>
                  <div className="small text-muted">gave {year - 1}, not {year}</div>
                </div>
              </div>
            </div>
            <div className="col-6 col-md-3">
              <div className="card border-0 bg-danger-subtle">
                <div className="card-body py-3">
                  <div className="text-muted small text-uppercase fw-bold">SYBUNT</div>
                  <div className="fs-4 fw-bold text-danger">{summary.sybunt_count}</div>
                  <div className="small text-muted">lapsed 2+ years</div>
                </div>
              </div>
            </div>
          </div>

          <div className="card mb-4">
            <div className="card-body">
              <h6 className="fw-bold text-uppercase small text-muted mb-3">Giving Trend (5 yr)</h6>
              <div style={{ width: '100%', height: 280 }}>
                <ResponsiveContainer>
                  <ComposedChart data={trend}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="year" />
                    <YAxis yAxisId="left" tickFormatter={fmtAxisMoney} />
                    <YAxis yAxisId="right" orientation="right" tickFormatter={fmtAxisMoney} />
                    <Tooltip formatter={(v, name) => [fmtMoney(v), name]} />
                    <Legend />
                    <Bar yAxisId="left" dataKey="total_amount" name="Total Given" fill="#0d6efd" />
                    <Line yAxisId="right" type="monotone" dataKey="avg_gift" name="Average Gift" stroke="#dc3545" strokeWidth={2} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          <DonorTable title="LYBUNT" rows={data.lybunt} csvHref={csvHref('lybunt')} />
          <DonorTable title="SYBUNT" rows={data.sybunt} csvHref={csvHref('sybunt')} />
        </>
      )}
    </div>
  );
}
