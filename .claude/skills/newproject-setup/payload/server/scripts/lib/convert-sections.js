// =============================================================================
// Rule-based HTML → Craft component conversion.
//
// This is deliberately NOT a general-purpose HTML-to-components converter.
// Those don't work: arbitrary markup has no reliable mapping onto a fixed set
// of components, so a generic converter either mangles the design or produces
// a component tree nobody can edit.
//
// Instead it recognises the *specific repeating patterns* in the design being
// imported, and leaves everything else as an HTML block. That means:
//   • recognised patterns become real, editable components;
//   • unrecognised markup still renders exactly as designed;
//   • nothing is ever lost — worst case a chunk stays as HTML.
//
// Converted components carry the design's own class names (`titleClass`,
// `gridClass`, …), so the imported stylesheet keeps styling them and the
// conversion is visually lossless. Add a rule below when a new design brings a
// new pattern.
// =============================================================================

const CARD_TITLE = /(^|\s)([a-z0-9-]*card__title|[a-z0-9-]*-title|h3)(\s|$)/i;

// Tags that carry no layout of their own, so an element containing only these
// is still a text leaf rather than a container.
const INLINE_TAGS = /^(br|b|strong|i|em|span|small|sup|sub|u|s|a|code|abbr|time|mark)$/;

/** Text content with entities decoded and whitespace collapsed. */
const textOf = (node) => (node ? node.text.replace(/\s+/g, ' ').trim() : '');

/** Inner markup, for fields the component renders as HTML (card title/text).
 *  Designs accent part of a string — `This <span class="gold">Movement</span>`,
 *  `50,000<span>+</span>` — and textOf() flattens exactly that away. */
const htmlOf = (node) => (node ? node.innerHTML.replace(/\s+/g, ' ').trim() : '');

/** The element immediately before a card's title — a badge, tag or letter
 *  (`<div class="letter-badge">K</div>`, `<span class="card-tag">
 *  Network</span>`). Distinct from a section eyebrow: this one lives inside
 *  a single card, not above the section heading. Every card rule below only
 *  looked for a title and a paragraph, so this content was silently dropped
 *  — the letter badges and category tags disappeared on import while the
 *  section still reported as fully converted.
 *
 *  Guarded to the media wrapper and to inline-only content, so a genuine
 *  second paragraph or a nested card is never mistaken for a one-line badge. */
function findEyebrow(title, mediaWrap) {
  if (!title || !title.parentNode) return null;
  const siblings = title.parentNode.childNodes.filter((n) => n.nodeType === 1);
  const idx = siblings.indexOf(title);
  if (idx <= 0) return null;
  const candidate = siblings[idx - 1];
  if (!candidate || candidate === mediaWrap || candidate.querySelector('img')) return null;
  const kids = candidate.childNodes.filter((n) => n.nodeType === 1);
  const inlineOnly = kids.every((el) => INLINE_TAGS.test((el.rawTagName || '').toLowerCase()));
  if (!inlineOnly || !textOf(candidate)) return null;
  return candidate;
}

const classesOf = (node) => (node?.getAttribute('class') || '').split(/\s+/).filter(Boolean);
const hasClass = (node, name) => classesOf(node).includes(name);
const firstClass = (node, suffix) => classesOf(node).find((c) => c.endsWith(suffix)) || '';

/* ── Rule: uniform `ns-block` set → Card Grid ─────────────────────────────
 * When every cell of an `ns-grid` shares a class (`stat`, `program-card`),
 * they're a repeating set rather than a bespoke layout — and a repeater is a
 * far better editing surface than N separate columns: items can be added,
 * removed and reordered from the settings panel.
 *
 * Deliberately emits an EMPTY `gridClass`, so CardGrid's own `bx-card-grid`
 * lays the cards out from the `columns` prop. Passing `ns-grid` through would
 * hand layout back to the design, whose `.ns-block` cells are positioned by
 * per-cell inline `--col-start`/`--col-span` that a repeater has nowhere to
 * store — every card would fall back to `grid-column: 1 / -1` and stack.
 *
 * The design still supplies all the *styling*, because the card, title and
 * text classes are passed through. The trade-off is gutters: they come from
 * `--bx-card-gap` rather than the design's `--grid-gap`.
 */
