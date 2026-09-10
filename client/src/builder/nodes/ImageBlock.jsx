import { useNode } from '@craftjs/core';
import { FieldGroup, ImageField, LinkField, SelectField, TextField } from '../fields/index.jsx';
import { IDENTITY_DEFAULTS, cssVars, cx, resolveHref, useDomIdentity, useIsEditing, useNodeRef } from './nodeUtils.js';

export default function ImageBlock({ src, alt, caption, fit, radius, ratio, maxWidth, link, bare }) {
  const ref = useNodeRef();
  const editing = useIsEditing();
  const { domId, customClass } = useDomIdentity('image');

  // `bare` renders just the <img>, with no class or <figure> wrapper. Imported
  // designs style the image through its parent (`.split-section__media img`),
  // and an extra wrapper element can break that parent's grid or flex layout.
  const img = src ? (
    <img
      className={bare ? undefined : cx('bx-image', fit && `bx-image--${fit}`)}
      src={src}
      alt={alt || ''}
      loading="lazy"
      style={bare ? undefined : cssVars({ '--bx-image-radius': radius, aspectRatio: ratio })}
    />
  ) : (
    <div className="bx-editor-note">
      <i className="fa-solid fa-image" /> Pick an image in the settings panel
    </div>
  );

  const href = resolveHref(link?.url);
  // Keep the <a> in the tree even while editing (just non-navigating) rather
  // than dropping it: a design's CSS often sizes/frames the image through
  // its anchor (e.g. `.home-mtn__faces a`), so omitting it here made linked
  // images render at their natural size in the builder canvas only.
  const body = href ? (
    <a
      href={editing ? undefined : href}
      target={link?.newTab ? '_blank' : undefined}
      rel={link?.newTab ? 'noopener noreferrer' : undefined}
      onClick={editing ? (e) => e.preventDefault() : undefined}
    >
      {img}
    </a>
  ) : (
    img
  );

  if (bare && !caption) {
    // Attach Craft's ref straight to the <img> so it stays selectable without
    // introducing a wrapper the design's CSS doesn't expect.
    if (!src) {
      return <div ref={ref} id={domId} className="bx-editor-note">Pick an image in the settings panel</div>;
    }
    const bareImg = (
      <img
        ref={ref}
        id={domId}
        className={customClass || undefined}
        src={src}
        alt={alt || ''}
        loading="lazy"
      />
    );
    // A linked bare image still has to render its anchor, and needs to keep
    // it while editing too: the design's CSS often sizes the image through
    // that anchor (e.g. `.home-mtn__faces a`), so dropping it in the canvas
    // left the image at its natural size there even though the live page
    // (which does render the anchor) looked right. Non-navigating while
    // editing so clicking the image still selects it in the canvas.
    return href
      ? (
        <a
          href={editing ? undefined : href}
          target={link?.newTab ? '_blank' : undefined}
          rel={link?.newTab ? 'noopener noreferrer' : undefined}
          onClick={editing ? (e) => e.preventDefault() : undefined}
        >
          {bareImg}
        </a>
      )
      : bareImg;
  }

  return (
    <figure ref={ref} id={domId} className={cx('bx-figure', customClass)} style={cssVars({ maxWidth })}>
      {body}
      {caption && <figcaption>{caption}</figcaption>}
    </figure>
  );
}

function ImageSettings() {
  const { props, actions: { setProp } } = useNode((node) => ({ props: node.data.props }));
  const p = (key) => (value) => setProp((s) => { s[key] = value; });

  return (
    <>
      <FieldGroup title="Image">
        <ImageField label="Source" value={props.src} onChange={p('src')} />
        <TextField
          label="Alt text"
          value={props.alt}
          onChange={p('alt')}
          hint="Describes the image for screen readers and search engines. Leave blank only for purely decorative images."
        />
        <TextField label="Caption" value={props.caption} onChange={p('caption')} />
        <LinkField label="Link" value={props.link} onChange={p('link')} />
      </FieldGroup>

      <FieldGroup title="Style">
        <SelectField
          label="Fit"
          value={props.fit}
          onChange={p('fit')}
          options={[
            { value: '', label: 'Natural' },
            { value: 'cover', label: 'Cover (fill and crop)' },
            { value: 'contain', label: 'Contain (fit inside)' },
          ]}
        />
        <SelectField
          label="Aspect ratio"
          value={props.ratio}
          onChange={p('ratio')}
          options={[
            { value: '', label: 'Original' },
            { value: '1 / 1', label: 'Square' },
            { value: '4 / 3', label: '4:3' },
            { value: '16 / 9', label: '16:9' },
            { value: '3 / 4', label: 'Portrait 3:4' },
          ]}
        />
        <TextField label="Corner radius" value={props.radius} onChange={p('radius')} placeholder="8px" />
        <TextField label="Max width" value={props.maxWidth} onChange={p('maxWidth')} placeholder="480px" />
      </FieldGroup>

      <FieldGroup title="Identity" defaultOpen={false}>
        <TextField label="Custom ID" value={props.customId} onChange={p('customId')} />
        <TextField label="Custom CSS class" value={props.customClass} onChange={p('customClass')} />
      </FieldGroup>
    </>
  );
}

ImageBlock.craft = {
  displayName: 'Image',
  props: { ...IDENTITY_DEFAULTS, src: '', alt: '', caption: '', fit: '', radius: '', ratio: '', maxWidth: '', link: { url: '', newTab: false }, bare: false },
  related: { settings: ImageSettings },
};
