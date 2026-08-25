// The developer escape hatch: edit a whole page as HTML / CSS / JS.
//
// DATA-LOSS GUARD (learned the hard way): opening this on a visually-built page
// must never show an empty HTML box, and saving an empty box must never flip
// the page into code mode — that combination blanks the live page. So we
// pre-fill from the current design, and refuse the mode switch when there's
// nothing to switch to.

import { useEffect, useState } from 'react';
import CodeEditor, { CodeTabs } from '../code/CodeEditor.jsx';
import { formatHtmlString } from '../code/rawHtml.js';
import { Drawer } from './PageSettingsDrawer.jsx';

const TABS = [
  { key: 'html', label: 'HTML' },
  { key: 'css', label: 'CSS' },
  { key: 'javascript', label: 'JavaScript' },
];

export default function CodeDrawer({ page, onChange, onClose, serializeCurrentDesign }) {
  const [tab, setTab] = useState('html');
  const [notice, setNotice] = useState('');

  // Pre-fill the HTML from the live canvas the first time this opens on a
  // visual page, so the box is never blank.
  useEffect(() => {
    if (page.code_html) return;
    const html = serializeCurrentDesign?.();
    if (!html) return;
    onChange({ ...page, code_html: html });
    setNotice('Pre-filled from your current design. Editing here does not change the visual layout until you switch this page to code mode.');
    // Intentionally runs once per open — `page` changes on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isCodeMode = page.page_mode === 'code';
  const hasHtml = Boolean((page.code_html || '').trim());

  function toggleMode() {
    if (!isCodeMode && !hasHtml) {
      setNotice('Add some HTML before switching to code mode — otherwise the published page would be blank.');
      return;
    }
    onChange({ ...page, page_mode: isCodeMode ? 'visual' : 'code' });
    setNotice(
      isCodeMode
        ? 'Back to visual mode. Your visual layout is untouched and will be published.'
        : 'Code mode. The HTML below is published verbatim; the visual layout is kept but not rendered.',
    );
  }

  const value = tab === 'html' ? page.code_html : tab === 'css' ? page.custom_css : page.custom_js;
  const field = tab === 'html' ? 'code_html' : tab === 'css' ? 'custom_css' : 'custom_js';

  return (
    <Drawer title="Edit code" onClose={onClose} wide>
      <div className="bx-code-mode">
        <div>
          <strong>This page renders as: {isCodeMode ? 'code' : 'visual layout'}</strong>
          <p>
            {isCodeMode
              ? 'The HTML tab below is what visitors see. Your drag-and-drop layout is preserved and comes back if you switch off code mode.'
              : 'Visitors see the drag-and-drop layout. CSS and JavaScript here still apply; the HTML tab only takes over in code mode.'}
          </p>
        </div>
        <button type="button" className="bxf__btn" onClick={toggleMode}>
          Switch to {isCodeMode ? 'visual' : 'code'} mode
        </button>
      </div>

      {/* Say this plainly rather than letting people discover it by losing
          work: the HTML is a snapshot, and editing it does not rewrite the
          drag-and-drop blocks. */}
      <p className="bx-code-notice bx-code-notice--info">
        <i className="fa-solid fa-circle-info" />{' '}
        <strong>Editing the HTML here does not change the drag-and-drop blocks.</strong>{' '}
        {isCodeMode
          ? 'This page publishes the HTML below. Your visual layout is kept as-is underneath — switching back to visual mode discards nothing, but also discards no HTML edits into it.'
          : 'It is a snapshot of your current design, used only if you switch this page to code mode. Changes you make here will be ignored while the page stays in visual mode.'}
      </p>

      {notice && <p className="bx-code-notice">{notice}</p>}

      <div className="bx-code-toolbar">
        <CodeTabs tabs={TABS} active={tab} onChange={setTab} />
        {tab === 'html' && (
          <button
            type="button"
            className="bx-code-tab"
            title="Re-indent the HTML"
            onClick={() => onChange({ ...page, code_html: formatHtmlString(page.code_html) })}
          >
            <i className="fa-solid fa-indent" /> Format
          </button>
        )}
      </div>
      <CodeEditor
        language={tab}
        value={value}
        onChange={(next) => onChange({ ...page, [field]: next })}
        height="calc(100vh - 340px)"
      />
    </Drawer>
  );
}
