// Divider and Spacer — the two "breathing room" primitives.

import { useNode } from '@craftjs/core';
import { ColorField, FieldGroup, NumberField, TextField } from '../fields/index.jsx';
import { IDENTITY_DEFAULTS, cssVars, cx, px, useDomIdentity, useIsEditing, useNodeRef } from './nodeUtils.js';

/* ── Divider ──────────────────────────────────────────────────────────────── */

export function Divider({ color, thickness, marginY }) {
  const ref = useNodeRef();
  const { domId, customClass } = useDomIdentity('divider');
  return (
    <hr
      ref={ref}
      id={domId}
      className={cx('bx-divider', customClass)}
      style={cssVars({ '--bx-divider-color': color, '--bx-divider-h': px(thickness), marginBlock: px(marginY) })}
    />
  );
}

function DividerSettings() {
  const { props, actions: { setProp } } = useNode((node) => ({ props: node.data.props }));
  const p = (key) => (value) => setProp((s) => { s[key] = value; });
  return (
    <FieldGroup title="Divider">
      <ColorField label="Colour" value={props.color} onChange={p('color')} />
      <NumberField label="Thickness" value={props.thickness} onChange={p('thickness')} suffix="px" min={1} />
      <NumberField label="Space above and below" value={props.marginY} onChange={p('marginY')} suffix="px" min={0} />
      <TextField label="Custom CSS class" value={props.customClass} onChange={p('customClass')} />
    </FieldGroup>
  );
}

Divider.craft = {
  displayName: 'Divider',
  props: { ...IDENTITY_DEFAULTS, color: '', thickness: 1, marginY: 24 },
  related: { settings: DividerSettings },
};

/* ── Spacer ───────────────────────────────────────────────────────────────── */

export function Spacer({ height, heightMobile }) {
  const ref = useNodeRef();
  const editing = useIsEditing();
  const { domId, customClass } = useDomIdentity('spacer');
  return (
    <div
      ref={ref}
      id={domId}
      className={cx('bx-spacer', customClass)}
      style={cssVars({ '--bx-spacer-h': px(height), '--bx-spacer-h-sm': px(heightMobile) })}
      // A zero-content div is invisible and unselectable, so give it a hint
      // of an outline while editing only.
      data-editing={editing ? 'true' : undefined}
    />
  );
}

function SpacerSettings() {
  const { props, actions: { setProp } } = useNode((node) => ({ props: node.data.props }));
  const p = (key) => (value) => setProp((s) => { s[key] = value; });
  return (
    <FieldGroup title="Spacer">
      <NumberField label="Height" value={props.height} onChange={p('height')} suffix="px" min={0} />
      <NumberField
        label="Height (mobile)"
        value={props.heightMobile}
        onChange={p('heightMobile')}
        suffix="px"
        min={0}
        hint="Blank reuses the desktop height."
      />
      <TextField label="Custom CSS class" value={props.customClass} onChange={p('customClass')} />
    </FieldGroup>
  );
}

Spacer.craft = {
  displayName: 'Spacer',
  props: { ...IDENTITY_DEFAULTS, height: 48, heightMobile: '' },
  related: { settings: SpacerSettings },
};
