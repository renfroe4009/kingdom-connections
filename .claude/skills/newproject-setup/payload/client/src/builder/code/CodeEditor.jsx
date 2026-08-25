// One CodeMirror wrapper, used everywhere code is edited: the page code editor,
// per-page custom CSS/JS, the HTML block, and site-wide CSS in admin settings.

import { useMemo } from 'react';
import CodeMirror, { EditorView } from '@uiw/react-codemirror';
import { html } from '@codemirror/lang-html';
import { css } from '@codemirror/lang-css';
import { javascript } from '@codemirror/lang-javascript';

const LANGUAGES = {
  html: html,
  css: css,
  javascript: javascript,
  js: javascript,
};

export default function CodeEditor({ language = 'html', value, onChange, height = '420px', placeholder, readOnly = false }) {
  const extensions = useMemo(() => {
    const factory = LANGUAGES[language] || html;
    // Wrap long lines rather than scrolling sideways — a single element can
    // carry a very long style attribute, and horizontal scrolling in a code
    // box is miserable.
    return [factory(), EditorView.lineWrapping];
  }, [language]);

  return (
    <div className="bx-code">
      <CodeMirror
        value={value ?? ''}
        height={height}
        extensions={extensions}
        onChange={onChange}
        placeholder={placeholder}
        readOnly={readOnly}
        basicSetup={{
          lineNumbers: true,
          highlightActiveLine: true,
          bracketMatching: true,
          autocompletion: true,
          closeBrackets: true,
          foldGutter: true,
          highlightSelectionMatches: true,
          searchKeymap: true,
        }}
      />
    </div>
  );
}

/** Small tab strip shared by the code drawers. */
export function CodeTabs({ tabs, active, onChange }) {
  return (
    <div className="bx-code-tabs">
      {tabs.map((tab) => (
        <button
          key={tab.key}
          type="button"
          className={`bx-code-tab ${active === tab.key ? 'is-active' : ''}`}
          onClick={() => onChange(tab.key)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
