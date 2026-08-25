import { useNode } from '@craftjs/core';
import { ChoiceField, ColorField, FieldGroup, NumberField, SelectField, TextField, ToggleField } from '../fields/index.jsx';
import InlineText from './InlineText.jsx';
import { IDENTITY_DEFAULTS, cssVars, cx, slugify, styleOverrides, useDomIdentity, useIsEditing, useNodeRef } from './nodeUtils.js';

export default function Heading({ text, eyebrow, level, size, weight, align, color, eyebrowColor, titleClass, eyebrowClass }) {
  const ref = useNodeRef();
  const editing = useIsEditing();
  const { domId, customClass } = useDomIdentity('heading');
  const { actions } = useNode();
  const Tag = level || 'h2';

  return (
    <div ref={ref} id={domId} className={cx('bx-heading-block', customClass)}>
      {(eyebrow || editing) && (
        <InlineText
          as="div"
          // `eyebrowClass`/`titleClass` let a block carry an imported design's
          // own class names (e.g. `section-label`, `section-title`) so the
          // design's stylesheet keeps applying after conversion from raw HTML.
          className={cx('bx-eyebrow', eyebrowClass)}
          style={styleOverrides({
            imported: Boolean(eyebrowClass),
            vars: { '--bx-eyebrow-color': eyebrowColor },
            direct: { color: eyebrowColor },
          })}
          value={eyebrow}
          editable={editing}
          placeholder="Eyebrow"
          onChange={(v) => actions.setProp((p) => { p.eyebrow = v; })}
        />
      )}
      <InlineText
        as={Tag}
        className={cx('bx-heading', titleClass)}
        style={styleOverrides({
          imported: Boolean(titleClass),
          vars: { '--bx-heading-size': size, '--bx-heading-weight': weight, '--bx-heading-align': align, '--bx-heading-color': color },
          direct: { fontSize: size, fontWeight: weight, textAlign: align, color },
        })}
        value={text}
        // Rich, so inline markup a design uses to accent a word (<em>, <span>,
        // <br>) renders instead of printing as visible text — but single-line,
        // since a heading shouldn't take newlines.
        rich
        singleLine
        editable={editing}
        placeholder="Heading"
        onChange={(v) => actions.setProp((p) => { p.text = v; })}
      />
    </div>
  );
}

function HeadingSettings() {
  const { props, actions: { setProp } } = useNode((node) => ({ props: node.data.props }));
  const p = (key) => (value) => setProp((s) => { s[key] = value; });

  return (
    <>
      <FieldGroup title="Content">
        <TextField
          label="Heading"
          value={props.text}
          onChange={p('text')}
          hint="Simple HTML is allowed, e.g. <em>word</em> to accent part of the heading. You can also type straight onto the page."
        />
        <TextField label="Eyebrow" value={props.eyebrow} onChange={p('eyebrow')} hint="Small label above the heading." />
      </FieldGroup>

      <FieldGroup title="Style">
        <SelectField
          label="Level"
          value={props.level}
          onChange={p('level')}
          options={['h1', 'h2', 'h3', 'h4', 'h5', 'h6']}
          hint="Affects SEO and screen readers — use one h1 per page."
        />
        <TextField label="Size" value={props.size} onChange={p('size')} placeholder="2rem" hint="Any CSS size. Blank uses the theme default." />
        <SelectField
          label="Weight"
          value={String(props.weight ?? '')}
          onChange={(v) => p('weight')(v)}
          options={[
            { value: '', label: 'Theme default' },
            { value: '400', label: 'Regular' },
            { value: '600', label: 'Semibold' },
            { value: '700', label: 'Bold' },
            { value: '800', label: 'Extra bold' },
          ]}
        />
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
        <ColorField label="Eyebrow colour" value={props.eyebrowColor} onChange={p('eyebrowColor')} />
      </FieldGroup>

      <FieldGroup title="Identity" defaultOpen={false}>
        <TextField
          label="Custom ID"
          value={props.customId}
          onChange={p('customId')}
          placeholder={slugify(props.text)}
          hint="Link to this heading with #your-id."
        />
        <TextField label="Custom CSS class" value={props.customClass} onChange={p('customClass')} />
      </FieldGroup>
    </>
  );
}

Heading.craft = {
  displayName: 'Heading',
  props: {
    ...IDENTITY_DEFAULTS,
    text: 'Section heading',
    eyebrow: '',
    level: 'h2',
    size: '',
    weight: '',
    align: '',
    color: '',
    eyebrowColor: '',
    // Set by the design importer; no UI, since they exist to preserve an
    // imported stylesheet rather than to be authored by hand.
    titleClass: '',
    eyebrowClass: '',
  },
  related: { settings: HeadingSettings },
};
