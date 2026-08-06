import { useEffect, useState, useCallback } from 'react';
import api from '../../api/client.js';
import PageHeader from '../../components/PageHeader.jsx';

const OPERATOR_LABELS = {
  equals: 'is', not_equals: 'is not', contains: 'contains', not_contains: 'does not contain',
  greater_than: '>', less_than: '<', between: 'between', before: 'before', after: 'after',
  is_empty: 'is empty', is_not_empty: 'is not empty',
};

function newFilter(field, registry, module) {
  const op = registry[module]?.columns[field]?.operators?.[0] || 'equals';
  return { field, operator: op, value: op === 'between' ? ['', ''] : '' };
}

function fmtCell(value, type) {
  if (value == null || value === '') return <span className="text-muted">—</span>;
  if (type === 'currency') return `$${Number(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  if (type === 'date') return String(value).slice(0, 10);
  return String(value);
}

export default function ReportBuilderPage() {
  const [registry, setRegistry]   = useState(null);
  const [savedReports, setSaved]  = useState([]);
  const [activeReportId, setActiveReportId] = useState(null);

  const [module, setModule]   = useState('contacts');
  const [columns, setColumns] = useState([]);
  const [filters, setFilters] = useState([]);
  const [sort, setSort]       = useState(null);

  const [result, setResult]   = useState(null);
  const [running, setRunning] = useState(false);
  const [error, setError]     = useState('');

  const [saveOpen, setSaveOpen]   = useState(false);
  const [saveName, setSaveName]   = useState('');
  const [saveVisibility, setSaveVisibility] = useState('private');
  const [saving, setSaving]       = useState(false);

  // Live option lists for enum columns whose values come from a table (e.g.
  // active fund names) rather than a fixed set — fetched once per
  // module+field and cached here, keyed "module:field".
  const [dynamicOptions, setDynamicOptions] = useState({});

  useEffect(() => {
    if (!registry) return;
    const modCfg = registry[module];
    if (!modCfg) return;
    filters.forEach((f) => {
      const col = modCfg.columns[f.field];
      const key = `${module}:${f.field}`;
      if (col?.dynamicOptions && !(key in dynamicOptions)) {
        setDynamicOptions((prev) => ({ ...prev, [key]: null })); // null = fetch in flight, [] = fetched but empty
        api.get(`/custom-reports/options/${module}/${f.field}`)
          .then((r) => setDynamicOptions((prev) => ({ ...prev, [key]: r.data || [] })))
          .catch(() => {});
      }
    });
  }, [filters, module, registry]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    api.get('/custom-reports/modules').then((r) => {
      setRegistry(r.data);
      const first = Object.keys(r.data)[0];
      if (first) {
        setModule(first);
        setColumns(r.data[first].defaultColumns);
        setSort(r.data[first].defaultSort);
      }
    });
    loadSavedReports();
  }, []);

  function loadSavedReports() {
    api.get('/custom-reports').then((r) => setSaved(r.data)).catch(() => {});
  }

  function selectModule(mod) {
    setModule(mod);
    setColumns(registry[mod].defaultColumns);
    setFilters([]);
    setSort(registry[mod].defaultSort);
    setResult(null);
    setActiveReportId(null);
    setSaveName('');
    setSaveVisibility('private');
  }

  function toggleColumn(key) {
    setColumns((prev) => prev.includes(key) ? prev.filter((c) => c !== key) : [...prev, key]);
  }

  function addFilter() {
    const firstField = Object.keys(registry[module].columns)[0];
    setFilters((prev) => [...prev, newFilter(firstField, registry, module)]);
  }

  function updateFilter(idx, patch) {
    setFilters((prev) => prev.map((f, i) => i === idx ? { ...f, ...patch } : f));
  }

  function removeFilter(idx) {
    setFilters((prev) => prev.filter((_, i) => i !== idx));
  }

  const buildDefinition = useCallback(() => ({
    module, columns, filters, sort,
  }), [module, columns, filters, sort]);

  async function run() {
    setRunning(true);
    setError('');
    try {
      const { data } = await api.post('/custom-reports/run', buildDefinition());
      setResult(data);
    } catch (e) {
      setError(e.response?.data?.error || 'Failed to run report.');
    } finally {
      setRunning(false);
    }
  }

  async function exportCsv() {
    try {
      const res = await api.post('/custom-reports/run?format=csv', buildDefinition(), { responseType: 'blob' });
      const url = URL.createObjectURL(res.data);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${module}-report.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (e) {
      setError('Failed to export CSV.');
    }
  }

  async function saveReport() {
    if (!saveName.trim()) return;
    setSaving(true);
    try {
      const payload = { name: saveName.trim(), visibility: saveVisibility, ...buildDefinition() };
      if (activeReportId) {
        await api.put(`/custom-reports/${activeReportId}`, payload);
      } else {
        const { data } = await api.post('/custom-reports', payload);
        setActiveReportId(data.id);
      }
      setSaveOpen(false);
      setSaveName('');
      loadSavedReports();
    } catch (e) {
      setError(e.response?.data?.error || 'Failed to save report.');
    } finally {
      setSaving(false);
    }
  }

  async function loadReport(id) {
    const { data } = await api.get(`/custom-reports/${id}`);
    setModule(data.module);
    setColumns(data.columns_json);
    setFilters(data.filters_json || []);
    setSort(data.sort_json || registry[data.module].defaultSort);
    setActiveReportId(data.id);
    setSaveName(data.name);
    setSaveVisibility(data.visibility);
    setResult(null);
  }

  async function deleteReport(id, e) {
    e.stopPropagation();
    if (!window.confirm('Delete this saved report?')) return;
    await api.delete(`/custom-reports/${id}`);
    if (activeReportId === id) setActiveReportId(null);
    loadSavedReports();
  }

  if (!registry) return <div className="text-center py-5"><span className="spinner-border text-primary" /></div>;

  const modCfg = registry[module];

  return (
    <div>
      <PageHeader
        title="Report Builder"
        subtitle="Build and save custom reports from any module."
      />

      <div className="row">
        {/* Saved reports sidebar */}
        <div className="col-lg-3 mb-3">
          <div className="card h-100">
            <div className="card-header fw-semibold small">Saved Reports</div>
            <div className="list-group list-group-flush" style={{ maxHeight: 480, overflowY: 'auto' }}>
              {savedReports.length === 0 && (
                <div className="list-group-item text-muted small">No saved reports yet.</div>
              )}
              {savedReports.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  className={`list-group-item list-group-item-action d-flex justify-content-between align-items-start ${activeReportId === r.id ? 'active' : ''}`}
                  onClick={() => loadReport(r.id)}
                >
                  <span>
                    <span className="d-block fw-semibold small">{r.name}</span>
                    <span className="d-block text-muted" style={{ fontSize: 11 }}>
                      {registry[r.module]?.label || r.module} · {r.visibility === 'shared' ? 'Shared' : 'Private'}
                    </span>
                  </span>
                  <button
                    type="button"
                    className={`btn btn-sm py-0 px-1 ${activeReportId === r.id ? 'btn-outline-light' : 'btn-outline-danger'}`}
                    onClick={(e) => deleteReport(r.id, e)}
                    title="Delete"
                  >
                    <iconify-icon icon="solar:trash-bin-trash-line-duotone"></iconify-icon>
                  </button>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Builder */}
        <div className="col-lg-9">
          <div className="card mb-3">
            <div className="card-body">
              <div className="row g-3 mb-3">
                <div className="col-md-4">
                  <label className="form-label form-label-sm">Module</label>
                  <select className="form-select form-select-sm" value={module} onChange={(e) => selectModule(e.target.value)}>
                    {Object.entries(registry).map(([key, cfg]) => (
                      <option key={key} value={key}>{cfg.label}</option>
                    ))}
                  </select>
                </div>
                <div className="col-md-4">
                  <label className="form-label form-label-sm">Sort By</label>
                  <select
                    className="form-select form-select-sm"
                    value={sort?.field || ''}
                    onChange={(e) => setSort({ field: e.target.value, dir: sort?.dir || 'desc' })}
                  >
                    {Object.entries(modCfg.columns).map(([key, col]) => (
                      <option key={key} value={key}>{col.label}</option>
                    ))}
                  </select>
                </div>
                <div className="col-md-4">
                  <label className="form-label form-label-sm">Direction</label>
                  <select
                    className="form-select form-select-sm"
                    value={sort?.dir || 'desc'}
                    onChange={(e) => setSort({ field: sort?.field, dir: e.target.value })}
                  >
                    <option value="asc">Ascending</option>
                    <option value="desc">Descending</option>
                  </select>
                </div>
              </div>

              <label className="form-label form-label-sm">Columns</label>
              <div className="d-flex flex-wrap gap-2 mb-3">
                {Object.entries(modCfg.columns).map(([key, col]) => (
                  <label key={key} className="form-check form-check-inline border rounded px-2 py-1 m-0" style={{ fontSize: 13 }}>
                    <input
                      type="checkbox"
                      className="form-check-input"
                      checked={columns.includes(key)}
                      onChange={() => toggleColumn(key)}
                    />
                    <span className="form-check-label">{col.label}</span>
                  </label>
                ))}
              </div>

              <div className="d-flex justify-content-between align-items-center mb-2">
                <label className="form-label form-label-sm mb-0">Filters</label>
                <button className="btn btn-sm btn-outline-primary" onClick={addFilter}>
                  <iconify-icon icon="solar:add-circle-line-duotone" className="me-1"></iconify-icon>
                  Add Filter
                </button>
              </div>

              {filters.map((f, idx) => {
                const col = modCfg.columns[f.field];
                const ops = col?.operators || [];
                const needsValue = !['is_empty', 'is_not_empty'].includes(f.operator);
                const isBetween = f.operator === 'between';
                return (
                  <div key={idx} className="row g-2 align-items-center mb-2">
                    <div className="col-md-3">
                      <select
                        className="form-select form-select-sm"
                        value={f.field}
                        onChange={(e) => updateFilter(idx, newFilter(e.target.value, registry, module))}
                      >
                        {Object.entries(modCfg.columns).map(([key, c]) => (
                          <option key={key} value={key}>{c.label}</option>
                        ))}
                      </select>
                    </div>
                    <div className="col-md-3">
                      <select
                        className="form-select form-select-sm"
                        value={f.operator}
                        onChange={(e) => updateFilter(idx, { operator: e.target.value, value: e.target.value === 'between' ? ['', ''] : '' })}
                      >
                        {ops.map((op) => <option key={op} value={op}>{OPERATOR_LABELS[op] || op}</option>)}
                      </select>
                    </div>
                    {needsValue && !isBetween && col?.type === 'enum' && (
                      <div className="col-md-4">
                        <select className="form-select form-select-sm" value={f.value} onChange={(e) => updateFilter(idx, { value: e.target.value })}>
                          <option value="">
                            {col.dynamicOptions && dynamicOptions[`${module}:${f.field}`] == null ? 'Loading…' : 'Select…'}
                          </option>
                          {(col.dynamicOptions ? dynamicOptions[`${module}:${f.field}`] || [] : col.options || []).map((o) => (
                            <option key={o} value={o}>{o}</option>
                          ))}
                        </select>
                      </div>
                    )}
                    {needsValue && !isBetween && col?.type !== 'enum' && (
                      <div className="col-md-4">
                        <input
                          type={col?.type === 'date' ? 'date' : col?.type === 'number' || col?.type === 'currency' ? 'number' : 'text'}
                          className="form-control form-control-sm"
                          value={f.value}
                          onChange={(e) => updateFilter(idx, { value: e.target.value })}
                        />
                      </div>
                    )}
                    {isBetween && (
                      <div className="col-md-4 d-flex gap-1">
                        <input
                          type={col?.type === 'date' ? 'date' : 'number'}
                          className="form-control form-control-sm"
                          value={f.value?.[0] || ''}
                          onChange={(e) => updateFilter(idx, { value: [e.target.value, f.value?.[1] || ''] })}
                        />
                        <input
                          type={col?.type === 'date' ? 'date' : 'number'}
                          className="form-control form-control-sm"
                          value={f.value?.[1] || ''}
                          onChange={(e) => updateFilter(idx, { value: [f.value?.[0] || '', e.target.value] })}
                        />
                      </div>
                    )}
                    <div className="col-md-2">
                      <button className="btn btn-sm btn-outline-danger" onClick={() => removeFilter(idx)}>
                        <iconify-icon icon="solar:trash-bin-trash-line-duotone"></iconify-icon>
                      </button>
                    </div>
                  </div>
                );
              })}

              {error && <div className="alert alert-danger py-2 small mt-2">{error}</div>}

              <div className="d-flex gap-2 mt-3">
                <button className="btn btn-primary btn-sm" onClick={run} disabled={running || columns.length === 0}>
                  {running ? 'Running…' : 'Run Report'}
                </button>
                <button className="btn btn-outline-secondary btn-sm" onClick={() => setSaveOpen(true)} disabled={columns.length === 0}>
                  {activeReportId ? 'Update Saved Report' : 'Save Report'}
                </button>
                {result && (
                  <button className="btn btn-outline-secondary btn-sm" onClick={exportCsv}>
                    <iconify-icon icon="solar:download-minimalistic-line-duotone" className="me-1"></iconify-icon>
                    Export CSV
                  </button>
                )}
              </div>
            </div>
          </div>

          {result && (
            <div className="card">
              <div className="card-header d-flex justify-content-between align-items-center">
                <span className="fw-semibold small">Results</span>
                <span className="text-muted small">{result.total.toLocaleString()} row{result.total === 1 ? '' : 's'}{result.total > result.rows.length ? ` (showing first ${result.rows.length})` : ''}</span>
              </div>
              <div className="card-body p-0" style={{ overflowX: 'auto' }}>
                <table className="table table-sm table-hover mb-0">
                  <thead>
                    <tr>
                      {result.columns.map((c) => <th key={c}>{modCfg.columns[c]?.label || c}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {result.rows.length === 0 && (
                      <tr><td colSpan={result.columns.length} className="text-center text-muted py-4">No results.</td></tr>
                    )}
                    {result.rows.map((row, i) => (
                      <tr key={i}>
                        {result.columns.map((c) => <td key={c}>{fmtCell(row[c], modCfg.columns[c]?.type)}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>

      {saveOpen && (
        <div className="modal d-block" style={{ background: 'rgba(0,0,0,0.45)' }} onClick={(e) => { if (e.target === e.currentTarget) setSaveOpen(false); }}>
          <div className="modal-dialog modal-dialog-centered">
            <div className="modal-content">
              <div className="modal-header">
                <h6 className="modal-title mb-0">{activeReportId ? 'Update Report' : 'Save Report'}</h6>
                <button className="btn-close" onClick={() => setSaveOpen(false)} />
              </div>
              <div className="modal-body">
                <label className="form-label form-label-sm">Report Name</label>
                <input className="form-control form-control-sm mb-3" value={saveName} onChange={(e) => setSaveName(e.target.value)} placeholder="e.g. Open Deals by Stage" />
                <label className="form-label form-label-sm">Visibility</label>
                <select className="form-select form-select-sm" value={saveVisibility} onChange={(e) => setSaveVisibility(e.target.value)}>
                  <option value="private">Private — only visible to me</option>
                  <option value="shared">Shared — visible to the team</option>
                </select>
              </div>
              <div className="modal-footer">
                <button className="btn btn-sm btn-outline-secondary" onClick={() => setSaveOpen(false)}>Cancel</button>
                <button className="btn btn-sm btn-primary" onClick={saveReport} disabled={saving || !saveName.trim()}>
                  {saving ? 'Saving…' : 'Save'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