function convertNsCardGrid(node, make) {
  if (!hasClass(node, 'ns-grid')) return null;

  const blocks = node.childNodes.filter((n) => n.nodeType === 1);
  if (blocks.length < 2) return null;

  // The shared class is the signal. `ns-*` names are the layout contract every
  // block carries, so they prove nothing about the content being repetitive.
  //
  // Find the longest *consecutive run* of blocks sharing one, rather than
  // requiring every block to match. Real sections are rarely pure: this design
  // routinely opens with a `section-head` and closes with a "view all" link,
  // with the cards in between. Demanding uniformity across the whole grid gave
  // up on exactly the sections most worth converting.
  let run = { start: 0, len: 0 };
  for (let i = 0; i < blocks.length; i += 1) {
    for (const c of classesOf(blocks[i]).filter((x) => !x.startsWith('ns-'))) {
      let j = i;
      while (j < blocks.length && hasClass(blocks[j], c)) j += 1;
      if (j - i > run.len) run = { start: i, len: j - i };
    }
  }
  if (run.len < 2) return null;

  const leading = blocks.slice(0, run.start);
  const trailing = blocks.slice(run.start + run.len);
  const cardBlocks = blocks.slice(run.start, run.start + run.len);

  // This design labels parts by class suffix rather than by tag: a stat's value
  // is `.stat-number`, not an <h3>. Try tags first, then fall back to the
  // suffix, so both conventions convert.
  const pick = (block, tags, suffix) => (tags && block.querySelector(tags))
    || block.querySelectorAll('*').find((el) => classesOf(el).some((c) => suffix.test(c)));

  const cards = [];
  let cardClass = '', eyebrowClass = '', titleClass = '', textClass = '', detailsClass = '', mediaClass = '', linkClass = '';

  for (const block of cardBlocks) {
    const title = pick(block, 'h2, h3, h4', /(title|number|name|heading)$/);
    const text = pick(block, 'p', /(text|label|desc|body|quote)$/);
    if (!title && !text) return null;

    const img = block.querySelector('img');
    const nsMediaWrap = img?.parentNode?.nodeType === 1 && img.parentNode !== block ? img.parentNode : null;
    const eyebrow = findEyebrow(title, nsMediaWrap);
    // The block may *be* the link (`<a class="ns-block program-card">`). A
    // descendant-only search misses that and silently drops the href — the
    // exact defect that made the generic card-grid rule unsafe here.
    const isLink = (block.rawTagName || '').toLowerCase() === 'a';
    const anchor = isLink ? block : block.querySelector('a');
    const cta = pick(block, null, /(cta|link|more)$/);

    cardClass = cardClass || classesOf(block).filter((c) => c !== 'ns-block').join(' ');
    eyebrowClass = eyebrowClass || (eyebrow?.getAttribute('class') || '');
    titleClass = titleClass || (title?.getAttribute('class') || '');
    textClass = textClass || (text?.getAttribute('class') || '');
    // Anything after the first paragraph is the card's longer copy. Picking
    // one element per card dropped it — the same blind spot the generic card
    // rule had, and the reason imported stat cards showed a bare number.
    const rest = block.querySelectorAll('p').filter((p) => p !== text);
    detailsClass = detailsClass || (rest[0]?.getAttribute('class') || '');
    mediaClass = mediaClass || (img?.parentNode?.getAttribute?.('class') || '');
    linkClass = linkClass || (anchor && !isLink ? (anchor.getAttribute('class') || '') : '');

    cards.push({
      eyebrow: htmlOf(eyebrow),
      title: htmlOf(title),
      text: htmlOf(text),
      details: rest.map((p) => htmlOf(p)).filter(Boolean).join(' '),
      image: img?.getAttribute('src') || '',
      icon: '',
      linkLabel: cta && cta !== title && cta !== text ? textOf(cta) : '',
      link: { url: anchor?.getAttribute('href') || '', newTab: anchor?.getAttribute('target') === '_blank' },
    });
  }

  // Leading heading and any trailing "view all" link stay in document order
  // around the grid, so the section still reads the way the design does.
  return [
    ...leading.flatMap((b) => convertContent(b, make)),
    make('CardGrid', {
    cards,
    media: cards.some((c) => c.image) ? 'image' : 'none',
    columns: Math.min(cards.length, 4),
    gap: 24,
    hover: false,
    cardBackground: '',
    iconColor: '',
    customId: '',
    customClass: '',
    gridClass: '',
    cardClass,
    mediaClass,
    bodyClass: '',
      eyebrowClass,
      titleClass,
      textClass,
      detailsClass,
      linkClass,
    }),
    ...trailing.flatMap((b) => convertContent(b, make)),
  ];
}

/* ── Rule: explicit grid contract (`ns-grid` → Row, `ns-block` → Column) ──
 * Some designs already ship a builder contract of their own: every section is
 * `<section class="ns-section"> <div class="ns-grid"> <div class="ns-block">`,
 * where each block carries its 12-column placement as inline custom
 * properties (`--col-start`, `--col-span`, plus `-md`/`-sm` tiers).
 *
 * That maps straight onto Row → Column, which is the best case available: the
 * layout becomes real, selectable, rearrangeable structure instead of one
 * opaque HTML blob, and the placement is preserved exactly because the Column
 * keeps both the `ns-block` class and the inline properties it reads.
 *
 * This rule must run BEFORE convertCardGrid. `ns-grid` ends in `-grid`, so the
 * card-grid rule matches the wrapper by coincidence and converts the section's
 * one-and-only child into a two-card grid — dropping every paragraph after the
 * first, every inline SVG icon, and (because it searches descendants of a card
 * that is itself an <a>) every card's href.
 */
