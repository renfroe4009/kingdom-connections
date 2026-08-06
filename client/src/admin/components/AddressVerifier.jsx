import { useState } from 'react';
import api from '../../api/client.js';
import { useIntegrations } from '../context/IntegrationsContext.jsx';

/**
 * AddressVerifier
 * -----------------------------------------------------------------------------
 * Drop-in replacement for the six address inputs on a form. Calls the
 * USPS API on demand, shows the standardized result, and lets the user
 * accept it (which writes back into the parent form via onChange).
 *
 * Props:
 *   value    — { address_line1, address_line2, city, state, postal_code, country }
 *   onChange — receives the new value object whenever anything changes.
 *   compact  — optional; when true renders a tighter grid (for modals).
 */
export default function AddressVerifier({ value = {}, onChange, compact = false, requiredAddress = false }) {
  const { usps: uspsActive } = useIntegrations();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [result, setResult] = useState(null);
  const [verified, setVerified] = useState(false);

  const v = {
    address_line1: '', address_line2: '', city: '', state: '', postal_code: '', country: '',
    ...value,
  };

  function set(field, val) {
    setVerified(false);
    setResult(null);
    onChange?.({ ...v, [field]: val });
  }

  async function verify() {
    setErr(''); setResult(null); setBusy(true);
    try {
      const { data } = await api.post('/usps/verify-address', {
        address_line1: v.address_line1,
        address_line2: v.address_line2,
        city:          v.city,
        state:         v.state,
        postal_code:   v.postal_code,
      });
      setResult(data);
    } catch (e) {
      setErr(e.response?.data?.error || e.message || 'Verification failed.');
    } finally { setBusy(false); }
  }

  function accept() {
    if (!result?.formatted) return;
    onChange?.({ ...v, ...result.formatted });
    setVerified(true);
    setResult(null);
  }

  const canVerify = v.address_line1 && (v.postal_code || (v.city && v.state));
  const colCls = compact ? 'col-md-6' : 'col-md-6';

  const dpv = result?.dpvConfirmation;
  const dpvLabel = dpv === 'Y' ? 'Deliverable'
                 : dpv === 'S' ? 'Building OK, unit not confirmed'
                 : dpv === 'D' ? 'Missing unit'
                 : dpv === 'N' ? 'Not deliverable'
                 : dpv ? `DPV: ${dpv}` : null;
  const dpvClass = dpv === 'Y' ? 'success'
                 : dpv === 'S' || dpv === 'D' ? 'warning'
                 : dpv === 'N' ? 'danger' : 'secondary';

  return (
    <div className="address-verifier">
      <div className="row g-2">
        <div className="col-12 d-flex justify-content-between align-items-center mb-1">
          <h6 className="fw-bold text-uppercase small text-muted mb-0">Address</h6>
          <div className="d-flex gap-2 align-items-center">
            {verified && <span className="badge bg-success-subtle text-success">USPS verified</span>}
            {uspsActive && (
              <button type="button" className="btn btn-sm btn-light" onClick={verify} disabled={!canVerify || busy}>
                <iconify-icon icon="solar:map-point-wave-line-duotone" class="me-1"></iconify-icon>
                {busy ? 'Verifying…' : 'Verify with USPS'}
              </button>
            )}
          </div>
        </div>

        <div className={colCls}>
          <label className="form-label">
            Street{requiredAddress && <span className="text-danger ms-1">*</span>}
          </label>
          <input
            className={`form-control${requiredAddress && !v.address_line1?.trim() ? ' is-invalid' : ''}`}
            value={v.address_line1 || ''}
            onChange={(e) => set('address_line1', e.target.value)}
            placeholder="123 Main St"
          />
        </div>
        <div className={colCls}>
          <label className="form-label">Apt / Suite</label>
          <input className="form-control" value={v.address_line2 || ''} onChange={(e) => set('address_line2', e.target.value)} placeholder="Ste 200" />
        </div>
        <div className="col-md-5">
          <label className="form-label">City</label>
          <input className="form-control" value={v.city || ''} onChange={(e) => set('city', e.target.value)} />
        </div>
        <div className="col-md-2">
          <label className="form-label">State</label>
          <input className="form-control text-uppercase" maxLength={2} value={v.state || ''} onChange={(e) => set('state', e.target.value.toUpperCase())} placeholder="TX" />
        </div>
        <div className="col-md-3">
          <label className="form-label">ZIP</label>
          <input className="form-control" value={v.postal_code || ''} onChange={(e) => set('postal_code', e.target.value)} placeholder="75001" />
        </div>
        <div className="col-md-2">
          <label className="form-label">Country</label>
          <input className="form-control" value={v.country || ''} onChange={(e) => set('country', e.target.value)} placeholder="USA" />
        </div>
      </div>

      {err && (
        <div className="alert alert-warning mt-2 py-2 small mb-0">
          <iconify-icon icon="solar:danger-triangle-line-duotone" class="me-1"></iconify-icon>
          {err}
        </div>
      )}

      {result && (
        <div className="alert alert-info mt-2 mb-0 py-2">
          <div className="d-flex justify-content-between align-items-start">
            <div>
              <div className="fw-bold small mb-1">USPS-standardized address</div>
              <div className="small">
                {result.formatted.address_line1}
                {result.formatted.address_line2 ? `, ${result.formatted.address_line2}` : ''}
                <br />
                {result.formatted.city}, {result.formatted.state} {result.formatted.postal_code}
              </div>
              <div className="mt-1 d-flex gap-1 flex-wrap">
                {dpvLabel && <span className={`badge bg-${dpvClass}-subtle text-${dpvClass}`}>{dpvLabel}</span>}
                {result.business && <span className="badge bg-info-subtle text-info">Business</span>}
                {result.vacant && <span className="badge bg-warning-subtle text-warning">Vacant</span>}
                {(result.warnings || []).map((w, i) => (
                  <span key={i} className="badge bg-warning-subtle text-warning" title={w.text || w.code}>
                    {w.code || 'Notice'}
                  </span>
                ))}
              </div>
            </div>
            <div className="d-flex gap-2 ms-2">
              <button type="button" className="btn btn-sm btn-light" onClick={() => setResult(null)}>Keep mine</button>
              <button type="button" className="btn btn-sm btn-primary" onClick={accept}>Use this</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
