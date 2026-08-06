// =============================================================================
// TemplateEditor — visual (TipTap) ↔ HTML toggle for email / SMS templates
// =============================================================================
import { useCallback, useEffect, useImperativeHandle, useRef, useState, forwardRef } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import Link from '@tiptap/extension-link';
import { Image } from '@tiptap/extension-image';
import TextAlign from '@tiptap/extension-text-align';
import { TextStyle, Color } from '@tiptap/extension-text-style';

// ─── global editor styles (injected once) ────────────────────────────────────
const EDITOR_STYLES = `
.lc-prosemirror-wrap .ProseMirror {
  outline: none;
  padding: 14px 16px;
  background: #ffffff;
  color: #212529;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  font-size: 15px;
  line-height: 1.65;
}
.lc-prosemirror-wrap .ProseMirror > * + * { margin-top: .5em; }
.lc-prosemirror-wrap .ProseMirror h1 { font-size: 1.6rem; font-weight: 700; }
.lc-prosemirror-wrap .ProseMirror h2 { font-size: 1.3rem; font-weight: 600; }
.lc-prosemirror-wrap .ProseMirror h3 { font-size: 1.1rem; font-weight: 600; }
.lc-prosemirror-wrap .ProseMirror ul,
.lc-prosemirror-wrap .ProseMirror ol { padding-left: 1.4em; }
.lc-prosemirror-wrap .ProseMirror a  { color: #0d6efd; text-decoration: underline; cursor: pointer; }
.lc-prosemirror-wrap .ProseMirror hr { border: none; border-top: 2px solid #dee2e6; margin: 1em 0; }
.lc-prosemirror-wrap .ProseMirror img { max-width: 100%; height: auto; display: block; }
.lc-prosemirror-wrap .ProseMirror p.is-editor-empty:first-child::before {
  content: attr(data-placeholder);
  float: left; color: #adb5bd; pointer-events: none; height: 0;
}
`;

let stylesInjected = false;

// ─── toolbar primitives ───────────────────────────────────────────────────────
function Btn({ active, disabled, onClick, title, children }) {
  return (
    <button
      type="button"
      title={title}
      disabled={!!disabled}
      onMouseDown={(e) => { e.preventDefault(); onClick?.(); }}   // preventDefault keeps focus in editor
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 2,
        padding: '3px 7px', fontSize: '0.82rem', lineHeight: 1.4,
        border: '1px solid #dee2e6', borderRadius: 4,
        background: active ? '#e2e6ea' : '#ffffff',
        color: '#495057', cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.45 : 1,
        flexShrink: 0,
      }}
    >
      {children}
    </button>
  );
}
function Sep() {
  return <span style={{ width: 1, background: '#dee2e6', margin: '0 3px', alignSelf: 'stretch' }} />;
}
function Icon({ name }) {
  return <iconify-icon icon={name} style={{ fontSize: '1rem', lineHeight: 1 }}></iconify-icon>;
}

// ─── heading dropdown ─────────────────────────────────────────────────────────
function HeadingPicker({ editor }) {
  const val = editor?.isActive('heading', { level: 1 }) ? '1'
    : editor?.isActive('heading', { level: 2 }) ? '2'
    : editor?.isActive('heading', { level: 3 }) ? '3' : '0';

  return (
    <select
      value={val}
      onMouseDown={(e) => e.preventDefault()}
      onChange={(e) => {
        const v = e.target.value;
        if (v === '0') editor?.chain().focus().setParagraph().run();
        else editor?.chain().focus().setHeading({ level: Number(v) }).run();
      }}
      style={{
        border: '1px solid #dee2e6', borderRadius: 4,
        padding: '2px 6px', fontSize: '0.82rem', background: '#fff',
        color: '#495057', height: 28, cursor: 'pointer', flexShrink: 0,
      }}
    >
      <option value="0">Paragraph</option>
      <option value="1">Heading 1</option>
      <option value="2">Heading 2</option>
      <option value="3">Heading 3</option>
    </select>
  );
}

