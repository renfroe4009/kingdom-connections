import { useEditor } from '@craftjs/core';

const DEVICES = [
  { key: 'desktop', width: '100%', icon: 'fa-solid fa-desktop', label: 'Desktop' },
  { key: 'laptop', width: '1024px', icon: 'fa-solid fa-laptop', label: 'Laptop — 1024px' },
  { key: 'tablet', width: '768px', icon: 'fa-solid fa-tablet-screen-button', label: 'Tablet — 768px' },
  { key: 'mobile', width: '375px', icon: 'fa-solid fa-mobile-screen', label: 'Mobile — 375px' },
];

export default function Topbar({
  title,
  status,
  onStatusChange,
  onSave,
  saving,
  message,
  device,
  onDeviceChange,
  onOpenPageSettings,
  onOpenTheme,
  canvasTheme,
  onCanvasThemeChange,
  onOpenCode,
  onBack,
  onPreview,
  dirty,
}) {
  const { canUndo, canRedo, actions, enabled } = useEditor((state, query) => ({
    enabled: state.options.enabled,
    canUndo: query.history.canUndo(),
    canRedo: query.history.canRedo(),
  }));

  return (
    <header className="bx-topbar">
      <button type="button" className="bx-topbar__btn" onClick={onBack} title="Back to pages">
        <i className="fa-solid fa-arrow-left" />
      </button>

      <span className="bx-topbar__title">
        {title || 'Untitled page'}
        {dirty && <span className="bx-topbar__dot" title="Unsaved changes" />}
      </span>

      <div className="bx-topbar__group">
        <button type="button" className="bx-topbar__btn" disabled={!canUndo} onClick={() => actions.history.undo()} title="Undo">
          <i className="fa-solid fa-rotate-left" />
        </button>
        <button type="button" className="bx-topbar__btn" disabled={!canRedo} onClick={() => actions.history.redo()} title="Redo">
          <i className="fa-solid fa-rotate-right" />
        </button>
      </div>

      <div className="bx-topbar__group">
        {DEVICES.map((item) => (
          <button
            key={item.key}
            type="button"
            title={item.label}
            className={`bx-topbar__btn ${device === item.key ? 'is-active' : ''}`}
            onClick={() => onDeviceChange(item.key)}
          >
            <i className={item.icon} />
          </button>
        ))}
      </div>

      <div className="bx-topbar__spacer" />

      {message && <span className="bx-topbar__msg">{message}</span>}

      <button
        type="button"
        className={`bx-topbar__btn ${!enabled ? 'is-active' : ''}`}
        title={enabled ? 'Preview (hide editing chrome)' : 'Back to editing'}
        onClick={() => actions.setOptions((options) => { options.enabled = !enabled; })}
      >
        <i className={`fa-solid fa-${enabled ? 'eye' : 'pen'}`} />
      </button>

      <button
        type="button"
        className="bx-topbar__btn"
        onClick={() => onCanvasThemeChange(canvasTheme === 'dark' ? 'light' : 'dark')}
        title={canvasTheme === 'dark' ? 'Previewing dark mode — switch to light' : 'Previewing light mode — switch to dark'}
      >
        <i className={canvasTheme === 'dark' ? 'fa-solid fa-sun' : 'fa-solid fa-moon'} />
      </button>

      <button type="button" className="bx-topbar__btn" onClick={onOpenTheme} title="Theme — brand colours, fonts, site CSS">
        <i className="fa-solid fa-palette" />
      </button>

      <button type="button" className="bx-topbar__btn" onClick={onOpenCode} title="Edit code">
        <i className="fa-solid fa-code" />
      </button>

      <button type="button" className="bx-topbar__btn" onClick={onOpenPageSettings} title="Page settings">
        <i className="fa-solid fa-gear" />
      </button>

      <select className="bx-topbar__select" value={status} onChange={(e) => onStatusChange(e.target.value)}>
        <option value="draft">Draft</option>
        <option value="published">Published</option>
      </select>

      {onPreview && (
        <button type="button" className="bx-topbar__btn" onClick={onPreview} title="Open the live page">
          <i className="fa-solid fa-arrow-up-right-from-square" />
        </button>
      )}

      <button type="button" className="bx-topbar__save" onClick={() => onSave()} disabled={saving}>
        {saving ? 'Saving…' : 'Save'}
      </button>
    </header>
  );
}

export { DEVICES };