function convertNsGrid(node, make) {
  if (!hasClass(node, 'ns-grid')) return null;

  const blocks = node.childNodes.filter((n) => n.nodeType === 1);
  if (!blocks.length) return null;

  const columns = blocks.map((block) => {
    // A block that is itself a link (`<a class="ns-block program-card">`) can't
    // become a Column, which renders a <div> — the href would be lost. Keep the
    // whole element as HTML and let the Column carry only the grid placement,
    // so the link survives and the cell still sits in the right track.
    //
    // Returning null for these instead would be worse than useless: the section
    // would fall through to convertCardGrid, whose class-suffix test `.ns-grid`
    // happens to satisfy, and it drops every card's href on the way past.
    const isLink = (block.rawTagName || '').toLowerCase() !== 'div';

    return make('Column', {
      importedClass: isLink ? 'ns-block' : classesOf(block).join(' '),
      importedStyle: block.getAttribute('style') || '',
      span: 12, spanTablet: '', spanMobile: '', padding: {}, gap: 16,
      verticalAlign: 'flex-start', horizontalAlign: 'stretch', textAlign: '',
      customId: '', customClass: '',
    }, isLink
      ? [make('HtmlBlock', { markup: block.outerHTML.trim(), runScripts: false, customId: '', customClass: '' })]
      : convertContent(block, make));
  });

  return [make('Row', {
    importedClass: classesOf(node).join(' '),
    mode: 'grid', gap: 0, align: 'stretch', justify: 'flex-start', wrap: true,
    customId: '', customClass: '',
  }, columns)];
}

/* ── Rule: section header ─────────────────────────────────────────────────
 * <div class="section-header">
 *   <span class="section-label">…</span>      → Heading eyebrow
 *   <h2 class="section-title">…</h2>          → Heading text
 *   <p class="section-desc">…</p>             → Text block
 * The single highest-value rule: this pattern repeats ~24 times across a
 * typical multi-page design.
 */
function convertSectionHeader(node, make) {
  if (!classesOf(node).some((c) => c === 'section-header' || c.endsWith('-header'))) return null;
  const label = node.querySelector('.section-label, .eyebrow, .label');
  const title = node.querySelector('h1, h2, h3');
  const desc = node.querySelector('p');
  if (!title) return null;

  const out = [make('Heading', {
    // innerHTML, not text — a design commonly accents one word inside the
    // heading (<em>Consistency</em>), and flattening it loses that styling.
    text: title.innerHTML.trim(),
    eyebrow: textOf(label),
    level: (title.rawTagName || 'h2').toLowerCase(),
    titleClass: (title.getAttribute('class') || ''),
    eyebrowClass: (label?.getAttribute('class') || ''),
    customClass: classesOf(node).filter((c) => c !== 'reveal').join(' '),
    size: '', weight: '', align: '', color: '', eyebrowColor: '', customId: '',
  })];

  if (desc) {
    out.push(make('TextBlock', {
      html: desc.innerHTML.trim(),
      customClass: desc.getAttribute('class') || '',
      size: '', align: '', color: '', maxWidth: '', customId: '',
    }));
  }
  return out;
}

/* ── Rule: card grid ──────────────────────────────────────────────────────
 * A container whose class ends in `-grid`, holding repeated <article>/<div>
 * children that each contain a heading and a paragraph. Becomes a Card Grid
 * whose items live in a repeater — the thing a client can actually edit.
 */
