import { useNode } from '@craftjs/core';
import { ChoiceField, ColorField, FieldGroup, IconField, ImageField, LinkField, SelectField, TextField, ToggleField } from '../fields/index.jsx';
import InlineText from './InlineText.jsx';
import { sanitizeHtml } from '../../utils/sanitizeHtml.js';
import { IDENTITY_DEFAULTS, cssVars, cx, parseInlineStyle, resolveHref, useDomIdentity, useIsEditing, useNodeRef } from './nodeUtils.js';

// `image`/`imagePosition` exist for imported designs whose links are picture
// tiles — the 7 Mountains jump bar is `<a><span>Family</span><img …></a>`, and
// a label-only button loses the portrait the design is built around.
export default function ButtonBlock({ label, link, variant, size, icon, iconPosition, background, textColor, radius, fullWidth, align, importedClass, importedStyle, image, imageAlt, imagePosition, bare, labelRich }) {
  const ref = useNodeRef();
  const editing = useIsEditing();
  const { domId, customClass } = useDomIdentity('button');
  const { actions } = useNode();

  // An imported link keeps the design's own inline style (one-off spacing the
  // class doesn't carry), on top of whatever the panel sets.
  const style = cssVars({
    '--bx-btn-bg': background,
    '--bx-btn-fg': textColor,
    '--bx-btn-radius': radius,
    '--bx-btn-size': size === 'sm' ? '0.875rem' : size === 'lg' ? '1.125rem' : '',
    '--bx-btn-py': size === 'sm' ? '8px' : size === 'lg' ? '16px' : '',
    '--bx-btn-px': size === 'sm' ? '16px' : size === 'lg' ? '32px' : '',
  });
  Object.assign(style, parseInlineStyle(importedStyle));

  const iconEl = icon ? <i className={`fa-solid fa-${icon}`} /> : null;
  // An imported button carries the design's own class instead of ours.
  // `bare` covers the other imported shape: a link the design styles through
  // its container (`.mtn-jump__row a`) and so gives no class of its own.
  // Adding `bx-btn` there paints it solid gold and overrides the design.
  const imported = Boolean(importedClass) || bare;
  const className = cx(!imported && 'bx-btn', !imported && variant !== 'solid' && `bx-btn--${variant}`, !imported && fullWidth && 'bx-btn--block', importedClass, customClass);

  const imageEl = image ? <img src={image} alt={imageAlt || ''} /> : null;

  const inner = (
    <>
      {iconPosition === 'left' && iconEl}
      {imagePosition === 'before' && imageEl}
      <InlineText
        as="span"
        value={label}
        rich={Boolean(labelRich)}
        singleLine
        editable={editing}
        placeholder="Button"
        onChange={(v) => actions.setProp((p) => { p.label = v; })}
      />
      {imagePosition !== 'before' && imageEl}
      {iconPosition === 'right' && iconEl}
    </>
  );

  // A structured label is the link's own content, not something inside a
  // wrapper: `.store-badge` lays out its svg and text as flex ROW children,
  // and an extra <span> around both makes the logo sit above the text. On the
  // live page the markup therefore goes straight into the anchor. In the
  // editor it keeps the wrapper, which is what makes the label editable.
  const richContent = labelRich && !editing;

  // In the editor the anchor must not navigate — clicking is how you select it.
  const anchor = (
    <a
      ref={imported ? ref : undefined}
      id={domId}
      className={className}
      style={style}
      href={editing ? undefined : resolveHref(link?.url)}
      target={!editing && link?.newTab ? '_blank' : undefined}
      rel={!editing && link?.newTab ? 'noopener noreferrer' : undefined}
      onClick={editing ? (e) => e.preventDefault() : undefined}
      {...(richContent ? { dangerouslySetInnerHTML: { __html: sanitizeHtml(label || '') } } : {})}
    >
      {richContent ? undefined : inner}
    </a>
  );

  // An imported link IS the element the design's parent lays out — partner
  // chips are direct children of a 6-column grid. Wrapping each one in a
  // flex div makes the WRAPPER the grid cell, so the chips stop filling
  // their column and the row spacing goes ragged. Our own buttons keep the
  // wrapper, which is what the alignment control acts on.
  if (imported) return anchor;

  return (
    <div ref={ref} style={{ display: 'flex', justifyContent: align || 'flex-start' }}>
      {anchor}
    </div>
  );
}

