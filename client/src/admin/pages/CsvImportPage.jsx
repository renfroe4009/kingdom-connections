import { useState, useEffect } from 'react';
import api from '../../api/client.js';
import PageHeader from '../../components/PageHeader.jsx';

const CONTACT_FIELDS = [
  'first_name', 'last_name', 'email', 'phone', 'mobile', 'title',
  'organization_name', 'lifecycle_stage', 'lead_source',
  'address_line1', 'city', 'state', 'postal_code', 'country',
];
const ORG_FIELDS = [
  'name', 'website', 'phone', 'industry', 'employee_count', 'annual_revenue',
  'address_line1', 'city', 'state', 'postal_code', 'country',
];

export default function CsvImportPage() {
  const [entityType, setEntityType] = useState('contact');
  const [file, setFile] = useState(null);
  const [headers, setHeaders] = useState([]);
  const [sample, setSample] = useState([]);
  const [mapping, setMapping] = useState({});
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(null);
  const [jobs, setJobs] = useState([]);

  const targets = entityType === 'contact' ? CONTACT_FIELDS : ORG_FIELDS;

  async function loadJobs() {
    try {
      const { data } = await api.get('/import/jobs');
      setJobs(data);
    } catch { /* noop */ }
  }
  useEffect(() => { loadJobs(); }, []);

  function onFile(f) {
    setFile(f);
    setResult(null);
    const reader = new FileReader();
    reader.onload = () => {
      const text = reader.result;
      const lines = text.split(/\r?\n/).filter(Boolean).slice(0, 6);
      if (!lines.length) return;
      const hs = splitCsv(lines[0]);
      setHeaders(hs);
      setSample(lines.slice(1).map(splitCsv));
      // auto-match
      const m = {};
      hs.forEach((h) => {
        const key = h.toLowerCase().replace(/[^a-z0-9]+/g, '_');
        const match = targets.find((t) => t === key || t.includes(key) || key.includes(t));
        if (match) m[h] = match;
      });
      setMapping(m);
    };
    reader.readAsText(f);
  }
  function splitCsv(line) {
    const out = [];
    let cur = '';
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') { inQ = !inQ; continue; }
      if (c === ',' && !inQ) { out.push(cur); cur = ''; continue; }
      cur += c;
    }
    out.push(cur);
    return out.map((s) => s.trim());
  }

  async function runImport() {
    if (!file) return;
    setRunning(true); setResult(null);
    const fd = new FormData();
    fd.append('file', file);
    fd.append('entity_type', entityType);
    fd.append('mapping', JSON.stringify(mapping));
    try {
      const { data } = await api.post('/import/csv', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      setResult(data);
      loadJobs();
    } catch (e) {
      setResult({ error: e.response?.data?.error || 'Import failed' });
    } finally { setRunning(false); }
  }

  return (
    <div>
      <PageHeader title="CSV Import" subtitle="Import contacts or organizations from a CSV file" />

      <div className="card">
        <div className="card-body">
          <div className="row g-3">
            <div className="col-md-4">
              <label className="form-label">Import type</label>
              <select className="form-select" value={entityType} onChange={(e) => { setEntityType(e.target.value); setMapping({}); }}>
                <option value="contact">Contacts</option>
                <option value="organization">Organizations</option>
              </select>
            </div>
            <div className="col-md-8">
              <label className="form-label">CSV file</label>
              <input type="file" accept=".csv,text/csv" className="form-control" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
            </div>
          </div>

          {headers.length > 0 && (
            <>
              <h6 className="mt-4 fw-bold text-uppercase small text-muted">Field Mapping</h6>
              <div className="table-responsive">
                <table className="table table-sm align-middle">
                  <thead><tr><th>CSV column</th><th>Sample</th><th>Maps to CRM field</th></tr></thead>
                  <tbody>
                    {headers.map((h, idx) => (
                      <tr key={h}>
                        <td className="fw-semibold">{h}</td>
                        <td className="text-muted small">{sample[0]?.[idx] || ''}</td>
                        <td>
                          <select className="form-select form-select-sm" value={mapping[h] || ''} onChange={(e) => setMapping({ ...mapping, [h]: e.target.value })}>
                            <option value="">— Skip —</option>
                            {targets.map((t) => <option key={t} value={t}>{t}</option>)}
                          </select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="d-flex justify-content-end mt-3">
                <button className="btn btn-primary" onClick={runImport} disabled={running}>
                  {running ? 'Importing…' : 'Run Import'}
                </button>
              </div>
            </>
          )}

          {result && (
            <div className={`alert ${result.error ? 'alert-danger' : 'alert-success'} mt-3`}>
              {result.error ? result.error : (
                <>Imported <strong>{result.imported}</strong> rows · <strong>{result.skipped || 0}</strong> skipped · <strong>{result.errors?.length || 0}</strong> errors.</>
              )}
            </div>
          )}
        </div>
      </div>

      {jobs.length > 0 && (
        <div className="card mt-3">
          <div className="card-body">
            <h6 className="fw-bold text-uppercase small text-muted">Recent Imports</h6>
            <table className="table table-sm align-middle mb-0">
              <thead><tr><th>Date</th><th>Type</th><th>File</th><th className="text-end">Rows</th><th className="text-end">Imported</th><th>Status</th></tr></thead>
              <tbody>
                {jobs.map((j) => (
                  <tr key={j.id}>
                    <td>{new Date(j.created_at).toLocaleString()}</td>
                    <td>{j.entity_type}</td>
                    <td>{j.filename}</td>
                    <td className="text-end">{j.total_rows}</td>
                    <td className="text-end">{j.imported_rows}</td>
                    <td><span className={`badge bg-${j.status === 'completed' ? 'success' : j.status === 'failed' ? 'danger' : 'warning'}-subtle text-${j.status === 'completed' ? 'success' : j.status === 'failed' ? 'danger' : 'warning'}`}>{j.status}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
