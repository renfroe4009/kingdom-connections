import { useEffect, useMemo, useRef, useState } from 'react';

/**
 * Searchable single-select. Renders like a Bootstrap form-select but with a
 * filterable popup list — picks up the styling of whatever sits next to it
 * (form-control, form-select) so it slots into existing forms cleanly.
 *
 * Props:
 *   options       Array<{ value, label, sublabel? }>
 *   value         current selected value (string|number|"")
 *   onChange      (newValue) => void  — newValue is "" when cleared
 *   placeholder   shown in the trigger when nothing is selected
 *   emptyText     shown in the popup when no options match
 *   allowClear    if true, shows a tiny "×" to clear (default true)
 *   disabled      bool
 *   inputId       optional id attribute on the trigger button (for label htmlFor)
 *
 * Behaviour notes:
 *   - Filter matches on label OR sublabel, case-insensitive.
 *   - Click outside, Escape, or selecting closes the popup.
 *   - ArrowUp/ArrowDown move highlight; Enter selects the highlighted row.
 *   - We deliberately don't use a native <select> so a "(no contacts for
 *     this org)" empty state can render with a hint instead of just being
 *     blank.
 */
export default function SearchableSelect({
  options = [],
  value = '',
  onChange,
  placeholder = 'Select…',
  emptyText = 'No matches.',
  allowClear = true,
  disabled = false,
  inputId,
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlight, setHighlight] = useState(0);
  const wrapRef = useRef(null);
  const inputRef = useRef(null);

  const selected = useMemo(
    () => options.find((o) => String(o.value) === String(value)) || null,
    [options, value]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => {
      const hay = `${o.label || ''} ${o.sublabel || ''}`.toLowerCase();
      return hay.includes(q);
    });
  }, [options, query]);

  // Reset highlight whenever the visible list changes.
  useEffect(() => { setHighlight(0); }, [query, open]);

  // Click-outside collapses the popup.
  useEffect(() => {
    if (!open) return;
    function onDoc(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  // Autofocus the search input each time we open.
  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 0);
  }, [open]);

  function pick(opt) {
    onChange?.(opt ? opt.value : '');
    setQuery('');
    setOpen(false);
  }

  function onKey(e) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (filtered[highlight]) pick(filtered[highlight]);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  }

  return (
    <div ref={wrapRef} className="ss-wrap" style={{ position: 'relative' }}>
      <button
        id={inputId}
        type="button"
        className="form-select text-start"
        disabled={disabled}
        onClick={() => !disabled && setOpen((v) => !v)}
        style={{ paddingRight: allowClear && selected ? '4.5rem' : undefined }}
      >
        {selected ? (
          <span>
            {selected.label}
            {selected.sublabel && (
              <span className="text-muted small ms-2">{selected.sublabel}</span>
            )}
          </span>
        ) : (
          <span className="text-muted">{placeholder}</span>
        )}
      </button>

      {allowClear && selected && !disabled && (
        <button
          type="button"
          aria-label="Clear selection"
          className="btn btn-sm btn-link text-muted"
          onClick={(e) => { e.stopPropagation(); pick(null); }}
          style={{
            position: 'absolute',
            right: '1.75rem',
            top: '50%',
            transform: 'translateY(-50%)',
            padding: '0 .25rem',
            lineHeight: 1,
            textDecoration: 'none',
          }}
        >
          ×
        </button>
      )}

      {open && (
        <div
          className="card shadow-sm"
          style={{
            position: 'absolute',
            zIndex: 1080,
            left: 0,
            right: 0,
            marginTop: 4,
            maxHeight: 320,
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <div className="p-2 border-bottom">
            <input
              ref={inputRef}
              type="text"
              className="form-control form-control-sm"
              placeholder="Search…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onKey}
            />
          </div>
          <div style={{ overflowY: 'auto' }}>
            {filtered.length === 0 ? (
              <div className="p-2 text-muted small">{emptyText}</div>
            ) : (
              <ul className="list-unstyled mb-0">
                {filtered.map((o, idx) => {
                  const isHi = idx === highlight;
                  const isSel = String(o.value) === String(value);
                  return (
                    <li
                      key={o.value}
                      onMouseEnter={() => setHighlight(idx)}
                      onMouseDown={(e) => { e.preventDefault(); pick(o); }}
                      className={
                        'px-2 py-1 d-flex justify-content-between align-items-center ' +
                        (isHi ? 'bg-light' : '')
                      }
                      style={{ cursor: 'pointer', fontWeight: isSel ? 600 : 400 }}
                    >
                      <span>
                        {o.label}
                        {o.sublabel && (
                          <span className="text-muted small ms-2">{o.sublabel}</span>
                        )}
                      </span>
                      {isSel && (
                        <iconify-icon icon="solar:check-circle-line-duotone" class="text-success"></iconify-icon>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
