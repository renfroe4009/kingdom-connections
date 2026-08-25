import { useNode } from '@craftjs/core';
import { ChoiceField, ColorField, FieldGroup, IconField, LinkField, SelectField, TextField, ToggleField } from '../fields/index.jsx';
import InlineText from './InlineText.jsx';
import { IDENTITY_DEFAULTS, cssVars, cx, resolveHref, useDomIdentity, useIsEditing, useNodeRef } from './nodeUtils.js';

export default function ButtonBlock({ label, link, variant, size, icon, iconPosition, background, textColor, radius, fullWidth, align, importedClass }) {
  const ref = useNodeRef();
  const editing = useIsEditing();
  const { domId, customClass } = useDomIdentity('button');
  const { actions } = useNode();

  const style = cssVars({
    '--bx-btn-bg': background,
    '--bx-btn-fg': textColor,
    '--bx-btn-radius': radius,
    '--bx-btn-size': size === 'sm' ? '0.875rem' : size === 'lg' ? '1.125rem' : '',
    '--bx-btn-py': size === 'sm' ? '8px' : size === 'lg' ? '16px' : '',
    '--bx-btn-px': size === 'sm' ? '16px' : size === 'lg' ? '32px' : '',
  });

  const iconEl = icon ? <i className={`fa-solid fa-${icon}`} /> : null;
  // An imported button carries the design's own class instead of ours.
  const imported = Boolean(importedClass);
  const className = cx(!imported && 'bx-btn', !imported && variant !== 'solid' && `bx-btn--${variant}`, !imported && fullWidth && 'bx-btn--block', importedClass, customClass);

  const inner = (
    <>
      {iconPosition === 'left' && iconEl}
      <InlineText
        as="span"
        value={label}
        editable={editing}
        placeholder="Button"
        onChange={(v) => actions.setProp((p) => { p.label = v; })}
      />
      {iconPosition === 'right' && iconEl}
    </>
  );

  // In the editor the anchor must not navigate — clicking is how you select it.
  return (
    <div ref={ref} style={{ display: 'flex', justifyContent: align || 'flex-start' }}>
      <a
        id={domId}
        className={className}
        style={style}
        href={editing ? undefined : resolveHref(link?.url)}
        target={!editing && link?.newTab ? '_blank' : undefined}
        rel={!editing && link?.newTab ? 'noopener noreferrer' : undefined}
        onClick={editing ? (e) => e.preventDefault() : undefined}
      >
        {inner}
      </a>
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
  },
  related: { settings: ButtonSettings },
};
