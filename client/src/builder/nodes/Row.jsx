// Row — a 12-column grid (or a flex strip) that holds Columns.
//
// We deliberately do NOT offer free-form absolute positioning. A grid is the
// only layout model that survives responsive design; absolute coordinates fall
// apart the moment the viewport changes.

import { Element, useEditor, useNode } from '@craftjs/core';
import { ChoiceField, FieldGroup, NumberField, SelectField, TextField, ToggleField } from '../fields/index.jsx';
import Column from './Column.jsx';
import { IDENTITY_DEFAULTS, cssVars, cx, px, useDomIdentity, useNodeRef } from './nodeUtils.js';

// Column-span presets, in twelfths.
const PRESETS = [
  { key: '12', label: '1 column', spans: [12] },
  { key: '6-6', label: '2 equal', spans: [6, 6] },
  { key: '4-8', label: '1 / 3 + 2 / 3', spans: [4, 8] },
  { key: '8-4', label: '2 / 3 + 1 / 3', spans: [8, 4] },
  { key: '4-4-4', label: '3 equal', spans: [4, 4, 4] },
  { key: '3-3-3-3', label: '4 equal', spans: [3, 3, 3, 3] },
  { key: '3-6-3', label: 'Sidebars', spans: [3, 6, 3] },
];

export default function Row({ mode, gap, align, justify, wrap, importedClass, children }) {
  const ref = useNodeRef();
  const { domId, customClass } = useDomIdentity('row');

  // An imported row keeps the design's own class and layout CSS; applying our
  // 12-column grid on top would fight it.
  const imported = Boolean(importedClass);

  const style = imported ? undefined : cssVars({
    '--bx-row-gap': px(gap),
    '--bx-row-align': align,
    '--bx-row-justify': justify,
    '--bx-row-wrap': wrap ? 'wrap' : 'nowrap',
  });

  return (
    <div
      ref={ref}
      id={domId}
      className={cx(!imported && 'bx-row', !imported && mode === 'flex' && 'bx-row--flex', importedClass, customClass)}
      style={style}
    >
      {children}
    </div>
  );
}

function RowSettings() {
  const { id, props, actions: { setProp } } = useNode((node) => ({ props: node.data.props }));
  const { actions, query, columnIds } = useEditor((state) => ({
    columnIds: state.nodes[id]?.data?.nodes || [],
  }));
  const p = (key) => (value) => setProp((s) => { s[key] = value; });

  // Applying a preset reshapes the row: existing columns are re-spanned,
  // missing ones added, surplus ones removed. Content in kept columns
  // survives, which is what people expect when nudging a 2-col row to 3-col.
  function applyPreset(preset) {
    const spans = preset.spans;
    columnIds.forEach((colId, index) => {
      if (index < spans.length) actions.setProp(colId, (cp) => { cp.span = spans[index]; });
      else actions.delete(colId);
    });
    for (let index = columnIds.length; index < spans.length; index += 1) {
      // Craft can only add a parsed node tree, not a bare element.
      const tree = query.parseReactElement(<Element is={Column} canvas span={spans[index]} />).toNodeTree();
      actions.addNodeTree(tree, id);
    }
  }

  const activePreset = PRESETS.find(
    (preset) => preset.spans.length === columnIds.length,
  );

  return (
    <>
      <FieldGroup title="Columns">
        <div className="bxf-presets">
          {PRESETS.map((preset) => (
            <button
              key={preset.key}
              type="button"
              className={cx('bxf-preset', activePreset?.key === preset.key && 'is-active')}
              title={preset.label}
              onClick={() => applyPreset(preset)}
            >
              <span className="bxf-preset__bars">
                {preset.spans.map((span, index) => (
                  <span key={index} style={{ flex: span }} />
                ))}
              </span>
              <span className="bxf-preset__label">{preset.label}</span>
            </button>
          ))}
        </div>
      </FieldGroup>

      <FieldGroup title="Layout">
        <SelectField
          label="Mode"
          value={props.mode}
          onChange={p('mode')}
          options={[
            { value: 'grid', label: '12-column grid' },
            { value: 'flex', label: 'Flex (equal widths)' },
          ]}
        />
        <NumberField label="Gap" value={props.gap} onChange={p('gap')} suffix="px" min={0} />
        <ChoiceField
          label="Vertical align"
          value={props.align}
          onChange={p('align')}
          options={[
            { value: 'stretch', label: 'Stretch', icon: 'fa-solid fa-arrows-up-down' },
            { value: 'flex-start', label: 'Top', icon: 'fa-solid fa-arrow-up' },
            { value: 'center', label: 'Middle', icon: 'fa-solid fa-minus' },
            { value: 'flex-end', label: 'Bottom', icon: 'fa-solid fa-arrow-down' },
          ]}
        />
        {props.mode === 'flex' && (
          <>
            <SelectField
              label="Justify"
              value={props.justify}
              onChange={p('justify')}
              options={[
                { value: 'flex-start', label: 'Start' },
                { value: 'center', label: 'Center' },
                { value: 'flex-end', label: 'End' },
                { value: 'space-between', label: 'Space between' },
                { value: 'space-around', label: 'Space around' },
              ]}
            />
            <ToggleField label="Wrap" value={props.wrap} onChange={p('wrap')} />
          </>
        )}
      </FieldGroup>

      <FieldGroup title="Identity" defaultOpen={false}>
        <TextField label="Custom ID" value={props.customId} onChange={p('customId')} />
        <TextField label="Custom CSS class" value={props.customClass} onChange={p('customClass')} />
      </FieldGroup>
    </>
  );
}

Row.craft = {
  displayName: 'Row',
  props: {
    ...IDENTITY_DEFAULTS,
    mode: 'grid',
    gap: 24,
    align: 'stretch',
    justify: 'flex-start',
    wrap: true,
    importedClass: '',
  },
  related: { settings: RowSettings },
  rules: {
    // Only Columns belong directly in a Row — otherwise the grid maths breaks.
    // An imported row isn't our grid, so it takes whatever the design had
    // (background layers, overlays) alongside its content columns.
    canMoveIn: (incoming, self) => (self?.data?.props?.importedClass
      ? true
      : incoming.every((node) => node.data.type === Column)),
  },
};

/** Toolbox preset — a row with two equal columns. */
export function RowPreset() {
  return (
    <Element is={Row} canvas>
      <Element is={Column} canvas span={6} />
      <Element is={Column} canvas span={6} />
    </Element>
  );
}

export { PRESETS as ROW_PRESETS };