function convertCardGrid(node, make) {
  // Matches both `overview-grid` and BEM's `pillars__grid`.
  const gridClass = classesOf(node).find((c) => /[-_]grid$/.test(c));
  if (!gridClass) return null;

  const children = node.childNodes.filter((n) => n.nodeType === 1);
  if (children.length < 2) return null;

  // Some designs paint a card's image as a background on a div rather than an
  // <img>. A Card Grid item has no way to carry that, so converting would
  // silently drop the visual — leave the whole grid as HTML instead. Losing a
  // conversion is cheap; losing the design is not.
  const usesBackgroundImages = children.some((child) => !child.querySelector('img')
    && child.querySelectorAll('*').some((el) => /background-image/i.test(el.getAttribute('style') || '')));
  if (usesBackgroundImages) return null;

  const cards = [];
  let cardClass = '', mediaClass = '', bodyClass = '', eyebrowClass = '', titleClass = '', textClass = '', detailsClass = '', linkClass = '';

  for (const child of children) {
    const title = child.querySelector('h2, h3, h4');
    // Every paragraph, not just the first. A stat card is two <p>s — the
    // value and its label — and taking only one silently dropped the label,
    // leaving a page of bare numbers with nothing to say what they count.
    const paragraphs = child.querySelectorAll('p');
    const desc = paragraphs[0] || null;
    const extra = paragraphs.slice(1);
    // Without a title and text it isn't a card; bail rather than guess.
    if (!title && !desc) return null;

    const img = child.querySelector('img');
    const link = child.querySelector('a');
    const mediaWrap = img?.parentNode?.nodeType === 1 && img.parentNode !== child ? img.parentNode : null;
    const eyebrow = findEyebrow(title, mediaWrap);
    const bodyWrap = title?.parentNode?.nodeType === 1 && title.parentNode !== child ? title.parentNode : null;

    cardClass = cardClass || classesOf(child).join(' ');
    mediaClass = mediaClass || (mediaWrap?.getAttribute('class') || '');
    bodyClass = bodyClass || (bodyWrap?.getAttribute('class') || '');
    eyebrowClass = eyebrowClass || (eyebrow?.getAttribute('class') || '');
    titleClass = titleClass || (title?.getAttribute('class') || '');
    textClass = textClass || (desc?.getAttribute('class') || '');
    detailsClass = detailsClass || (extra[0]?.getAttribute('class') || '');
    linkClass = linkClass || (link?.getAttribute('class') || '');

    cards.push({
      eyebrow: htmlOf(eyebrow),
      title: htmlOf(title),
      text: htmlOf(desc),
      details: extra.map((p) => htmlOf(p)).filter(Boolean).join(' '),
      image: img?.getAttribute('src') || '',
      icon: '',
      linkLabel: link ? textOf(link) : '',
      link: { url: link?.getAttribute('href') || '', newTab: false },
    });
  }

  if (!cards.length) return null;

  return [make('CardGrid', {
    cards,
    media: cards.some((c) => c.image) ? 'image' : 'none',
    columns: Math.min(cards.length, 4),
    gap: 24,
    hover: false,
    cardBackground: '',
    iconColor: '',
    customId: '',
    customClass: '',
    gridClass,
    cardClass,
    mediaClass,
    bodyClass,
    eyebrowClass,
    titleClass,
    textClass,
    detailsClass,
    linkClass,
  })];
}

/* ── Sequential content conversion ────────────────────────────────────────
 * For a container whose children are loose content (a label, a heading, a
 * paragraph, a button) rather than a recognised composite. Walks them in
 * order, converting what it knows and passing anything else through as HTML,
 * so order and layout are preserved exactly.
 */
/** Convert the children of a container. `depth` bounds the recursion below. */
function convertContent(container, make, depth = 0) {
  return convertKids(container.childNodes.filter((n) => n.nodeType === 1), make, depth);
}

