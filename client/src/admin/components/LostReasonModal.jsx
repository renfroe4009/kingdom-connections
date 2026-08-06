import { useState } from 'react';
import Modal from '../../components/Modal.jsx';

/**
 * Prompts for a lost reason before confirming a deal stage move.
 * Props:
 *   show         — boolean
 *   onConfirm(reason) — called with the entered reason string
 *   onCancel()   — called when dismissed
 */
export default function LostReasonModal({ show, onConfirm, onCancel }) {
  const [reason, setReason] = useState('');
  const [error, setError]   = useState('');

  function handleConfirm() {
    if (!reason.trim()) { setError('Please enter a reason.'); return; }
    const r = reason.trim();
    setReason('');
    setError('');
    onConfirm(r);
  }

  function handleCancel() {
    setReason('');
    setError('');
    onCancel();
  }

  return (
    <Modal
      show={show}
      onClose={handleCancel}
      title="Mark Deal as Lost"
      size="md"
      footer={
        <>
          <button className="btn btn-light" onClick={handleCancel}>Cancel</button>
          <button className="btn btn-danger" onClick={handleConfirm}>Mark Lost</button>
        </>
      }
    >
      <p className="text-muted small mb-3">
        This deal is being moved to a lost stage. Please provide a reason so your team can learn from it.
      </p>
      <label className="form-label">Lost Reason <span className="text-danger">*</span></label>
      <textarea
        className={`form-control ${error ? 'is-invalid' : ''}`}
        rows={3}
        value={reason}
        onChange={(e) => { setReason(e.target.value); setError(''); }}
        placeholder="e.g. Lost to competitor, Budget cut, No decision..."
        autoFocus
      />
      {error && <div className="invalid-feedback">{error}</div>}
    </Modal>
  );
}
