// =============================================================================
// VaultProfilesWidget — reusable saved payment methods panel.
// Used in admin ContactDetail, OrganizationDetail, and InvoiceDetail.
//
// Props:
//   contactId       int|null
//   organizationId  int|null
//   onSelectProfile fn(profile)|null   — if provided, shows radio-select UI
//   selectedId      int|null           — currently selected vault_profile_id
//   compact         bool               — hide Add card panel (read-only mode)
// =============================================================================
import { useEffect, useState } from 'react';
import api from '../../api/client.js';
import VaultCardSaveForm from './VaultCardSaveForm.jsx';
import { parseApiError } from '../../utils/apiError.js';
import { useConfirm } from '../../hooks/useConfirm.jsx';

const GATEWAY_LABEL = { valor: 'Valor PayTech', authnet: 'Authorize.Net' };

export default function VaultProfilesWidget({
  contactId      = null,
  organizationId = null,
  onSelectProfile = null,
  selectedId      = null,
  compact         = false,
}) {
  const [profiles,    setProfiles]    = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [error,       setError]       = useState('');
  const [actionErr,   setActionErr]   = useState('');
  const [busy,        setBusy]        = useState(null);
  const [showAdd,     setShowAdd]     = useState(false);
  const { confirm, dialog: confirmDialog } = useConfirm();

  const params = {};
  if (contactId)      params.contact_id      = contactId;
  if (organizationId) params.organization_id = organizationId;

  async function load() {
    if (!contactId && !organizationId) { setLoading(false); return; }
    setLoading(true); setError('');
    try {
      const { data } = await api.get('/vault/profiles', { params });
      setProfiles(data.profiles || []);
    } catch (e) {
      setError(e.response?.data?.error || 'Failed to load payment methods');
    } finally { setLoading(false); }
  }

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [contactId, organizationId]);

  async function setDefault(id) {
    setBusy(id); setActionErr('');
    try {
      await api.put(`/vault/profiles/${id}/default`);
      await load();
    } catch (e) {
      setActionErr(parseApiError(e, 'Failed'));
    } finally { setBusy(null); }
  }

  async function removeCard(id, last4) {
    if (!(await confirm(`Remove card ending in ${last4 || '????'}?`, { danger: true }))) return;
    setBusy(id); setActionErr('');
    try {
      await api.delete(`/vault/profiles/${id}`);
      await load();
      if (onSelectProfile && selectedId === id) onSelectProfile(null);
    } catch (e) {
      setActionErr(parseApiError(e, 'Failed'));
    } finally { setBusy(null); }
  }

  if (loading) return <div className="text-muted small py-2"><span className="spinner-border spinner-border-sm me-2"></span>Loading…</div>;
  if (error)   return <div className="alert alert-danger py-2 small">{error}</div>;

  return (
    <div>
      {actionErr && <div className="alert alert-danger py-2 small mb-2">{actionErr}</div>}

      {profiles.length === 0 && !showAdd && (
        <div className="text-muted small py-2">No saved payment methods.</div>
      )}

      {profiles.length > 0 && (
        <div className="d-flex flex-column gap-2 mb-3">
          {profiles.map((p) => (
            <div
              key={p.id}
              className={`border rounded p-2 d-flex align-items-center justify-content-between gap-2
                ${onSelectProfile && selectedId === p.id ? 'border-primary bg-primary-subtle' : ''}
                ${p.is_default ? 'border-warning' : ''}`}
              style={{ cursor: onSelectProfile ? 'pointer' : 'default' }}
              onClick={() => onSelectProfile && onSelectProfile(p)}
            >
              <div className="d-flex align-items-center gap-2">
                {onSelectProfile && (
                  <input
                    type="radio"
                    name="vault_profile"
                    checked={selectedId === p.id}
                    onChange={() => onSelectProfile(p)}
                    onClick={(e) => e.stopPropagation()}
                  />
                )}
                <iconify-icon icon="solar:card-line-duotone" style={{ fontSize: 20, color: 'var(--secondary)' }}></iconify-icon>
                <div>
                  <div className="fw-semibold small">
                    {p.card_brand ? `${p.card_brand.charAt(0).toUpperCase()}${p.card_brand.slice(1)} ` : ''}
                    ****&nbsp;{p.last4 || '????'}
                    {p.nickname && <span className="text-muted fw-normal ms-1">"{p.nickname}"</span>}
                    {p.is_default && <span className="badge bg-warning text-dark ms-2" style={{ fontSize: 10 }}>Default</span>}
                  </div>
                  <div className="text-muted" style={{ fontSize: 11 }}>
                    {p.expiry ? `Exp ${p.expiry}` : ''}
                    {p.expiry && p.cardholder_name ? ' · ' : ''}
                    {p.cardholder_name || ''}
                    {(p.expiry || p.cardholder_name) && GATEWAY_LABEL[p.gateway] ? ' · ' : ''}
                    {GATEWAY_LABEL[p.gateway] || p.gateway}
                  </div>
                </div>
              </div>

              {!compact && (
                <div className="d-flex gap-1" onClick={(e) => e.stopPropagation()}>
                  {!p.is_default && (
                    <button
                      className="btn btn-sm btn-outline-secondary"
                      style={{ fontSize: 11 }}
                      disabled={busy === p.id}
                      onClick={() => setDefault(p.id)}
                      title="Set as default"
                    >
                      {busy === p.id ? <span className="spinner-border spinner-border-sm"></span> : 'Default'}
                    </button>
                  )}
                  <button
                    className="btn btn-sm btn-outline-danger"
                    disabled={busy === p.id}
                    onClick={() => removeCard(p.id, p.last4)}
                    title="Remove"
                  >
                    <iconify-icon icon="solar:trash-bin-minimalistic-line-duotone"></iconify-icon>
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {!compact && (
        showAdd ? (
          <VaultCardSaveForm
            contactId={contactId}
            organizationId={organizationId}
            onSaved={() => { setShowAdd(false); load(); }}
            onCancel={() => setShowAdd(false)}
          />
        ) : (
          <button
            className="btn btn-sm btn-outline-primary"
            onClick={() => { setShowAdd(true); setActionErr(''); }}
          >
            <iconify-icon icon="solar:add-square-line-duotone" class="me-1"></iconify-icon>
            Add card
          </button>
        )
      )}

      {confirmDialog}
    </div>
  );
}