function convertKids(kids, make, depth = 0) {
  const out = [];
  let pendingLabel = null;

  for (const kid of kids) {
    const tag = (kid.rawTagName || '').toLowerCase();
    const cls = kid.getAttribute('class') || '';

    // A small label immediately before a heading becomes that heading's eyebrow.
    if ((tag === 'span' || tag === 'p') && /label|eyebrow/i.test(cls) && !pendingLabel) {
      pendingLabel = kid;
      continue;
    }

    if (/^h[1-6]$/.test(tag)) {
      out.push(make('Heading', {
        // innerHTML, not text: designs routinely style one word with <em>.
        text: kid.innerHTML.trim(),
        eyebrow: pendingLabel ? textOf(pendingLabel) : '',
        level: tag,
        titleClass: cls,
        eyebrowClass: pendingLabel?.getAttribute('class') || '',
        size: '', weight: '', align: '', color: '', eyebrowColor: '', customId: '', customClass: '',
      }));
      pendingLabel = null;
      continue;
    }

    if (tag === 'p') {
      out.push(make('TextBlock', {
        html: kid.innerHTML.trim(), customClass: cls,
        size: '', align: '', color: '', maxWidth: '', customId: '',
      }));
      continue;
    }

    if (tag === 'a' && /btn|button|cta/i.test(cls)) {
      out.push(make('ButtonBlock', {
        label: textOf(kid),
        link: { url: kid.getAttribute('href') || '', newTab: kid.getAttribute('target') === '_blank' },
        importedClass: cls,
        variant: 'solid', size: 'md', icon: '', iconPosition: 'right',
        background: '', textColor: '', radius: '', fullWidth: false, align: 'flex-start',
        customId: '', customClass: '',
      }));
      continue;
    }

    if (tag === 'img') {
      out.push(make('ImageBlock', {
        src: kid.getAttribute('src') || '', alt: kid.getAttribute('alt') || '',
        bare: true, caption: '', fit: '', radius: '', ratio: '', maxWidth: '',
        link: { url: '', newTab: false }, customId: '', customClass: cls,
      }));
      continue;
    }

    // A section head: eyebrow + heading, frequently with a "view all" link
    // sitting beside them. Emitted as Heading (+ Button) rather than passed to
    // convertSectionHeader, which matches on `-header` and keeps no link — it
    // would drop the "View all programs" anchor on the way through.
    if (/(^|\s)([a-z0-9-]*-head|section-header)(\s|$)/.test(cls)) {
      const eyebrow = kid.querySelector('.eyebrow, .section-label, .label');
      const title = kid.querySelector('h1, h2, h3, h4');
      const link = kid.querySelector('a');
      if (title) {
        out.push(make('Heading', {
          text: title.innerHTML.trim(),
          eyebrow: textOf(eyebrow),
          level: (title.rawTagName || 'h2').toLowerCase(),
          titleClass: title.getAttribute('class') || '',
          eyebrowClass: eyebrow?.getAttribute('class') || '',
          customClass: cls,
          size: '', weight: '', align: '', color: '', eyebrowColor: '', customId: '',
        }));
        if (link) {
          out.push(make('ButtonBlock', {
            label: textOf(link),
            link: { url: link.getAttribute('href') || '', newTab: link.getAttribute('target') === '_blank' },
            importedClass: link.getAttribute('class') || '',
            variant: 'solid', size: 'md', icon: '', iconPosition: 'right',
            background: '', textColor: '', radius: '', fullWidth: false, align: 'flex-start',
            customId: '', customClass: '',
          }));
        }
        continue;
      }
    }

    // A classed leaf that holds only text. This design states most of its
    // content that way — `stat-number`, `stat-label`, `program-card-title`,
    // `vision-quote` — rather than as <p>, so without this branch nearly every
    // leaf falls through to an opaque HtmlBlock and the page looks converted
    // while remaining uneditable.
    //
    // Emitted as a Text block carrying the original class, so the design's own
    // rule still styles it and the text becomes editable. Deliberately NOT a
    // Heading: these are divs, and promoting one to an <h2> would change both
    // the document outline and the browser's default sizing.
    // Inline children don't disqualify it: `<div class="stat-label">TEXT<br>MORE
    // TEXT</div>` is still a text leaf, and the markup survives verbatim because
    // a Text block stores innerHTML.
    const kidElements = kid.childNodes.filter((n) => n.nodeType === 1);
    const inlineOnly = kidElements.every((el) => INLINE_TAGS.test((el.rawTagName || '').toLowerCase()));
    // A wrapper of nothing but links is an actions row, not a text leaf —
    // anchors count as inline tags, so without this exclusion a pair of CTA
    // buttons is swallowed as rich text and the client loses the button fields.
    const onlyAnchors = kidElements.length > 0
      && kidElements.every((el) => (el.rawTagName || '').toLowerCase() === 'a');
    if (inlineOnly && !onlyAnchors && /^(div|span|li|footer|figcaption|blockquote|dt|dd|label)$/.test(tag) && textOf(kid)) {
      out.push(make('TextBlock', {
        html: kid.innerHTML.trim(), customClass: cls,
        size: '', align: '', color: '', maxWidth: '', customId: '',
      }));
      continue;
    }

    // A lone wrapper around a single button — very common for spacing.
    const onlyChild = kidElements;
    if (tag === 'div' && onlyChild.length === 1 && (onlyChild[0].rawTagName || '').toLowerCase() === 'a') {
      const anchor = onlyChild[0];
      out.push(make('ButtonBlock', {
        label: textOf(anchor),
        link: { url: anchor.getAttribute('href') || '', newTab: anchor.getAttribute('target') === '_blank' },
        importedClass: anchor.getAttribute('class') || '',
        variant: 'solid', size: 'md', icon: '', iconPosition: 'right',
        background: '', textColor: '', radius: '', fullWidth: false, align: 'flex-start',
        customId: '', customClass: '',
      }));
      continue;
    }

    // An actions row — a wrapper holding nothing but links. Kept as a Column
    // carrying the wrapper class so the design's flex/gap rules still apply;
    // emitting bare buttons would lose the row and stack them.
    if (kidElements.length && kidElements.every((el) => (el.rawTagName || '').toLowerCase() === 'a')) {
      const anchors = kidElements;
      const allImages = anchors.every((anchor) => {
        const inner = anchor.childNodes.filter((n) => n.nodeType === 1);
        return inner.length === 1 && (inner[0].rawTagName || '').toLowerCase() === 'img';
      });
      // <a><img></a> repeated is a logo/avatar strip, not a button row.
      const items = allImages
        ? anchors.map((anchor) => imageSpec(anchor.querySelector('img'), make, {
            url: anchor.getAttribute('href') || '', newTab: anchor.getAttribute('target') === '_blank',
          }))
        : anchors.map((anchor) => buttonSpec(anchor, make));
      out.push(columnSpec(kid, items, make));
      continue;
    }

    // A nested wrapper that still holds real content. Try the full rule set on
    // it first (so an inner card grid becomes a CardGrid rather than a pile of
    // columns), then fall back to recursing into it. Without this, anything one
    // level deeper than the section container — which is most of a real design —
    // collapses into a single uneditable blob.
    if (depth < 3 && RECURSE_TAGS.test(tag) && kidElements.length
        && kid.querySelector('h1, h2, h3, h4, h5, h6, p, img, a')) {
      let nested = null;
      for (const rule of CORE_RULES) { nested = rule(kid, make); if (nested) break; }
      out.push(columnSpec(kid, nested || convertContent(kid, make, depth + 1), make));
      continue;
    }

    if (pendingLabel) {
      out.push(make('HtmlBlock', { markup: pendingLabel.outerHTML.trim(), runScripts: false, customId: '', customClass: '' }));
      pendingLabel = null;
    }
    out.push(make('HtmlBlock', { markup: kid.outerHTML.trim(), runScripts: false, customId: '', customClass: '' }));
  }

  if (pendingLabel) {
    // No heading followed it, so it was never an eyebrow — a standalone
    // eyebrow/label paragraph. Emitted as text carrying its own class so it
    // stays editable and the design keeps styling it.
    out.push(make('TextBlock', {
      html: pendingLabel.innerHTML.trim(), customClass: pendingLabel.getAttribute('class') || '',
      size: '', align: '', color: '', maxWidth: '', customId: '',
    }));
  }
  return out;
}

