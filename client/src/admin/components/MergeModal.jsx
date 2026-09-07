import { useEffect, useMemo, useState } from 'react';
import api from '../../api/client.js';
import Modal from '../../components/Modal.jsx';
import { toast } from '../../components/Toast.jsx';
import { parseApiError } from '../../utils/apiError.js';

const CONTACT_FIELDS = [
  { key: 'first_name', label: 'First name' },
  { key: 'last_name', label: 'Last name' },
  { key: 'email', label: 'Email' },
  { key: 'phone', label: 'Phone' },
  { key: 'mobile', label: 'Mobile' },
  { key: 'title', label: 'Title' },
  { key: 'lifecycle_stage', label: 'Lifecycle stage' },
];

const ORG_FIELDS = [
  { key: 'name', label: 'Name' },
  { key: 'website', label: 'Website' },
  { key: 'phone', label: 'Phone' },
  { key: 'industry', label: 'Industry' },
  { key: 'city', label: 'City' },
  { key: 'state', label: 'State' },
];

const displayName = (entityType, r) =>
  entityType === 'contact' ? `${r.first_name || ''} ${r.last_name || ''}`.trim() || `#${r.id}` : r.name || `#${r.id}`;

/**
 * Side-by-side merge review for two contact or organization records.
 * `recordA`/`recordB` need only `id` plus whatever display fields the
 * FIELDS list above reads — callers pass list-row shape or a full detail
 * fetch, both work. Record A is the default survivor; the user can flip it.
 */
export default function MergeModal({ entityType, recordA, recordB, onClose, onMerged }) {
  const fields = entityType === 'contact' ? CONTACT_FIELDS : ORG_FIELDS;
  const base = entityType === 'contact' ? '/contacts' : '/organizations';

  const [survivorSide, setSurvivorSide] = useState('A');
  const [fieldChoices, setFieldChoices] = useState(() => {
    const init = {};
    for (const f of fields) {
      init[f.key] = recordA[f.key] ? 'A' : (recordB[f.key] ? 'B' : 'A');
    }
    return init;
  });
  const [previewA, setPreviewA] = useState(null);
  const [previewB, setPreviewB] = useState(null);
  const [confirmLogin, setConfirmLogin] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get(`${base}/${recordA.id}/merge-preview`).then((r) => setPreviewA(r.data)).catch(() => setPreviewA({}));
    api.get(`${base}/${recordB.id}/merge-preview`).then((r) => setPreviewB(r.data)).catch(() => setPreviewB({}));
  }, [base, recordA.id, recordB.id]);

  const survivor = survivorSide === 'A' ? recordA : recordB;
  const loser = survivorSide === 'A' ? recordB : recordA;
  const loserPreview = survivorSide === 'A' ? previewB : previewA;
  const loserHasActiveLogin = entityType === 'contact' && !!loserPreview?.active_login_user_id;

  async function apply() {
    setBusy(true);
    setError('');
    try {
      const mergedFields = {};
      for (const f of fields) {
        const pick = fieldChoices[f.key] === 'A' ? recordA : recordB;
        mergedFields[f.key] = pick[f.key];
      }
      await api.post(`${base}/merge`, {
        survivor_id: survivor.id,
        loser_id: loser.id,
        fields: mergedFields,
        ...(entityType === 'contact' ? { confirm_login_deactivation: confirmLogin } : {}),
      });
      toast('Records merged.', 'success');
      onMerged?.();
    } catch (e) {
      if (e?.response?.status === 409 && e.response.data?.conflict === 'active_login') {
        setError(e.response.data.error);
      } else {
        setError(parseApiError(e, 'Merge failed'));
      }
    } finally {
      setBusy(false);
    }
  }

  const canApply = !busy && (!loserHasActiveLogin || confirmLogin);

  return (
    <Modal show title={`Merge ${entityType === 'contact' ? 'contacts' : 'organizations'}`} onClose={onClose} size="lg"
      footer={<>
        <button className="btn btn-light" onClick={onClose}>Cancel</button>
        <button className="btn btn-danger" onClick={apply} disabled={!canApply}>
          {busy ? <><span className="spinner-border spinner-border-sm me-2" />Merging…</> : `Merge into "${displayName(entityType, survivor)}"`}
        </button>
      </>}>
      {error && <div className="alert alert-danger py-2">{error}</div>}

      <div className="mb-3">
        <label className="form-label fw-semibold">Which record should survive?</label>
        <div className="btn-group w-100">
          <button type="button" className={`btn btn-sm ${survivorSide === 'A' ? 'btn-primary' : 'btn-outline-secondary'}`}
            onClick={() => setSurvivorSide('A')}>{displayName(entityType, recordA)}</button>
          <button type="button" className={`btn btn-sm ${survivorSide === 'B' ? 'btn-primary' : 'btn-outline-secondary'}`}
            onClick={() => setSurvivorSide('B')}>{displayName(entityType, recordB)}</button>
        </div>
      </div>

      <div className="table-responsive mb-3">
        <table className="table table-sm align-middle">
          <thead>
            <tr>
              <th>Field</th>
              <th>{displayName(entityType, recordA)}</th>
              <th>{displayName(entityType, recordB)}</th>
            </tr>
          </thead>
          <tbody>
            {fields.map((f) => (
              <tr key={f.key}>
                <td className="text-muted small">{f.label}</td>
                {['A', 'B'].map((side) => {
                  const rec = side === 'A' ? recordA : recordB;
                  return (
                    <td key={side}>
                      <label className="d-flex align-items-center gap-2 mb-0">
                        <input type="radio" className="form-check-input" name={`field-${f.key}`}
                          checked={fieldChoices[f.key] === side}
                          onChange={() => setFieldChoices((prev) => ({ ...prev, [f.key]: side }))} />
                        <span>{rec[f.key] || <span className="text-muted">—</span>}</span>
                      </label>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="alert alert-secondary py-2 small mb-3">
        Merging moves donations, orders, recurring plans, invoices, tags, and related history from
        <strong> {displayName(entityType, loser)}</strong> onto the survivor. {loser.id} will be retired, not deleted.
        {loserPreview && (
          <ul className="mb-0 mt-1">
            {Object.entries(loserPreview).filter(([k]) => k !== 'active_login_user_id').map(([k, v]) => (
              Number(v) > 0 ? <li key={k}>{v} {k.replace(/_/g, ' ')}</li> : null
            ))}
          </ul>
        )}
      </div>

      {loserHasActiveLogin && (
        <div className="alert alert-warning py-2">
          <label className="d-flex align-items-start gap-2 mb-0">
            <input type="checkbox" className="form-check-input mt-1" checked={confirmLogin}
              onChange={(e) => setConfirmLogin(e.target.checked)} />
            <span>
              <strong>{displayName(entityType, loser)}</strong> has an active portal login. I understand merging
              will deactivate that login — the surviving record's login (if any) is unaffected.
            </span>
          </label>
        </div>
      )}
    </Modal>
  );
}
