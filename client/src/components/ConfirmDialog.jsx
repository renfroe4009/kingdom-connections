// =============================================================================
// ConfirmDialog — in-app replacement for window.confirm()/window.prompt().
// Rendered via the useConfirm()/usePrompt() hooks in useConfirm.js — don't
// mount this directly in a page, use those hooks instead.
// =============================================================================
import Modal from './Modal.jsx';

export default function ConfirmDialog({
  show, title = 'Confirm', message, confirmLabel = 'Confirm', cancelLabel = 'Cancel',
  danger = true, onConfirm, onCancel, busy = false,
  input = null, inputValue = '', onInputChange,
}) {
  return (
    <Modal
      show={show}
      onClose={onCancel}
      title={title}
      size="sm"
      footer={
        <>
          <button className="btn btn-light" onClick={onCancel} disabled={busy}>{cancelLabel}</button>
          <button
            className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`}
            onClick={onConfirm}
            disabled={busy || (input && !String(inputValue || '').trim() && input.required)}
          >
            {busy ? <><span className="spinner-border spinner-border-sm me-2" />Working…</> : confirmLabel}
          </button>
        </>
      }
    >
      {message && <p className={input ? 'mb-2' : 'mb-0'}>{message}</p>}
      {input && (
        <input
          className="form-control"
          placeholder={input.placeholder || ''}
          value={inputValue}
          onChange={(e) => onInputChange(e.target.value)}
          autoFocus
          onKeyDown={(e) => { if (e.key === 'Enter') onConfirm(); }}
        />
      )}
    </Modal>
  );
}