// ─── text color ───────────────────────────────────────────────────────────────
function TextColor({ editor }) {
  const ref = useRef(null);
  const cur = editor?.getAttributes('textStyle')?.color || '#000000';
  return (
    <span style={{ position: 'relative', flexShrink: 0 }}>
      <Btn title="Text color" onClick={() => ref.current?.click()}>
        <Icon name="solar:text-bold-line-duotone" />
        <span style={{ width: 14, height: 3, background: cur, borderRadius: 2, display: 'inline-block' }} />
      </Btn>
      <input ref={ref} type="color" value={cur}
        onChange={(e) => editor?.chain().focus().setColor(e.target.value).run()}
        style={{ position: 'absolute', opacity: 0, width: 1, height: 1, pointerEvents: 'none' }} />
    </span>
  );
}

// ─── merge-field dropdown ─────────────────────────────────────────────────────
const NS_COLOR = {
  contact: '#0d6efd', organization: '#6f42c1', deal: '#198754',
  user: '#fd7e14', business: '#dc3545', invoice: '#20c997', payment: '#0dcaf0',
};

function MergeMenu({ editor, mergeFields }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    function close(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const entries = Object.entries(mergeFields || {});
  if (!entries.length) return null;

  function insert(token) {
    editor?.chain().focus().insertContent(`{{${token}}}`).run();
    setOpen(false);
  }

  return (
    <div ref={ref} style={{ position: 'relative', flexShrink: 0 }}>
      <Btn title="Insert merge field" active={open} onClick={() => setOpen(v => !v)}>
        <Icon name="solar:code-square-line-duotone" />
        <span style={{ fontSize: '0.78rem', marginLeft: 2 }}>Merge</span>
        <Icon name="solar:alt-arrow-down-bold" />
      </Btn>
      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 4px)', left: 0, zIndex: 1055,
          background: '#fff', border: '1px solid #dee2e6', borderRadius: 6,
          boxShadow: '0 6px 16px rgba(0,0,0,.12)',
          minWidth: 240, maxHeight: 320, overflowY: 'auto', padding: '4px 0',
        }}>
          {entries.map(([ns, fields]) => (
            <div key={ns}>
              <div style={{
                padding: '5px 12px 2px',
                fontSize: '0.68rem', fontWeight: 700,
                textTransform: 'uppercase', letterSpacing: '.05em',
                color: NS_COLOR[ns] || '#6c757d',
              }}>{ns}</div>
              {fields.map((f) => (
                <button key={f} type="button"
                  onMouseDown={(e) => { e.preventDefault(); insert(`${ns}.${f}`); }}
                  style={{
                    display: 'block', width: '100%', textAlign: 'left',
                    background: 'none', border: 'none',
                    padding: '3px 14px 3px 20px',
                    fontSize: '0.82rem', fontFamily: 'monospace',
                    cursor: 'pointer', color: '#212529',
                  }}
                  onMouseOver={e => e.currentTarget.style.background = '#f0f4ff'}
                  onMouseOut={e => e.currentTarget.style.background = 'none'}
                >
                  <span style={{
                    background: '#fff3cd', color: '#664d03',
                    border: '1px solid #ffe69c', borderRadius: 3,
                    padding: '0 3px', fontSize: '0.78rem',
                  }}>{`{{${ns}.${f}}}`}</span>
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── main component ───────────────────────────────────────────────────────────
const TemplateEditor = forwardRef(function TemplateEditor({
  value = '',
  onChange,
  mergeFields = {},
  minHeight = 320,
  defaultMode = 'visual',   // 'visual' | 'html'  — pass 'html' for complex table-based templates
}, ref) {
  // Inject editor CSS once into <head>
  if (!stylesInjected && typeof document !== 'undefined') {
    const el = document.createElement('style');
    el.textContent = EDITOR_STYLES;
    document.head.appendChild(el);
    stylesInjected = true;
  }

  const [mode, setMode] = useState(defaultMode);
  // modeRef lets the onUpdate callback read the current mode without stale closures
  const modeRef = useRef(defaultMode);
  // htmlRef tracks the current HTML string regardless of which mode is active
  const htmlRef = useRef(value);
  // htmlText is STATE for the textarea so it re-renders on change
  const [htmlText, setHtmlText] = useState(value);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
      Underline,
      Link.configure({ openOnClick: false, autolink: false }),
      Image.configure({ inline: false, allowBase64: false }),
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      TextStyle,
      Color,
    ],
    // When starting in HTML mode, give TipTap an empty doc so it never parses
    // table-based email HTML (which it would strip, corrupting the template).
    content: defaultMode === 'html' ? '' : value,
    immediatelyRender: true,
    onUpdate({ editor: ed }) {
      // Guard: only propagate changes when the visual editor is active.
      // This prevents TipTap from ever overwriting htmlRef / form.body while
      // we're in HTML mode (e.g. if an internal event fires unexpectedly).
      if (modeRef.current !== 'visual') return;
      const html = ed.getHTML();
      htmlRef.current = html;
      onChange?.(html);
    },
  });

  // Keep editor in sync when `value` prop changes externally (form load)
  const prevValueRef = useRef(value);
  useEffect(() => {
    if (!editor || value === prevValueRef.current) return;
    prevValueRef.current = value;
    htmlRef.current = value;
    setHtmlText(value);
    // Only sync TipTap when we're in visual mode — in HTML mode TipTap stays
    // empty intentionally so it never touches complex email HTML.
    if (modeRef.current === 'visual' && editor.getHTML() !== value) {
      editor.commands.setContent(value || '', false);
    }
  }, [editor, value]); // eslint-disable-line

  function switchToHtml() {
    // Capture latest TipTap output only if we were in visual mode
    const html = modeRef.current === 'visual'
      ? (editor?.getHTML() ?? htmlRef.current)
      : htmlRef.current;
    htmlRef.current = html;
    setHtmlText(html);
    onChange?.(html);
    modeRef.current = 'html';
    setMode('html');
  }

  function switchToVisual() {
    // Load the current HTML into TipTap before showing it
    editor?.commands.setContent(htmlRef.current || '', false);
    modeRef.current = 'visual';
    setMode('visual');
  }

  // Link helper
  const handleLink = useCallback(() => {
    if (!editor) return;
    const prev = editor.getAttributes('link').href || '';
    // eslint-disable-next-line no-alert
    const url = window.prompt('Enter URL (empty to remove):', prev);
    if (url === null) return;
    if (!url.trim()) editor.chain().focus().unsetLink().run();
    else editor.chain().focus().setLink({ href: url.trim(), target: '_blank' }).run();
  }, [editor]);

  // Image helper
  const handleImage = useCallback(() => {
    if (!editor) return;
    // eslint-disable-next-line no-alert
    const url = window.prompt('Image URL:');
    if (url?.trim()) editor.chain().focus().setImage({ src: url.trim() }).run();
  }, [editor]);

  useImperativeHandle(ref, () => ({
    insertToken(token) {
      const t = `{{${token}}}`;
      if (modeRef.current === 'visual') {
        editor?.chain().focus().insertContent(t).run();
      } else {
        const next = htmlRef.current
          ? htmlRef.current + (htmlRef.current.endsWith(' ') ? '' : ' ') + t
          : t;
        htmlRef.current = next;
        setHtmlText(next);
        onChange?.(next);
      }
    },
  }), [editor, onChange]); // modeRef and htmlRef are stable refs, not listed

  return (
    <div>
      {/* Mode tabs */}
      <div className="d-flex align-items-center gap-2 mb-2">
        <div className="btn-group btn-group-sm">
          <button type="button"
            className={`btn btn-sm ${mode === 'visual' ? 'btn-secondary' : 'btn-outline-secondary'}`}
            onClick={switchToVisual}>
            <iconify-icon icon="solar:magic-stick-3-line-duotone" class="me-1"></iconify-icon>Visual
          </button>
          <button type="button"
            className={`btn btn-sm ${mode === 'html' ? 'btn-secondary' : 'btn-outline-secondary'}`}
            onClick={switchToHtml}>
            <iconify-icon icon="solar:code-line-duotone" class="me-1"></iconify-icon>HTML
          </button>
        </div>
        <small className="text-muted">
          {mode === 'visual'
            ? 'Use the toolbar below to format. Switch to HTML for full control.'
            : 'Editing raw HTML — switch to Visual to return to the rich editor.'}
        </small>
      </div>

      {/* Visual editor */}
      {mode === 'visual' && (
        <div className="border rounded overflow-hidden" style={{ background: '#fff' }}>
          {/* Toolbar */}
          <div style={{
            display: 'flex', flexWrap: 'wrap', alignItems: 'center',
            gap: 3, padding: '6px 8px',
            background: '#f8f9fa', borderBottom: '1px solid #dee2e6',
          }}>
            <HeadingPicker editor={editor} />
            <Sep />
            <Btn title="Bold"          active={editor?.isActive('bold')}      onClick={() => editor?.chain().focus().toggleBold().run()}>      <Icon name="solar:text-bold-line-duotone" /></Btn>
            <Btn title="Italic"        active={editor?.isActive('italic')}    onClick={() => editor?.chain().focus().toggleItalic().run()}>    <Icon name="solar:text-italic-line-duotone" /></Btn>
            <Btn title="Underline"     active={editor?.isActive('underline')} onClick={() => editor?.chain().focus().toggleUnderline().run()}> <Icon name="solar:text-underline-line-duotone" /></Btn>
            <Btn title="Strikethrough" active={editor?.isActive('strike')}    onClick={() => editor?.chain().focus().toggleStrike().run()}>    <Icon name="solar:text-cross-line-duotone" /></Btn>
            <TextColor editor={editor} />
            <Sep />
            <Btn title="Align left"   active={editor?.isActive({ textAlign: 'left' })}   onClick={() => editor?.chain().focus().setTextAlign('left').run()}>   <Icon name="solar:align-left-line-duotone" /></Btn>
            <Btn title="Align center" active={editor?.isActive({ textAlign: 'center' })} onClick={() => editor?.chain().focus().setTextAlign('center').run()}> <Icon name="solar:align-center-line-duotone" /></Btn>
            <Btn title="Align right"  active={editor?.isActive({ textAlign: 'right' })}  onClick={() => editor?.chain().focus().setTextAlign('right').run()}>  <Icon name="solar:align-right-line-duotone" /></Btn>
            <Sep />
            <Btn title="Bullet list"   active={editor?.isActive('bulletList')}  onClick={() => editor?.chain().focus().toggleBulletList().run()}>  <Icon name="solar:list-line-duotone" /></Btn>
            <Btn title="Ordered list"  active={editor?.isActive('orderedList')} onClick={() => editor?.chain().focus().toggleOrderedList().run()}><Icon name="solar:list-check-minimalistic-line-duotone" /></Btn>
            <Sep />
            <Btn title="Link"   active={editor?.isActive('link')} onClick={handleLink}>  <Icon name="solar:link-line-duotone" /></Btn>
            <Btn title="Image"                                     onClick={handleImage}> <Icon name="solar:gallery-wide-line-duotone" /></Btn>
            <Btn title="Divider"                                   onClick={() => editor?.chain().focus().setHorizontalRule().run()}><Icon name="solar:minus-line-duotone" /></Btn>
            <Sep />
            <MergeMenu editor={editor} mergeFields={mergeFields} />
            <Sep />
            <Btn title="Undo" disabled={!editor?.can().undo()} onClick={() => editor?.chain().focus().undo().run()}><Icon name="solar:undo-line-duotone" /></Btn>
            <Btn title="Redo" disabled={!editor?.can().redo()} onClick={() => editor?.chain().focus().redo().run()}><Icon name="solar:redo-line-duotone" /></Btn>
          </div>

          {/* Editor area */}
          <div className="lc-prosemirror-wrap" style={{ minHeight, cursor: 'text' }}
            onClick={() => editor?.commands.focus()}>
            {editor
              ? <EditorContent editor={editor} />
              : <div style={{ minHeight, padding: '14px 16px', color: '#adb5bd' }}>Loading editor…</div>
            }
          </div>
        </div>
      )}

      {/* HTML textarea */}
      {mode === 'html' && (
        <textarea
          className="form-control font-monospace"
          style={{ minHeight, resize: 'vertical', fontSize: '0.82rem', lineHeight: 1.5 }}
          value={htmlText}
          onChange={(e) => {
            const v = e.target.value;
            htmlRef.current = v;
            setHtmlText(v);
            onChange?.(v);
          }}
          spellCheck={false}
          placeholder="<p>Hi {{contact.first_name}},</p>"
        />
      )}

      <div className="d-flex justify-content-between mt-1">
        <small className="text-muted">
          {mode === 'visual'
            ? 'Click "Merge" to insert personalization tokens like {{contact.first_name}}'
            : 'Raw HTML — paste full email HTML here, then switch to Visual to keep editing'}
        </small>
        {mode === 'html' && (
          <small className="text-muted">{htmlText.length} chars</small>
        )}
      </div>
    </div>
  );
});

export default TemplateEditor;