function ButtonSettings() {
  const { props, actions: { setProp } } = useNode((node) => ({ props: node.data.props }));
  const p = (key) => (value) => setProp((s) => { s[key] = value; });

  return (
    <>
      <FieldGroup title="Content">
        <TextField label="Label" value={props.label} onChange={p('label')} />
        <LinkField label="Link" value={props.link} onChange={p('link')} />
        <IconField label="Icon" value={props.icon} onChange={p('icon')} />
        <ImageField label="Image" value={props.image} onChange={p('image')} hint="Shown inside the link, for picture tiles." />
        {props.image && (
          <>
            <TextField label="Image alt text" value={props.imageAlt} onChange={p('imageAlt')} />
            <ChoiceField
              label="Image position"
              value={props.imagePosition || 'after'}
              onChange={p('imagePosition')}
              options={[
                { value: 'before', label: 'Before label', icon: 'fa-solid fa-arrow-left' },
                { value: 'after', label: 'After label', icon: 'fa-solid fa-arrow-right' },
              ]}
            />
          </>
        )}
        {props.icon && (
          <ChoiceField
            label="Icon position"
            value={props.iconPosition}
            onChange={p('iconPosition')}
            options={[
              { value: 'left', label: 'Left', icon: 'fa-solid fa-arrow-left' },
              { value: 'right', label: 'Right', icon: 'fa-solid fa-arrow-right' },
            ]}
          />
        )}
      </FieldGroup>

      <FieldGroup title="Style">
        <SelectField
          label="Variant"
          value={props.variant}
          onChange={p('variant')}
          options={[
            { value: 'solid', label: 'Solid' },
            { value: 'outline', label: 'Outline' },
            { value: 'ghost', label: 'Text only' },
          ]}
        />
        <SelectField
          label="Size"
          value={props.size}
          onChange={p('size')}
          options={[
            { value: 'sm', label: 'Small' },
            { value: 'md', label: 'Medium' },
            { value: 'lg', label: 'Large' },
          ]}
        />
        <ChoiceField
          label="Align"
          value={props.align}
          onChange={p('align')}
          options={[
            { value: 'flex-start', label: 'Left', icon: 'fa-solid fa-align-left' },
            { value: 'center', label: 'Center', icon: 'fa-solid fa-align-center' },
            { value: 'flex-end', label: 'Right', icon: 'fa-solid fa-align-right' },
          ]}
        />
        <ToggleField label="Full width" value={props.fullWidth} onChange={p('fullWidth')} />
        <ColorField label="Background" value={props.background} onChange={p('background')} hint="Blank uses the site's button colour from Web Settings." />
        <ColorField label="Text colour" value={props.textColor} onChange={p('textColor')} />
        <TextField label="Corner radius" value={props.radius} onChange={p('radius')} placeholder="8px" />
      </FieldGroup>

      <FieldGroup title="Identity" defaultOpen={false}>
        <TextField label="Custom ID" value={props.customId} onChange={p('customId')} />
        <TextField label="Custom CSS class" value={props.customClass} onChange={p('customClass')} />
      </FieldGroup>
    </>
  );
}

ButtonBlock.craft = {
  displayName: 'Button',
  props: {
    ...IDENTITY_DEFAULTS,
    label: 'Learn more',
    // The label is markup (a store badge's logo + two lines), not plain text.
    labelRich: false,
    link: { url: '', newTab: false },
    variant: 'solid',
    size: 'md',
    icon: '',
    iconPosition: 'right',
    background: '',
    textColor: '',
    radius: '',
    fullWidth: false,
    align: 'flex-start',
    importedClass: '',
    importedStyle: '',
    // Set by the importer for links the design styles through their
    // container — render no button classes of our own.
    bare: false,
    // Picture tiles: an image inside the link itself (see the component).
    image: '',
    imageAlt: '',
    imagePosition: 'after',
  },
  related: { settings: ButtonSettings },
};