/* ── Rule: split section ──────────────────────────────────────────────────
 * A two-child container where one side holds a heading and the other an
 * image. Becomes Row → Column + Column, which is what makes it visible and
 * rearrangeable in the Layers panel.
 */
function convertSplit(node, make) {
  const kids = node.childNodes.filter((n) => n.nodeType === 1);
  if (kids.length !== 2) return null;

  const contentIndex = kids.findIndex((k) => k.querySelector('h1, h2, h3, h4'));
  const mediaIndex = kids.findIndex((k, i) => i !== contentIndex && k.querySelector('img'));
  if (contentIndex === -1 || mediaIndex === -1) return null;

  const media = kids[mediaIndex];
  const img = media.querySelector('img');
  // Only a *simple* media side is safe to convert; anything richer (captions,
  // badges, multiple images) stays as HTML so nothing is lost.
  const mediaIsJustAnImage = media.childNodes.filter((n) => n.nodeType === 1).length === 1;

  const column = (source, children) => make('Column', {
    importedClass: (source.getAttribute('class') || ''),
    span: 12, spanTablet: '', spanMobile: '', padding: {}, gap: 16,
    verticalAlign: 'flex-start', horizontalAlign: 'stretch', textAlign: '',
    customId: '', customClass: '',
  }, children);

  const columns = kids.map((kid, index) => {
    if (index === contentIndex) return column(kid, convertContent(kid, make));
    if (index === mediaIndex && mediaIsJustAnImage) {
      return column(kid, [make('ImageBlock', {
        src: img.getAttribute('src') || '', alt: img.getAttribute('alt') || '',
        bare: true, caption: '', fit: '', radius: '', ratio: '', maxWidth: '',
        link: { url: '', newTab: false }, customId: '', customClass: '',
      })]);
    }
    return column(kid, [make('HtmlBlock', { markup: kid.innerHTML.trim(), runScripts: false, customId: '', customClass: '' })]);
  });

  return [make('Row', {
    importedClass: classesOf(node).join(' '),
    mode: 'grid', gap: 0, align: 'stretch', justify: 'flex-start', wrap: true,
    customId: '', customClass: '',
  }, columns)];
}

/* ── Rule: visual banner ──────────────────────────────────────────────────
 * A wrapper holding decorative background/overlay layers plus a content box.
 * The layers must stay inside the wrapper (they're absolutely positioned
 * against it), so they're kept as HTML siblings of the converted content.
 */
