import { useNode } from '@craftjs/core';
import {
  ColorField,
  FieldGroup,
  IconField,
  ImageField,
  LinkField,
  NumberField,
  RepeaterField,
  SelectField,
  TextField,
  TextareaField,
  ToggleField,
} from '../fields/index.jsx';
import { IDENTITY_DEFAULTS, cssVars, cx, px, resolveHref, useDomIdentity, useIsEditing, useNodeRef, sanitizeInline } from './nodeUtils.js';

export default function CardGrid({
  cards, columns, gap, media, cardBackground, hover, iconColor,
  // Class hooks used by the design importer: a converted grid keeps the
  // original design's class names, so its stylesheet still applies and the
  // conversion is visually lossless. Left blank for hand-built grids.
  gridClass, cardClass, mediaClass, bodyClass, eyebrowClass, titleClass, textClass, detailsClass, linkClass,
}) {
  const ref = useNodeRef();
  const editing = useIsEditing();
  const { domId, customClass } = useDomIdentity('cards');
  const items = Array.isArray(cards) ? cards : [];
  // An imported grid brings its own layout CSS; ours would fight it.
  const imported = Boolean(gridClass);

  return (
    <div
      ref={ref}
      id={domId}
      className={cx(!imported && 'bx-card-grid', gridClass, customClass)}
      style={imported ? undefined : cssVars({ '--bx-cards': columns, '--bx-card-gap': px(gap) })}
    >
      {items.map((card, index) => {
        const href = resolveHref(card.link?.url);
        // An imported card keeps the design's structure: the link stays on the
        // "read more" element, exactly where the designer put it. Wrapping the
        // whole card in an <a> would inherit link colour and underline —
        // imported card CSS has no reason to reset those.
        const Wrapper = href && !editing && !imported ? 'a' : 'div';
        return (
          <Wrapper
            key={index}
            className={cx(!imported && 'bx-card', !imported && hover && 'bx-card--hover', cardClass, card.className)}
            style={imported ? undefined : cssVars({ '--bx-card-bg': cardBackground, textDecoration: 'none', color: 'inherit' })}
            href={Wrapper === 'a' ? href : undefined}
            target={Wrapper === 'a' && card.link?.newTab ? '_blank' : undefined}
            rel={Wrapper === 'a' && card.link?.newTab ? 'noopener noreferrer' : undefined}
          >
            {media === 'image' && card.image && (
              mediaClass
                ? <div className={mediaClass}><img src={card.image} alt={card.title || ''} loading="lazy" /></div>
                : <img className="bx-card__media" src={card.image} alt={card.title || ''} loading="lazy" />
            )}
            <div className={cx(!imported && 'bx-card__body', bodyClass)}>
              {media === 'icon' && card.icon && (
                <div className="bx-card__icon" style={cssVars({ color: iconColor })}>
                  <i className={`fa-solid fa-${card.icon}`} />
                </div>
              )}
              {card.eyebrow && <div className={cx(!imported && 'bx-card__eyebrow', eyebrowClass)} dangerouslySetInnerHTML={{ __html: sanitizeInline(card.eyebrow) }} />}
              {card.title && <h3 className={cx(!imported && 'bx-card__title', titleClass)} dangerouslySetInnerHTML={{ __html: sanitizeInline(card.title) }} />}
              {card.text && <p className={cx(!imported && 'bx-card__text', textClass)} dangerouslySetInnerHTML={{ __html: sanitizeInline(card.text) }} />}
              {card.details && <p className={cx(!imported && 'bx-card__details', detailsClass)} dangerouslySetInnerHTML={{ __html: sanitizeInline(card.details) }} />}
              {card.linkLabel && href && (
                imported
                  ? (
                    <a
                      className={linkClass}
                      href={editing ? undefined : href}
                      target={card.link?.newTab ? '_blank' : undefined}
                      rel={card.link?.newTab ? 'noopener noreferrer' : undefined}
                      onClick={editing ? (e) => e.preventDefault() : undefined}
                    >
                      {card.linkLabel}
                    </a>
                  )
                  : <span className="bx-btn bx-btn--ghost" style={{ alignSelf: 'flex-start', marginTop: 'auto' }}>{card.linkLabel}</span>
              )}
            </div>
          </Wrapper>
        );
      })}
      {!items.length && <div className="bx-editor-note">Add cards in the settings panel</div>}
    </div>
  );
}

