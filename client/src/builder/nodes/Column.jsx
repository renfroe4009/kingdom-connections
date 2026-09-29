// Column — a cell in a Row's 12-column grid, with per-breakpoint spans.
//
// Mobile rule: columns stack full-width below 768px unless a mobile span is
// explicitly set. That default lives in site.css (`--bx-col-span-sm` falls
// back to 12), not here, so it applies to rendered pages too.

import { useNode } from '@craftjs/core';
import { ChoiceField, FieldGroup, SelectField, SpacingField, TextField } from '../fields/index.jsx';
import { IDENTITY_DEFAULTS, cssVars, cx, parseInlineStyle, px, spacingToCss, useDomIdentity, useNodeRef } from './nodeUtils.js';

const SPAN_OPTIONS = [{ value: '', label: 'Auto / inherit' }].concat(
  Array.from({ length: 12 }, (_, i) => ({ value: String(i + 1), label: `${i + 1} / 12` })),
);

export default function Column({ span, spanTablet, spanMobile, padding, gap, verticalAlign, horizontalAlign, textAlign, importedClass, importedStyle, bare, children }) {
  const ref = useNodeRef();
  const { domId, customClass } = useDomIdentity('col');

  // See Row: an imported column is positioned by the design's own CSS.
  // `bare` is the unclassed wrapper case — a plain <div> the design's parent
  // grid places by source order. Giving it `bx-col` forces a 12-column span,
  // which makes every such cell take a full row instead of sitting side by
  // side, so it renders as the plain div it was.
  const imported = Boolean(importedClass) || bare;

  // Some designs put the rule in the class and the per-cell values in inline
  // custom properties, so an imported column has to keep the source element's
  // inline style or its grid placement is lost with it.
  const style = imported ? parseInlineStyle(importedStyle) : cssVars({
    '--bx-col-span': span,
    '--bx-col-span-md': spanTablet,
    '--bx-col-span-sm': spanMobile,
    '--bx-col-p': spacingToCss(padding),
    '--bx-col-gap': px(gap),
    '--bx-col-justify': verticalAlign,
    '--bx-col-align': horizontalAlign,
    '--bx-col-text-align': textAlign,
  });

  return (
    <div ref={ref} id={domId} className={cx(!imported && 'bx-col', importedClass, customClass)} style={style}>
      {children}
    </div>
  );
}

function ColumnSettings() {
  const { props, actions: { setProp } } = useNode((node) => ({ props: node.data.props }));
  const p = (key) => (value) => setProp((s) => { s[key] = value; });

  return (
    <>
      <FieldGroup title="Width">
        <SelectField label="Desktop" value={String(props.span ?? '')} onChange={(v) => p('span')(v === '' ? '' : Number(v))} options={SPAN_OPTIONS} />
        <SelectField
          label="Tablet (≤1024px)"
          value={String(props.spanTablet ?? '')}
          onChange={(v) => p('spanTablet')(v === '' ? '' : Number(v))}
          options={SPAN_OPTIONS}
          hint="Blank reuses the desktop width."
        />
        <SelectField
          label="Mobile (≤767px)"
          value={String(props.spanMobile ?? '')}
          onChange={(v) => p('spanMobile')(v === '' ? '' : Number(v))}
          options={SPAN_OPTIONS}
          hint="Blank stacks the column full-width."
        />
      </FieldGroup>

      <FieldGroup title="Content">
        <ChoiceField
          label="Vertical"
          value={props.verticalAlign}
          onChange={p('verticalAlign')}
          options={[
            { value: 'flex-start', label: 'Top', icon: 'fa-solid fa-arrow-up' },
            { value: 'center', label: 'Middle', icon: 'fa-solid fa-minus' },
            { value: 'flex-end', label: 'Bottom', icon: 'fa-solid fa-arrow-down' },
          ]}
        />
        <ChoiceField
          label="Horizontal"
          value={props.horizontalAlign}
          onChange={p('horizontalAlign')}
          options={[
            { value: 'stretch', label: 'Fill', icon: 'fa-solid fa-arrows-left-right' },
            { value: 'flex-start', label: 'Left', icon: 'fa-solid fa-align-left' },
            { value: 'center', label: 'Center', icon: 'fa-solid fa-align-center' },
            { value: 'flex-end', label: 'Right', icon: 'fa-solid fa-align-right' },
          ]}
        />
        <ChoiceField
          label="Text align"
          value={props.textAlign}
          onChange={p('textAlign')}
          options={[
            { value: '', label: 'Inherit', icon: 'fa-solid fa-ban' },
            { value: 'left', label: 'Left', icon: 'fa-solid fa-align-left' },
            { value: 'center', label: 'Center', icon: 'fa-solid fa-align-center' },
            { value: 'right', label: 'Right', icon: 'fa-solid fa-align-right' },
          ]}
        />
        <SpacingField label="Padding (px)" value={props.padding} onChange={p('padding')} />
      </FieldGroup>

      <FieldGroup title="Identity" defaultOpen={false}>
        <TextField label="Custom ID" value={props.customId} onChange={p('customId')} />
        <TextField label="Custom CSS class" value={props.customClass} onChange={p('customClass')} />
      </FieldGroup>
    </>
  );
}

Column.craft = {
  displayName: 'Column',
  props: {
    ...IDENTITY_DEFAULTS,
    span: 12,
    spanTablet: '',
    spanMobile: '',
    padding: {},
    gap: 16,
    verticalAlign: 'flex-start',
    horizontalAlign: 'stretch',
    textAlign: '',
    importedClass: '',
    importedStyle: '',
    // Set by the importer for an unclassed structural <div> (see above).
    bare: false,
  },
  related: { settings: ColumnSettings },
  rules: {
    // A Column can hold anything, including another Section — nesting to any
    // depth is a requirement, not an accident.
    canMoveIn: () => true,
  },
};
