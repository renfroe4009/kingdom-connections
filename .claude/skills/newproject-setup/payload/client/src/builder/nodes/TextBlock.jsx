import { useNode } from '@craftjs/core';
import { ChoiceField, ColorField, FieldGroup, TextField, TextareaField } from '../fields/index.jsx';
import InlineText from './InlineText.jsx';
import { IDENTITY_DEFAULTS, cssVars, cx, styleOverrides, useDomIdentity, useIsEditing, useNodeRef } from './nodeUtils.js';

export default function TextBlock({ html, size, align, color, maxWidth }) {
  const ref = useNodeRef();
  const editing = useIsEditing();
  const { domId, customClass } = useDomIdentity('text');
  const { actions } = useNode();

  return (
    <InlineText
      ref={ref}
      as="div"
      id={domId}
      className={cx('bx-text', customClass)}
      style={{
        ...styleOverrides({
          imported: Boolean(customClass),
          vars: { '--bx-text-size': size, '--bx-text-align': align, '--bx-text-color': color },
          direct: { fontSize: size, textAlign: align, color },
        }),
        ...cssVars({ maxWidth }),
      }}
      value={html}
      rich
      editable={editing}
      placeholder="Write something…"
      onChange={(v) => actions.setProp((p) => { p.html = v; })}
    />
  );
}

function TextSettings() {
  const { props, actions: { setProp } } = useNode((node) => ({ props: node.data.props }));
  const p = (key) => (value) => setProp((s) => { s[key] = value; });

  return (
    <>
      <FieldGroup title="Content">
        <TextareaField
          label="Text"
          value={props.html}
          onChange={p('html')}
          rows={8}
          hint="You can type directly on the canvas. Basic HTML (<p>, <strong>, <a>, <ul>) is allowed here."
        />
      </FieldGroup>

      <FieldGroup title="Style">
        <TextField label="Font size" value={props.size} onChange={p('size')} placeholder="1rem" />
        <ChoiceField
          label="Align"
          value={props.align}
          onChange={p('align')}
          options={[
            { value: '', label: 'Inherit', icon: 'fa-solid fa-ban' },
            { value: 'left', label: 'Left', icon: 'fa-solid fa-align-left' },
            { value: 'center', label: 'Center', icon: 'fa-solid fa-align-center' },
            { value: 'right', label: 'Right', icon: 'fa-solid fa-align-right' },
          ]}
        />
        <ColorField label="Colour" value={props.color} onChange={p('color')} />
        <TextField label="Max width" value={props.maxWidth} onChange={p('maxWidth')} placeholder="60ch" hint="Caps the line length for readability." />
      </FieldGroup>

      <FieldGroup title="Identity" defaultOpen={false}>
        <TextField label="Custom ID" value={props.customId} onChange={p('customId')} />
        <TextField label="Custom CSS class" value={props.customClass} onChange={p('customClass')} />
      </FieldGroup>
    </>
  );
}

TextBlock.craft = {
  displayName: 'Text',
  props: {
    ...IDENTITY_DEFAULTS,
    html: '<p>Write your copy here. Select the block to change its size, colour and alignment.</p>',
    size: '',
    align: '',
    color: '',
    maxWidth: '',
  },
  related: { settings: TextSettings },
};
