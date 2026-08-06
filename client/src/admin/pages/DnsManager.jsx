import { useState, useEffect, useCallback } from 'react';
import api from '../../api/client.js';
import PageHeader from '../../components/PageHeader.jsx';

// ---------------------------------------------------------------------------
// Cloudflare Account Settings Modal
// ---------------------------------------------------------------------------
function AccountSettingsModal({ onSaved, onClose }) {
  const [token,   setToken]   = useState('');
  const [show,    setShow]    = useState(false);
  const [saving,  setSaving]  = useState(false);
  const [err,     setErr]     = useState('');

  useEffect(() => {
    api.get('/dns/account')
      .then(({ data }) => setToken(data.api_token || ''))
      .catch(() => {});
  }, []);

  async function save() {
    if (!token.trim()) { setErr('API token is required'); return; }
    setSaving(true);
    setErr('');
    try {
      await api.put('/dns/account', { api_token: token });
      onSaved();
    } catch (e) {
      setErr(e.response?.data?.error || 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="modal d-block"
      style={{ background: 'rgba(0,0,0,0.45)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="modal-dialog modal-dialog-centered">
        <div className="modal-content">
          <div className="modal-header">
            <h5 className="modal-title">
              <iconify-icon icon="solar:cloud-check-line-duotone" class="me-2" style={{ color: 'var(--secondary)' }} />
              Cloudflare Account Settings
            </h5>
            <button type="button" className="btn-close" onClick={onClose} />
          </div>
          <div className="modal-body">
            <p className="text-muted small mb-3">
              Get your API token from Cloudflare Dashboard → My Profile → API Tokens.
              Use the <strong>Edit zone DNS</strong> template and grant access to all zones you want to manage.
            </p>
            <label className="form-label fw-semibold">API Token</label>
            <div className="input-group">
              <input
                type={show ? 'text' : 'password'}
                className="form-control font-monospace"
                placeholder="Paste your Cloudflare API token"
                value={token}
                onChange={(e) => { setToken(e.target.value); setErr(''); }}
                autoComplete="new-password"
                name="cf-api-token"
              />
              <button
                type="button"
                className="btn btn-outline-secondary"
                onClick={() => setShow((s) => !s)}
                tabIndex={-1}
              >
                <iconify-icon icon={show ? 'solar:eye-closed-line-duotone' : 'solar:eye-line-duotone'} />
              </button>
            </div>
            {err && <p className="text-danger small mt-2 mb-0">{err}</p>}
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
            <button type="button" className="btn btn-primary" onClick={save} disabled={saving}>
              {saving
                ? <><span className="spinner-border spinner-border-sm me-1" />Saving…</>
                : 'Save Token'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

const DNS_TYPES = ['A', 'AAAA', 'CNAME', 'MX', 'TXT', 'NS', 'SRV', 'CAA', 'PTR'];

const EMPTY_RECORD = {
  type: 'A',
  name: '',
  content: '',
  ttl: 1,
  proxied: false,
  priority: '',
};

function ttlLabel(ttl) {
  if (ttl === 1) return 'Auto';
  if (ttl < 60)  return `${ttl}s`;
  if (ttl < 3600) return `${Math.round(ttl / 60)}m`;
  return `${Math.round(ttl / 3600)}h`;
}

const SECURITY_LEVELS = [
  { value: 'essentially_off', label: 'Essentially Off',  badge: 'bg-secondary', desc: 'Only challenge IPs with the worst reputation' },
  { value: 'low',             label: 'Low',              badge: 'bg-info text-dark', desc: 'Challenge only threatening visitors' },
  { value: 'medium',          label: 'Medium',           badge: 'bg-primary', desc: 'Challenge both moderate and high-threat visitors' },
  { value: 'high',            label: 'High',             badge: 'bg-warning text-dark', desc: 'Challenge all visitors that have exhibited threatening behavior' },
  { value: 'under_attack',    label: 'Under Attack',     badge: 'bg-danger', desc: '5s JS challenge for every visitor — use only during active DDoS' },
];

// ---------------------------------------------------------------------------
// Zone Security Panel
// ---------------------------------------------------------------------------
function SecurityPanel({ zoneId }) {
  const [level,   setLevel]   = useState(null);
  const [loading, setLoading] = useState(false);
  const [saving,  setSaving]  = useState(false);
  const [err,     setErr]     = useState('');

  useEffect(() => {
    if (!zoneId) return;
    setLoading(true);
    setErr('');
    api.get(`/dns/zones/${zoneId}/security`)
      .then(({ data }) => setLevel(data.security_level))
      .catch((e) => setErr(e.response?.data?.error || e.response?.data?.message || 'Could not load security settings'))
      .finally(() => setLoading(false));
  }, [zoneId]);

  async function setSecurityLevel(value) {
    setSaving(true);
    setErr('');
    try {
      await api.patch(`/dns/zones/${zoneId}/security`, { security_level: value });
      setLevel(value);
    } catch (e) {
      setErr(e.response?.data?.error || 'Failed to update security level');
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="text-muted small py-2"><span className="spinner-border spinner-border-sm me-1" />Loading security settings…</div>;
  if (err && !level) return <div className="alert alert-danger py-2 small mb-3">{err}</div>;
  if (!level) return null;

  const current = SECURITY_LEVELS.find((l) => l.value === level);
  const isUnderAttack = level === 'under_attack';

  return (
    <div className={`card mb-3 ${isUnderAttack ? 'border-danger border-2' : ''}`}>
      <div className="card-body py-2 px-3">
        <div className="d-flex flex-wrap gap-3 align-items-center">
          <span className="fw-semibold small text-muted text-uppercase" style={{ letterSpacing: '.05em', flexShrink: 0 }}>
            <iconify-icon icon="solar:shield-check-line-duotone" class="me-1" />
            Security Level
          </span>

          <span className={`badge ${current?.badge || 'bg-secondary'}`}>{current?.label || level}</span>
          <span className="text-muted small d-none d-md-inline">{current?.desc}</span>

          <div className="ms-auto d-flex align-items-center gap-2 flex-wrap">
            {err && <span className="text-danger small">{err}</span>}

            {isUnderAttack ? (
              <button
                className="btn btn-sm btn-outline-success fw-semibold"
                disabled={saving}
                onClick={() => setSecurityLevel('medium')}
              >
                {saving
                  ? <span className="spinner-border spinner-border-sm me-1" />
                  : <iconify-icon icon="solar:shield-check-line-duotone" class="me-1" />}
                Disable Under Attack
              </button>
            ) : (
              <button
                className="btn btn-sm btn-danger fw-semibold"
                disabled={saving}
                onClick={() => setSecurityLevel('under_attack')}
              >
                {saving
                  ? <span className="spinner-border spinner-border-sm me-1" />
                  : <iconify-icon icon="solar:danger-triangle-bold" class="me-1" />}
                Enable Under Attack
              </button>
            )}

            <select
              className={`form-select form-select-sm ${isUnderAttack ? 'border-danger' : ''}`}
              style={{ width: 'auto' }}
              value={level}
              disabled={saving}
              onChange={(e) => setSecurityLevel(e.target.value)}
            >
              {SECURITY_LEVELS.map((l) => (
                <option key={l.value} value={l.value}>{l.label}</option>
              ))}
            </select>
            {saving && <span className="spinner-border spinner-border-sm text-primary" />}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Record Form (shared for Add and Edit)
// ---------------------------------------------------------------------------
function RecordForm({ value, onChange }) {
  const needsPriority = value.type === 'MX' || value.type === 'SRV';
  const canProxy = ['A', 'AAAA', 'CNAME'].includes(value.type);

  return (
    <div className="d-flex flex-column gap-3">
      <div className="row g-2">
        <div className="col-4">
          <label className="form-label">Type</label>
          <select
            className="form-select"
            value={value.type}
            onChange={(e) => onChange({ ...value, type: e.target.value, proxied: false })}
          >
            {DNS_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div className="col-8">
          <label className="form-label">Name</label>
          <input
            type="text"
            className="form-control font-monospace"
            placeholder="@ or subdomain"
            value={value.name}
            onChange={(e) => onChange({ ...value, name: e.target.value })}
          />
        </div>
      </div>

      <div>
        <label className="form-label">
          {value.type === 'MX' ? 'Mail Server' : value.type === 'TXT' ? 'Value' : 'Content'}
        </label>
        <input
          type="text"
          className="form-control font-monospace"
          placeholder={value.type === 'A' ? '1.2.3.4' : value.type === 'CNAME' ? 'target.example.com' : ''}
          value={value.content}
          onChange={(e) => onChange({ ...value, content: e.target.value })}
        />
      </div>

      <div className="row g-2">
        {needsPriority && (
          <div className="col-4">
            <label className="form-label">Priority</label>
            <input
              type="number"
              className="form-control"
              min={0}
              placeholder="10"
              value={value.priority}
              onChange={(e) => onChange({ ...value, priority: e.target.value })}
            />
          </div>
        )}
        <div className={needsPriority ? 'col-4' : 'col-6'}>
          <label className="form-label">TTL</label>
          <select
            className="form-select"
            value={value.ttl}
            onChange={(e) => onChange({ ...value, ttl: Number(e.target.value) })}
          >
            <option value={1}>Auto</option>
            <option value={60}>1 minute</option>
            <option value={300}>5 minutes</option>
            <option value={3600}>1 hour</option>
            <option value={86400}>1 day</option>
          </select>
        </div>
        {canProxy && (
          <div className={needsPriority ? 'col-4' : 'col-6'} style={{ paddingTop: 36 }}>
            <div className="form-check">
              <input
                type="checkbox"
                className="form-check-input"
                id="proxied"
                checked={!!value.proxied}
                onChange={(e) => onChange({ ...value, proxied: e.target.checked })}
              />
              <label className="form-check-label" htmlFor="proxied">
                <iconify-icon icon="solar:cloud-line-duotone" className="me-1" />
                Proxied (orange cloud)
              </label>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Add / Edit Record Modal
// ---------------------------------------------------------------------------
function RecordModal({ record, zoneId, onSave, onClose }) {
  const isEdit = !!record?.id;
  const [form, setForm] = useState(
    isEdit
      ? { type: record.type, name: record.name, content: record.content, ttl: record.ttl, proxied: record.proxied, priority: record.priority || '' }
      : EMPTY_RECORD
  );
  const [saving, setSaving] = useState(false);
  const [err,    setErr]    = useState('');

  async function save() {
    if (!form.name.trim() || !form.content.trim()) { setErr('Name and content are required.'); return; }
    setSaving(true);
    setErr('');
    try {
      const payload = { ...form, ttl: Number(form.ttl) };
      if (form.priority !== '' && form.priority !== undefined) payload.priority = Number(form.priority);
      if (isEdit) {
        const { data } = await api.put(`/dns/zones/${zoneId}/records/${record.id}`, payload);
        onSave(data);
      } else {
        const { data } = await api.post(`/dns/zones/${zoneId}/records`, payload);
        onSave(data);
      }
    } catch (e) {
      setErr(e.response?.data?.error || e.response?.data?.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="modal d-block"
      style={{ background: 'rgba(0,0,0,0.45)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="modal-dialog modal-lg modal-dialog-centered">
        <div className="modal-content">
          <div className="modal-header">
            <h5 className="modal-title">{isEdit ? 'Edit DNS Record' : 'Add DNS Record'}</h5>
            <button type="button" className="btn-close" onClick={onClose} />
          </div>
          <div className="modal-body">
            <RecordForm value={form} onChange={setForm} />
            {err && <p className="text-danger small mt-3 mb-0">{err}</p>}
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
            <button type="button" className="btn btn-primary" onClick={save} disabled={saving}>
              {saving ? <><span className="spinner-border spinner-border-sm me-1" />Saving…</> : isEdit ? 'Update Record' : 'Add Record'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// DNS Manager Page
// ---------------------------------------------------------------------------
export default function DnsManager() {
  const [zones,          setZones]          = useState([]);
  const [zoneId,         setZoneId]         = useState('');
  const [records,        setRecords]        = useState([]);
  const [loading,        setLoading]        = useState(false);
  const [zonesLoading,   setZonesLoading]   = useState(true);
  const [filter,         setFilter]         = useState('');
  const [typeFilter,     setTypeFilter]     = useState('');
  const [modal,          setModal]          = useState(null); // null | 'add' | record obj
  const [deleting,       setDeleting]       = useState(null);
  const [msg,            setMsg]            = useState('');
  const [cfMissing,      setCfMissing]      = useState(false);
  const [primaryZone,    setPrimaryZone]    = useState('');
  const [settingPrimary, setSettingPrimary] = useState(false);
  const [acctModal,      setAcctModal]      = useState(false);
  const [refreshKey,     setRefreshKey]     = useState(0);

  useEffect(() => {
    setZonesLoading(true);
    setCfMissing(false);
    (async () => {
      try {
        const { data } = await api.get('/dns/zones');
        setZones(data.zones || []);
        const def = data.defaultZone || data.zones?.[0]?.id || '';
        setZoneId(def);
        setPrimaryZone(data.defaultZone || '');
      } catch (e) {
        if (e.response?.status === 503) setCfMissing(true);
      } finally {
        setZonesLoading(false);
      }
    })();
  }, [refreshKey]);

  const loadRecords = useCallback(async (zId) => {
    if (!zId) return;
    setLoading(true);
    try {
      const { data } = await api.get(`/dns/zones/${zId}/records`);
      setRecords(data.records || []);
    } catch (e) {
      setMsg(e.response?.data?.error || 'Failed to load records');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { if (zoneId) loadRecords(zoneId); }, [zoneId, loadRecords]);

  async function setAsPrimary() {
    setSettingPrimary(true);
    try {
      await api.put('/dns/primary-zone', { zoneId });
      setPrimaryZone(zoneId);
      setMsg(`${zones.find(z => z.id === zoneId)?.name} set as primary analytics domain.`);
    } catch (e) {
      setMsg(e.response?.data?.error || 'Failed to set primary zone');
    } finally {
      setSettingPrimary(false);
    }
  }

  async function deleteRecord(record) {
    if (!window.confirm(`Delete ${record.type} record "${record.name}"?`)) return;
    setDeleting(record.id);
    try {
      await api.delete(`/dns/zones/${zoneId}/records/${record.id}`);
      setRecords((prev) => prev.filter((r) => r.id !== record.id));
      setMsg('Record deleted.');
    } catch (e) {
      setMsg(e.response?.data?.error || 'Delete failed');
    } finally {
      setDeleting(null);
    }
  }

  function handleSave(saved) {
    setRecords((prev) => {
      const idx = prev.findIndex((r) => r.id === saved.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = saved;
        return next;
      }
      return [...prev, saved];
    });
    setModal(null);
    setMsg('Record saved.');
  }

  const filtered = records.filter((r) => {
    if (typeFilter && r.type !== typeFilter) return false;
    if (filter) {
      const q = filter.toLowerCase();
      return r.name?.toLowerCase().includes(q) || r.content?.toLowerCase().includes(q);
    }
    return true;
  });

  const typesInUse = [...new Set(records.map((r) => r.type))].sort();

  if (zonesLoading) return <div className="text-center py-5"><span className="spinner-border text-primary" /></div>;

  if (cfMissing) {
    return (
      <div>
        <PageHeader title="DNS Management" />
        <div className="alert alert-warning">
          <div className="d-flex align-items-start gap-3">
            <iconify-icon icon="solar:cloud-line-duotone" style={{ fontSize: 28, flexShrink: 0, marginTop: 2 }} />
            <div>
              <h6 className="fw-bold mb-1">Cloudflare account not connected</h6>
              <p className="mb-3 small text-muted">
                Enter your Cloudflare API token to manage DNS records for this customer's zones.
              </p>
              <button
                className="btn btn-sm btn-warning fw-semibold"
                onClick={() => setAcctModal(true)}
              >
                <iconify-icon icon="solar:settings-line-duotone" class="me-1" />
                Connect Cloudflare Account
              </button>
            </div>
          </div>
        </div>
        {acctModal && (
          <AccountSettingsModal
            onSaved={() => { setAcctModal(false); setRefreshKey((k) => k + 1); }}
            onClose={() => setAcctModal(false)}
          />
        )}
      </div>
    );
  }

  if (!zones.length) {
    return (
      <div>
        <PageHeader title="DNS Management" />
        <div className="alert alert-info">No Cloudflare zones found for this API token.</div>
      </div>
    );
  }

  const selectedZone = zones.find((z) => z.id === zoneId);

  return (
    <div>
      <PageHeader
        title="DNS Management"
        subtitle={selectedZone ? `Zone: ${selectedZone.name}` : ''}
        actions={
          <button
            className="btn btn-primary btn-sm"
            onClick={() => setModal('add')}
          >
            <iconify-icon icon="solar:add-circle-line-duotone" className="me-1" />
            Add Record
          </button>
        }
      />

      {msg && (
        <div className={`alert py-2 ${msg.toLowerCase().includes('fail') || msg.toLowerCase().includes('error') ? 'alert-danger' : 'alert-success'} d-flex justify-content-between align-items-center`}>
          <span>{msg}</span>
          <button type="button" className="btn-close btn-sm" onClick={() => setMsg('')} />
        </div>
      )}

      {/* Zone selector + filters */}
      <div className="d-flex flex-wrap gap-2 mb-3 align-items-center">
        <select
          className="form-select form-select-sm"
          style={{ maxWidth: 220 }}
          value={zoneId}
          onChange={(e) => setZoneId(e.target.value)}
        >
          {zones.map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}
        </select>
        <button
          className="btn btn-sm btn-outline-secondary"
          onClick={() => setAcctModal(true)}
          title="Cloudflare account settings"
        >
          <iconify-icon icon="solar:settings-line-duotone" />
        </button>
        {zoneId && zoneId !== primaryZone && (
          <button
            className="btn btn-sm btn-outline-primary"
            onClick={setAsPrimary}
            disabled={settingPrimary}
            title="Use this domain for Cloudflare analytics in Reports"
          >
            {settingPrimary
              ? <span className="spinner-border spinner-border-sm" />
              : <><iconify-icon icon="solar:star-line-duotone" class="me-1" />Set as primary</>
            }
          </button>
        )}
        {zoneId && zoneId === primaryZone && (
          <span className="badge bg-success-subtle text-success border border-success-subtle">
            <iconify-icon icon="solar:star-bold" class="me-1" />Primary analytics domain
          </span>
        )}
        <div className="d-flex align-items-center gap-1 ms-auto">
          {typesInUse.map((t) => (
            <button
              key={t}
              className={`btn btn-sm ${typeFilter === t ? 'btn-primary' : 'btn-outline-secondary'}`}
              onClick={() => setTypeFilter(typeFilter === t ? '' : t)}
            >
              {t}
            </button>
          ))}
          <input
            type="search"
            className="form-control form-control-sm"
            style={{ maxWidth: 200 }}
            placeholder="Filter…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </div>
      </div>

      {/* Security toggles */}
      {zoneId && <SecurityPanel zoneId={zoneId} />}

      {/* Records table */}
      {loading ? (
        <div className="text-center py-5"><span className="spinner-border text-primary" /></div>
      ) : (
        <div className="card">
          <div className="table-responsive">
            <table className="table table-hover align-middle mb-0">
              <thead className="table-light">
                <tr>
                  <th style={{ width: 70 }}>Type</th>
                  <th>Name</th>
                  <th>Content</th>
                  <th style={{ width: 80 }}>TTL</th>
                  <th style={{ width: 90 }}>Proxy</th>
                  <th style={{ width: 110 }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={6} className="text-center text-muted py-4">No records found</td>
                  </tr>
                )}
                {filtered.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <span className="badge bg-secondary">{r.type}</span>
                    </td>
                    <td className="font-monospace small text-truncate" style={{ maxWidth: 200 }}>
                      {r.name}
                    </td>
                    <td className="font-monospace small text-muted text-truncate" style={{ maxWidth: 280 }}>
                      {r.content}
                      {r.priority !== undefined ? ` (priority: ${r.priority})` : ''}
                    </td>
                    <td className="small text-muted">{ttlLabel(r.ttl)}</td>
                    <td>
                      {r.proxied
                        ? <span style={{ color: '#f6821f' }} title="Proxied by Cloudflare"><iconify-icon icon="solar:cloud-bold" /> On</span>
                        : <span className="text-muted"><iconify-icon icon="solar:cloud-line-duotone" /> Off</span>
                      }
                    </td>
                    <td>
                      <button
                        className="btn btn-sm btn-light me-1"
                        title="Edit"
                        onClick={() => setModal(r)}
                      >
                        <iconify-icon icon="solar:pen-line-duotone" />
                      </button>
                      <button
                        className="btn btn-sm btn-light text-danger"
                        title="Delete"
                        disabled={deleting === r.id}
                        onClick={() => deleteRecord(r)}
                      >
                        {deleting === r.id
                          ? <span className="spinner-border spinner-border-sm" />
                          : <iconify-icon icon="solar:trash-bin-trash-line-duotone" />
                        }
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {filtered.length > 0 && (
            <div className="card-footer text-muted small">
              {filtered.length} record{filtered.length !== 1 ? 's' : ''} {filter || typeFilter ? '(filtered)' : ''}
            </div>
          )}
        </div>
      )}

      {modal === 'add' && (
        <RecordModal zoneId={zoneId} onSave={handleSave} onClose={() => setModal(null)} />
      )}
      {modal && modal !== 'add' && (
        <RecordModal record={modal} zoneId={zoneId} onSave={handleSave} onClose={() => setModal(null)} />
      )}
      {acctModal && (
        <AccountSettingsModal
          onSaved={() => { setAcctModal(false); setRefreshKey((k) => k + 1); }}
          onClose={() => setAcctModal(false)}
        />
      )}
    </div>
  );
}
