// Raw HTML inside an otherwise visual page. This is the escape hatch for
// sections that must be pixel-exact — paste the original markup and it renders
// verbatim, while the rest of the page stays drag-and-drop editable.

import { useEffect, useRef } from 'react';
import { useNode } from '@craftjs/core';
import { Field, FieldGroup, TextField, ToggleField } from '../fields/index.jsx';
import CodeEditor from '../code/CodeEditor.jsx';
import { injectHtml } from '../code/rawHtml.js';
import { IDENTITY_DEFAULTS, cx, useDomIdentity, useIsEditing, useNodeRef } from './nodeUtils.js';

export default function HtmlBlock({ markup, runScripts }) {
  const connectRef = useNodeRef();
  const hostRef = useRef(null);
  const editing = useIsEditing();

  const { domId, customClass } = useDomIdentity('html');

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    // Scripts are skipped while editing — a third-party widget booting inside
    // the canvas can hijack the page and make the block impossible to select.
    if (editing || !runScripts) host.innerHTML = markup || '';
    else injectHtml(host, markup);
  }, [markup, runScripts, editing]);

  return (
    <div
      ref={(el) => {
        hostRef.current = el;
        connectRef(el);
      }}
      id={domId}
      className={cx('bx-html', customClass)}
    />
  );
}

function HtmlSettings() {
  const { props, actions: { setProp } } = useNode((node) => ({ props: node.data.props }));
  const p = (key) => (value) => setProp((s) => { s[key] = value; });
  return (
    <>
      <FieldGroup title="HTML">
        <Field hint="Renders exactly as written. Styles for it belong in Page settings → Custom CSS or in site-wide CSS.">
          <CodeEditor language="html" value={props.markup} onChange={p('markup')} height="320px" />
        </Field>
        <ToggleField
          label="Run <script> tags on the live site"
          value={props.runScripts}
          onChange={p('runScripts')}
          hint="Scripts never run inside the builder, so a widget can't take over the canvas."
        />
      </FieldGroup>
      <FieldGroup title="Identity" defaultOpen={false}>
        <TextField label="Custom ID" value={props.customId} onChange={p('customId')} />
        <TextField label="Custom CSS class" value={props.customClass} onChange={p('customClass')} />
      </FieldGroup>
    </>
  );
}

HtmlBlock.craft = {
  displayName: 'HTML',
  props: { ...IDENTITY_DEFAULTS, markup: '<p>Paste your HTML here.</p>', runScripts: false },
  related: { settings: HtmlSettings },
};