function convertBanner(node, make) {
  const kids = node.childNodes.filter((n) => n.nodeType === 1);
  if (kids.length < 2) return null;

  const contentIndex = kids.findIndex((k) => /content|inner|body/i.test(k.getAttribute('class') || ''));
  if (contentIndex === -1) return null;
  const decorative = kids.filter((k, i) => i !== contentIndex);
  if (!decorative.length) return null;
  // Every non-content child must be a decorative layer, or this isn't a banner.
  if (!decorative.every((k) => /bg|overlay|deco|backdrop/i.test(k.getAttribute('class') || ''))) return null;
  if (!kids[contentIndex].querySelector('h1, h2, h3, h4')) return null;

  const children = decorative.map((k) => make('HtmlBlock', {
    markup: k.outerHTML.trim(), runScripts: false, customId: '', customClass: '',
  }));

  children.splice(contentIndex, 0, make('Column', {
    importedClass: kids[contentIndex].getAttribute('class') || '',
    span: 12, spanTablet: '', spanMobile: '', padding: {}, gap: 16,
    verticalAlign: 'flex-start', horizontalAlign: 'stretch', textAlign: '',
    customId: '', customClass: '',
  }, convertContent(kids[contentIndex], make)));

  return [make('Row', {
    importedClass: classesOf(node).join(' '),
    mode: 'grid', gap: 0, align: 'stretch', justify: 'flex-start', wrap: true,
    customId: '', customClass: '',
  }, children)];
}

// Order matters: the most specific shapes are tried first. An explicit grid
// contract outranks everything — it states the design's own structure, rather
// than being inferred from one, and it shields the looser class-suffix rules
// below from matching a layout wrapper by coincidence.
/* ── Rule: decorative separator → Divider ─────────────────────────────────
 * A design's section break is an empty element — no text, no children — that
 * exists purely to be styled (`.section-break { height: 1.5px; background:
 * linear-gradient(...) }`). There is nothing to convert, but leaving it as an
 * HtmlBlock hands the client a block whose settings panel offers raw markup
 * and nothing editable, for what is conceptually the simplest element on the
 * page.
 *
 * Every dimension is left blank on purpose. Divider writes `marginY` inline,
 * and an inline margin beats the design's own `margin: 0` — passing the
 * default 24 would silently add 48px of space the mockup doesn't have.
 * `bx-divider` stays on the element but loses to the design's rule on
 * specificity, so the gradient survives.
 *
 * Guarded to genuine separators: an empty div is just as often a positioned
 * overlay or a JS mount point, and rendering one of those as <hr> would break
 * the layout rather than improve it.
 */
const SEPARATOR_CLASS = /(^|[-_])(break|divider|separator|rule|hr)($|[-_])/i;

function convertSeparator(node, make) {
  const tag = (node.rawTagName || '').toLowerCase();
  if (!/^(div|hr|span)$/.test(tag)) return null;
  if (node.childNodes.filter((n) => n.nodeType === 1).length) return null;
  if (textOf(node)) return null;

  const looksLikeSeparator = node.getAttribute('role') === 'separator'
    || tag === 'hr'
    || classesOf(node).some((c) => SEPARATOR_CLASS.test(c));
  if (!looksLikeSeparator) return null;

  return [make('Divider', {
    customId: '',
    customClass: node.getAttribute('class') || '',
    color: '', thickness: '', marginY: '',
  })];
}

/* ── Rule: embedded video → Video block ───────────────────────────────────
 * A design states its video as a bare <iframe> inside an aspect-ratio
 * wrapper. As an HtmlBlock the client cannot change the video without
 * editing an embed URL by hand, which is exactly the kind of thing they will
 * ask to change and exactly what they cannot do in markup.
 *
 * VideoBlock's own parser accepts watch/embed/short/youtu.be and Vimeo forms,
 * so the iframe src goes straight in and the settings panel offers a plain
 * URL field. The wrapper class rides along: it carries the aspect ratio, and
 * the design's stylesheet loads after ours so it wins over `bx-video`.
 */
function convertVideoEmbed(node, make) {
  const tag = (node.rawTagName || '').toLowerCase();
  const frame = tag === 'iframe' ? node : node.querySelector('iframe');
  if (!frame) return null;

  const src = frame.getAttribute('src') || frame.getAttribute('data-src') || '';
  if (!/(youtube|youtu\.be|vimeo)/i.test(src)) return null;

  // Only a wrapper that is *just* the embed. Anything richer (a caption, a
  // play-button overlay, a poster image) keeps its markup rather than losing
  // the parts VideoBlock has nowhere to store.
  if (tag !== 'iframe') {
    const els = node.querySelectorAll('*');
    if (els.length !== 1) return null;
  }

  return [make('VideoBlock', {
    customId: '',
    customClass: tag === 'iframe' ? '' : (node.getAttribute('class') || ''),
    url: src,
    poster: '', autoplay: false, loop: false, muted: false, controls: true,
  })];
}

