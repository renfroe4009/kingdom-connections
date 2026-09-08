// Edit-in-place text for builder nodes.
//
// Typing straight onto the canvas is the difference between a builder a
// non-technical user enjoys and one they tolerate, so headings, paragraphs and
// button labels are all contentEditable while the editor is enabled.
//
// The tricky part is that React must not re-write the DOM while the caret is
// inside it — that resets the cursor to the start on every keystroke. So we
// only push `value` into the element when it isn't focused, and let the DOM be
// the source of truth in between.

import { forwardRef, useEffect, useRef } from 'react';
import { sanitizeHtml } from '../../utils/sanitizeHtml.js';

function setContent(el, value, rich) {
  if (!el) return;
  if (rich) {
    if (el.innerHTML !== value) el.innerHTML = value ?? '';
  } else if (el.innerText !== value) {
    el.innerText = value ?? '';
  }
}

/**
 * `rich`       — the value is HTML, read and written as innerHTML.
 * `singleLine` — Enter is swallowed and pastes come in as plain text.
 *
 * These are separate on purpose. A heading holds HTML (designs routinely
 * italicise or colour one word with an <em>) but must not accept newlines, so
 * it needs `rich` *and* `singleLine`. Tying the two together is what made
 * headings print their own markup as visible text.
 */
const InlineText = forwardRef(function InlineText(
  { as: Tag = 'div', value, onChange, editable, rich = false, singleLine = false, className, style, placeholder, ...rest },
  forwardedRef,
) {
  const localRef = useRef(null);
  const focused = useRef(false);

  useEffect(() => {
    if (focused.current) return;
    setContent(localRef.current, value, rich);
  }, [value, rich, editable]);

  const attach = (el) => {
    localRef.current = el;
    if (el && !focused.current) setContent(el, value, rich);
    if (typeof forwardedRef === 'function') forwardedRef(el);
    else if (forwardedRef) forwardedRef.current = el;
  };

  if (!editable) {
    return rich ? (
      <Tag ref={attach} className={className} style={style} dangerouslySetInnerHTML={{ __html: sanitizeHtml(value || '') }} {...rest} />
    ) : (
      <Tag ref={attach} className={className} style={style} {...rest}>
        {value}
      </Tag>
    );
  }

  return (
    <Tag
      ref={attach}
      className={className}
      style={style}
      contentEditable
      suppressContentEditableWarning
      data-placeholder={placeholder}
      onFocus={() => { focused.current = true; }}
      onBlur={(e) => {
        focused.current = false;
        onChange(rich ? e.currentTarget.innerHTML : e.currentTarget.innerText);
      }}
      onInput={(e) => onChange(rich ? e.currentTarget.innerHTML : e.currentTarget.innerText)}
      // Craft's drag handling would otherwise steal clicks meant for the caret.
      onMouseDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        // Headings and labels shouldn't accept newlines.
        if ((singleLine || !rich) && e.key === 'Enter') e.preventDefault();
        e.stopPropagation();
      }}
      onPaste={(e) => {
        if (rich && !singleLine) return;
        e.preventDefault();
        document.execCommand('insertText', false, e.clipboardData.getData('text/plain'));
      }}
      {...rest}
    />
  );
});

export default InlineText;
