// =============================================================================
// Minimal toast system for success/info notifications that don't warrant a
// blocking dialog — the app previously used alert() for these (e.g. "Added 5
// contacts."). Mount <ToastHost /> once near the app root; call toast(...)
// from anywhere.
// =============================================================================
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

let listeners = [];
let idCounter = 0;

export function toast(message, type = 'success', duration = 4000) {
  const id = ++idCounter;
  listeners.forEach((fn) => fn((prev) => [...prev, { id, message, type }]));
  setTimeout(() => {
    listeners.forEach((fn) => fn((prev) => prev.filter((t) => t.id !== id)));
  }, duration);
}

export function ToastHost() {
  const [toasts, setToasts] = useState([]);

  useEffect(() => {
    listeners.push(setToasts);
    return () => { listeners = listeners.filter((fn) => fn !== setToasts); };
  }, []);

  if (!toasts.length) return null;

  return createPortal(
    <div style={{ position: 'fixed', bottom: 20, right: 20, zIndex: 300000, display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 360 }}>
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`alert ${t.type === 'error' ? 'alert-danger' : 'alert-success'} shadow-sm mb-0 d-flex align-items-center gap-2`}
        >
          <iconify-icon
            icon={t.type === 'error' ? 'solar:close-circle-bold-duotone' : 'solar:check-circle-bold-duotone'}
            class="fs-5"
          ></iconify-icon>
          {t.message}
        </div>
      ))}
    </div>,
    document.body
  );
}