/* ── Shared spec builders ─────────────────────────────────────────────── */

// Wrappers worth descending into. Excludes nav/form/table, whose semantics a
// column tree would not preserve.
const RECURSE_TAGS = /^(div|section|article|aside|blockquote|figure|header|footer|li)$/;

function buttonSpec(anchor, make) {
  return make('ButtonBlock', {
    label: textOf(anchor),
    link: { url: anchor.getAttribute('href') || '', newTab: anchor.getAttribute('target') === '_blank' },
    importedClass: anchor.getAttribute('class') || '',
    variant: 'solid', size: 'md', icon: '', iconPosition: 'right',
    background: '', textColor: '', radius: '', fullWidth: false, align: 'flex-start',
    customId: '', customClass: '',
  });
}

function imageSpec(img, make, link) {
  if (!img) return make('HtmlBlock', { markup: '', runScripts: false, customId: '', customClass: '' });
  return make('ImageBlock', {
    src: img.getAttribute('src') || '', alt: img.getAttribute('alt') || '',
    bare: true, caption: '', fit: '', radius: '', ratio: '', maxWidth: '',
    link: link || { url: '', newTab: false },
    customId: '', customClass: img.getAttribute('class') || '',
  });
}

// Reproduces a design wrapper as a Column: same class, same inline style.
// Column drops its own `bx-col` layout when importedClass is set, so the DOM
// shape the stylesheet expects survives the conversion.
function columnSpec(node, children, make) {
  return make('Column', {
    importedClass: node.getAttribute('class') || '',
    importedStyle: node.getAttribute('style') || '',
    span: 12, spanTablet: '', spanMobile: '', padding: {}, gap: 0,
    verticalAlign: 'flex-start', horizontalAlign: 'stretch', textAlign: '',
    customId: '', customClass: '',
  }, children);
}

/* ── Rule: anything else made of recognisable content ──────────────────────
 * The catch-all, deliberately last. Runs the same vocabulary convertContent
 * uses over a single top-level block, so a section whose content sits one
 * wrapper deep still becomes Heading / Text / Button / Image rather than raw
 * markup. Returns null when it produced nothing but an HtmlBlock, so a block
 * it cannot improve is still reported honestly as unconverted.
 */
function convertContentBlock(node, make) {
  const specs = convertKids([node], make, 0);
  if (!specs.length) return null;
  if (specs.every((spec) => spec.type === 'HtmlBlock')) return null;
  return specs;
}

// Tried against nested wrappers too; must not include convertContentBlock, or
// a block would hand itself straight back and recurse forever.
const CORE_RULES = [convertSeparator, convertVideoEmbed, convertNsCardGrid, convertNsGrid, convertSectionHeader, convertCardGrid, convertBanner, convertSplit];
const RULES = [...CORE_RULES, convertContentBlock];

/**
 * Convert one top-level design section into a Craft node subtree.
 *
 * Returns `{ children, converted, total }` where `children` are node specs for
 * a Column. Anything no rule matches is emitted as an HtmlBlock, so the output
 * always renders identically to the source.
 */
function convertSection(sectionNode, make) {
  // Most designs wrap section content in a `.container` for max-width; walk
  // into it so we convert the content rather than the wrapper.
  const inner = sectionNode.querySelector('.container, .wrapper, .inner, .wrap') || sectionNode;
  const kids = inner.childNodes.filter((n) => n.nodeType === 1);

  // A section with no element children is still a section — a decorative rule
  // (<div class="section-break">) is the common case. The loop below walks
  // children, so such a section produced nothing at all and fell through to
  // raw HTML no matter which rules were registered. Treat the section itself
  // as the block in that case.
  const blocks = kids.length ? kids : [inner];

  const children = [];
  let converted = 0;

  for (const block of blocks) {
    let result = null;
    for (const rule of RULES) {
      result = rule(block, make);
      if (result) break;
    }
    if (result) {
      children.push(...result);
      converted += 1;
      // eslint-disable-next-line no-continue
      continue;
    } else {
      children.push(make('HtmlBlock', {
        markup: block.outerHTML.trim(),
        runScripts: false,
        customId: '',
        customClass: '',
      }));
    }
  }

  // `containerClass` is the class of the wrapper we descended through (e.g.
  // `.wrap`). It usually carries max-width / margin-inline / padding-inline
  // as well as layout, so the caller has to re-apply it — dropping it sends
  // every converted section edge-to-edge while looking structurally correct.
  return {
    children,
    converted,
    total: blocks.length,
    usedContainer: inner !== sectionNode,
    containerClass: inner !== sectionNode ? (inner.getAttribute('class') || '') : '',
  };
}

module.exports = { convertSection, hasClass, textOf };
