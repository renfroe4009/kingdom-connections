// Shared helpers for builder nodes.
//
// STYLING RULE: components emit dynamic values as inline CSS *variables*
// (`--bx-btn-bg`) which a class in site.css consumes — never inline
// declarations. Inline declarations beat every external stylesheet, so they
// make per-page custom CSS and site-wide overrides impossible. Inline
// variables don't.

import { useCallback } from 'react';
import { useEditor, useNode } from '@craftjs/core';

/**
 * Build a style object of CSS custom properties, dropping empty values so the
 * stylesheet's own default wins instead of an empty string killing the
 * cascade. This is what lets a colour setting mean "inherit from the theme".
 *
 * Numbers are emitted verbatim — units are the caller's job, via px() below.
 * Appending px automatically looks convenient but silently corrupts the
 * unitless variables (grid spans, column counts, font weights): `span 12px` is
 * an invalid grid-column, so the declaration is dropped and the column
 * collapses to auto width.
 */
export function cssVars(map) {
  const out = {};
  for (const [key, value] of Object.entries(map || {})) {
    if (value === '' || value === null || value === undefined) continue;
    out[key] = typeof value === 'number' ? String(value) : value;
  }
  return out;
}

/**
 * Parse an element's inline `style` attribute into a React style object.
 *
 * Needed by imported nodes whose *placement* lives in inline custom properties
 * rather than in a class. A design may declare its grid contract as
 * `<div class="ns-block" style="--col-start:1; --col-span:7">` — the class
 * carries the rule (`grid-column: var(--col-start) / span var(--col-span)`)
 * and the inline properties carry the per-cell values. Drop the inline half
 * and every cell falls back to the rule's defaults, collapsing the whole grid
 * to a single stacked column.
 *
 * Custom properties are passed through verbatim (React sets any `--*` key as
 * written); ordinary declarations are camelCased, since React rejects
 * `background-image` but accepts `backgroundImage`.
 */
