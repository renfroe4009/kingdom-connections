// Section — the top-level band of a page. Full-bleed background, constrained
// inner content, and the node that carries a page's anchor identity.

import { Element, useNode } from '@craftjs/core';
import {
  ChoiceField,
  ColorField,
  FieldGroup,
  ImageField,
  NumberField,
  SelectField,
  TextField,
  ToggleField,
} from '../fields/index.jsx';
import Row from './Row.jsx';
import { IDENTITY_DEFAULTS, cssVars, cx, px, styleOverrides, useDomIdentity, useNodeRef } from './nodeUtils.js';

export default function Section({
  background,
  textColor,
  backgroundImage,
  overlay,
  overlayColor,
  paddingTop,
  paddingBottom,
  paddingTopMobile,
  paddingBottomMobile,
  paddingX,
  maxWidth,
  fullBleed,
  sectionType,
  importedDesign,
  children,
}) {
  const ref = useNodeRef();
  const { domId, customClass } = useDomIdentity('section');

  // A section that carries imported design classes is styled by the imported
  // stylesheet, which wins over ours — so panel choices go out inline there.
  // Mobile padding still has to be a variable (a media query can't read an
  // inline style), which is a known limit for imported sections.
  const style = {
    ...styleOverrides({
      imported: Boolean(customClass),
      vars: {
        '--bx-section-bg': background,
        '--bx-section-fg': textColor,
        '--bx-section-bg-image': backgroundImage ? `url("${backgroundImage}")` : '',
        '--bx-section-pt': px(paddingTop),
        '--bx-section-pb': px(paddingBottom),
        '--bx-section-px': px(paddingX),
        '--bx-section-width': maxWidth,
      },
      direct: {
        backgroundColor: background,
        color: textColor,
        backgroundImage: backgroundImage ? `url("${backgroundImage}")` : '',
        paddingTop: px(paddingTop),
        paddingBottom: px(paddingBottom),
        paddingLeft: px(paddingX),
        paddingRight: px(paddingX),
      },
    }),
    ...cssVars({
      '--bx-section-overlay': overlay ? overlayColor : '',
      '--bx-section-pt-sm': px(paddingTopMobile),
      '--bx-section-pb-sm': px(paddingBottomMobile),
    }),
  };

  return (
    <section
      ref={ref}
      id={domId}
      className={cx('bx-section', fullBleed && 'bx-section--full', importedDesign && 'bx-section--imported', overlay && backgroundImage && 'bx-section--overlay', customClass)}
      style={style}
      data-section-type={sectionType || undefined}
    >
      <div className="bx-section__inner">{children}</div>
    </section>
  );
}

function SectionSettings() {
  const { props, actions: { setProp } } = useNode((node) => ({ props: node.data.props }));
  const p = (key) => (value) => setProp((s) => { s[key] = value; });

  return (
    <>
      <FieldGroup title="Background">
        <ColorField label="Background colour" value={props.background} onChange={p('background')} />
        <ColorField label="Text colour" value={props.textColor} onChange={p('textColor')} />
        <ImageField label="Background image" value={props.backgroundImage} onChange={p('backgroundImage')} />
        {props.backgroundImage && (
          <>
            <ToggleField label="Darken image for readability" value={props.overlay} onChange={p('overlay')} />
            {props.overlay && (
              <TextField
                label="Overlay"
                value={props.overlayColor}
                onChange={p('overlayColor')}
                placeholder="rgb(0 0 0 / 0.45)"
              />
            )}
          </>
        )}
      </FieldGroup>

      <FieldGroup title="Layout">
        <ToggleField
          label="Full-bleed (edge to edge)"
          value={props.fullBleed}
          onChange={p('fullBleed')}
          hint="Content spans the full window width instead of the site's max width."
        />
        {!props.fullBleed && (
          <SelectField
            label="Content width"
            value={props.maxWidth}
            onChange={p('maxWidth')}
            options={[
              { value: '', label: 'Site default' },
              { value: '1440px', label: 'Wide — 1440px' },
              { value: '1200px', label: 'Standard — 1200px' },
              { value: '960px', label: 'Narrow — 960px' },
              { value: '720px', label: 'Reading — 720px' },
            ]}
          />
        )}
        <NumberField label="Side padding" value={props.paddingX} onChange={p('paddingX')} suffix="px" min={0} />
        <NumberField label="Padding top" value={props.paddingTop} onChange={p('paddingTop')} suffix="px" min={0} />
        <NumberField label="Padding bottom" value={props.paddingBottom} onChange={p('paddingBottom')} suffix="px" min={0} />
        <NumberField
          label="Padding top (mobile)"
          value={props.paddingTopMobile}
          onChange={p('paddingTopMobile')}
          suffix="px"
          min={0}
          hint="Leave blank to reuse the desktop value."
        />
        <NumberField
          label="Padding bottom (mobile)"
          value={props.paddingBottomMobile}
          onChange={p('paddingBottomMobile')}
          suffix="px"
          min={0}
        />
      </FieldGroup>

      <FieldGroup title="Identity" defaultOpen={false}>
        <TextField
          label="Custom ID"
          value={props.customId}
          onChange={p('customId')}
          placeholder="services"
          hint="Used for anchor links (#services) and per-section custom CSS. Leave blank for an automatic id."
        />
        <TextField
          label="Custom CSS class"
          value={props.customClass}
          onChange={p('customClass')}
          placeholder="hero dark-band"
          hint="Space-separated. Style these in Page settings → Custom CSS or site-wide CSS."
        />
      </FieldGroup>
    </>
  );
}

Section.craft = {
  displayName: 'Section',
  props: {
    ...IDENTITY_DEFAULTS,
    background: '',
    textColor: '',
    backgroundImage: '',
    overlay: true,
    overlayColor: 'rgb(0 0 0 / 0.45)',
    paddingTop: 64,
    paddingBottom: 64,
    paddingTopMobile: '',
    paddingBottomMobile: '',
    paddingX: 24,
    maxWidth: '',
    fullBleed: false,
    // Carries the design's own data-section-type across the import. The
    // imported stylesheet targets [data-section-type="hero"] etc. directly,
    // so dropping it renders those sections unstyled.
    sectionType: '',
    // Set by the design importer. Blank padding then means "none" instead of
    // the 64px/40px default, since the imported markup brings its own spacing.
    importedDesign: false,
  },
  related: { settings: SectionSettings },
  rules: {
    // Sections accept anything; the default child is a Row so a freshly
    // dropped Section is immediately usable.
    canMoveIn: () => true,
  },
};

/** What the Toolbox drags in — a Section pre-seeded with one Row. */
export function SectionPreset() {
  return (
    <Element is={Section} canvas>
      <Element is={Row} canvas />
    </Element>
  );
}
