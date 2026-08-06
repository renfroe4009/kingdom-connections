// SavedPaymentMethods — reusable component that shows stored vault profiles
// for a contact or org, and lets users add a new card via Passage.js.
//
// Props:
//   contactId       int | null
//   organizationId  int | null
//   selectable      bool  — renders radio buttons so a recurring invoice can
//                           pick which profile to auto-charge
//   selectedId      int | null   — controlled value when selectable=true
//   onSelect        fn(profile)  — called when a profile is selected
//   readOnly        bool  — hides Add / Delete / Default actions

import { useEffect, useState } from 'react';
import api from '../../api/client.js';
import Modal from '../../components/Modal.jsx';
import PassageCardForm from './PassageCardForm.jsx';
import { toast } from '../../components/Toast.jsx';
import { parseApiError } from '../../utils/apiError.js';
import { useConfirm } from '../../hooks/useConfirm.jsx';
import { useAuth } from '../../auth/AuthContext.jsx';

const BRAND_ICON = {
  visa:       'solar:card-line-duotone',
  mastercard: 'solar:card-line-duotone',
  amex:       'solar:card-line-duotone',
  discover:   'solar:card-line-duotone',
  default:    'solar:card-line-duotone',
};

const GW_LABEL = { valor: 'Valor', authnet: 'Auth.net' };

export default function SavedPaymentMethods({
  contactId,
  organizationId,
  selectable = false,
  selectedId = null,
  onSelect,
  readOnly = false,
}) {
  const { can } = useAuth();
  const canWrite = !readOnly && can('payments.write');
  const { confirm, dialog: confirmDialog } = useConfirm();

  const [profiles, setProfiles]   = useState([]);
  const [loadErr, setLoadErr]     = useState('');
  const [showAdd, setShowAdd]     = useState(false);
  const [deleting, setDeleting]   = useState(null);
  const [settingDefault, setSettingDefault] = useState(null);

  async function load() {
    if (!contactId && !organizationId) return;
    setLoadErr('');
    try {
      const params = {};
      if (contactId)      params.contact_id      = contactId;
      if (organizationId) params.organization_id = organizationId;
      const { data } = await api.get('/vault/profiles', { params });
      setProfiles(data.profiles || []);
    } catch (e) {
      setLoadErr(e.response?.data?.error || 'Could not load saved payment methods.');
    }
  }

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [contactId, organizationId]);

  function handleSaved(profile) {
    setShowAdd(false);
    load();
    if (selectable && onSelect) onSelect(profile);
  }

  async function handleDelete(id) {
    if (!(await confirm('Remove this payment method?', { danger: true }))) return;
    setDeleting(id);
    try {
      await api.delete(`/vault/profiles/${id}`);
      setProfiles((p) => p.filter((x) => x.id !== id));
    } catch (e) {
      toast(parseApiError(e, 'Could not remove payment method.'), 'error');
    } finally { setDeleting(null); }
  }

  async function handleSetDefault(id) {
    setSettingDefault(id);
    try {
      await api.put(`/vault/profiles/${id}/default`);
      await load();
    } catch (e) {
      toast(parseApiError(e, 'Could not set default.'), 'error');
    } finally { setSettingDefault(null); }
  }

  return (
    <div>
      {loadErr && <div className="alert alert-warning py-2 small">{loadErr}</div>}

      {profiles.length === 0 && !loadErr && (
        <div className="text-muted small py-2">No saved payment methods yet.</div>
      )}

      {profiles.length > 0 && (
        <div className="list-group list-group-flush mb-2">
          {profiles.map((p) => {
            const isSelected = selectable && selectedId === p.id;
            return (
              <div
                key={p.id}
                className={`list-group-item list-group-item-action px-0 py-2 d-flex align-items-center gap-2
                  ${isSelected ? 'bg-primary-subtle' : ''}`}
                style={{ cursor: selectable ? 'pointer' : 'default' }}
                onClick={() => selectable && onSelect && onSelect(p)}
              >
                {/* Radio for selectable mode */}
                {selectable && (
                  <input
                    type="radio"
                    className="form-check-input ms-1"
                    readOnly
                    checked={isSelected}
                    onChange={() => onSelect && onSelect(p)}
                  />
                )}

                {/* Card icon */}
                <iconify-icon
                  icon={BRAND_ICON[String(p.card_brand || '').toLowerCase()] || BRAND_ICON.default}
                  class="fs-4 text-secondary flex-shrink-0"
                ></iconify-icon>

                {/* Card info */}
                <div className="flex-grow-1 small">
                  <div className="fw-semibold">
                    {p.card_brand
                      ? `${p.card_brand.charAt(0).toUpperCase() + p.card_brand.slice(1)} ••••${p.last4 || '????'}`
                      : `••••${p.last4 || '????'}`}
                    {p.nickname && (
                      <span className="ms-2 text-muted fw-normal">({p.nickname})</span>
                    )}
                  </div>
                  <div className="text-muted" style={{ fontSize: '0.75rem' }}>
                    {p.cardholder_name || ''}
                    {p.expiry ? ` · Exp ${p.expiry}` : ''}
                    {' · '}
                    <span className="text-uppercase">{GW_LABEL[p.gateway] || p.gateway}</span>
                    {p.payment_method === 'ach' && ' · ACH'}
                  </div>
                </div>

                {/* Default badge */}
                {p.is_default ? (
                  <span className="badge bg-success-subtle text-success flex-shrink-0">Default</span>
                ) : (
                  canWrite && !selectable && (
                    <button
                      className="btn btn-sm btn-light text-muted py-0 flex-shrink-0"
                      style={{ fontSize: '0.7rem' }}
                      disabled={settingDefault === p.id}
                      onClick={(e) => { e.stopPropagation(); handleSetDefault(p.id); }}
                    >
                      {settingDefault === p.id ? '…' : 'Set default'}
                    </button>
                  )
                )}

                {/* Delete */}
                {canWrite && !selectable && (
                  <button
                    className="btn btn-sm btn-light text-danger py-0 flex-shrink-0"
                    disabled={deleting === p.id}
                    onClick={(e) => { e.stopPropagation(); handleDelete(p.id); }}
                    title="Remove"
                  >
                    {deleting === p.id
                      ? <span className="spinner-border spinner-border-sm"></span>
                      : <iconify-icon icon="solar:trash-bin-trash-line-duotone"></iconify-icon>}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {canWrite && (
        <button
          className="btn btn-sm btn-outline-primary"
          onClick={() => setShowAdd(true)}
        >
          <iconify-icon icon="solar:add-circle-line-duotone" class="me-1"></iconify-icon>
          Add payment method
        </button>
      )}

      <Modal
        show={showAdd}
        onClose={() => setShowAdd(false)}
        title="Add Payment Method"
        size="md"
        footer={null}
      >
        <PassageCardForm
          contactId={contactId}
          organizationId={organizationId}
          onSaved={handleSaved}
          onCancel={() => setShowAdd(false)}
        />
      </Modal>

      {confirmDialog}
    </div>
  );
}