export function parseInlineStyle(css) {
  const out = {};
  if (!css || typeof css !== 'string') return out;
  for (const declaration of css.split(';')) {
    const at = declaration.indexOf(':');
    if (at === -1) continue;
    const prop = declaration.slice(0, at).trim();
    const value = declaration.slice(at + 1).trim();
    if (!prop || !value) continue;
    out[prop.startsWith('--')
      ? prop
      : prop.replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = value;
  }
  return out;
}

/**
 * Emit the values a user explicitly set in the settings panel.
 *
 * Normally these go out as CSS custom properties, consumed by a class in
 * site.css — that keeps per-page and site-wide CSS able to override them.
 *
 * An *imported* block is different. It carries the original design's class
 * names (`section-title`, `section--muted`) so the imported stylesheet keeps
 * styling it. But that stylesheet is injected after site.css, and at equal
 * specificity the later rule wins — so `.section-title { font-size: … }` beats
 * `.bx-heading { font-size: var(--bx-heading-size) }` and the panel control
 * silently does nothing. For those blocks an explicit choice has to be an
 * inline declaration to take effect at all.
 *
 * Only values the user actually set are emitted either way, so leaving a field
 * blank still means "inherit from the design".
 */
export function styleOverrides({ vars, direct, imported }) {
  return cssVars(imported ? direct : vars);
}

/** Add `px` to a bare number; pass strings (`2rem`, `50%`) through untouched. */
export function px(value) {
  if (value === '' || value === null || value === undefined) return '';
  return typeof value === 'number' ? `${value}px` : value;
}

/** `{top,right,bottom,left}` → a CSS shorthand, skipping unset sides. */
export function spacingToCss(spacing) {
  if (!spacing) return '';
  const sides = ['top', 'right', 'bottom', 'left'];
  if (sides.every((s) => spacing[s] === '' || spacing[s] === undefined)) return '';
  return sides.map((s) => `${Number(spacing[s]) || 0}px`).join(' ');
}

/** Join truthy class names. */
export function cx(...parts) {
  return parts.filter(Boolean).join(' ');
}

/**
 * The ref every node attaches to its outermost DOM element. Connects the node
 * to Craft's tree and makes it draggable while editing.
 */
export function useNodeRef() {
  const {
    connectors: { connect, drag },
  } = useNode();
  return useCallback(
    (el) => {
      if (el) connect(drag(el));
    },
    [connect, drag],
  );
}

/**
 * True while the builder is in edit mode; false on the live site.
 *
 * The collector MUST return an object. Craft spreads the collected value into
 * its return — spreading a bare boolean yields `{}`, so a collector like
 * `(state) => state.options.enabled` silently produces `undefined` and every
 * caller quietly behaves as if it were on the live site.
 */
export function useIsEditing() {
  const { enabled } = useEditor((state) => ({ enabled: state.options.enabled }));
  return Boolean(enabled);
}

/**
 * A stable, unique DOM id for a node, plus the user's overrides.
 *
 * Craft node ids survive serialize/deserialize, so `section-<nodeId>` is
 * stable across saves. Without a real id, per-section custom CSS and anchor
 * links (`#services`) are impossible and two instances of the same component
 * can't be styled differently.
 */
export function useDomIdentity(prefix = 'section') {
  const { id, customId, customClass } = useNode((node) => ({
    customId: node.data.props.customId,
    customClass: node.data.props.customClass,
  }));
  return {
    nodeId: id,
    domId: (customId || '').trim() || `${prefix}-${id}`,
    customClass: (customClass || '').trim(),
  };
}

/** Props every node that supports identity/custom CSS shares. */
export const IDENTITY_DEFAULTS = { customId: '', customClass: '' };

/** Anchor-safe slug, used to suggest a Custom ID from a heading. */
export function slugify(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/** Normalize a user-entered link so `about` behaves like `/about`. */
export function resolveHref(url) {
  const value = String(url || '').trim();
  if (!value) return undefined;
  if (/^(https?:|mailto:|tel:|#|\/)/i.test(value)) return value;
  return `/${value}`;
}

/* ── Inline HTML for repeater fields ──────────────────────────────────────────
 * Card titles and copy need a little markup: designs routinely accent one word
 * (`Become Part of This <span class="gold">Growing Movement</span>`) or style a
 * suffix separately (`50,000<span>+</span>`). Flattening those to text loses
 * the design, so these fields store markup.
 *
 * Storing markup means rendering it, and this content reaches a public page —
 * so it is filtered to an inline allowlist rather than injected as-is. Anything
 * outside the list is *unwrapped*, not deleted: the text survives even when the
 * tag doesn't, so a paste from Word can't silently empty a card.
 *
 * Block tags are excluded on purpose — a <div> or <table> inside a card title
 * would break the card's layout, not just its styling.
 */
const INLINE_ALLOWED_TAGS = new Set([
  'BR', 'STRONG', 'B', 'EM', 'I', 'SPAN', 'SMALL', 'SUP', 'SUB', 'U', 'A', 'MARK', 'CODE',
]);
const INLINE_ALLOWED_ATTRS = new Set(['class', 'href', 'target', 'rel', 'title', 'style']);
const INLINE_DROP_TAGS = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'NOSCRIPT', 'TEMPLATE']);

export function sanitizeInline(html) {
  const value = typeof html === 'string' ? html : '';
  if (!value) return '';
  // No DOM (SSR/tests): return the text with tags stripped rather than trusting it.
  if (typeof document === 'undefined') return value.replace(/<[^>]*>/g, '');

  const tpl = document.createElement('template');
  tpl.innerHTML = value;

  const clean = (node) => {
    for (const child of [...node.childNodes]) {
      if (child.nodeType === 3) continue;            // text — keep
      if (child.nodeType !== 1) { child.remove(); continue; }  // comments etc.

      clean(child);                                   // depth-first

      // Script/style/frame content is never meant to be read. Unwrapping one
      // would leave its source visible as literal text — inert, but nonsense
      // on the page. Drop the element and its contents outright.
      if (INLINE_DROP_TAGS.has(child.tagName)) { child.remove(); continue; }

      if (!INLINE_ALLOWED_TAGS.has(child.tagName)) {
        child.replaceWith(...child.childNodes);       // unwrap, keep the text
        continue;
      }
      for (const attr of [...child.attributes]) {
        const name = attr.name.toLowerCase();
        // on* handlers are the reason this function exists.
        if (!INLINE_ALLOWED_ATTRS.has(name)) { child.removeAttribute(attr.name); continue; }
        if (name === 'href' && /^\s*(javascript|data):/i.test(attr.value)) child.removeAttribute(attr.name);
      }
    }
  };
  clean(tpl.content);
  return tpl.innerHTML;
}