function CardGridSettings() {
  const { props, actions: { setProp } } = useNode((node) => ({ props: node.data.props }));
  const p = (key) => (value) => setProp((s) => { s[key] = value; });

  return (
    <>
      <FieldGroup title="Cards">
        <RepeaterField
          value={props.cards}
          onChange={p('cards')}
          addLabel="Add card"
          itemLabel={(card) => card.title}
          newItem={() => ({ eyebrow: '', title: 'Card title', text: 'Short supporting sentence.', details: '', icon: '', image: '', linkLabel: '', link: { url: '', newTab: false }, className: '' })}
          renderItem={(card, patch) => (
            <>
              <TextField label="Eyebrow (optional) — small line above the title" value={card.eyebrow} onChange={(v) => patch({ eyebrow: v })} />
              <TextField label="Title — basic HTML allowed (<br>, <strong>, <span>)" value={card.title} onChange={(v) => patch({ title: v })} />
              <TextareaField label="Text — basic HTML allowed (<br>, <strong>, <a>)" value={card.text} onChange={(v) => patch({ text: v })} rows={3} />
              <TextareaField
                label="Details (optional) — the longer paragraph under the text. Basic HTML allowed."
                value={card.details}
                onChange={(v) => patch({ details: v })}
                rows={3}
              />
              {props.media === 'image' && <ImageField label="Image" value={card.image} onChange={(v) => patch({ image: v })} />}
              {props.media === 'icon' && <IconField label="Icon" value={card.icon} onChange={(v) => patch({ icon: v })} />}
              <TextField label="Link label" value={card.linkLabel} onChange={(v) => patch({ linkLabel: v })} placeholder="Read more" />
              <LinkField label="Link" value={card.link} onChange={(v) => patch({ link: v })} />
              <TextField
                label="CSS class"
                value={card.className}
                onChange={(v) => patch({ className: v })}
                placeholder="reveal"
                hint="Added to this card only — e.g. an animation class from your design."
              />
            </>
          )}
        />
      </FieldGroup>

      <FieldGroup title="Layout">
        <SelectField
          label="Media"
          value={props.media}
          onChange={p('media')}
          options={[
            { value: 'none', label: 'Text only' },
            { value: 'icon', label: 'Icon' },
            { value: 'image', label: 'Image' },
          ]}
        />
        <NumberField label="Columns" value={props.columns} onChange={p('columns')} min={1} max={6} hint="Collapses to 2 on tablet and 1 on mobile automatically." />
        <NumberField label="Gap" value={props.gap} onChange={p('gap')} suffix="px" min={0} />
        <ToggleField label="Lift on hover" value={props.hover} onChange={p('hover')} />
        <ColorField label="Card background" value={props.cardBackground} onChange={p('cardBackground')} />
        <ColorField label="Icon colour" value={props.iconColor} onChange={p('iconColor')} />
      </FieldGroup>

      {/* The design's own class names, applied to the elements this block
          renders. The importer fills these in from the mockup; they are here
          so a hand-built card can match an imported one, and so it is visible
          why an imported grid is styled and a new one is not.

          These are the supported way to attach a design class to a card part.
          Wrapping the text in your own tag does not work: the text fields are
          rendered inside the element below, and a block tag nested in a <p> is
          invalid HTML, so it is unwrapped and its class goes with it. */}
      <FieldGroup title="Design classes" defaultOpen={false}>
        <TextField label="Grid class — the wrapper around all cards" value={props.gridClass} onChange={p('gridClass')} />
        <TextField label="Card class — each card" value={props.cardClass} onChange={p('cardClass')} />
        <TextField label="Media class — the image wrapper" value={props.mediaClass} onChange={p('mediaClass')} />
        <TextField label="Body class — the text wrapper" value={props.bodyClass} onChange={p('bodyClass')} />
        <TextField label="Eyebrow class" value={props.eyebrowClass} onChange={p('eyebrowClass')} />
        <TextField label="Title class" value={props.titleClass} onChange={p('titleClass')} />
        <TextField label="Text class" value={props.textClass} onChange={p('textClass')} />
        <TextField label="Details class" value={props.detailsClass} onChange={p('detailsClass')} />
        <TextField label="Link class" value={props.linkClass} onChange={p('linkClass')} />
      </FieldGroup>

      <FieldGroup title="Identity" defaultOpen={false}>
        <TextField label="Custom ID" value={props.customId} onChange={p('customId')} />
        <TextField label="Custom CSS class" value={props.customClass} onChange={p('customClass')} />
      </FieldGroup>
    </>
  );
}

CardGrid.craft = {
  displayName: 'Card Grid',
  props: {
    ...IDENTITY_DEFAULTS,
    // Placeholder copy only — never ship another client's real content in a
    // component default or a starter template.
    cards: [
      { eyebrow: '', title: 'First card', text: 'Replace this with a short description.', details: '', icon: 'star', image: '', linkLabel: '', link: { url: '', newTab: false } },
      { eyebrow: '', title: 'Second card', text: 'Replace this with a short description.', details: '', icon: 'bolt', image: '', linkLabel: '', link: { url: '', newTab: false } },
      { eyebrow: '', title: 'Third card', text: 'Replace this with a short description.', details: '', icon: 'heart', image: '', linkLabel: '', link: { url: '', newTab: false } },
    ],
    columns: 3,
    gap: 24,
    media: 'icon',
    cardBackground: '',
    hover: true,
    iconColor: '',
    // Populated only by the design importer.
    gridClass: '',
    cardClass: '',
    mediaClass: '',
    bodyClass: '',
    titleClass: '',
    textClass: '',
    eyebrowClass: '',
    detailsClass: '',
    linkClass: '',
  },
  related: { settings: CardGridSettings },
};
