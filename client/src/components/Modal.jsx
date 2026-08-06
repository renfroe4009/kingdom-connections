import { useEffect, useRef } from 'react';

// Slides in from the right (Bootstrap offcanvas) instead of a centered dialog —
// reads better on mobile and gives more vertical room for long forms. Same
// props as before (show/onClose/title/children/size/footer) so no call site
// needs to change; `size` now maps to a panel width instead of a dialog size.
const WIDTH_BY_SIZE = { sm: 380, md: 480, lg: 640, xl: 860 };

export default function Modal({ show, onClose, title, children, size, footer }) {
  const backdropRef = useRef(null);
  useEffect(() => {
    function esc(e) { if (e.key === 'Escape') onClose?.(); }
    if (show) document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [show, onClose]);

  if (!show) return null;
  const width = WIDTH_BY_SIZE[size] || WIDTH_BY_SIZE.lg;

  return (
    <>
      <div
        className="offcanvas offcanvas-end show"
        tabIndex="-1"
        style={{ width, maxWidth: '92vw', visibility: 'visible' }}
      >
        <div className="offcanvas-header border-bottom">
          <h5 className="offcanvas-title fw-bolder">{title}</h5>
          <button type="button" className="btn-close" onClick={onClose}></button>
        </div>
        <div className="offcanvas-body d-flex flex-column p-0">
          <div style={{ overflowY: 'auto', flex: 1, padding: '1rem' }}>{children}</div>
          {footer && (
            <div className="border-top p-3 d-flex justify-content-end gap-2">{footer}</div>
          )}
        </div>
      </div>
      <div
        className="offcanvas-backdrop fade show"
        ref={backdropRef}
        onClick={() => onClose?.()}
      ></div>
    </>
  );
}
