// The canvas root. Every page's node tree hangs off this, and it's what gives
// the page its `.bx-page` styling context both in the builder and live.

import { useNode } from '@craftjs/core';
import { ColorField, FieldGroup, TextField } from '../fields/index.jsx';
import { cssVars, cx, useIsEditing } from './nodeUtils.js';

export default function PageRoot({ background, textColor, maxWidth, children }) {
  const {
    connectors: { connect },
    // Ask Craft whether the page has nodes rather than inspecting `children`:
    // when the page is empty React hands us an empty array, which is truthy,
    // so a `!children` check silently fails and the placeholder never appears.
    isEmpty,
  } = useNode((node) => ({ isEmpty: (node.data.nodes || []).length === 0 }));
  const editing = useIsEditing();

  return (
    <div
      ref={connect}
      className={cx('bx-page', editing && 'bx-page--editing', editing && isEmpty && 'bx-page--empty')}
      style={cssVars({ '--bx-bg': background, '--bx-text': textColor, '--bx-container': maxWidth })}
    >
      {children}
      {editing && isEmpty && (
        <div className="bx-editor-note" style={{ margin: 40 }}>
          Drag a Section from the left to start building this page — or click one to add it.
        </div>
      )}
    </div>
  );
}

function PageRootSettings() {
  const { props, actions: { setProp } } = useNode((node) => ({ props: node.data.props }));
  const p = (key) => (value) => setProp((s) => { s[key] = value; });
  return (
    <FieldGroup title="Page">
      <ColorField label="Page background" value={props.background} onChange={p('background')} />
      <ColorField label="Default text colour" value={props.textColor} onChange={p('textColor')} />
      <TextField label="Content width" value={props.maxWidth} onChange={p('maxWidth')} placeholder="1200px" hint="Blank uses the width set in Web Settings." />
    </FieldGroup>
  );
}

PageRoot.craft = {
  displayName: 'Page',
  props: { background: '', textColor: '', maxWidth: '' },
  related: { settings: PageRootSettings },
  rules: {
    canMoveIn: () => true,
    // The root can never be dragged or deleted out from under the page.
    canDrag: () => false,
  },
};
